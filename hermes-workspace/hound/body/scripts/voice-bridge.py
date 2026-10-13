#!/usr/bin/env python3
"""Voice bridge: mic -> whisper -> text -> model routing -> TTS -> audio.

WebSocket server on port 8092.
Routes: body model (8093) for casual chat, brain (10.0.0.1:8080) for complex requests.

Multi-client event forwarding:
  - HUD clients register via {type: "registerHud"}
  - wake-word-detector sends events via {type: "wakeWord"} etc.
  - Events are broadcast to all registered HUD clients

Detector support (Phase 2):
  - detectorCommand messages relayed to detector-server on :18765
  - faceDetected events polled from /tmp/hound-detection.json and forwarded to HUD clients
"""
import asyncio
import websockets
import aiohttp
import base64
import json
import os
import subprocess
import tempfile
from typing import Set

WHISPER_URL = "http://localhost:8090/inference"
TTS_URL = "http://localhost:8091/speak"
BODY_MODEL_URL = "http://localhost:8093/v1/chat/completions"
BRAIN_MODEL_URL = "http://10.0.0.1:8080/v1/chat/completions"
PORT = 8092
WHISPER_TIMEOUT = aiohttp.ClientTimeout(total=30.0)
MODEL_TIMEOUT = aiohttp.ClientTimeout(total=60.0)

BODY_SYSTEM_PROMPT = (
    "You are HOUND, a small AI assistant running on the body computer. "
    "You handle casual conversation, greetings, simple questions, and status updates. "
    "If a user asks for complex work - coding, research, analysis, writing, or anything "
    "needing computation - say exactly: 'I will ask the main AI.' and nothing more. "
    "Keep responses short, under 3 sentences."
)

# Multi-client event forwarding
hud_clients: Set[websockets.WebSocketServerProtocol] = set()
event_queue: asyncio.Queue = asyncio.Queue()

# Detector state
detector_last_event = None
detector_last_update = 0
DETECTION_FILE = "/tmp/hound-detection.json"
DETECTION_POLL_INTERVAL = 2.0  # seconds

camera_state = "inactive"  # Track locally to prevent redundant command spam


async def convert_webm_to_wav(webm_bytes: bytes) -> bytes:
    try:
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as w:
            w.write(webm_bytes)
            webm_path = w.name
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as wav_out:
            wav_path = wav_out.name
        subprocess.run(
            ['ffmpeg', '-y', '-i', webm_path,
             '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wav_path],
            capture_output=True, timeout=15
        )
        wav_data = open(wav_path, 'rb').read()
        os.unlink(webm_path)
        os.unlink(wav_path)
        return wav_data
    except Exception as e:
        print(f"WebM->WAV convert error: {e}", flush=True)
        return webm_bytes


async def transcribe(audio_bytes: bytes, content_type: str = 'audio/wav') -> str:
    try:
        async with aiohttp.ClientSession(timeout=WHISPER_TIMEOUT) as session:
            data = aiohttp.FormData()
            data.add_field('file', audio_bytes, filename='audio.wav', content_type=content_type)
            data.add_field('response_format', 'json', content_type='text/plain')
            async with session.post(WHISPER_URL, data=data) as resp:
                raw = await resp.read()
                text_only = raw.decode('utf-8', errors='replace')
                if not text_only.strip():
                    return ""
                result = json.loads(text_only)
                return result.get('text', '').strip()
    except json.JSONDecodeError:
        return ""
    except Exception as e:
        return f"error: {e}"


async def synthesize(text: str) -> bytes:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(TTS_URL, data=text.encode()) as resp:
                if 'json' in resp.headers.get('Content-Type', ''):
                    return b'{"error": "TTS error"}'
                return await resp.read()
    except Exception as e:
        return f'{{"error": "{e}"}}'.encode()


async def query_model(prompt: str, use_body: bool = True) -> str:
    system_prompt = BODY_SYSTEM_PROMPT
    if not use_body:
        system_prompt = (
            "You are the main AI assistant. Handle complex requests - coding, "
            "research, analysis, writing. Be thorough and helpful."
        )

    url = BODY_MODEL_URL if use_body else BRAIN_MODEL_URL
    payload = {
        "model": "local",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 512,
        "temperature": 0.7,
        "stream": False
    }

    try:
        async with aiohttp.ClientSession(timeout=MODEL_TIMEOUT) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    return f"error: model returned {resp.status}"
                result = await resp.json()
                return result['choices'][0]['message']['content']
    except aiohttp.ClientConnectorError:
        if use_body:
            return await query_model(prompt, use_body=False)
        return "error: no model available"
    except asyncio.TimeoutError:
        if use_body:
            return await query_model(prompt, use_body=False)
        return "error: model timed out"
    except Exception as e:
        return f"error: {e}"


async def relay_detector_command(command: str) -> dict:
    """Relay a detector command to the detector-server on :18765."""
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", 18765, limit=65536)
        writer.write((command + "\n").encode())
        await writer.drain()
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        print(f"[bridge] detector command relayed: {command}", flush=True)
        return {"status": "ok", "command": command}
    except Exception as e:
        print(f"[bridge] detector command failed: {e}", flush=True)
        return {"status": "error", "detail": str(e)}


async def handle_camera_command(command: str) -> dict:
    """Toggle MJPEG stream via the local control endpoint on :8085."""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5.0)) as session:
            async with session.get(f"http://127.0.0.1:8085/{command}") as resp:
                text = await resp.text()
                print(f"[bridge] mjpeg {command}: {text}", flush=True)
                return {"status": "ok", "command": command, "mjpeg": text}
    except Exception as e:
        print(f"[bridge] mjpeg {command} failed: {e}", flush=True)
        return {"status": "error", "command": command, "detail": str(e)}


async def poll_detection_file() -> dict | None:
    """Poll /tmp/hound-detection.json for new events from detector-server."""
    global detector_last_event
    try:
        if not os.path.exists(DETECTION_FILE):
            # Detector stopped / cleared the file (on stop, on freeze, on
            # restart): reset the dedupe cache so a stale event can't be
            # held forever, and the detector's next real event always lands.
            detector_last_event = None
            return None
        with open(DETECTION_FILE, 'r') as f:
            new_event = json.loads(f.read())
        # Only return if event changed
        if new_event != detector_last_event:
            detector_last_event = new_event
            return new_event
    except Exception as e:
        print(f"[bridge] detection poll error: {e}", flush=True)
    return None


async def broadcast_to_hud_clients(message: dict):
    """Broadcast a message to all registered HUD clients."""
    if not hud_clients:
        return
    payload = json.dumps(message)
    closed = set()
    for client in hud_clients:
        try:
            await client.send(payload)
        except websockets.exceptions.ConnectionClosed:
            closed.add(client)
    for client in closed:
        hud_clients.discard(client)


async def detector_poller():
    """Poll the detection file and broadcast new events to HUD clients."""
    global detector_last_update
    while True:
        try:
            now = asyncio.get_event_loop().time()
            if now - detector_last_update >= DETECTION_POLL_INTERVAL:
                event = await poll_detection_file()
                if event and event.get("type") in ("faceDetected",):
                    print(f"[bridge] forwarding detection: {event.get('status', 'unknown')}", flush=True)
                    await broadcast_to_hud_clients(event)
                    detector_last_update = now
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[bridge] detector poller error: {e}", flush=True)
        await asyncio.sleep(0.5)


async def event_forwarder():
    """Listen for events from any client and forward to HUD clients."""
    while True:
        try:
            msg = await event_queue.get()
            await broadcast_to_hud_clients(msg)
            event_queue.task_done()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Event forwarder error: {e}", flush=True)


async def handle_client(websocket):
    """Handle a single WebSocket client.
    
    All clients can send mic/command/chat messages (like the old bridge).
    HUD clients register via registerHud to receive event forwarding.
    Events from wake-word-detector are forwarded to HUD clients.
    detectorCommand messages are relayed to detector-server.
    """
    global camera_state
    print(f"Client connected: {websocket.remote_address}", flush=True)
    
    try:
        async for message in websocket:
            try:
                msg = json.loads(message)
            except Exception:
                msg = {}

            msg_type = msg.get('type', '')

            # Register HUD client for event forwarding
            if msg_type == 'registerHud':
                hud_clients.add(websocket)
                print(f"HUD client registered ({len(hud_clients)} total)", flush=True)
                await websocket.send(json.dumps({"type": "registered", "data": "hud"}))
                continue

            # Lock screen HUD ready
            if msg_type == 'hudReady':
                print("HUD ready signal received", flush=True)
                continue

            # Forward events from wake-word-detector to HUD clients
            if msg_type in ('wakeWord', 'faceMatch', 'unlocked'):
                print(f"Event received: {msg_type}", flush=True)
                await event_queue.put(msg)
                continue

            # Camera command — toggle MJPEG stream on body
            if msg_type == 'cameraCommand':
                command = msg.get('command', '')
                
                # Guard: ignore redundant commands to prevent idle-timer spam & feedback loops
                if command == "start" and camera_state == "active":
                    print(f"[bridge] ignoring redundant start", flush=True)
                    await websocket.send(json.dumps({"type": "cameraStatus", "state": "active"}))
                    continue
                if command == "stop" and camera_state == "inactive":
                    print(f"[bridge] ignoring redundant stop", flush=True)
                    await websocket.send(json.dumps({"type": "cameraStatus", "state": "inactive"}))
                    continue
                
                print(f'[bridge] cameraCommand: {command}', flush=True)
                result = await handle_camera_command(command)
                camera_state = "active" if command == "start" else "inactive"
                await broadcast_to_hud_clients(json.dumps({
                    "type": "cameraStatus",
                    "state": camera_state,
                    "status": result.get("status")
                }))
                continue

            # Relay detector commands to detector-server
            if msg_type == 'detectorCommand':
                command = msg.get('command', '')
                print(f"detectorCommand: {command}", flush=True)
                result = await relay_detector_command(command)
                await websocket.send(json.dumps({
                    "type": "detectorResponse",
                    "command": command,
                    "status": result.get("status")
                }))
                continue

            # Face verification command — run face-verify.py and report result
            if msg_type == 'faceVerifyCommand' and msg.get('command') == 'start':
                print("[bridge] faceVerifyCommand: start", flush=True)
                try:
                    import subprocess as sp, json as j
                    face_result = sp.run(
                        ['python3', '/opt/ollie-body/bin/face-verify.py'],
                        capture_output=True, text=True, timeout=15
                    )
                    match_data = {}
                    if os.path.exists('/tmp/face-match.json'):
                        with open('/tmp/face-match.json', 'r') as f:
                            match_data = j.loads(f.read())
                    result_msg = {
                        'type': 'faceMatch',
                        'match': match_data.get('match', False)
                    }
                    if face_result.returncode != 0:
                        result_msg['error'] = face_result.stderr.strip()[:200]
                    await websocket.send(json.dumps(result_msg))
                except Exception as e:
                    await websocket.send(json.dumps({
                        'type': 'faceMatch',
                        'match': False,
                        'error': str(e)
                    }))
                continue

            # All clients can send mic/command/chat (same as old bridge)
            if msg_type == 'mic':
                data_value = msg.get('data', '')
                if data_value and all(c in '0123456789abcdefABCDEF' for c in data_value[:50]):
                    audio_data = bytes.fromhex(data_value)
                else:
                    audio_data = base64.b64decode(data_value)

                if not audio_data:
                    await websocket.send(json.dumps({"type": "error", "data": "empty audio"}))
                    continue

                print(f"Received {len(audio_data)} bytes audio (raw)", flush=True)

                if len(audio_data) > 4 and audio_data[:4] == b'\x1a\x45\xdf\xa3':
                    print("Detected WebM format, converting to WAV...", flush=True)
                    audio_data = await convert_webm_to_wav(audio_data)
                    print(f"Converted to {len(audio_data)} bytes WAV", flush=True)

                text = await transcribe(audio_data)
                print(f"Transcribed: '{text}' (len={len(text)})", flush=True)

                if not text or text.startswith('error'):
                    await websocket.send(json.dumps({"type": "text", "data": text or "no speech"}))
                    continue

                reply = await query_model(text)
                print(f"Model replied: '{reply}'", flush=True)

                tts_audio = await synthesize(reply)
                if len(tts_audio) > 100:
                    audio_b64 = base64.b64encode(tts_audio).decode()
                    await websocket.send(json.dumps({
                        "type": "tts_audio",
                        "data": audio_b64,
                        "text": reply
                    }))
                else:
                    await websocket.send(json.dumps({"type": "text", "data": reply}))

            elif msg_type == 'command':
                text = msg.get('data', '')
                print(f"Command: '{text}'", flush=True)

                reply = await query_model(text)
                print(f"Model replied: '{reply}'", flush=True)

                tts_audio = await synthesize(reply)
                if len(tts_audio) > 100:
                    audio_b64 = base64.b64encode(tts_audio).decode()
                    await websocket.send(json.dumps({
                        "type": "tts_audio",
                        "data": audio_b64,
                        "text": reply
                    }))
                else:
                    await websocket.send(json.dumps({"type": "text", "data": reply}))

            elif msg_type == 'chat':
                text = msg.get('data', '')
                print(f"Chat: '{text}'", flush=True)

                reply = await query_model(text)
                print(f"Model replied: '{reply}'", flush=True)

                await websocket.send(json.dumps({
                    "type": "chat_reply",
                    "data": reply,
                    "text": reply
                }))

            else:
                await websocket.send(json.dumps({"type": "error", "data": f"unknown type: {msg_type}"}))

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"Error: {e}", flush=True)
    finally:
        if websocket in hud_clients:
            hud_clients.discard(websocket)
            print(f"HUD client disconnected ({len(hud_clients)} remaining)", flush=True)
        print(f"Client disconnected: {websocket.remote_address}", flush=True)


async def main():
    """Start the voice bridge server."""
    print(f"Voice bridge starting on port {PORT}", flush=True)
    
    forwarder = asyncio.create_task(event_forwarder())
    detector_poll = asyncio.create_task(detector_poller())
    
    async with websockets.serve(handle_client, "0.0.0.0", PORT):
        print(f"Voice bridge running on ws://0.0.0.0:{PORT}", flush=True)
        await asyncio.Future()
    
    forwarder.cancel()
    detector_poll.cancel()


if __name__ == '__main__':
    asyncio.run(main())

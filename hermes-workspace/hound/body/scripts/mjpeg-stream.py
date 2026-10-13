#!/usr/bin/env python3
"""MJPEG stream server - C920 -> :8082 (SHARED-ENCODER design)

2026-09-27: per-connection ffmpeg + watchdog/write-timeout leak fix.
  Still wrong: every client connection spawned its own ffmpeg, and the
  C920 USB camera can only be held by ONE ffmpeg at a time. With 2+ live
  clients (kiosk preview + detector, or a kiosk reload racing the old tab)
  the second ffmpeg could not open /dev/video0, died, restarted, and the
  whole box fell into a spawn loop (58+ encoders, load 70, service crash).

2026-09-29 (this version): ONE shared encoder for the server's lifetime,
  fanned out to all clients.
  - Camera contention: impossible (single ffmpeg).
  - Leaks: a client thread can only die when a write to a dead peer
    raises (10s write timeout) — it owns no ffmpeg, so dying is clean.
    CLOSE-WAIT clients are reaped by the write timeout.
  - Encoder death: detected by the frame reader, respawned once; the
    camera is released with it, so respawn can re-open /dev/video0.
  - Backpressure: a client that can't keep up gets one 1MB buffer of
    frames, then is dropped (write timeout / full buffer) and reaped.
    It reconnects on its own.
  - Connection cap: 3 live clients max; extras get a 503 and retry.
    (Kiosk + detector + 1 headroom. Prevents any future cascade.)

2026-10-11: HTTP control endpoints /stop and /start (port 8083) for
  camera lifecycle: HUD tells MJPEG service to kill/respawn ffmpeg when
  the lock screen activates / deactivates.

2026-10-13: Connection lifecycle fix: guard against duplicates, add
  periodic cleanup for stale CLOSE-WAIT connections to prevent 503 block.
"""
import socketserver
import struct
import subprocess
import threading
import time
import http.server
import signal as _sig_import
import urllib.request as _urllib
import grp
import os
import socket
import select

# Ensure video group membership for /dev/video0 access.
# systemd user services drop supplementary groups; re-add video ourselves.
try:
    os.setgroups(list(os.getgroups()) + [grp.getgrnam("video").gr_gid])
except PermissionError:
    pass  # already has group

CAMERA = "/dev/video0"
WIDTH = 640
HEIGHT = 480
FPS = 15
PORT = int(os.environ.get("MJPEG_PORT", "8084"))
BOUNDARY = "frame"
SOI = b"\xff\xd8"
EOI = b"\xff\xd9"
WRITE_TIMEOUT = 10    # seconds; dead/slow peers fail fast
MAX_CLIENTS = 3
MAX_BUF = 10 * 1024 * 1024
MAX_FRAME = 1024 * 1024


def log(msg):
    print(f"MJPEG: {msg}", flush=True)


def spawn_ffmpeg():
    return subprocess.Popen(
        ["ffmpeg", "-y", "-f", "v4l2",
         "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS),
         "-i", CAMERA,
         "-f", "image2pipe", "-pix_fmt", "yuvj420p",
         "-vcodec", "mjpeg", "-q:v", "5", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=10**5)


class SharedEncoder:
    """One ffmpeg for the lifetime of the server; clients read its ring."""

    def __init__(self):
        self.procs = []            # live ffmpeg Popen objects
        self.buf = b""
        self.frame = b""           # latest complete JPEG
        self.frame_seq = 0         # incremented per new frame
        self.cv = threading.Condition()
        self._stop = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        # Guard: don't spawn duplicate reader threads if one is already running
        if getattr(self, '_reader', None) and self._reader.is_alive():
            log("encoder already running")
            return
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        log("shared encoder started")

    def _ensure_proc(self) -> subprocess.Popen:
        with self._lock:
            alive = [p for p in self.procs if p.poll() is None]
            for p in self.procs:
                if p not in alive:
                    try:
                        p.kill()
                    except Exception:
                        pass
            self.procs = alive
            if alive:
                return alive[0]
            t0 = time.time()
            while True:
                try:
                    p = spawn_ffmpeg()
                    self.procs.append(p)
                    log("ffmpeg spawned (pid %d)" % p.pid)
                    return p
                except Exception as e:
                    log(f"spawn error: {e}")
                    time.sleep(0.5)
                    if time.time() - t0 > 30:
                        raise

    def _read_loop(self):
        while not self._stop.is_set():
            try:
                p = self._ensure_proc()
                self.buf = b""
                while not self._stop.is_set():
                    c = p.stdout.read(65536)
                    if not c:
                        log("ffmpeg died, releasing camera and respawning")
                        stderr_output = ""
                        try:
                            stderr_output = p.stderr.read().decode(errors="replace") if p.stderr else ""
                        except:
                            pass
                        log(f"ffmpeg stderr: {stderr_output[:500]}")
                        try:
                            p.terminate()
                            p.wait(timeout=5)
                        except Exception:
                            try:
                                p.kill()
                            except Exception:
                                pass
                        with self._lock:
                            try:
                                import os
                                os.waitpid(p.pid, 0)
                            except ChildProcessError:
                                pass
                            self.procs = [q for q in self.procs if q is not p]
                        break
                    self.buf += c
                    s = self.buf.find(SOI)
                    if s < 0:
                        if len(self.buf) > MAX_BUF:
                            self.buf = b""
                        continue
                    if len(self.buf) < s + 4:
                        continue
                    e = self.buf.find(EOI, s + 2)
                    if e < 0:
                        if len(self.buf) - s > MAX_FRAME:
                            self.buf = b""
                        continue
                    frame = self.buf[s:e + 2]
                    self.buf = self.buf[e + 2:]
                    with self.cv:
                        self.frame = frame
                        self.frame_seq += 1
                        self.cv.notify_all()
            except Exception as e:
                log(f"reader error: {e}")
                time.sleep(1)

    def get_frame(self, timeout=5.0, since_seq=0):
        """Block until a frame newer than since_seq is available.

        Returns (frame_bytes, new_seq) or (None, None).
        """
        with self.cv:
            ok = self.cv.wait_for(lambda: self.frame_seq != since_seq, timeout=timeout)
            if ok:
                return self.frame, self.frame_seq
        return None, None

    def stop(self):
        self._stop.set()
        with self._lock:
            for p in self.procs:
                try:
                    p.terminate()
                    p.wait(timeout=3)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
            self.procs = []


def _periodic_cleanup():
    """Periodically scan CLIENTS and remove stale CLOSE-WAIT connections."""
    while True:
        time.sleep(30)
        dead = []
        with CLIENTS_LOCK:
            for client in list(CLIENTS):
                sock = client.request
                try:
                    readable, _, _ = select.select([sock], [], [], 0)
                    if readable:
                        peek = sock.recv(1, socket.MSG_PEEK)
                        if not peek:
                            dead.append(client)
                except (OSError, AttributeError):
                    dead.append(client)
        for c in dead:
            CLIENTS.discard(c)
            log("periodic cleanup: removed dead client")
            try:
                c.request.close()
            except Exception:
                pass


class ControlHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP server for /stop and /start endpoints."""

    def log_message(self, format, *args):
        pass  # suppress control request logs

    def do_GET(self):
        if self.path == '/stop':
            if ENC._stop.is_set():
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'already stopped')
                return
            ENC.stop()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'stopped')
        elif self.path == '/start':
            ENC._stop.clear()
            ENC.start()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'started')
        else:
            self.send_response(404)
            self.end_headers()


def start_control_server(port=8083):
    httpd = http.server.HTTPServer(('127.0.0.1', port), ControlHandler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    print(f"[mjpeg] control server on :{port}", flush=True)


ENC = SharedEncoder()
CLIENTS = set()
CLIENTS_LOCK = threading.Lock()

# Module-level ref for SIGTERM handler
_httpd_ref = None


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        global CLIENTS
        with CLIENTS_LOCK:
            # A) Guard against duplicate connections
            if self in CLIENTS:
                log("duplicate client, ignoring")
                self.request.close()
                return
            if len(CLIENTS) >= MAX_CLIENTS:
                self.request.sendall(
                    b"HTTP/1.1 503 Too Many Connections\r\n"
                    b"Content-Length: 22\r\n\r\n503 too many clients\r\n")
                self.request.close()
                return
            CLIENTS.add(self)
        log(f"client connected ({len(CLIENTS)}/{MAX_CLIENTS})")
        try:
            self.request.sendall(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: multipart/x-mixed-replace; boundary=" +
                BOUNDARY.encode() + b"\r\n"
                b"Cache-Control: no-cache, no-store\r\n\r\n")
            # SO_SNDTIMEO: writes to a dead/slow peer raise after 10s
            self.request.setsockopt(
                socket.SOL_SOCKET, socket.SO_SNDTIMEO,
                struct.pack("ll", WRITE_TIMEOUT, 0))
            last_seq = 0
            while True:
                frame, seq = ENC.get_frame(timeout=30, since_seq=last_seq)
                if frame is None:
                    # No new frame in 30s: encoder is down; client just
                    # waits for it to come back. (Kiosk shows last frame.)
                    continue
                last_seq = seq
                chunk = b"--" + BOUNDARY.encode() + b"\r\n" \
                        b"Content-Type: image/jpeg\r\n" \
                        b"Content-Length: " + str(len(frame)).encode() + \
                        b"\r\n\r\n" + frame + b"\r\n"
                self.request.sendall(chunk)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            # B) Disconnect handler: remove client from CLIENTS on close
            with CLIENTS_LOCK:
                CLIENTS.discard(self)
            log(f"client gone ({len(CLIENTS)}/{MAX_CLIENTS})")
            try:
                self.request.close()
            except Exception:
                pass


def _sigterm_handler(signum, frame):
    ENC.stop()
    if _httpd_ref is not None:
        _httpd_ref.shutdown()
    exit(0)


def main():
    global _httpd_ref
    ENC.start()
    # Wait for the first frame before accepting clients (avoids a client
    # blocking 30s on a camera that hasn't opened yet).
    first, _ = ENC.get_frame(timeout=30, since_seq=0)
    if first is None:
        log("WARNING: no frame within 30s, accepting clients anyway")
    socketserver.TCPServer.allow_reuse_address = True
    # Start control endpoint (local-only, not exposed)
    start_control_server(int(os.environ.get("MJPEG_CONTROL_PORT", "8085")))
    # C) Start periodic cleanup thread
    threading.Thread(target=_periodic_cleanup, daemon=True).start()
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        _httpd_ref = httpd
        log(f"listening on :{PORT} (shared encoder, max {MAX_CLIENTS} clients)")
        httpd.serve_forever()
    ENC.stop()


if __name__ == "__main__":
    _sig_import.signal(_sig_import.SIGTERM, _sigterm_handler)
    main()

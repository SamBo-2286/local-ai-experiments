#!/usr/bin/env python3
"""HOUND MJPEG watchdog — runs as a user systemd timer (3-min cadence).

Root cause it guards against: the C920 USB link suspends while the stream
is idle (autosuspend=2s, control=auto) and the v4l2 capture freezes — the
mjpeg-stream service keeps running, but every frame after the freeze is
byte-identical. Re-opening the camera (service restart) wakes the link.
Verified 2026-09-30: frozen (1 unique frame / 20s) -> restart ->
LIVE (185 unique / 60s).

mjpeg-stream.service is a SYSTEM service, so the watchdog revives it via
sudo -S with the password from /home/ollie/.hound-sudo-pw (root:ollie,
mode 600). If the password file is missing the watchdog reports and exits
1 instead of silently doing nothing.

Also clears a stale /tmp/hound-detection.json that is older than 120s
and says match:true — a leftover from a crashed detector run that would
otherwise let a stale event re-broadcast after a bridge restart.
"""
import hashlib
import os
import subprocess
import sys
import time
import urllib.request

STREAM_URL = "http://localhost:8084/"
SOI, EOI = b"\xff\xd8", b"\xff\xd9"
CHECK_SECONDS = 12
MIN_UNIQUE_FRAMES = 3  # live stream at 10fps produces >100 in 12s
DETECTION_FILE = "/tmp/hound-detection.json"
STALE_AFTER_SECONDS = 120
SUDO_PW_FILE = "/home/ollie/.hound-sudo-pw"


def stream_is_live() -> bool:
    try:
        r = urllib.request.urlopen(STREAM_URL, timeout=CHECK_SECONDS + 5)
        buf = b""
        seen = set()
        t0 = time.time()
        while time.time() - t0 < CHECK_SECONDS:
            chunk = r.read(65536)
            if not chunk:
                break
            buf += chunk
            while True:
                s = buf.find(SOI)
                if s < 0:
                    break
                e = buf.find(EOI, s + 2)
                if e < 0:
                    break
                frame = buf[s:e + 2]
                buf = buf[e + 2:]
                seen.add(hashlib.md5(frame).hexdigest()[:8])
                if len(seen) >= MIN_UNIQUE_FRAMES:
                    r.close()
                    return True
        r.close()
        return len(seen) >= MIN_UNIQUE_FRAMES
    except Exception:
        return False


def clear_stale_detection() -> None:
    try:
        if not os.path.exists(DETECTION_FILE):
            return
        age = time.time() - os.path.getmtime(DETECTION_FILE)
        if age < STALE_AFTER_SECONDS:
            return
        content = open(DETECTION_FILE).read()
        if "match\": true" in content.replace(" ", ""):
            os.unlink(DETECTION_FILE)
            print(f"watchdog: cleared stale match detection file (age {age:.0f}s)",
                  flush=True)
    except Exception as e:
        print(f"watchdog: stale-file check error: {e}", flush=True)


def main() -> None:
    clear_stale_detection()
    if stream_is_live():
        print("watchdog: stream live", flush=True)
        return
    print("watchdog: stream FROZEN — restarting mjpeg-stream.service", flush=True)
    if not os.path.exists(SUDO_PW_FILE):
        print(f"watchdog: FATAL {SUDO_PW_FILE} missing — cannot restart service",
              flush=True)
        sys.exit(1)
    try:
        with open(SUDO_PW_FILE) as pw:
            subprocess.run(
                ["sudo", "-S", "-p", "", "systemctl", "restart", "mjpeg-stream.service"],
                stdin=pw, timeout=90, check=False)
        # Give systemd a moment to respawn; the C920 re-open + encoder warm-up
        # takes ~10s, so wait 15 before judging.
        time.sleep(15)
        active = subprocess.run(
            ["systemctl", "is-active", "mjpeg-stream.service"],
            capture_output=True, text=True, timeout=10).stdout.strip()
        print(f"watchdog: mjpeg-stream state={active}", flush=True)
        if stream_is_live():
            print("watchdog: stream LIVE after restart", flush=True)
        else:
            print("watchdog: stream still not live — will retry next tick",
                  flush=True)
            sys.exit(1)
    except Exception as e:
        print(f"watchdog: restart failed: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

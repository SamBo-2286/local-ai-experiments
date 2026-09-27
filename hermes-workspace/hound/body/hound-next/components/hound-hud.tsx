"use client";

/**
 * HOUND HUD — Main full-bleed layout
 * 3×3 grid + footer, full-bleed viewport with cqw/cqh units.
 * Replaces the placeholder in hound-screen.tsx.
 *
 * FIX (2026-09-19): Changed gridTemplateRows from percentage tracks
 * ("36.4% 18.2% 39.4%") to fr tracks ("36.4fr 18.2fr 39.4fr"). The old
 * percentage tracks collapsed because percentage grid tracks resolve
 * against the container's base height (auto/0 when parent is flex-1),
 * causing all rows to shrink-wrap and stack at the top. fr tracks always
 * resolve against the real container height, so panels now fill the
 * entire screen correctly.
 */

import { useEffect, useRef, useLayoutEffect, useState, useCallback } from "react"
import { useHudState } from "./hound-hud-state"
import { HoundAvatar } from "./hound-avatar"
import { VaultGraph } from "./vault-graph"
import { LockScreen } from "./lock-screen"

const IDLE_TIMEOUT_MS = 120_000 // 120 seconds

const RED = "#e8232a"
const CREAM = "#f2ecc0"

const STATS_URL = "/api/stats"

export function HudFullBleed() {
  const s = useHudState()
  const frameRef = useRef(1)
  const [frame, setFrame] = useState(1)
  const [isLocked, setIsLockedState] = useState(false)

  // Handle lock
  const handleLock = () => {
    if (!isLocked) {
      setIsLockedState(true)
      s.setIsLocked(true)
    }
  }

  // Handle unlock
  const handleUnlock = () => {
    setIsLockedState(false)
    s.setIsLocked(false)
  }

  // Idle timeout tracking — moved here so it always runs (not gated by lock state)
  const lastActivityRef = useRef(Date.now())
  const resetIdle = useCallback(() => {
    lastActivityRef.current = Date.now()
    s.setIdleMs(0)
  }, [s])

  useEffect(() => {
    window.addEventListener("mousemove", resetIdle)
    window.addEventListener("keydown", resetIdle)
    window.addEventListener("click", resetIdle)
    window.addEventListener("touchstart", resetIdle)

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current
      s.setIdleMs(idle)

      if (idle >= IDLE_TIMEOUT_MS) {
        handleLock()
      }
    }, 1000)

    return () => {
      window.removeEventListener("mousemove", resetIdle)
      window.removeEventListener("keydown", resetIdle)
      window.removeEventListener("click", resetIdle)
      window.removeEventListener("touchstart", resetIdle)
      clearInterval(interval)
    }
  }, [resetIdle, s])

  // Frame counter: increments during thinking/speaking, resets to 1
  useEffect(() => {
    const id = setInterval(() => {
      const st = s.avatarState
      if (st === "thinking" || st === "speaking" || st === "talking") {
        frameRef.current = (frameRef.current % 4) + 1
      } else {
        frameRef.current = 1
      }
      setFrame(frameRef.current)
    }, 220)
    return () => clearInterval(id)
  }, [s.avatarState])

  // WebSocket connection to voice bridge for wake word and speech events
  const bridgeRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:8092`
    const ws = new WebSocket(wsUrl)
    bridgeRef.current = ws
    s.setBridgeWs(ws)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "registerHud" }))
      s.appendMessage("system", "VOICE BRIDGE CONNECTED")
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === "wakeWord") {
          s.appendMessage("system", `WAKE WORD DETECTED (confidence: ${(msg.confidence * 100).toFixed(0)}%)`)
        } else if (msg.type === "speechActive") {
          s.setWaveState(msg.active ? "speaking" : "idle")
        } else if (msg.type === "avatar") {
          s.setAvatarState(msg.state)
        } else if (msg.type === "chat_reply") {
          s.appendMessage("model", msg.data)
        } else if (msg.type === "tts_audio") {
          // Bridge synthesized a voice reply: base64 WAV -> blob -> play.
          // Avatar state "speaking" is the engine's talking animation.
          try {
            s.setAvatarState("speaking")
            const bytes = atob(msg.data ?? msg.audio)
            const arr = new Uint8Array(bytes.length)
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
            const url = URL.createObjectURL(new Blob([arr], { type: "audio/wav" }))
            const audio = new Audio(url)
            audio.onended = () => {
              s.setAvatarState("idle")
              URL.revokeObjectURL(url)
            }
            audio.onerror = () => {
              s.appendMessage("system", "TTS PLAYBACK FAILED (audio blocked?)")
              s.setAvatarState("idle")
              URL.revokeObjectURL(url)
            }
            void audio.play()
          } catch (e) {
            s.appendMessage("system", "TTS PLAYBACK ERROR")
            s.setAvatarState("idle")
          }
        } else if (msg.type === "faceMatch") {
          window.dispatchEvent(new CustomEvent("hound-unlock-event", { detail: msg }))
        } else if (msg.type === "unlocked") {
          window.dispatchEvent(new CustomEvent("hound-unlock-event", { detail: msg }))
        }
      } catch (e) {
        console.error("Bridge message parse error:", e)
      }
    }

    ws.onerror = () => {
      s.appendMessage("system", "VOICE BRIDGE DISCONNECTED")
    }

    return () => {
      ws.close()
    }
  }, [s])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black"
      style={{ containerType: "size" }}
    >
      {/* Outer HUD frame */}
      <div
        className="relative"
        style={{
          width: "100vw",
          height: "100vh",
          background: "#020708",
          border: "2px solid rgba(17,27,29,1)",
          borderRadius: "34px 42px 38px 44px",
          boxShadow:
            "0 0 0 1px #071012 inset, 0 0 24px rgba(0,0,0,.9) inset, 0 0 70px rgba(0,0,0,.95)",
          overflow: "hidden",
          containerType: "size",
        }}
      >
        {/* CRT scanlines overlay */}
        <div
          className="scanlines pointer-events-none absolute inset-0 z-30"
          aria-hidden="true"
        />

        {/* Screen area — flex column: [grid (100% of flex space)] + [footer (auto)] */}
        <div
          className="relative flex flex-col"
          style={{
            height: "100%",
            padding: "2.3cqw 2.25cqw 1.65cqw",
            gap: "1.7cqh",
            boxSizing: "border-box",
          }}
        >
          {/* Main grid — 3 cols × 3 rows, uses fr tracks (not %) */}
          <div
            className="flex-1 min-h-0 grid"
            style={{
              gridTemplateColumns: "23.25% 1fr 28.95%",
              gridTemplateRows: "36.4fr 18.2fr 39.4fr",
              columnGap: "1.23cqw",
              rowGap: "1.7cqh",
            }}
          >
            {/* Row 1 */}
            <HudLogoPanel />
            <HudAvatarPanel s={s} frame={frame} />
            <HudCameraPanel s={s} />

            {/* Row 2 */}
            <HudSystemStatus s={s} />
            <HudWaveformPanel s={s} />
            {/* Camera already spans into this row */}

            {/* Row 3 */}
            <HudControlPanel s={s} />
            <HudChatPanel s={s} />
            <HudDisplayPanel s={s} />
          </div>

          {/* Footer */}
          <footer
            className="flex items-center justify-between"
            style={{
              border: `2px solid rgba(232,35,42,.42)`,
              borderRadius: "3px 7px 10px 5px",
              padding: "0 1.5cqw 0 1.5cqw",
              fontSize: "clamp(7px, 0.7cqw, 11px)",
              letterSpacing: "0.2px",
              color: "rgba(216,75,75,0.8)",
            }}
          >
            <span>
              HOUND&nbsp;&nbsp;//&nbsp;&nbsp;HOUND SYSTEM&nbsp;&nbsp;//&nbsp;&nbsp;v1.0.0
            </span>
            <span>
              SAME MIND&nbsp;&nbsp;//&nbsp;&nbsp;DIFFERENT INTERFACE
            </span>
          </footer>
        </div>

        {/* Idle indicator (top-right corner, only when unlocked) */}
        {!isLocked && s.idleMs > 0 && (
          <div
            className="absolute z-20"
            style={{
              right: "1.5cqw",
              top: "1.5cqw",
              fontSize: "clamp(6px, 0.55cqw, 9px)",
              color: "rgba(216,75,75,0.35)",
              fontFamily: "var(--font-vt323)",
              letterSpacing: "0.1em",
            }}
          >
            IDLE: {Math.floor(s.idleMs / 60000)}m{s.idleMs % 60000 >= 1000 ? `${Math.floor((s.idleMs % 60000) / 1000)}s` : ""}
          </div>
        )}

        {/* Lock screen overlay */}
        <LockScreen isLocked={isLocked} onUnlocked={handleUnlock} />

        {/* Screensaver idle tracking removed — idle logic now in HudFullBleed (always runs) */}
      </div>
    </div>
  )
}

/* ─── Logo (top-left) ─── */
function HudLogoPanel() {
  return (
    <div className="panel">
      <div
        className="absolute inset-[0.5%] flex flex-col items-center justify-center"
        style={{ containerType: "size" }}
      >
        {/* Dog — slightly larger, fills more of the panel */}
        <img
          src="/images/hound-dog.png"
          alt="HOUND logo"
          className="max-w-full max-h-[55%] object-contain"
          style={{ imageRendering: "pixelated" }}
        />
        {/* HOUND wordmark — slightly bigger, nearly touching panel edges */}
        <div
          className="mt-[0.1%] text-center leading-[0.82]"
          style={{ containerType: "size", width: "100%" }}
        >
          <span
            className="font-[family-name:var(--font-archivo-black)] tracking-[0.04em]"
            style={{
              color: CREAM,
              fontSize: "clamp(22px, 21cqw, 110px)",
              textShadow: `0 0 20px ${CREAM}aa`,
              lineHeight: "0.82",
              display: "block",
            }}
          >
            HOUND
            <sup
              className="font-[family-name:var(--font-vt323)] leading-none"
              style={{ fontSize: "0.26em", verticalAlign: "1.05em", letterSpacing: "0.04em" }}
            >
              oo
            </sup>
          </span>
        </div>
      </div>
    </div>
  )
}

/* ─── System Status (mid-left) ─── */
function HudSystemStatus({ s }: { s: ReturnType<typeof useHudState> }) {
  const failRef = useRef(0)

  useEffect(() => {
    let id: ReturnType<typeof setInterval>
    let dead = false
    const poll = async () => {
      try {
        const r = await fetch(STATS_URL, { cache: "no-store" })
        if (!r.ok) throw 0
        const data = await r.json()
        if (dead) return
        failRef.current = 0
        // Bridge already picks the active GPU (most VRAM resident) into
        // top-level gpu/temp — use them directly.
        s.setStats({
          cpu: data.cpu,
          ram: data.ram,
          gpu: data.gpu,
          temp: data.temp,
          model: data.model || "NONE",
          gpus: data.gpus,
        })
      } catch {
        if (dead) return
        failRef.current++
        if (failRef.current >= 3) s.setStatsOffline()
      }
    }

    poll()
    id = setInterval(poll, 2000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [s])

  const st = s.stats || { cpu: 0, ram: 0, gpu: 0, temp: 0 }
  const online = s.statsOnline

  const rows = [
    { label: "CPU", val: st.cpu, unit: "%" },
    { label: "RAM", val: st.ram, unit: "%" },
    { label: "GPU", val: st.gpu, unit: "%" },
    { label: "TEMP", val: st.temp, unit: "°C" },
  ]

  return (
    <div className="panel relative" style={{ padding: "7.5% 4% 3%" }}>
      {/* Title */}
      <PanelTitle title="SYSTEM STATUS" right={online ? "" : "OFFLINE"} />

      {rows.map((r) => {
        const pct = online
          ? Math.min(100, Math.max(0, Number(r.val) || 0))
          : 0
        const display = online ? `${Math.round(r.val)}${r.unit}` : `--${r.unit}`
        return (
          <div
            key={r.label}
            className="grid"
            style={{
              gridTemplateColumns: "18% 1fr 18%",
              alignItems: "center",
              height: "23%",
              fontSize: "clamp(8px, 0.86cqw, 13px)",
            }}
          >
            <span
              style={{
                color: RED,
                textShadow: `0 0 6px ${RED}55`,
              }}
            >
              {r.label}
            </span>
            <div
              style={{
                height: "58%",
                border: `1px solid rgba(232,35,42,.42)`,
                background: "#05090a",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background:
                    "linear-gradient(90deg, rgba(190,48,48,.55), rgba(233,74,74,.9))",
                  boxShadow: "0 0 8px rgba(233,74,74,.18)",
                  transition: "width 0.5s ease",
                }}
              />
            </div>
            <span
              style={{
                textAlign: "right",
                opacity: online ? 1 : 0.3,
              }}
            >
              {display}
            </span>
          </div>
        )
      })}

      {/* Model label */}
      {s.stats?.model && (
        <div
          style={{
            position: "absolute",
            left: "4%",
            bottom: "2%",
            fontSize: "clamp(7px, 0.6cqw, 10px)",
            color: RED,
            opacity: 0.6,
          }}
        >
          MODEL: {s.stats.model.toUpperCase()}
        </div>
      )}
    </div>
  )
}

/* ─── Control (bottom-left) ─── */
function HudControlPanel({ s }: { s: ReturnType<typeof useHudState> }) {
  const buttons = [
    { label: `CAMERA: ${s.cameraOn ? "ON" : "OFF"}`, action: s.toggleCamera, on: s.cameraOn },
    { label: `MIC: ${s.micOn ? "ON" : "OFF"}`, action: s.toggleMic, on: s.micOn },
    { label: "OBSIDIAN", action: s.displayVault, on: false },
    {
      label: "WEB VIEW",
      action: () =>
        s.displayText("WEB: URL ENTRY DEFERRED ON KIOSK"),
      on: false,
    },
    { label: "DISPLAY", action: s.displayVault, on: false },
    { label: "CLEAR LOG", action: s.clearLog, on: false },
    { label: "MODEL: general-subagent", action: () => {}, on: false },
    { label: "TTS: OFF", action: () => {}, on: false },
  ]

  return (
    <div className="panel relative">
      <PanelTitle title="CONTROL" />

      <div
        className="grid"
        style={{
          position: "absolute",
          inset: "12% 4% 10%",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "repeat(4, 1fr)",
          gap: "6px",
        }}
      >
        {buttons.map((b, i) => (
          <button
            key={i}
            onClick={b.action}
            className="ctrl"
            style={b.on ? { background: "rgba(232,35,42,.12)" } : {}}
            onMouseEnter={(e) => {
              if (!b.on) {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(232,35,42,.08)"
              }
            }}
            onMouseLeave={(e) => {
              if (!b.on) {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(3,8,9,.75)"
              }
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: "4%",
          right: "4%",
          bottom: "2%",
          fontSize: "clamp(6px, 0.56cqw, 9px)",
          opacity: 0.6,
          whiteSpace: "nowrap",
          color: "rgba(216,75,75,0.8)",
        }}
      >
        HOUND // LOCAL CONTROL INTERFACE
      </div>
    </div>
  )
}

/* ─── Avatar (top-center) ─── */
function HudAvatarPanel({
  s,
  frame,
}: {
  s: ReturnType<typeof useHudState>
  frame: number
}) {
  return (
    <div className="panel relative" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <PanelTitle
        title="HOUND AI AVATAR"
        right={s.avatarState.toUpperCase()}
      />

      {/* Inner frame with corner brackets */}
      <div
        className="relative"
        style={{
          position: "absolute",
          left: "2.7%",
          right: "2.7%",
          top: "13%",
          bottom: "10.5%",
          border: `2px solid rgba(232,35,42,.42)`,
        }}
      >
        <CornerBracket pos="tl" />
        <CornerBracket pos="tr" />
        <CornerBracket pos="bl" />
        <CornerBracket pos="br" />
      </div>

      {/* Avatar face — centered in the panel cell */}
      <div
        style={{
          position: "absolute",
          left: "2.7%",
          right: "2.7%",
          top: "13%",
          bottom: "10.5%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <HoundAvatar state={s.avatarState} />
      </div>

      {/* Footer */}
      <div
        className="absolute flex justify-between"
        style={{
          left: "2.8%",
          right: "2.8%",
          bottom: "3%",
          fontSize: "clamp(8px, 0.86cqw, 13px)",
          color: "rgba(216,75,75,0.7)",
        }}
      >
        <span>ANIMATION: {s.avatarState.toUpperCase()}</span>
        <span>FRAME {frame} / 4</span>
      </div>
    </div>
  )
}

/* ─── Waveform (mid-center) ─── */
function HudWaveformPanel({ s }: { s: ReturnType<typeof useHudState> }) {
  const bars = [
    0.25, 0.45, 0.7, 0.9, 0.7, 1, 0.8, 0.55,
    0.95, 0.7, 0.42, 0.8, 0.98, 0.65, 0.45, 0.8,
    0.35, 0.65, 0.9, 0.55, 0.3, 0.7, 0.95, 0.58,
    0.42, 0.75, 0.95, 0.52, 0.3, 0.6, 0.82, 0.46,
    0.25, 0.55, 0.7, 0.38,
  ]

  const isLive =
    s.waveState === "speaking" ||
    s.waveState === "thinking" ||
    s.micOn

  return (
    <div className="panel relative">
      <PanelTitle title="SPEAKING ANIMATION (MOUTH SYNC)" />

      {/* Bars */}
      <div
        className="absolute flex items-center justify-center gap-[3px]"
        style={{ left: "3%", right: "3%", top: "28%", bottom: "12%" }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: `${(i / bars.length) * 100}%`,
              width: "3px",
              height: `${h * 100}%`,
              background: RED,
              boxShadow: `0 0 5px rgba(233,74,74,.42)`,
              opacity: isLive ? 0.92 : 0.35,
              transformOrigin: "center",
              animation: isLive
                ? `wave 680ms ease-in-out infinite alternate`
                : "none",
              animationDelay: `${i * 50}ms`,
              transition: "opacity 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Status */}
      <div
        style={{
          position: "absolute",
          left: "3%",
          bottom: "4%",
          fontSize: "clamp(7px, 0.72cqw, 11px)",
          opacity: 0.7,
          color: "rgba(216,75,75,0.8)",
        }}
      >
        AUDIO: {s.micOn
          ? "MONITOR"
          : s.waveState === "idle"
            ? "IDLE"
            : s.waveState.toUpperCase()}
      </div>
    </div>
  )
}

/* ─── Chat (bottom-center) ─── */
function HudChatPanel({ s }: { s: ReturnType<typeof useHudState> }) {
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useLayoutEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [s.log.length])

  const submit = () => {
    const val = inputRef.current?.value || ""
    if (val.trim()) {
      s.sendHoundMessage(val)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="panel relative">
      <PanelTitle title="MODEL PROCESS / OUTPUT" />

      {/* Log */}
      <div
        ref={logRef}
        className="absolute overflow-auto"
        style={{
          top: "12%",
          bottom: "15%",
          left: "3%",
          right: "3%",
          fontSize: "clamp(8px, 0.73cqw, 12px)",
          lineHeight: "1.45",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(232,35,42,.42) transparent",
        }}
      >
        {s.log.map((m, i) => (
          <div
            key={i}
            className="mb-[0.7cqh]"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: m.type === "system" ? 0.55 : 1,
              color:
                m.type === "user"
                  ? "#e9a1a1"
                  : m.type === "model"
                  ? "#e45b5b"
                  : "rgba(216,75,75,0.7)",
            }}
          >
            {m.text}
          </div>
        ))}
      </div>

      {/* Input row */}
      <div
        className="absolute flex gap-[6px]"
        style={{ left: "3%", right: "3%", bottom: "3%", height: "9%" }}
      >
        <textarea
          ref={inputRef}
          className="flex-1 resize-none outline-none border"
          style={{
            border: `1px solid rgba(232,35,42,.42)`,
            background: "#030809",
            color: "#e8a0a0",
            fontSize: "clamp(7px, 0.67cqw, 11px)",
            padding: "5px 7px",
          }}
          rows={1}
          placeholder="TYPE DIRECTLY TO HOUND..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          onClick={submit}
          className="ctrl"
          style={{ width: "12%", minWidth: "48px" }}
        >
          SEND
        </button>
      </div>
    </div>
  )
}

/* ─── Camera (top-right, spans rows 1-2 via grid-area in the style tag) ─── */
function HudCameraPanel({ s }: { s: ReturnType<typeof useHudState> }) {
  const [camDead, setCamDead] = useState(false)

  // Track stream health: onError fires when the MJPEG stream dies.
  useEffect(() => {
    if (!s.cameraOn) return
    setCamDead(false)
  }, [s.cameraOn])

  const offline = !s.cameraOn || camDead

  return (
    <div
      className="panel relative"
      style={{ gridColumn: 3, gridRow: "1 / span 2" }}
    >
      <PanelTitle
        title="CAMERA FEED"
        right={offline ? "OFFLINE" : "LIVE"}
        rightColor={offline ? RED : "#4ade4a"}
      />

      {s.cameraOn && (
        <img
          src="/api/cam"
          alt="Camera feed"
          className="absolute inset-[3px] w-[calc(100%-6px)] h-[calc(100%-6px)] object-cover"
          style={{
            filter: "contrast(1.02) saturate(0.55)",
            opacity: camDead ? 0 : 1,
          }}
          onError={() => setCamDead(true)}
          onLoad={() => setCamDead(false)}
        />
      )}

      {offline && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: "clamp(8px, 0.75cqw, 12px)",
            opacity: 0.45,
            color: RED,
          }}
        >
          CAMERA OFFLINE
        </div>
      )}
    </div>
  )
}

/* ─── Display (bottom-right) ─── */
function HudDisplayPanel({ s }: { s: ReturnType<typeof useHudState> }) {
  const title =
    s.displayMode === "web"
      ? "WEB VIEW"
      : s.displayMode === "message"
        ? "DISPLAY MESSAGE"
        : "DISPLAY"

  return (
    <div className="panel relative">
      <PanelTitle title={title} />

      {/* Box-in-box content area — keeps content clear of title bar and footer */}
      <div
        style={{
          position: "absolute",
          inset: "12% 4% 8%",
          overflow: "hidden",
        }}
      >
        {/* Graph mode */}
        {s.displayMode === "graph" && <VaultGraph />}

        {/* Web iframe */}
        {s.displayMode === "web" && s.displayPayload && (
          <iframe
            className="w-full h-full"
            title="HOUND web display"
            src={s.displayPayload}
            style={{
              background: "#020607",
              filter: "saturate(0.6) contrast(0.95)",
              width: "100%",
              height: "100%",
              border: "none",
            }}
          />
        )}

        {/* Message mode */}
        {s.displayMode === "message" && (
          <div
            className="flex items-center justify-center"
            style={{
              height: "100%",
              opacity: 0.18,
              fontSize: "clamp(8px, 0.75cqw, 12px)",
            }}
          >
            {s.displayPayload || "DISPLAY OFFLINE"}
          </div>
        )}

        {/* Image mode */}
        {s.displayMode === "image" && s.displayPayload && (
          <img
            src={s.displayPayload}
            alt="Display"
            className="w-full h-full object-contain"
          />
        )}
      </div>
    </div>
  )
}

/* ─── Helpers ─── */

function PanelTitle({
  title,
  right,
  rightColor,
}: {
  title: string
  right?: string
  rightColor?: string
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "2.5%",
        right: "2.5%",
        top: "2.7%",
        height: "8.5%",
        borderBottom: `1px solid rgba(232,35,42,.25)`,
        color: RED,
        fontSize: "clamp(9px, 1.05cqw, 16px)",
        lineHeight: "1",
        letterSpacing: "0.3px",
        textShadow: `0 0 7px rgba(232,35,42,.22)`,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{title}</span>
      {right && (
        <span
          style={{
            float: "right",
            fontSize: "0.85em",
            color: rightColor || RED,
          }}
        >
          {right}
        </span>
      )}
    </div>
  )
}

function CornerBracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const styles: Record<string, React.CSSProperties> = {
    tl: { left: -2, top: -2, borderLeft: `2px solid ${RED}`, borderTop: `2px solid ${RED}` },
    tr: { right: -2, top: -2, borderRight: `2px solid ${RED}`, borderTop: `2px solid ${RED}` },
    bl: { left: -2, bottom: -2, borderLeft: `2px solid ${RED}`, borderBottom: `2px solid ${RED}` },
    br: { right: -2, bottom: -2, borderRight: `2px solid ${RED}`, borderBottom: `2px solid ${RED}` },
  }
  return (
    <i
      className="corner"
      style={{
        position: "absolute",
        width: 17,
        height: 17,
        pointerEvents: "none",
        ...styles[pos],
      }}
    />
  )
}

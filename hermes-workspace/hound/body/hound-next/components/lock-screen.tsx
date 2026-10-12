"use client"

/**
 * HOUND Lock Screen — Password overlay after 120s idle
 * Dismissed by: password entry + Enter, or face match via WebSocket
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { useDetector } from "../lib/detector-client"

const IDLE_TIMEOUT_MS = 120_000 // 120 seconds

interface Props {
  isLocked: boolean
  onUnlocked: () => void
  faceScan?: boolean
  showPassword?: boolean
}

export function LockScreen({ isLocked, onUnlocked, faceScan, showPassword }: Props) {
  const [password, setPassword] = useState("")
  const [time, setTime] = useState("")
  const [error, setError] = useState("")
  const [detectionLabel, setDetectionLabel] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Detection polling — runs ONLY while locked
  const { detection, isPolling } = useDetector(isLocked, () => {
    // Face match detected — trigger unlock
    window.dispatchEvent(new CustomEvent("hound-unlock-event", { detail: { type: "faceMatch", match: true } }))
  })

  // Update detection label for display
  useEffect(() => {
    if (detection.status === "face_found" || detection.status === "pet_found" || detection.status === "unknown_face") {
      setDetectionLabel(detection.label || detection.status)
    } else {
      setDetectionLabel(null)
    }
  }, [detection])

  // Clock — update every second
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Focus password input on mount
  useEffect(() => {
    if (isLocked && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isLocked])

  // Face match / unlock events — dispatched as CustomEvents by HudFullBleed
  // (which owns the bridge WS). This component only listens, never connects.
  useEffect(() => {
    if (!isLocked) return

    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as { type?: string } | undefined
      if (detail && (detail.type === "faceMatch" || detail.type === "unlocked")) {
        onUnlocked()
      }
    }

    window.addEventListener("hound-unlock-event", handler as EventListener)

    return () => {
      window.removeEventListener("hound-unlock-event", handler as EventListener)
    }
  }, [isLocked, onUnlocked])

  // Handle password submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    // Verify password (compare against SHA-256 hash)
    const hash = await sha256(password)
    const stored = localStorage.getItem("hound_password_hash")

    if (!stored) {
      // First time: set the password
      localStorage.setItem("hound_password_hash", hash)
      onUnlocked()
      return
    }

    if (hash === stored) {
      onUnlocked()
    } else {
      setError("INCORRECT PASSWORD")
      setPassword("")
    }
  }, [password, onUnlocked])

  if (!isLocked) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,2,3,0.97)" }}
    >
      {/* Face scanning indicator (only during face scan window) */}
      {faceScan && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2"
          style={{
            fontSize: "clamp(8px, 0.7cqw, 11px)",
            color: "#ffa500",
            fontFamily: "var(--font-vt323)",
            zIndex: 51,
          }}
        >
          <div style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            border: "2px solid #ffa500",
            borderTopColor: "transparent",
            animation: "spin 1s linear infinite",
          }} />
          <span>SCANNING...</span>
        </div>
      )}

      {/* HOUND logo */}
      <div className="mb-8 text-center">
        <img
          src="/images/hound-dog.png"
          alt="HOUND"
          className="mx-auto mb-4"
          style={{ imageRendering: "pixelated", width: "80px", height: "80px" }}
        />
        <div
          className="text-center leading-[0.82]"
          style={{ containerType: "size", width: "100%" }}
        >
          <span
            className="font-[family-name:var(--font-archivo-black)] tracking-[0.04em]"
            style={{
              color: "#f2ecc0",
              fontSize: "clamp(36px, 8cqw, 80px)",
              textShadow: "0 0 20px rgba(242,236,192,0.66)",
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

      {/* Clock */}
      <div
        className="mb-8 font-[family-name:var(--font-vt323)]"
        style={{
          color: "#e8232a",
          fontSize: "clamp(28px, 6cqw, 64px)",
          textShadow: "0 0 12px rgba(232,35,42,0.5)",
        }}
      >
        {time}
      </div>

      {/* Password form */}
      {showPassword && (
        <form onSubmit={handleSubmit} className="w-full max-w-xs px-8">
          <div className="mb-4 text-center text-[0.85rem] uppercase tracking-wider" style={{ color: "rgba(232,35,42,0.7)" }}>
            ENTER PASSWORD TO UNLOCK
          </div>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-center outline-none"
            style={{
              background: "rgba(3,8,9,0.8)",
              border: "1px solid rgba(232,35,42,0.42)",
              borderRadius: "3px",
              color: "#e8a0a0",
              fontSize: "clamp(12px, 1.5cqw, 20px)",
              padding: "8px 12px",
              letterSpacing: "0.2em",
            }}
            placeholder="••••••••"
            autoComplete="off"
            autoFocus
          />
          <div className="mt-4 flex justify-center">
            <button
              type="submit"
              className="w-full"
              style={{
                background: "rgba(232,35,42,0.12)",
                border: "1px solid rgba(232,35,42,0.42)",
                borderRadius: "3px",
                color: "#e8232a",
                fontSize: "clamp(10px, 1.2cqw, 16px)",
                padding: "8px 16px",
                letterSpacing: "0.15em",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,35,42,0.22)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(232,35,42,0.12)")}
            >
              UNLOCK
            </button>
          </div>
          {error && (
            <div className="mt-3 text-center" style={{ color: "#e8232a", fontSize: "0.75rem" }}>
              {error}
            </div>
          )}
        </form>
      )}

      {/* Status */}
      <div
        className="mt-8 text-center text-[0.65rem] uppercase tracking-widest"
        style={{ color: "rgba(216,75,75,0.35)" }}
      >
        HOUND SYSTEM LOCKED
        <br />
        IDLE 120s
      </div>

      {/* Pulse animation for detection indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.4 }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

/**
 * Simple SHA-256 hash function using Web Crypto API
 */
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  return crypto.subtle.digest("SHA-256", data).then((hash) => {
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  })
}

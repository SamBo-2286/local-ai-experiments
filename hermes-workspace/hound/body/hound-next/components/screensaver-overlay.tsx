/**
 * HOUND Screensaver Overlay — Idle timer (120s)
 * Tracks mouse movement, key presses, and audio activity to determine idle time.
 * Triggers the lock screen when idle for 120 seconds.
 * Updates idleMs in shared HUD state.
 */
"use client"

import { useEffect, useRef, useCallback } from "react"
import { useHudState } from "./hound-hud-state"

const IDLE_TIMEOUT_MS = 120_000 // 120 seconds

interface Props {
  onLock: () => void
  onUnlock: () => void
}

export function ScreensaverOverlay({ onLock, onUnlock }: Props) {
  const s = useHudState()
  const lastActivityRef = useRef(Date.now())

  // Reset idle on user activity
  const resetIdle = useCallback(() => {
    lastActivityRef.current = Date.now()
    s.setIdleMs(0)
  }, [s])

  useEffect(() => {
    // Listen for user activity to reset idle timer
    window.addEventListener("mousemove", resetIdle)
    window.addEventListener("keydown", resetIdle)
    window.addEventListener("click", resetIdle)
    window.addEventListener("touchstart", resetIdle)

    // Poll idle time every second
    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current
      s.setIdleMs(idle)

      if (idle >= IDLE_TIMEOUT_MS) {
        onLock()
      }
    }, 1000)

    return () => {
      window.removeEventListener("mousemove", resetIdle)
      window.removeEventListener("keydown", resetIdle)
      window.removeEventListener("click", resetIdle)
      window.removeEventListener("touchstart", resetIdle)
      clearInterval(interval)
    }
  }, [onLock, resetIdle, s])

  // Track voice activity to reset idle when Otto is speaking/listening
  useEffect(() => {
    const handler = () => {
      const speechActive = document.querySelector('[data-speech="active"]')
      if (speechActive) {
        resetIdle()
      }
    }
    const id = setInterval(handler, 500)
    return () => clearInterval(id)
  }, [resetIdle])

  // Return null — this is an invisible tracker component
  return null
}

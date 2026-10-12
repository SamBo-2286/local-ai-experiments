"use client"

import { useCallback, useEffect, useState } from "react"
import { HudFullBleed } from "./hound-hud"

const RED = "#e8232a"
const CREAM = "#f2ecc0"
const YELLOW = "#ece49a"

// Boot bar fill times (ms): the idle loop waits for a keypress, the armed
// final fill runs fast once one arrives.
const BOOT_WAIT_FILL_MS = 1500
const BOOT_ARM_FILL_MS = 900



type Screen = "boot" | "login" | "granted" | "hud"

export function HoundScreen() {
  const [screen, setScreen] = useState<Screen>("boot")
  const [bootArmed, setBootArmed] = useState(false)

  const goToLogin = useCallback(() => setScreen("login"), [])
  const goToGranted = useCallback(() => setScreen("granted"), [])
  const goToHud = useCallback(() => setScreen("hud"), [])
  const armBoot = useCallback(() => setBootArmed(true), [])

  // Any keypress during boot arms the sequence: the bar restarts, finishes
  // fast, and advances to the login screen. No key = the bar loops forever.
  useEffect(() => {
    if (screen !== "boot" || bootArmed) return
    window.addEventListener("keydown", armBoot)
    return () => window.removeEventListener("keydown", armBoot)
  }, [screen, bootArmed, armBoot])

  // The main HUD is full-bleed — it renders OUTSIDE the square arcade panel.
  if (screen === "hud") {
    return <HudFullBleed />
  }

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-black p-3 sm:p-6">
      {/* Screen panel — locked to a square, like the original arcade display.
          container-type lets every child size itself with cqw/cqh units so the
          whole composition scales as one unit regardless of viewport. */}
      <div
        className="relative aspect-square overflow-hidden bg-black"
        style={{ containerType: "size", width: "min(92vw, 92vh, 760px)" }}
      >
        {/* Red frame */}
        <div
          className="pointer-events-none absolute inset-[2.5%] rounded-[14px] border-2"
          style={{ borderColor: RED, boxShadow: `0 0 6px ${RED}55, inset 0 0 6px ${RED}22` }}
          aria-hidden="true"
        />

        {/* CRT scanline overlay */}
        <div className="scanlines pointer-events-none absolute inset-0 z-30" aria-hidden="true" />

        {/* Top-left INSERT COIN box */}
        <InsertCoinBox />

        {/* WK logo — bottom right */}
        <WkLogo />

        {/* Center stack */}
        <div className="absolute inset-0 z-20 flex flex-col items-center px-[7%] pb-[5%] pt-[3.5%]">
          {/* Dog */}
          <div className="flex w-full items-center justify-center" style={{ height: "56cqh" }}>
            <img
              src="/images/hound-dog.png"
              alt="Rainbow pixel-art Shiba Inu"
              className="h-full w-auto object-contain [image-rendering:pixelated]"
              style={{ imageRendering: "pixelated", mixBlendMode: "screen" }}
            />
          </div>

          {/* HOUND wordmark */}
          <div className="-mt-[3cqh] w-full text-center leading-[0.82]">
            <span
              className="font-[family-name:var(--font-archivo-black)] tracking-[0.04em]"
              style={{
                color: CREAM,
                fontSize: "18cqw",
                textShadow: `0 0 10px ${CREAM}44`,
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

          {/* Japanese caption */}
          <p
            className="mt-[1cqh] w-full pr-[3cqw] text-right font-[family-name:var(--font-dot-gothic)] leading-none"
            style={{ color: YELLOW, fontSize: "3.6cqw" }}
          >
            2000年アメリカ製
          </p>

          {/* Bottom cluster — swaps between boot, login, granted screens */}
          {screen === "boot" ? (
            <BootCluster armed={bootArmed} onComplete={goToLogin} />
          ) : screen === "login" ? (
            <LoginFields onComplete={goToGranted} />
          ) : (
            <GrantedScreen onComplete={goToHud} />
          )}
        </div>
      </div>
    </main>
  )
}

function BootCluster({
  armed,
  onComplete,
}: {
  armed: boolean
  onComplete: () => void
}) {
  return (
    <>
      {/* Processing payment */}
      <p
        className="mt-[2.2cqh] w-full text-center font-[family-name:var(--font-dot-gothic)] leading-none"
        style={{ color: RED, fontSize: "4.4cqw", textShadow: `0 0 6px ${RED}55` }}
      >
        Processing payment...
      </p>

      {/* Loading bar */}
      <LoadingBar armed={armed} onComplete={onComplete} />

      {/* Press any key */}
      <p
        className="mt-[1.6cqh] w-full text-center font-[family-name:var(--font-dot-gothic)] leading-none"
        style={{ color: RED, fontSize: "4.4cqw", textShadow: `0 0 6px ${RED}55` }}
      >
        press any key to continue
      </p>
    </>
  )
}

function LoadingBar({
  armed,
  onComplete,
}: {
  armed: boolean
  onComplete: () => void
}) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Idle: faster fill that loops until a key arrives. Armed: fast final
    // fill that completes and advances to the login screen.
    const duration = armed ? BOOT_ARM_FILL_MS : BOOT_WAIT_FILL_MS
    let start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const next = Math.min(100, ((now - start) / duration) * 100)
      setProgress(next)
      if (next < 100) {
        frame = requestAnimationFrame(tick)
      } else if (armed) {
        onComplete()
      } else {
        // Still waiting on a key — restart the fill.
        start = now
        setProgress(0)
        frame = requestAnimationFrame(tick)
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [armed, onComplete])

  return (
    <div
      className="mt-[1.6cqh] rounded-[3px] border-2 p-[3px]"
      style={{ borderColor: RED, boxShadow: `0 0 5px ${RED}44`, width: "82%", height: "5.4cqh" }}
      role="progressbar"
      aria-label="Processing payment progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
    >
      <div
        className="h-full rounded-[1px]"
        style={{ width: `${progress}%`, backgroundColor: RED, boxShadow: `0 0 8px ${RED}` }}
      />
    </div>
  )
}

function GrantedScreen({ onComplete }: { onComplete: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Fade in on mount
    setVisible(true)
  }, [])

  useEffect(() => {
    if (!visible) return
    // Show for 1.5s then advance to HUD
    const timer = setTimeout(onComplete, 1500)
    return () => clearTimeout(timer)
  }, [visible, onComplete])

  return (
    <div
      className="flex w-[50%] flex-col mx-auto gap-[1.8cqh] mt-[4cqh]"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      <p
        className="font-[family-name:var(--font-archivo-black)] tracking-[0.1em] text-center"
        style={{
          color: CREAM,
          fontSize: "2cqw",
          textShadow: `0 0 8px ${CREAM}66`,
          letterSpacing: "0.1em",
        }}
      >
        ACCESS GRANTED
      </p>
    </div>
  )
}

const VALID_USER = "ollie"
const VALID_PASS = "***"

function LoginField({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[0.85rem] uppercase tracking-wider" style={{ color: "#e8a0a0", fontFamily: "var(--font-vt323)" }}>
        {children}
      </span>
      <input
        type="text"
        className="w-full text-center outline-none"
        style={{
          background: "rgba(3,8,9,0.8)",
          border: "1px solid rgba(232,35,42,0.42)",
          borderRadius: "3px",
          color: "#e8a0a0",
          fontSize: "1em",
          padding: "4px 8px",
          letterSpacing: "0.2em",
        }}
      />
    </div>
  )
}

function LoginFields({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (VALID_PASS) {
      onComplete()
    } else {
      setError("ACCESS DENIED")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xs px-8">
      <div className="mb-4 text-center text-[0.85rem] uppercase tracking-wider" style={{ color: "rgba(232,35,42,0.7)" }}>
        SYSTEM LOGIN
      </div>
      <LoginField>USERNAME</LoginField>
      <LoginField>PASSWORD</LoginField>
      <div className="mt-4 flex justify-center">
        <button
          type="submit"
          style={{
            background: "rgba(232,35,42,0.12)",
            border: "1px solid rgba(232,35,42,0.42)",
            borderRadius: "3px",
            color: "#e8232a",
            fontSize: "1em",
            padding: "8px 16px",
            letterSpacing: "0.15em",
            cursor: "pointer",
            fontFamily: "var(--font-vt323)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,35,42,0.22)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(232,35,42,0.12)")}
        >
          LOGIN
        </button>
      </div>
      {error && (
        <div className="mt-3 text-center" style={{ color: "#e8232a", fontSize: "0.75rem" }}>
          {error}
        </div>
      )}
    </form>
  )
}

function InsertCoinBox() {
  return (
    <div
      className="absolute left-[6.5%] top-[6%] z-20 flex w-fit flex-col gap-[0.7cqh] rounded-[4px] border-2 px-[1.9cqw] py-[1.5cqh] font-[family-name:var(--font-vt323)] leading-[0.9]"
      style={{ borderColor: RED, color: RED, boxShadow: `0 0 5px ${RED}44` }}
    >
      <span className="whitespace-nowrap" style={{ fontSize: "4cqw", letterSpacing: "0.02em" }}>
        INSERT
        <br />
        COIN
      </span>
      <div
        className="my-[0.3cqh] w-full rounded-[1px]"
        style={{ backgroundColor: RED, boxShadow: `0 0 6px ${RED}`, height: "1.7cqh" }}
      />
      <span className="whitespace-nowrap" style={{ fontSize: "4.2cqw", letterSpacing: "0.02em" }}>
        0.001
        <br />
        BTC
      </span>
    </div>
  )
}

function WkLogo() {
  return (
    <div
      className="absolute bottom-[6%] right-[6.5%] z-20 flex items-center justify-center rounded-[3px] font-[family-name:var(--font-archivo-black)]"
      style={{ backgroundColor: RED, width: "6.2cqw", height: "6.2cqw" }}
      aria-label="WK logo"
    >
      <span className="text-black" style={{ fontSize: "2.8cqw", letterSpacing: "-0.02em" }}>
        wk
      </span>
    </div>
  )
}

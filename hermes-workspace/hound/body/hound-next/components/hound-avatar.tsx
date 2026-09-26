/**
 * HOUND AI Avatar — text-face engine with 18 states, blink, frame counter.
 * Ported from hound-text-avatar-engine.html
 */
"use client"

import { useState, useEffect, useRef } from "react"

const STATES: Record<
  string,
  { hold: number; frames: string[]; animation: string }
> = {
  idle: {
    hold: 1800,
    frames: ["(•‿•)", "(•ᴗ•)", "(•‿•)", "(•_•)", "(•‿•)"],
    animation: "",
  },
  listening: {
    hold: 850,
    frames: ["(•‿•)", "(◕‿◕)", "(•‿•)", "(◉‿◉)", "(•‿•)"],
    animation: "bounce",
  },
  thinking: {
    hold: 650,
    frames: [
      "(•_•) .",
      "(¬_¬) ..",
      "(ಠ_ಠ) ...",
      "(•_•) ....",
      "(¬_¬) ...",
      "(•‿•) ..",
    ],
    animation: "think",
  },
  speaking: {
    hold: 105,
    frames: [
      "(•‿•)",
      "(•▽•)",
      "(•▿•)",
      "(•口•)",
      "(•▽•)",
      "(•ᴗ•)",
      "(•▿•)",
      "(•‿•)",
    ],
    animation: "talk",
  },
  happy: {
    hold: 430,
    frames: ["(＾‿＾)", "(＾▽＾)", "(≧▽≦)", "(＾▽＾)", "(＾‿＾)"],
    animation: "bounce",
  },
  excited: {
    hold: 170,
    frames: ["(☆▽☆)", "(≧▽≦)", "(☆▽☆)", "＼(≧▽≦)／", "(☆▽☆)"],
    animation: "bounce",
  },
  curious: {
    hold: 520,
    frames: ["(•_•)", "(•‿•)?", "(o_O)?", "(•_•)?", "(•ᴗ•)"],
    animation: "bounce",
  },
  confused: {
    hold: 390,
    frames: ["(•_•)?", "(o_O)", "(O_o)", "(•_•)?", "(¬_¬)?"],
    animation: "think",
  },
  surprised: {
    hold: 260,
    frames: ["(⊙_⊙)", "(°□°)", "(⊙o⊙)", "(°□°)", "(⊙_⊙)"],
    animation: "bounce",
  },
  worried: {
    hold: 500,
    frames: ["(•︵•)", "(•_•;)", "(；_；)", "(•︵•)"],
    animation: "think",
  },
  sad: {
    hold: 900,
    frames: ["(•︵•)", "(－︵－)", "(╥_╥)", "(－︵－)"],
    animation: "sleep",
  },
  angry: {
    hold: 230,
    frames: ["(ಠ_ಠ)", "(ಠ益ಠ)", "(╬_ಠ)", "(ಠ益ಠ)", "(ಠ_ಠ)"],
    animation: "glitch",
  },
  smug: {
    hold: 650,
    frames: ["(¬‿¬)", "(¬ᴗ¬)", "(¬‿¬)", "(￣‿￣)"],
    animation: "",
  },
  sleepy: {
    hold: 1100,
    frames: [
      "(－ω－) z",
      "(－_－) zz",
      "(－ω－) zzZ",
      "(－_－) z",
      "(－ω－) zzZ",
    ],
    animation: "sleep",
  },
  error: {
    hold: 210,
    frames: ["(ಠ_ಠ)", "(╬_ಠ)", "(×_×)", "(ಠ_ಠ)", "(╬_ಠ)"],
    animation: "glitch",
  },
  booting: {
    hold: 360,
    frames: ["(•_•) .", "(•_•) ..", "(•_•) ...", "(•_•) ....", "(•_•) .."],
    animation: "think",
  },
  sleeping: {
    hold: 1350,
    frames: [
      "(－ω－) z",
      "(－ω－) zz",
      "(－ω－) zzZ",
      "(－_－) zzZ",
      "(－ω－) z",
    ],
    animation: "sleep",
  },
}

// Glyphs that may not render in DotGothic16/VT323
const FONT_RISK = /\u2574\u2575\u2566\u2567\u2551\u2554\u2557\u255a\u255d\u256a\u256d\u256e/

export interface HoundAvatarProps {
  state: string
}

export function HoundAvatar({ state: propState }: HoundAvatarProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blinkRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(propState)
  const frameRef = useRef(0)
  const speedRef = useRef(1)

  const [text, setText] = useState("(•‿•)")
  const [anim, setAnim] = useState("")
  const [blink, setBlink] = useState(false)
  const [monoFallback, setMonoFallback] = useState(false)

  // Detect font risk on mount / state change
  useEffect(() => {
    const s = STATES[propState]
    if (s) {
      const all = s.frames.join("")
      setMonoFallback(FONT_RISK.test(all))
    }
  }, [propState])

  // Ref-based internals: safe to capture in effect closures (all mutable
  // state lives in refs, so stale function identities are harmless).
  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (blinkRef.current) clearTimeout(blinkRef.current)
  }

  const draw = () => {
    const st = STATES[stateRef.current]
    if (!st) return
    setText(st.frames[frameRef.current])
    setAnim(st.animation || "")
    const delay = Math.max(30, st.hold / speedRef.current)
    timerRef.current = setTimeout(() => {
      frameRef.current = (frameRef.current + 1) % st.frames.length
      draw()
    }, delay)
  }

  const scheduleBlink = () => {
    if (blinkRef.current) clearTimeout(blinkRef.current)
    const cur = stateRef.current
    if (cur === "speaking" || cur === "sleeping" || cur === "sleepy") return

    const delay = 2500 + Math.random() * 5000
    blinkRef.current = setTimeout(() => {
      setBlink(true)
      setTimeout(() => {
        setBlink(false)
        scheduleBlink()
      }, 120)
    }, delay)
  }

  // Mount: start the animation loop immediately
  useEffect(() => {
    frameRef.current = 0
    clearTimers()
    draw()
    scheduleBlink()
    return () => clearTimers()
  }, [])

  // Re-draw when propState changes
  useEffect(() => {
    if (stateRef.current === propState) {
      // State unchanged — nothing to do
      return
    }
    stateRef.current = propState
    frameRef.current = 0
    clearTimers()
    draw()
    scheduleBlink()
  }, [propState])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => clearTimers()
  }, [])

  // The reference engine renders the face in plain monospace (glyphs like
  // ◕ ‿ ᴗ ▽ ▿ 口 ⊙ ° □ ω ╥ ¬ ಠ ☆ are guaranteed to exist there). Keep it —
  // DotGothic16/VT323 are missing several of these.
  const fontFamily = monoFallback
    ? '"Courier New", "Lucida Console", monospace'
    : "monospace, \"Courier New\", \"Lucida Console\""

  return (
    <div
      className="pointer-events-none"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "pre",
        fontFamily,
        fontSize: "clamp(36px, 5.2cqw, 72px)",
        lineHeight: 1,
        letterSpacing: "-5px",
        transform: "scaleX(1.08)",
        color: "#ee5a58",
        textShadow: "0 0 7px #b62d2d, 0 0 18px rgba(233,74,74,.45)",
        userSelect: "none",
      }}
    >
      <style>{`
          @keyframes hound-bounce { to { transform: translateY(-3px) } }
          @keyframes hound-think { 50% { transform: translateY(-2px); opacity: 0.72 } }
          @keyframes hound-talk { to { transform: scaleY(1.035) translateY(-1px) } }
          @keyframes hound-glitch { 50% { transform: translateX(2px); opacity: 0.72 } }
          @keyframes hound-sleep { 50% { transform: translateY(2px); opacity: 0.62 } }
          @keyframes hound-blink { to { transform: scaleY(0.08) } }
        `}</style>
      <span
        key={`${propState}-${text}`}
        style={{
          display: "inline-block",
          animation: blink
            ? "hound-blink 140ms ease-in-out 1"
            : anim
              ? `hound-${anim} 820ms ease-in-out infinite`
              : "none",
        }}
      >
        {text}
      </span>
    </div>
  )
}

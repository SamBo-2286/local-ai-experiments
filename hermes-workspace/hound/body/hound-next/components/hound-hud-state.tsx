/**
 * HOUND HUD Shared State Module
 * Mirrors the layout HTML's window.HOUND API for future drop-in comms phase.
 *
 * API surface:
 *   setAvatarState, setThinking, setOutput, setStats
 *   displayWeb, displayText, displayImage, displayVault
 *   sendMessage, appendMessage, clearLog, toggleCamera, toggleMic
 */
"use client"

import { useState, useRef, useCallback } from "react"

export interface StatsData {
  cpu: number
  ram: number
  gpu: number
  temp: number
  load?: number
  model?: string
  gpuIdx?: number
  gpus?: Array<{
    i: number
    name: string
    mem_mb: number
    mem_total_mb: number
    util: number
    temp: number
  }>
}

type DisplayMode = "graph" | "web" | "message" | "image"
type VoiceState = "idle" | "listening" | "thinking" | "speaking"

interface HUDState {
  avatarState: string
  waveState: string
  displayMode: DisplayMode
  displayPayload: string | null
  cameraOn: boolean
  micOn: boolean
  voiceState: VoiceState
  log: Array<{ type: string; text: string }>
  stats: StatsData | null
  statsOnline: boolean
  statsFailCount: number
  idleMs: number
  isLocked: boolean
}

const HUD: HUDState = {
  avatarState: "idle",
  waveState: "idle",
  displayMode: "graph",
  displayPayload: null,
  cameraOn: true,
  micOn: false,
  voiceState: "idle",
  log: [
    { type: "system", text: "HOUND // MAIN HUD ONLINE" },
    { type: "system", text: "MODEL CHANNEL READY" },
  ],
  stats: null,
  statsOnline: false,
  statsFailCount: 0,
  idleMs: 0,
  isLocked: false,
}

export function useHudState() {
  const ref = useRef(HUD)

  const [tick, setTick] = useState(0)
  const force = useCallback(() => setTick((t) => t + 1), [])

  const setAvatarState = useCallback(
    (s: string) => {
      ref.current.avatarState = s
      force()
    },
    [force],
  )

  const setWaveState = useCallback(
    (s: string) => {
      ref.current.waveState = s
      force()
    },
    [force],
  )

  const setDisplayMode = useCallback(
    (m: DisplayMode) => {
      ref.current.displayMode = m
      ref.current.displayPayload = null
      force()
    },
    [force],
  )

  const displayWeb = useCallback(
    (url: string) => {
      ref.current.displayMode = "web"
      ref.current.displayPayload = url
      force()
    },
    [force],
  )

  const displayText = useCallback(
    (text: string) => {
      ref.current.displayMode = "message"
      ref.current.displayPayload = text
      force()
    },
    [force],
  )

  const displayImage = useCallback(
    (url: string) => {
      ref.current.displayMode = "image"
      ref.current.displayPayload = url
      force()
    },
    [force],
  )

  const displayVault = useCallback(() => {
    ref.current.displayMode = "graph"
    ref.current.displayPayload = null
    force()
  }, [force])

  const setStats = useCallback(
    (s: StatsData | null) => {
      ref.current.stats = s
      ref.current.statsOnline = !!s
      ref.current.statsFailCount = 0
      force()
    },
    [force],
  )

  const setStatsOffline = useCallback(() => {
    ref.current.statsOnline = false
    ref.current.statsFailCount = (ref.current.statsFailCount || 0) + 1
    if (ref.current.statsFailCount >= 3) {
      ref.current.stats = null
    }
    force()
  }, [force])

  const appendMessage = useCallback(
    (type: string, text: string) => {
      ref.current.log = [...ref.current.log, { type, text }]
      force()
    },
    [force],
  )

  const clearLog = useCallback(() => {
    ref.current.log = [{ type: "system", text: "HOUND // LOG CLEARED" }]
    force()
  }, [force])

  const toggleCamera = useCallback(() => {
    ref.current.cameraOn = !ref.current.cameraOn
    force()
  }, [force])

  const toggleMic = useCallback(() => {
    ref.current.micOn = !ref.current.micOn
    force()
  }, [force])

  const sendHoundMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      appendMessage("user", trimmed)
      setAvatarState("thinking")
      // Comms deferred — fallback only
      setTimeout(() => {
        appendMessage(
          "system",
          "LOCAL MODEL BRIDGE NOT CONNECTED // MESSAGE QUEUED FOR HOUND",
        )
        setAvatarState("idle")
      }, 300)
    },
    [appendMessage, setAvatarState],
  )

  const setThinking = useCallback(
    (text: string) => {
      appendMessage("system", text)
      setAvatarState("thinking")
    },
    [appendMessage, setAvatarState],
  )

  const setOutput = useCallback(
    (text: string) => {
      appendMessage("model", text)
      setAvatarState("idle")
    },
    [appendMessage, setAvatarState],
  )

  const setIdleMs = useCallback(
    (ms: number) => {
      ref.current.idleMs = ms
      force()
    },
    [force],
  )

  const setIsLocked = useCallback(
    (locked: boolean) => {
      ref.current.isLocked = locked
      force()
    },
    [force],
  )

  const s = ref.current

  return {
    tick,
    avatarState: s.avatarState,
    waveState: s.waveState,
    displayMode: s.displayMode,
    displayPayload: s.displayPayload,
    cameraOn: s.cameraOn,
    micOn: s.micOn,
    voiceState: s.voiceState,
    log: s.log,
    stats: s.stats,
    statsOnline: s.statsOnline,
    idleMs: s.idleMs,
    isLocked: s.isLocked,
    setAvatarState,
    setWaveState,
    setDisplayMode,
    displayWeb,
    displayText,
    displayImage,
    displayVault,
    setStats,
    setStatsOffline,
    appendMessage,
    clearLog,
    toggleCamera,
    toggleMic,
    sendHoundMessage,
    setThinking,
    setOutput,
    setIdleMs,
    setIsLocked,
  }
}

"use client"

/**
 * HOUND HUD Shared State Module
 * Mirrors the layout HTML's window.HOUND API for future drop-in comms phase.
 *
 * API surface:
 *   setAvatarState, setThinking, setOutput, setStats
 *   displayWeb, displayText, displayImage, displayVault
 *   sendMessage, appendMessage, clearLog, toggleCamera, toggleMic
 */

import { useState, useRef, useCallback, useEffect } from "react"

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
  micActive: boolean
  voiceState: VoiceState
  log: Array<{ type: string; text: string }>
  stats: StatsData | null
  statsOnline: boolean
  statsFailCount: number
  idleMs: number
  isLocked: boolean
  faceScan: boolean
  faceScanTimer: ReturnType<typeof setTimeout> | null
  bridgeWs: WebSocket | null
  mediaRecorder: MediaRecorder | null
  mediaStream: MediaStream | null
}

const HUD: HUDState = {
  avatarState: "idle",
  waveState: "idle",
  displayMode: "graph",
  displayPayload: null,
  cameraOn: true,
  micOn: false,
  micActive: false,
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
  faceScan: false,
  faceScanTimer: null,
  bridgeWs: null,
  mediaRecorder: null,
  mediaStream: null,
}

export interface HudApi {
  tick: number
  avatarState: string
  waveState: string
  displayMode: DisplayMode
  displayPayload: string | null
  cameraOn: boolean
  micOn: boolean
  micActive: boolean
  voiceState: VoiceState
  log: Array<{ type: string; text: string }>
  stats: StatsData | null
  statsOnline: boolean
  idleMs: number
  isLocked: boolean
  faceScan: boolean
  setAvatarState: (s: string) => void
  setWaveState: (s: string) => void
  setDisplayMode: (m: DisplayMode) => void
  displayWeb: (url: string) => void
  displayText: (text: string) => void
  displayImage: (url: string) => void
  displayVault: () => void
  setCameraOn: (on: boolean) => void
  setStats: (s: StatsData | null) => void
  setStatsOffline: () => void
  appendMessage: (type: string, text: string) => void
  clearLog: () => void
  toggleCamera: () => void
  toggleMic: () => void
  sendHoundMessage: (text: string) => void
  setThinking: (text: string) => void
  setOutput: (text: string) => void
  setIdleMs: (ms: number) => void
  setIsLocked: (locked: boolean) => void
  setFaceScan: (active: boolean) => void
  startFaceScanTimer: (onTimeout: () => void) => void
  setBridgeWs: (ws: WebSocket | null) => void
}

// Live accessor for the shared bridge WebSocket (used by lib/detector-client
// to send detectorCommand start/stop without creating new object identities).
export function getBridgeWs(): WebSocket | null {
  return HUD.bridgeWs
}

export function useHudState(): HudApi {
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

  const setCameraOn = useCallback(
    (on: boolean) => {
      ref.current.cameraOn = on
      force()
      // Signal body to stop/start MJPEG stream via bridge WS
      if (ref.current.bridgeWs && ref.current.bridgeWs.readyState === WebSocket.OPEN) {
        ref.current.bridgeWs.send(JSON.stringify({ type: "cameraCommand", command: on ? "start" : "stop" }))
      }
    },
    [force],
  )

  const setBridgeWs = useCallback((ws: WebSocket | null) => {
    ref.current.bridgeWs = ws
    force()
  }, [force])

  const toggleMic = useCallback(() => {
    if (ref.current.micOn) {
      // Stop mic
      if (ref.current.mediaRecorder) {
        ref.current.mediaRecorder.stop()
        ref.current.mediaRecorder = null
      }
      if (ref.current.mediaStream) {
        ref.current.mediaStream.getTracks().forEach((t) => t.stop())
        ref.current.mediaStream = null
      }
      ref.current.micOn = false
      ref.current.micActive = false
      force()
    } else {
      // Start mic — capture audio and stream it to the bridge
      if (!ref.current.bridgeWs) {
        appendMessage("system", "VOICE BRIDGE NOT CONNECTED")
        return
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        ref.current.mediaStream = stream
        ref.current.micOn = true
        ref.current.micActive = true
        force()

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" })
        ref.current.mediaRecorder = recorder
        const chunks: Blob[] = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ref.current.micActive) {
            chunks.push(e.data)
          }
        }

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "audio/webm" })
          const reader = new FileReader()
          reader.onloadend = () => {
            const arrayBuffer = reader.result as ArrayBuffer
            const hex = Array.from(new Uint8Array(arrayBuffer))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
            if (
              hex.length > 0 &&
              ref.current.bridgeWs?.readyState === WebSocket.OPEN
            ) {
              ref.current.bridgeWs.send(
                JSON.stringify({ type: "mic", data: hex }),
              )
            }
            chunks.length = 0
          }
          reader.readAsArrayBuffer(blob)
        }

        recorder.start(1000) // 1s chunks
      }).catch((err) => {
        console.error("Mic error:", err)
        appendMessage("system", "MIC ERROR: " + err.message)
      })
    }
  }, [force, appendMessage])

  const sendHoundMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      appendMessage("user", trimmed)
      setAvatarState("thinking")

      // Actually send to the bridge if connected
      if (ref.current.bridgeWs && ref.current.bridgeWs.readyState === WebSocket.OPEN) {
        ref.current.bridgeWs.send(JSON.stringify({ type: "chat", data: trimmed }))
      } else {
        // Bridge not connected yet — show fallback
        setTimeout(() => {
          appendMessage(
            "system",
            "LOCAL MODEL BRIDGE NOT CONNECTED // MESSAGE QUEUED FOR HOUND",
          )
          setAvatarState("idle")
        }, 300)
      }
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

  const setFaceScan = useCallback(
    (active: boolean) => {
      ref.current.faceScan = active
      if (!active && ref.current.faceScanTimer) {
        clearTimeout(ref.current.faceScanTimer)
        ref.current.faceScanTimer = null
      }
      force()
    },
    [force],
  )

  const startFaceScanTimer = useCallback(
    (onTimeout: () => void) => {
      if (ref.current.faceScanTimer) {
        clearTimeout(ref.current.faceScanTimer)
      }
      ref.current.faceScanTimer = setTimeout(() => {
        ref.current.faceScan = false
        ref.current.faceScanTimer = null
        force()
        onTimeout()
      }, 10_000)
    },
    [force],
  )

  // Clean up timers and media on unmount
  useEffect(() => {
    return () => {
      if (ref.current.faceScanTimer) {
        clearTimeout(ref.current.faceScanTimer)
        ref.current.faceScanTimer = null
      }
      if (ref.current.mediaRecorder) {
        ref.current.mediaRecorder.stop()
        ref.current.mediaRecorder = null
      }
      if (ref.current.mediaStream) {
        ref.current.mediaStream.getTracks().forEach((t) => t.stop())
        ref.current.mediaStream = null
      }
    }
  }, [])

  // STABLE REFERENCE FIX (2026-09-26):
  // Previously this returned a fresh object literal on every render. Any
  // consumer using `[s]` as a useEffect dependency (the voice-bridge WS
  // effect, the idle-timer effect, the stats poll) saw a new reference each
  // render, tore down and re-created the effect, called force(), and caused
  // another render — an infinite loop that flapped the WebSocket 1-2x/sec
  // and flooded the chat log with DISCONNECTED messages.
  //
  // We now build the API object ONCE and cache it in a ref. All state
  // fields are read from the shared store at render time (spread evaluates
  // them fresh each render, so consumers always see current values), while
  // every function reference stays identical across renders. Effects keyed
  // on [s] now run exactly once on mount and clean up once on unmount.
  const apiRef = useRef<HudApi | null>(null)
  if (apiRef.current === null) {
    apiRef.current = {
      tick,
      avatarState: ref.current.avatarState,
      waveState: ref.current.waveState,
      displayMode: ref.current.displayMode,
      displayPayload: ref.current.displayPayload,
      cameraOn: ref.current.cameraOn,
      micOn: ref.current.micOn,
      micActive: ref.current.micActive,
      voiceState: ref.current.voiceState,
      log: ref.current.log,
      stats: ref.current.stats,
      statsOnline: ref.current.statsOnline,
      idleMs: ref.current.idleMs,
      isLocked: ref.current.isLocked,
      faceScan: ref.current.faceScan,
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
      setCameraOn,
      toggleMic,
      sendHoundMessage,
      setThinking,
      setOutput,
      setIdleMs,
      setIsLocked,
      setFaceScan,
      startFaceScanTimer,
      setBridgeWs,
    }
  }

  // Re-read live values into the SAME object identity each render so that
  // consumers (which hold the first render's reference) always see fresh
  // state, while the reference itself never changes for effect deps.
  const api = apiRef.current!
  api.tick = tick
  api.avatarState = ref.current.avatarState
  api.waveState = ref.current.waveState
  api.displayMode = ref.current.displayMode
  api.displayPayload = ref.current.displayPayload
  api.cameraOn = ref.current.cameraOn
  api.micOn = ref.current.micOn
  api.micActive = ref.current.micActive
  api.voiceState = ref.current.voiceState
  api.log = ref.current.log
  api.stats = ref.current.stats
  api.statsOnline = ref.current.statsOnline
  api.idleMs = ref.current.idleMs
  api.isLocked = ref.current.isLocked
  api.faceScan = ref.current.faceScan

  return api
}

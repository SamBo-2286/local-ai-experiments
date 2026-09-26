/**
 * Vault Graph — 2D canvas-based node-link diagram.
 * Force-directed layout: repulsion + link springs + center gravity.
 * Supports sparse (86 nodes) and dense (up to 600) graphs.
 *
 * Positions are cached across fetches by node id, so the 60s re-fetch
 * doesn't re-randomize the layout — new nodes drift in, old nodes stay put.
 */
"use client"

import { useEffect, useRef, useState } from "react"

interface VaultNode {
  id: string
  name: string
}

interface VaultLink {
  s: string
  t: string
}

interface VaultGraphData {
  nodes: VaultNode[]
  links: VaultLink[]
  count: number
  ts: number
}

interface SimNode {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
}

// Position cache survives re-fetches within the component's lifetime.
const posCache = new Map<string, { x: number; y: number }>()

// Per-node energy tracking for cooling: each node accumulates velocity.
// When total energy drops below threshold, simulation freezes in place.
interface SimNodeWithEnergy extends SimNode {
  energy: number
}

export function VaultGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dataRef = useRef<VaultGraphData | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const rafRef = useRef<number | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const frozenRef = useRef(false) // true when simulation has cooled and stopped

  // Fetch graph data on mount, re-fetch every 60s
  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const r = await fetch("/api/vault-graph", { cache: "no-store" })
        if (!r.ok) throw 0
        const data: VaultGraphData = await r.json()
        dataRef.current = data

        // Rebuild sim nodes, reusing cached positions where possible.
        const seen = new Set<string>()
        const fresh: SimNode[] = data.nodes.map((n, i) => {
          seen.add(n.id)
          const cached = posCache.get(n.id)
          if (cached) {
            return {
              id: n.id,
              name: n.name,
              x: cached.x,
              y: cached.y,
              vx: 0,
              vy: 0,
            }
          }
          // Seed new nodes on a ring
          const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2
          const r0 = Math.min(300, 360) * 0.32
          return {
            id: n.id,
            name: n.name,
            x: 300 + Math.cos(a) * r0,
            y: 200 + Math.sin(a) * r0,
            vx: 0,
            vy: 0,
          }
        })
        // Prune cache entries that disappeared
        for (const id of Array.from(posCache.keys())) {
          if (!seen.has(id)) posCache.delete(id)
        }
        nodesRef.current = fresh
        setNodeCount(data.count || data.nodes.length)
        // Unfreeze so new nodes can settle into the layout
        frozenRef.current = false
      } catch {
        // Keep last good data on transient failures; mark count 0 only
        // if we never had any.
        if (!dataRef.current) setNodeCount(0)
      }
    }
    fetchGraph()
    const id = setInterval(fetchGraph, 60000)
    return () => clearInterval(id)
  }, [])

  // Draw + simulate loop
  useEffect(() => {
    let running = true

    const tick = () => {
      if (!running) return
      const canvas = canvasRef.current
      if (canvas) {
        const parent = canvas.parentElement
        if (parent) {
          const rect = parent.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          if (
            Math.abs(canvas.width - rect.width * dpr) > 1 ||
            Math.abs(canvas.height - rect.height * dpr) > 1
          ) {
            canvas.width = Math.max(1, Math.round(rect.width * dpr))
            canvas.height = Math.max(1, Math.round(rect.height * dpr))
            canvas.style.width = rect.width + "px"
            canvas.style.height = rect.height + "px"
          }
        }
      }

      const ctx = canvas?.getContext("2d")
      if (canvas && ctx) {
        const dpr = window.devicePixelRatio || 1
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const W = canvas.width / dpr
        const H = canvas.height / dpr
        ctx.clearRect(0, 0, W, H)

        const nodes = nodesRef.current
        const links = dataRef.current?.links ?? []

        if (nodes.length === 0) {
          ctx.fillStyle = "rgba(216,75,75,0.35)"
          ctx.font = "11px monospace"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText("NO NODES", W / 2, H / 2)
        } else {
          // ── Energy cooling ──────────────────────────────────────────
          // Alpha decays toward zero: simulation starts hot (alpha=0.3),
          // cools each frame, and freezes when total kinetic energy
          // drops below a threshold. This prevents the "drifting" effect
          // where nodes never settle.
          if (!frozenRef.current) {
            const alpha = 0.3 // initial simulation intensity

            // Repulsion between all pairs
            for (let i = 0; i < nodes.length; i++) {
              const a = nodes[i]
              for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j]
                const dx = a.x - b.x
                const dy = a.y - b.y
                let dist2 = dx * dx + dy * dy
                if (dist2 < 1) dist2 = 1
                const dist = Math.sqrt(dist2)
                const force = 800 / dist2
                const fx = (dx / dist) * force * alpha
                const fy = (dy / dist) * force * alpha
                a.vx += fx
                a.vy += fy
                b.vx -= fx
                b.vy -= fy
              }
            }

            // Link springs
            const byId = new Map(nodes.map((n) => [n.id, n]))
            const springLen = Math.max(40, W * 0.09)
            for (const link of links) {
              const a = byId.get(link.s)
              const b = byId.get(link.t)
              if (!a || !b) continue
              const dx = b.x - a.x
              const dy = b.y - a.y
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              const force = (dist - springLen) * 0.01 * alpha
              const fx = (dx / dist) * force
              const fy = (dy / dist) * force
              a.vx += fx
              a.vy += fy
              b.vx -= fx
              b.vy -= fy
            }

            // Center gravity + integrate + clamp
            for (const n of nodes) {
              n.vx += (W / 2 - n.x) * 0.005 * alpha
              n.vy += (H / 2 - n.y) * 0.005 * alpha
              n.vx *= 0.85
              n.vy *= 0.85
              n.x += n.vx
              n.y += n.vy
              n.x = Math.max(10, Math.min(W - 10, n.x))
              n.y = Math.max(10, Math.min(H - 10, n.y))
            }

            // Compute total kinetic energy this frame
            let totalEnergy = 0
            for (const n of nodes) {
              totalEnergy += n.vx * n.vx + n.vy * n.vy
            }

            // Persist positions
            for (const n of nodes) posCache.set(n.id, { x: n.x, y: n.y })

            // If energy is near-zero, freeze the simulation entirely
            if (totalEnergy < nodes.length * 0.01) {
              frozenRef.current = true
            }
          }

          // ── Draw (always runs, even when frozen) ─────────────────────
          const byId = new Map(nodes.map((n) => [n.id, n]))

          // Draw links
          ctx.lineWidth = 1
          ctx.strokeStyle = "rgba(232,35,42,.28)"
          for (const link of links) {
            const a = byId.get(link.s)
            const b = byId.get(link.t)
            if (!a || !b) continue
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }

          // Draw nodes + labels (skip labels when dense)
          const showLabels = nodes.length <= 200
          const fontSize = Math.max(8, Math.min(12, W * 0.012))
          ctx.font = `${Math.round(fontSize)}px monospace`
          ctx.textBaseline = "middle"
          ctx.textAlign = "left"

          for (const n of nodes) {
            ctx.shadowBlur = 7
            ctx.shadowColor = "rgba(232,35,42,.5)"
            ctx.fillStyle = "rgba(232,35,42,.85)"
            ctx.beginPath()
            ctx.arc(n.x, n.y, 3, 0, Math.PI * 2)
            ctx.fill()

            if (showLabels) {
              ctx.shadowBlur = 0
              ctx.fillStyle = "rgba(232,35,42,.72)"
              const label =
                n.name.length > 28 ? n.name.slice(0, 28) + "…" : n.name
              ctx.fillText(label, n.x + 6, n.y)
            }
          }
          ctx.shadowBlur = 0
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {nodeCount > 0 && (
        <div
          style={{
            position: "absolute",
            right: "4%",
            bottom: "2.5%",
            fontSize: "clamp(7px, 0.6cqw, 10px)",
            color: "rgba(216,75,75,0.55)",
            letterSpacing: "0.05em",
          }}
        >
          {nodeCount} NODES
        </div>
      )}
    </div>
  )
}

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:hound-project-rules -->

# HOUND project rules (load-bearing — do not remove)

This repo is the HOUND HUD. The body (10.0.0.2) is 4-core CPU-only; the local model (3B, port 8093)
saturates at load ~1.5. These rules come from a real incident — violating them costs days.

## Hard rules
1. **`useHudState()` must keep returning a stable object.** A fresh object per render makes every
   `[s]`-keyed effect tear down and rebuild every render (reconnect storm). Commit 18d31e3 is load-bearing.
2. **CPU budget:** anything that polls or infers on the body (face detection, motion, frame
   capture) must have a hard cadence cap and a pause condition. Face detection runs ONLY while
   the lock screen is active. Verify `loadavg` idle (< 1.5) and active before shipping.
3. **Avatar states:** `idle, listening, thinking, speaking, happy, excited, curious, confused,
   surprised, worried, sad, angry, smug, sleepy, error, booting, sleeping`. There is NO `talking`
   state — talking animation is `speaking`.
4. **Bridge `tts_audio`** payload is base64 WAV in the `data` field (not `audio`).
5. **Deploy gate — every brain→body deploy, no exceptions:**
   1. Backup: `git diff > backup.patch` + snapshot `components/` before editing.
   2. Brain: `npx tsc --noEmit` (empty) + `rm -rf .next && pnpm build` (exit 0). **Never exclude
      `.next/` from the deploy — the body cannot rebuild (no pnpm, no node_modules).**
   3. Body: `rm -rf .next node_modules components-backup` BEFORE `tar -xzf` (stale chunks lie).
      Deploy the **full** brain output (source + `.next/` + `node_modules/` in one tar). Verify
      BUILD_ID matches brain. `systemctl --user restart hound-next`.
   4. Wire-verify before any TV check: bridge journal stable (1 connection, not a storm), new code
      present in served chunks (search `.next/static/chunks/` for feature strings),
      `curl -sI http://localhost:3000/` → 200. Slow model? Time one :8093 request, check
      `loadavg`, `pgrep -c ffmpeg` (want 1), `ss -tn | grep 8082` for CLOSE-WAIT.
   5. Sam verifies the golden path on the TV (login → speak → verbal reply + face animation →
      type → text+verbal → 120s idle → lock → unlock).
   6. Commit only after Sam confirms.

   **Why full tar, not incremental sources:** The body has no pnpm and cannot install it
   (corepack enable, npm i -g pnpm, all failed). The body is a serve-only node. Build on
   brain → deploy complete `.next/` + `node_modules/` → serve on body. Incremental source
   transfers break because `npm` can't resolve pnpm symlinks and there are no dependencies.
6. **ssh to body:** user `ollie`; never write the password into files/commits/logs. Avoid
   parentheses in remote bash strings; `pkill -f` patterns must not match the ssh command line.
7. One feature at a time: gate → Sam verifies → commit → next. Never batch features into one
   unverified deploy.

## System map
Brain 10.0.0.1 = this repo (build here). Body 10.0.0.2 = `/opt/ollie-body/hound-next` (port 3000),
kiosk `chromium-kiosk.service` (keeps `--autoplay-policy=no-user-gesture-required`). Body user
services: `hound-next` :3000, `hound-voice-bridge` :8092, whisper :8090, piper TTS :8091, model
:8093, `hound-mjpeg` :8082 (one ffmpeg per connection — has a stale-connection reaper; keep it).
Full protocol details + incident history: `../PHASE2-BRIEF.md` (repo root's parent dir).

## Workflow (Phase 2+)

Every feature follows this pipeline, no exceptions. Violating costs time.

### 1. Spec — before any code
- Write feature spec to `.hermes/plans/FEATURE-name.md`
- Cover: goal, success criteria, affected files, edge cases, constraints
- Must pass `grill-me` adversarial review for novel features

### 2. Spike — for unknown unknowns only
- If a feature involves unproven feasibility (e.g., "can YOLO run on N100 without killing the model?")
- Create throwaway branch, run `spike` skill
- Measure loadavg, validate approach, write findings
- If spike fails → document and move on. Don't force it.

### 3. Implement — one feature, one session
- Load `nextjs-troubleshooting` before touching any Next.js code
- Implement ONLY the specified feature. No scope creep.
- If you hit a wall → `systematic-debugging` (4-phase root cause, not trial-and-error)
- Use `cavecrew` subagents for parallel independent work

### 4. QA — before ANY body deploy
- Run `dogfood` on `http://localhost:3000` (run `next dev` first)
- Run `webapp-testing` for WebSocket/connectivity checks
- Visual check via `browser_vision` on localhost:3000
- **No deploy until QA passes.** This is non-negotiable.

### 5. Deploy
- Follow the deploy gate (Hard rule 5) exactly
- Wire-verify on the body before Sam checks on TV

### 6. Verify + Commit
- Sam runs golden path on TV
- Commit only after confirmation
- Update PHASE2-BRIEF.md §0 with what changed
- Update Known Issues table below if you learned something new

## Known Issues

| # | Issue | Status | Impact |
|---|-------|--------|--------|
| 1 | WebSocket bridge has zero reconnection logic (onerror just logs "DISCONNECTED") | Known, unmitigated | Bridge restarts break HUD until page reload |
| 2 | Zustand store: all 9 panels connected to same reactive state | Known, deferred | Full HUD re-render on every stats update (2s) |
| 3 | Polling not batched: stats 2s, idle 1s, clock 1s, avatar 220ms | Known, minor | Constant background churn on N100 |
| 4 | No error boundaries — one panel crash can take entire HUD | Known, deferred | Unhandled component errors = full HUD failure |
| 5 | Hardcoded upstream URLs in route.ts (BRIDGE, UPSTREAM) | Known, deferred | Any port change requires source edit + rebuild + deploy |
| 6 | Password in localStorage (client-side only) | Known, accepted risk | Anyone with display access can read hash via DevTools |
| 7 | `tts_audio` payload field is `data` not `audio` | Mitigated | Rule 4 in hard rules — enforces correct field |

## Anti-patterns (do NOT do these)

- ❌ Batch multiple features into one deploy
- ❌ Deploy without running tsc + pnpm build first
- ❌ Skip the `rm -rf .next` on body before tar extract
- ❌ Use new per-render object literals in useEffect dependencies
- ❌ Poll camera/detection outside lock screen active state
- ❌ Write password/secret to files, commits, or logs
- ❌ Commit before Sam confirms on TV

<!-- END:hound-project-rules -->

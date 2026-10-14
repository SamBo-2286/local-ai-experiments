import { NextResponse } from "next/server"

export async function GET() {
  const { exec } = await import("child_process")
  const prom = (cmd: string) => new Promise<string>((resolve) => {
    exec(cmd, (_err, stdout) => resolve(stdout.trim()))
  })

  const [whisper, tts, bridge, mjpeg, nextjs] = await Promise.all([
    prom("systemctl --user is-active hound-whisper"),
    prom("systemctl --user is-active hound-tts"),
    prom("systemctl --user is-active hound-voice-bridge"),
    prom("systemctl --system is-active mjpeg-stream.service"),
    prom("systemctl --user is-active hound-next"),
  ])

  return NextResponse.json({
    services: [
      { name: "whisper", display: "STT (Whisper)", port: 8090, status: whisper },
      { name: "tts", display: "TTS (espeak)", port: 8091, status: tts },
      { name: "voice-bridge", display: "Voice Bridge", port: 8092, status: bridge },
      { name: "mjpeg", display: "Camera Stream", port: 8084, status: mjpeg },
      { name: "nextjs", display: "HUD / Web", port: 3000, status: nextjs },
    ],
  })
}

export async function POST(request: Request) {
  const { action, service } = await request.json()

  const validActions = ["start", "stop", "restart"]
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 })
  }

  const { exec } = await import("child_process")
  const cmd = `systemctl --user ${action} hound-${service}`

  try {
    await new Promise<void>((resolve, reject) => {
      exec(cmd, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const status = await new Promise<string>((resolve) => {
      exec(`systemctl --user is-active hound-${service}`, (_err, stdout) => {
        resolve(stdout.trim())
      })
    })

    return NextResponse.json({ action, service, status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

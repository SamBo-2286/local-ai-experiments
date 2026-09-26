import { NextResponse } from "next/server"

const UPSTREAM = "http://127.0.0.1:8082/cam-stream"

// MJPEG multipart is a long-lived stream — never let Next cache or buffer it.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const upstream = await fetch(UPSTREAM, { cache: "no-store" })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "camera offline" }, { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ??
          "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache",
      },
    })
  } catch {
    return NextResponse.json({ error: "camera offline" }, { status: 502 })
  }
}

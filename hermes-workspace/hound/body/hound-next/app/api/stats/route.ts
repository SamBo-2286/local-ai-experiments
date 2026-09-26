import { NextResponse } from "next/server"

const BRIDGE = "http://10.0.0.1:8090"

export async function GET() {
  try {
    const r = await fetch(`${BRIDGE}/api/stats`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!r.ok) {
      return NextResponse.json(
        { error: "bridge unreachable" },
        { status: 502 },
      )
    }
    const data = await r.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: "bridge unreachable" },
      { status: 502 },
    )
  }
}

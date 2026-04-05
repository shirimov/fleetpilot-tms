import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params
    // Prevent path traversal
    const safe = segments.map(s => s.replace(/\.\./g, '')).filter(Boolean)
    const filePath = path.join(process.cwd(), 'public', 'uploads', ...safe)
    const buf = await readFile(filePath)

    const ext = safe[safe.length - 1]?.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mime: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic'
    }
    return new NextResponse(buf, {
      headers: {
        'Content-Type': mime[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

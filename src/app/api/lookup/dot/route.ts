import { NextResponse } from 'next/server'

async function scrapeCarrier(param: 'USDOT' | 'MC_MX', value: string) {
  const res = await fetch(
    `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=${param}&query_string=${value}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  const html = await res.text()

  if (html.includes('RECORD NOT FOUND') || html.includes('No records found') || html.includes('RECORD INACTIVE')) {
    return null
  }

  const fieldMatches = [...html.matchAll(/<td[^>]*class="queryfield"[^>]*>([\s\S]*?)<\/td>/gi)]
  const fields = fieldMatches.map(m =>
    m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\r?\n/g, ' ').trim()
  )

  const mcMatch = html.match(/MC-(\d+)/)
  const dotMatch = html.match(/USDOT\s*:?\s*(\d+)/)

  const name      = fields[9]  || ''
  const address   = fields[11] || ''
  const status    = fields[2]  || ''
  const mcNumber  = mcMatch  ? mcMatch[1]  : (fields[4] || '')
  const dotNumber = dotMatch ? dotMatch[1] : (param === 'USDOT' ? value : '')

  if (!name) return null

  return { name, address, status, dotNumber, mcNumber }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dot = searchParams.get('dot')?.trim()
  const mc  = searchParams.get('mc')?.trim()

  if (!dot && !mc) {
    return NextResponse.json({ error: 'Provide a DOT or MC number' }, { status: 400 })
  }
  if (dot && !/^\d+$/.test(dot)) {
    return NextResponse.json({ error: 'DOT number must be numeric' }, { status: 400 })
  }
  if (mc && !/^\d+$/.test(mc)) {
    return NextResponse.json({ error: 'MC number must be numeric' }, { status: 400 })
  }

  try {
    const result = dot
      ? await scrapeCarrier('USDOT', dot)
      : await scrapeCarrier('MC_MX', mc!)

    if (!result) {
      return NextResponse.json({ error: `${dot ? 'DOT' : 'MC'} number not found in FMCSA` }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

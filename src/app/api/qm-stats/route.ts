import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const STATS_FILE = '/opt/tms/public/qm-stats.json';
const CACHE_MINUTES = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  try {
    // Check if cache is fresh
    let needsRefresh = forceRefresh;
    if (!needsRefresh && fs.existsSync(STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      const age = (Date.now() - new Date(stats.updatedAt).getTime()) / 60000;
      if (age < CACHE_MINUTES) return NextResponse.json(stats);
      needsRefresh = true;
    } else {
      needsRefresh = true;
    }

    // Run scraper
    await execAsync('node /opt/tms/scripts/qm-stats.js', { timeout: 90000 });

    if (fs.existsSync(STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      return NextResponse.json(stats);
    }

    return NextResponse.json({ error: 'Stats not available' }, { status: 500 });
  } catch (e: unknown) {
    const err = e as { message?: string };
    // Return cached data if available even if refresh failed
    if (fs.existsSync(STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      stats.stale = true;
      return NextResponse.json(stats);
    }
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}

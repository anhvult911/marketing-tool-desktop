import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import {
  summarizeByAccount,
  summarizeByEngine,
  recommendPacing,
  withinWindow,
  estimateMeasuredConstants,
  TelemetryRow,
} from '@/lib/scrape-telemetry';

/**
 * P5 — API sức khoẻ cào & khuyến nghị auto-tune.
 * GET ?hours=168 → tổng hợp telemetry cửa sổ N giờ + khuyến nghị pacing/cooldown
 * theo từng account + hằng số đo thực cho capacity calculator.
 */
export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { searchParams } = new URL(request.url);
    const hours = Math.max(1, Math.min(24 * 30, parseInt(searchParams.get('hours') || '168', 10) || 168));
    const windowMs = hours * 3600_000;

    const rows = db.prepare(`
      SELECT t.account_id, t.engine, t.requests, t.leads_new, t.http_500,
             t.duration_ms, t.first_500_at_request, t.created_at
      FROM scrape_telemetry t
      JOIN scrape_jobs j ON j.id = t.job_id
      WHERE j.workspace_id = ?
      ORDER BY t.id DESC
      LIMIT 5000
    `).all(workspaceId) as TelemetryRow[];

    const windowed = withinWindow(rows, Date.now(), windowMs);
    const accounts = summarizeByAccount(windowed).map(a => {
      const rec = recommendPacing(a);
      const account = db.prepare(`SELECT username, status, cooldown_until, platform FROM social_accounts WHERE id = ?`)
        .get(a.accountId) as { username: string; status: string; cooldown_until: string | null; platform: string } | undefined;
      return {
        ...a,
        username: account?.username || `#${a.accountId}`,
        status: account?.status || 'unknown',
        platform: account?.platform || 'facebook',
        cooldownUntil: account?.cooldown_until || null,
        recommendation: {
          pacingMs: rec.pacingMs,
          cooldownMs: rec.cooldownMs,
          note: rec.note,
          confident: rec.confident,
        },
      };
    });

    return NextResponse.json({
      success: true,
      windowHours: hours,
      totalRows: windowed.length,
      engines: summarizeByEngine(windowed),
      accounts,
      measured: estimateMeasuredConstants(windowed) || null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

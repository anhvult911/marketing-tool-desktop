import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { planCapacity } from '@/lib/capacity';

interface CountRow {
  n: number;
}

function countRow(row: unknown): number {
  if (row && typeof row === 'object' && 'n' in row) {
    const value = (row as CountRow).n;
    return typeof value === 'number' ? value : 0;
  }
  return 0;
}

/**
 * CD7 — Capacity API: trả kế hoạch thu leads dựa trên hằng số đo thực tế
 * và trạng thái pool hiện tại (account live + proxy working không gắn account).
 *
 * GET /api/spam/capacity?target=5000
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetParam = parseInt(searchParams.get('target') || '5000', 10);
    const targetLeads = Math.max(1, Number.isNaN(targetParam) ? 5000 : targetParam);

    const liveAccounts = countRow(db.prepare(`
      SELECT COUNT(*) as n FROM social_accounts
      WHERE platform = 'facebook' AND status IN ('live', 'ready', 'active')
    `).get());

    const spareProxies = countRow(db.prepare(`
      SELECT COUNT(*) as n FROM proxies
      WHERE status = 'working' AND id NOT IN (
        SELECT COALESCE(proxy_id, -1) FROM social_accounts
      )
    `).get());

    const plan = planCapacity({ liveAccounts, spareProxies, targetLeads });

    return NextResponse.json({
      success: true,
      data: {
        pool: { liveAccounts, spareProxies },
        targetLeads,
        plan,
        measured: {
          leadsPerRequest: 8,
          chainRequests: 18,
          chainLeads: 144,
          chainCooldownMin: 10,
          sessionMin: 7,
          note: 'Hằng số đo thực tế 2026-09-09 trên target follower list công khai',
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

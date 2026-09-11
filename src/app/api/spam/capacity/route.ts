import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { planCapacity, CapacityOverrides } from '@/lib/capacity';
import { estimateMeasuredConstants, withinWindow, TelemetryRow } from '@/lib/scrape-telemetry';

type Estimate = CapacityOverrides;

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

    // P5 — số đo telemetry; nguồn ghi RÕ theo từng trường để không nhận vơ là
    // "đo thực" khi trường đó vẫn lấy từ hằng số tay (vd telemetry cũ chưa có
    // first_500_at_request nên không suy ra được chainLeads).
    let measuredOverride: Estimate | undefined;
    let est: ReturnType<typeof estimateMeasuredConstants>;
    try {
      const telRows = db.prepare(`
        SELECT t.account_id, t.engine, t.requests, t.leads_new, t.http_500,
               t.duration_ms, t.first_500_at_request, t.created_at
        FROM scrape_telemetry t
        JOIN scrape_jobs j ON j.id = t.job_id
        ORDER BY t.id DESC LIMIT 3000
      `).all() as TelemetryRow[];
      est = estimateMeasuredConstants(withinWindow(telRows, Date.now(), 7 * 24 * 3600_000));
      if (est) {
        measuredOverride = {
          chainLeads: est.chainLeads,
          sessionMin: est.chainDurationMin,
          successRate: est.successRate,
        };
      }
    } catch (telErr: unknown) {
      console.warn('[Capacity] Bỏ qua số đo telemetry:', telErr instanceof Error ? telErr.message : telErr);
    }

    const plan = planCapacity({ liveAccounts, spareProxies, targetLeads, overrides: measuredOverride ?? undefined });

    const chainLeadsFromTelemetry = est?.chainLeads !== undefined;
    const sessionFromTelemetry = est?.chainDurationMin !== undefined;
    const successFromTelemetry = est?.successRate !== undefined;
    const anyFromTelemetry = chainLeadsFromTelemetry || sessionFromTelemetry || successFromTelemetry;

    return NextResponse.json({
      success: true,
      data: {
        pool: { liveAccounts, spareProxies },
        targetLeads,
        plan,
        measured: {
          leadsPerRequest: 8,
          chainRequests: 18,
          chainLeads: chainLeadsFromTelemetry ? est!.chainLeads : 144,
          chainCooldownMin: 10,
          sessionMin: sessionFromTelemetry ? est!.chainDurationMin : 7,
          successRate: successFromTelemetry ? est!.successRate : undefined,
          source: anyFromTelemetry ? 'telemetry-7d' : 'manual-2026-09-09',
          fieldsFromTelemetry: {
            chainLeads: chainLeadsFromTelemetry,
            sessionMin: sessionFromTelemetry,
            successRate: successFromTelemetry,
          },
          note: anyFromTelemetry
            ? 'Trường có fieldsFromTelemetry=true lấy từ telemetry 7 ngày; trường còn lại dùng hằng số đo tay 2026-09-09.'
            : 'Chưa đủ mẫu telemetry — dùng hằng số đo tay 2026-09-09 trên target follower list công khai.',
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

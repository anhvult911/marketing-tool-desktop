import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { startScrapeQueue, stopScrapeQueue, getScrapeQueueState } from '@/lib/scrape-queue-runner';

/**
 * P4 — API hàng đợi mục tiêu chạy nền ("qua đêm").
 * GET  → trạng thái hiện tại (UI poll).
 * POST → { action: 'start' | 'stop', ...tuỳ chọn }
 */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: getScrapeQueueState() });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const body = await request.json().catch(() => ({}));

    if (body.action === 'stop') {
      return NextResponse.json({ success: true, message: 'Đã gửi lệnh dừng hàng đợi.', data: stopScrapeQueue() });
    }

    if (body.action !== 'start') {
      return NextResponse.json({ success: false, error: 'Hành động không hợp lệ (start | stop).' }, { status: 400 });
    }

    const result = startScrapeQueue({
      workspaceId,
      maxRuntimeHours: body.maxRuntimeHours,
      minIntervalHours: body.minIntervalHours,
      maxLimitPerTarget: body.maxLimitPerTarget,
      scrapeType: body.scrapeType,
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : undefined,
      parallelSessions: body.parallelSessions,
      sleepBetweenTargetsSec: body.sleepBetweenTargetsSec,
    });

    return NextResponse.json({
      success: result.ok,
      message: result.message,
      error: result.ok ? undefined : result.message,
      data: result.state,
    }, { status: result.ok ? 200 : 409 });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

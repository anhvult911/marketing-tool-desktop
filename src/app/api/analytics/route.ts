import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    // 1. Fetch Daily Stats
    const dailyStats = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', coalesce(run_at, scheduled_at)) as date,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as success,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
        COALESCE(SUM(CASE WHEN status = 'pending' OR status = 'processing' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END), 0) as paused,
        COUNT(*) as total
      FROM jobs
      WHERE coalesce(run_at, scheduled_at) IS NOT NULL AND workspace_id = ?
      GROUP BY strftime('%Y-%m-%d', coalesce(run_at, scheduled_at))
      ORDER BY date ASC
    `).all(workspaceId) as any[];

    // 2. Fetch KPIs
    const kpiStats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as total_success,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as total_failed,
        COALESCE(SUM(CASE WHEN status = 'pending' OR status = 'processing' THEN 1 ELSE 0 END), 0) as total_pending,
        COUNT(*) as total_jobs
      FROM jobs
      WHERE workspace_id = ?
    `).get(workspaceId) as any;

    // 3. Operational Dashboard Stats
    const totalAccs = db.prepare(`SELECT COUNT(*) as count FROM social_accounts WHERE workspace_id = ?`).get(workspaceId) as any;
    const liveAccs = db.prepare(`SELECT COUNT(*) as count FROM social_accounts WHERE status = 'live' AND workspace_id = ?`).get(workspaceId) as any;
    const dieAccs = db.prepare(`SELECT COUNT(*) as count FROM social_accounts WHERE status = 'die' AND workspace_id = ?`).get(workspaceId) as any;
    const checkpointAccs = db.prepare(`SELECT COUNT(*) as count FROM social_accounts WHERE status = 'checkpoint' AND workspace_id = ?`).get(workspaceId) as any;

    const totalProxies = db.prepare(`SELECT COUNT(*) as count FROM proxies WHERE workspace_id = ?`).get(workspaceId) as any;
    const totalTargets = db.prepare(`SELECT COUNT(*) as count FROM scrape_targets WHERE workspace_id = ?`).get(workspaceId) as any;

    const recentJobs = db.prepare(`
      SELECT jobs.*, social_accounts.username, social_accounts.platform 
      FROM jobs 
      LEFT JOIN social_accounts ON jobs.account_id = social_accounts.id 
      WHERE jobs.workspace_id = ?
      ORDER BY jobs.id DESC 
      LIMIT 5
    `).all(workspaceId) as any[];

    return NextResponse.json({
      success: true,
      data: {
        daily: dailyStats,
        campaigns: [],
        platforms: [],
        kpi: {
          totalSuccess: kpiStats?.total_success || 0,
          totalFailed: kpiStats?.total_failed || 0,
          totalPending: kpiStats?.total_pending || 0,
          totalJobs: kpiStats?.total_jobs || 0,
        },
        operational: {
          accounts: {
            total: totalAccs?.count || 0,
            live: liveAccs?.count || 0,
            die: dieAccs?.count || 0,
            checkpoint: checkpointAccs?.count || 0
          },
          proxies: {
            total: totalProxies?.count || 0,
            working: totalProxies?.count || 0
          },
          targets: {
            total: totalTargets?.count || 0
          },
          recentJobs
        }
      }
    });
  } catch (error: any) {
    console.error('[Analytics API Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi hệ thống khi tải thống kê.' },
      { status: 500 }
    );
  }
}

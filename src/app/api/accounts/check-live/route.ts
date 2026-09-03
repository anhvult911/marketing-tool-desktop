import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import localQueue from '@/lib/queue';

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { accountId, accountIds } = await request.json();
    const now = new Date().toISOString();

    const insertJobStmt = db.prepare(`
      INSERT INTO jobs (account_id, type, status, scheduled_at, workspace_id)
      VALUES (?, 'check_status', 'pending', ?, ?)
    `);

    if (accountIds && Array.isArray(accountIds)) {
      const insertMany = db.transaction(() => {
        for (const id of accountIds) {
          insertJobStmt.run(parseInt(id, 10), now, workspaceId);
        }
      });
      insertMany();
      localQueue.triggerProcess();
      return NextResponse.json({ success: true, message: `Đã thêm yêu cầu kiểm tra cho ${accountIds.length} tài khoản vào hàng đợi.` });
    }

    if (accountId) {
      insertJobStmt.run(parseInt(accountId, 10), now, workspaceId);
      localQueue.triggerProcess();
      return NextResponse.json({ success: true, message: 'Đã thêm yêu cầu kiểm tra tài khoản vào hàng đợi.' });
    } else {
      const accounts = db.prepare(`SELECT id FROM social_accounts WHERE workspace_id = ?`).all(workspaceId) as Array<{ id: number }>;
      if (accounts.length === 0) {
        return NextResponse.json({ success: false, error: 'Chưa có tài khoản nào để kiểm tra.' }, { status: 400 });
      }

      const insertAll = db.transaction(() => {
        for (const acc of accounts) {
          insertJobStmt.run(acc.id, now, workspaceId);
        }
      });
      insertAll();
      localQueue.triggerProcess();

      return NextResponse.json({ success: true, message: `Đã thêm yêu cầu kiểm tra cho ${accounts.length} tài khoản vào hàng đợi.` });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

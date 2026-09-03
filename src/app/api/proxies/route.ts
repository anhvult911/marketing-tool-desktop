import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const proxies = db.prepare(`
      SELECT proxies.*, 
             (SELECT COUNT(*) FROM social_accounts WHERE social_accounts.proxy_id = proxies.id AND social_accounts.workspace_id = ?) as account_count,
             (SELECT GROUP_CONCAT(username) FROM social_accounts WHERE social_accounts.proxy_id = proxies.id AND social_accounts.workspace_id = ?) as accounts
      FROM proxies 
      WHERE proxies.workspace_id = ?
      ORDER BY proxies.id DESC
    `).all(workspaceId, workspaceId, workspaceId) as any[];

    const formattedProxies = proxies.map(p => ({
      ...p,
      accounts: p.accounts ? p.accounts.split(',') : []
    }));

    return NextResponse.json({ success: true, data: formattedProxies });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { rawText } = await request.json();
    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsedProxies: Array<{ host: string; port: number; username?: string; password?: string }> = [];

    for (const line of lines) {
      if (line.includes('@')) {
        const [auth, hostPort] = line.split('@');
        const [username, password] = auth.split(':');
        const [host, portStr] = hostPort.split(':');
        const port = parseInt(portStr, 10);
        if (host && port) {
          parsedProxies.push({ host, port, username, password });
        }
      } else {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const host = parts[0];
          const port = parseInt(parts[1], 10);
          const username = parts[2] || undefined;
          const password = parts[3] || undefined;
          if (host && port) {
            parsedProxies.push({ host, port, username, password });
          }
        }
      }
    }

    if (parsedProxies.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO proxies (host, port, username, password, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction(() => {
        for (const item of parsedProxies) {
          insertStmt.run(item.host, item.port, item.username || null, item.password || null, workspaceId);
        }
      });
      insertMany();
    }

    return NextResponse.json({ success: true, count: parsedProxies.length, message: `Đã nhập thành công ${parsedProxies.length} proxy.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID proxy.' }, { status: 400 });
    }

    const deleteTx = db.transaction(() => {
      db.prepare(`UPDATE social_accounts SET proxy_id = NULL WHERE proxy_id = ? AND workspace_id = ?`).run(id, workspaceId);
      db.prepare(`DELETE FROM proxies WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    });
    deleteTx();

    return NextResponse.json({ success: true, message: 'Đã xóa proxy thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

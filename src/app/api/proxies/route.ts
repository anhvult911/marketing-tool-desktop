import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { parseProxyLine } from '@/lib/proxy-utils';

export const dynamic = 'force-dynamic';

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
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ. Vui lòng nhập danh sách proxy.' }, { status: 400 });
    }

    const lines = rawText.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const parsedProxies = lines
      .map((line: string) => parseProxyLine(line))
      .filter((p: any): p is NonNullable<typeof p> => p !== null);

    if (parsedProxies.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Không nhận diện được định dạng proxy nào. Hỗ trợ các định dạng: host:port, host:port:user:pass, user:pass@host:port, host|port|user|pass hoặc http/socks5.' 
      }, { status: 400 });
    }

    const checkExistingStmt = db.prepare(`
      SELECT id FROM proxies WHERE host = ? AND port = ? AND workspace_id = ?
    `);

    const updateStmt = db.prepare(`
      UPDATE proxies SET username = ?, password = ?, protocol = ?, status = 'active' WHERE id = ?
    `);

    const insertStmt = db.prepare(`
      INSERT INTO proxies (host, port, username, password, protocol, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let newCount = 0;
    let updatedCount = 0;

    const saveMany = db.transaction(() => {
      for (const item of parsedProxies) {
        const existing = checkExistingStmt.get(item.host, item.port, workspaceId) as any;
        if (existing) {
          updateStmt.run(item.username || null, item.password || null, item.protocol || 'http', existing.id);
          updatedCount++;
        } else {
          insertStmt.run(item.host, item.port, item.username || null, item.password || null, item.protocol || 'http', workspaceId);
          newCount++;
        }
      }
    });

    saveMany();

    const summaryMsg = updatedCount > 0 
      ? `Đã thêm ${newCount} proxy mới và cập nhật ${updatedCount} proxy đã có.`
      : `Đã nhập thành công ${newCount} proxy.`;

    return NextResponse.json({ 
      success: true, 
      count: parsedProxies.length, 
      message: summaryMsg 
    });
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

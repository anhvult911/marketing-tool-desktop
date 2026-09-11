import { NextResponse } from 'next/server';
import db from '@/lib/db';
import path from 'path';
import { getAuthSession } from '@/lib/auth';
import { PROFILES_DIR } from '@/lib/paths';
import { parseProxyLine } from '@/lib/proxy-utils';

const VALID_PLATFORMS = ['x', 'zalo', 'whatsapp', 'telegram', 'threads', 'facebook', 'youtube', 'tiktok', 'instagram', 'newf319'];

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const accounts = db.prepare(`
      SELECT social_accounts.*, 
             (proxies.host || ':' || proxies.port) as "proxy_display",
             proxies.id as "proxy_id"
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id 
      WHERE social_accounts.workspace_id = ?
      ORDER BY social_accounts.id DESC
    `).all(workspaceId);

    return NextResponse.json({ success: true, data: accounts });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { rawText, platform: defaultPlatform } = await request.json();
    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    let insertedCount = 0;

    const insertAccountStmt = db.prepare(`
      INSERT INTO social_accounts (platform, username, password, email, proxy_id, user_data_dir, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const findProxyStmt = db.prepare(`
      SELECT id FROM proxies 
      WHERE host = ? AND port = ? AND workspace_id = ?
    `);

    const insertProxyStmt = db.prepare(`
      INSERT INTO proxies (host, port, username, password, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const line of lines) {
        const parts = line.split('|').map((p: string) => p.trim());
        if (parts.length >= 1 && parts[0]) {
          let platform = defaultPlatform || 'x';
          let username = '';
          let password = null;
          let email = null;
          let proxyPart = null;

          if (VALID_PLATFORMS.includes(parts[0].toLowerCase()) && parts.length >= 2) {
            platform = parts[0].toLowerCase();
            username = parts[1];
            password = parts[2] || null;
            email = parts[3] || null;
            proxyPart = parts[4] || null;
          } else {
            username = parts[0];
            password = parts[1] || null;
            email = parts[2] || null;
            proxyPart = parts[3] || null;
          }

          if (username.startsWith('@')) {
            username = username.slice(1);
          }

          const usernameRegex = /^[a-zA-Z0-9_.+-]+$/;
          if (!username || !usernameRegex.test(username)) {
            continue;
          }

          let proxyId: number | null = null;
          
          if (proxyPart) {
            if (/^\d+$/.test(proxyPart)) {
              proxyId = parseInt(proxyPart, 10);
            } else {
              const parsedProxy = parseProxyLine(proxyPart);
              if (parsedProxy) {
                const existing = findProxyStmt.get(parsedProxy.host, parsedProxy.port, workspaceId) as any;
                if (existing) {
                  proxyId = existing.id;
                } else {
                  const res = insertProxyStmt.run(parsedProxy.host, parsedProxy.port, parsedProxy.username || null, parsedProxy.password || null, workspaceId);
                  proxyId = Number(res.lastInsertRowid);
                }
              }
            }
          }
          
          const profilePath = path.join(PROFILES_DIR, `${platform}_${username}`);
          insertAccountStmt.run(platform, username, password, email, proxyId, profilePath, workspaceId);
          insertedCount++;
        }
      }
    });

    insertMany();

    return NextResponse.json({ success: true, count: insertedCount, message: `Đã nhập thành công ${insertedCount} tài khoản.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, ids } = await request.json();
    
    if (ids && Array.isArray(ids)) {
      const deleteStmt = db.prepare(`DELETE FROM social_accounts WHERE id = ? AND workspace_id = ?`);
      const deleteMany = db.transaction(() => {
        for (const accId of ids) {
          deleteStmt.run(accId, workspaceId);
        }
      });
      deleteMany();
      return NextResponse.json({ success: true, message: 'Đã xóa hàng loạt tài khoản thành công.' });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID tài khoản.' }, { status: 400 });
    }

    db.prepare(`DELETE FROM social_accounts WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa tài khoản thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { accountId, accountIds, proxyId, authToken, extraData, action } = await request.json();
    
    if (action === 'auto-distribute') {
      const activeProxies = db.prepare(`SELECT id FROM proxies WHERE status != 'dead' AND workspace_id = ?`).all(workspaceId) as Array<{ id: number }>;
      if (activeProxies.length === 0) {
        return NextResponse.json({ success: false, error: 'Không có proxy hoạt động nào trong Workspace.' }, { status: 400 });
      }

      const allAccounts = db.prepare(`SELECT id FROM social_accounts WHERE workspace_id = ?`).all(workspaceId) as Array<{ id: number }>;
      if (allAccounts.length === 0) {
        return NextResponse.json({ success: false, error: 'Chưa có tài khoản nào để phân bổ proxy.' }, { status: 400 });
      }

      const updateStmt = db.prepare(`UPDATE social_accounts SET proxy_id = ? WHERE id = ? AND workspace_id = ?`);
      const distribute = db.transaction(() => {
        for (let i = 0; i < allAccounts.length; i++) {
          const prx = activeProxies[i % activeProxies.length];
          updateStmt.run(prx.id, allAccounts[i].id, workspaceId);
        }
      });
      distribute();

      return NextResponse.json({ success: true, message: 'Đã chia đều proxy cho tất cả tài khoản.' });
    }

    if (accountIds && Array.isArray(accountIds)) {
      const updateStmt = db.prepare(`UPDATE social_accounts SET proxy_id = ? WHERE id = ? AND workspace_id = ?`);
      const updateMany = db.transaction(() => {
        for (const id of accountIds) {
          updateStmt.run(proxyId ? parseInt(proxyId, 10) : null, parseInt(id, 10), workspaceId);
        }
      });
      updateMany();
      return NextResponse.json({ success: true, message: 'Cập nhật proxy hàng loạt thành công.' });
    }

    if (!accountId) {
      return NextResponse.json({ success: false, error: 'Thiếu ID tài khoản.' }, { status: 400 });
    }
    
    if (proxyId !== undefined) {
      db.prepare(`UPDATE social_accounts SET proxy_id = ? WHERE id = ? AND workspace_id = ?`).run(proxyId ? parseInt(proxyId, 10) : null, parseInt(accountId, 10), workspaceId);
    }
    
    if (authToken !== undefined) {
      db.prepare(`UPDATE social_accounts SET auth_token = ? WHERE id = ? AND workspace_id = ?`).run(authToken || null, parseInt(accountId, 10), workspaceId);
    }

    if (extraData !== undefined) {
      db.prepare(`UPDATE social_accounts SET extra_data = ? WHERE id = ? AND workspace_id = ?`).run(extraData || null, parseInt(accountId, 10), workspaceId);
    }
    
    return NextResponse.json({ success: true, message: 'Cập nhật tài khoản thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

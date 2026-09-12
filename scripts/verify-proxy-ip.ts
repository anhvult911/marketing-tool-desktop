/**
 * ĐO IP ĐẦU RA THẬT của từng proxy → lưu vào `proxies.exit_ip`.
 *
 * Vì sao cần đo thay vì suy đoán: đo thực tế trên máy này cho thấy
 *   103.179.188.222:27305 → 118.68.29.31
 *   103.179.188.222:27321 → 118.68.233.185
 *   103.179.188.222:25975 → 1.55.226.226
 * Cùng host, khác port → KHÁC IP. Nếu suy đoán từ host, hệ thống tưởng 3 account dùng
 * chung 1 IP và siết concurrency sai (5 IP thật bị coi là 2).
 *
 * Nếu KHÔNG đo được: giữ giá trị cũ (không xoá) để lần chạy sau vẫn có tham chiếu.
 *
 * Dùng:
 *   npm run verify:proxy-ip                 # đo toàn bộ proxy đang bật
 *   npm run verify:proxy-ip -- --all        # đo cả proxy đang cooldown
 *   npm run verify:proxy-ip -- --id 2,3     # đo proxy cụ thể
 */
import https from 'node:https';
import db from '../src/lib/db';
import { HttpsProxyAgent } from 'https-proxy-agent';

interface ProxyRow {
  id: number;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  protocol: string | null;
  status: string;
  exit_ip: string | null;
  exit_ip_checked_at: string | null;
}

const IP_CHECK_ENDPOINTS = [
  { host: 'api.ipify.org', path: '/?format=json', pick: (j: unknown) => (j as { ip?: string })?.ip },
  { host: 'ipinfo.io', path: '/json', pick: (j: unknown) => (j as { ip?: string })?.ip },
];

function fetchExitIp(row: ProxyRow, endpoint: { host: string; path: string; pick: (j: unknown) => string | undefined }, timeoutMs = 20000): Promise<string | null> {
  return new Promise((resolve) => {
    const proto = row.protocol || 'http';
    const auth = row.username ? `${encodeURIComponent(row.username)}:${encodeURIComponent(row.password || '')}@` : '';
    let agent: HttpsProxyAgent<string>;
    try {
      agent = new HttpsProxyAgent(`${proto}://${auth}${row.host}:${row.port}`, { timeout: timeoutMs });
    } catch {
      resolve(null);
      return;
    }
    const req = https.get(
      { host: endpoint.host, path: endpoint.path, agent, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (d: Buffer) => { body += d.toString(); });
        res.on('end', () => {
          try {
            const ip = endpoint.pick(JSON.parse(body));
            resolve(ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function measure(row: ProxyRow): Promise<string | null> {
  for (const ep of IP_CHECK_ENDPOINTS) {
    const ip = await fetchExitIp(row, ep);
    if (ip) return ip;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const includeAll = args.includes('--all');
  const idArgIndex = args.indexOf('--id');
  const onlyIds = idArgIndex >= 0 && args[idArgIndex + 1]
    ? args[idArgIndex + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
    : null;

  let rows = db.prepare(`SELECT id, host, port, username, password, protocol, status, exit_ip, exit_ip_checked_at FROM proxies ORDER BY id`).all() as ProxyRow[];
  if (onlyIds) rows = rows.filter(r => onlyIds.includes(r.id));
  else if (!includeAll) rows = rows.filter(r => r.status === 'working' || r.status === 'active');

  if (rows.length === 0) {
    console.log('[verify-proxy-ip] Không có proxy nào cần đo. (Dùng --all để đo cả proxy đang cooldown.)');
    return 0;
  }

  console.log(`[verify-proxy-ip] Đo IP đầu ra thật cho ${rows.length} proxy...\n`);
  const update = db.prepare(`UPDATE proxies SET exit_ip = ?, exit_ip_checked_at = CURRENT_TIMESTAMP WHERE id = ?`);

  const summary: Array<{ id: number; ip: string | null; changed: boolean; previous: string | null }> = [];
  for (const row of rows) {
    process.stdout.write(`  #${row.id} ${row.host}:${row.port} ... `);
    const ip = await measure(row);
    if (ip) {
      const changed = row.exit_ip !== ip;
      update.run(ip, row.id);
      summary.push({ id: row.id, ip, changed, previous: row.exit_ip });
      console.log(`${ip}${changed ? `  (thay đổi: ${row.exit_ip || 'chưa có'} → ${ip})` : '  (không đổi)'}`);
    } else {
      summary.push({ id: row.id, ip: null, changed: false, previous: row.exit_ip });
      console.log(`KHÔNG đo được${row.exit_ip ? ` — giữ giá trị cũ ${row.exit_ip}` : ''}`);
    }
  }

  console.log('\n=== TỔNG HỢP ===');
  const measured = summary.filter(s => s.ip);
  const uniqueIps = new Set(measured.map(s => s.ip!));
  console.log(`  Đo được: ${measured.length}/${rows.length}`);
  console.log(`  IP duy nhất: ${uniqueIps.size}`);

  // Phát hiện trùng IP: 2 proxy cùng IP không được chạy song song
  const byIp = new Map<string, number[]>();
  for (const s of measured) {
    const arr = byIp.get(s.ip!) || [];
    arr.push(s.id);
    byIp.set(s.ip!, arr);
  }
  const dupes = [...byIp.entries()].filter(([, ids]) => ids.length > 1);
  if (dupes.length > 0) {
    console.log('\n  ⚠️ Proxy TRÙNG IP (không được chạy song song):');
    for (const [ip, ids] of dupes) console.log(`     ${ip} ← proxy #${ids.join(', #')}`);
  } else if (measured.length > 0) {
    console.log('  ✅ Mỗi proxy một IP riêng — có thể chạy song song an toàn.');
  }

  const stillUnknown = summary.filter(s => !s.ip && !s.previous).length;
  if (stillUnknown > 0) {
    console.log(`\n  ⚠️ ${stillUnknown} proxy chưa có IP (đo thất bại) — hệ thống tạm dùng host:port.`);
    console.log('     Kiểm tra proxy còn sống không, hoặc chạy lại sau.');
  }
  return 0;
}

main().then(code => process.exit(code)).catch(e => { console.error('CRASH:', e.message); process.exit(1); });

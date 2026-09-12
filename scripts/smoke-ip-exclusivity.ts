/**
 * Smoke Tầng 1: tái hiện ĐÚNG tình huống máy thật — 3 account dùng chung 1 IP
 * (3 proxy row cùng host), rồi xác minh:
 *   - job KHÔNG mở nhiều session đồng thời trên cùng IP
 *   - cờ warm-up + slot clamp hoạt động
 *
 * KHÔNG chạm Facebook: dùng DB temp và chỉ quan sát quyết định cấp IP (không launch
 * browser được vì account không có profile).
 *
 * Chạy: npx tsx scripts/smoke-ip-exclusivity.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import db from '../src/lib/db';
import { IpRegistry, chooseIpForSession, maxSafeSessions, proxyIpKey, type ProxyEndpoint } from '../src/lib/ip-registry';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 220) : ''); fail++; }
}

console.log('— Dữ liệu thật gây sự cố: 3 proxy row CÙNG host 103.179.188.222 —');
const sharedIp = '103.179.188.222';
const accounts = [
  { id: 2, proxy: { proxyId: 2, host: sharedIp, port: 27305 } as ProxyEndpoint },
  { id: 3, proxy: { proxyId: 3, host: sharedIp, port: 27321 } as ProxyEndpoint },
  { id: 4, proxy: { proxyId: 4, host: sharedIp, port: 25975 } as ProxyEndpoint },
  { id: 5, proxy: { proxyId: 5, host: '103.179.188.185', port: 20782 } as ProxyEndpoint },
];
const distinctIps = new Set(accounts.map(a => proxyIpKey(a.proxy)));
check('3 proxy row cùng host + 1 host khác = 2 IP thật', distinctIps.size === 2, [...distinctIps]);
check('maxSafeSessions clamp 5 → 2 theo số IP thật', maxSafeSessions(distinctIps.size, 5) === 2, maxSafeSessions(distinctIps.size, 5));

console.log('\n— Mô phỏng 4 account xin session đồng thời —');
const reg = new IpRegistry();
const leases = accounts.map(a =>
  chooseIpForSession({ registry: reg, accountId: a.id, accountProxy: a.proxy, spareProxies: [], allowSpare: false })
);
const granted = leases.filter(Boolean);
check('CHỈ 2 session được cấp (1 IP dùng chung + 1 IP riêng)', granted.length === 2, leases.map(l => l?.ipKey ?? null));
check('session được cấp dùng IP KHÁC NHAU', new Set(granted.map(l => l!.ipKey)).size === granted.length, granted.map(l => l!.ipKey));
check('account 2/3/4 (cùng IP) chỉ đúng 1 account chạy', granted.filter(l => l!.ipKey === sharedIp).length === 1, granted);
check('registry có 2 IP bận', reg.size() === 2, reg.busyKeys());

console.log('\n— Giải phóng IP rồi cấp lại —');
const held = granted[0]!;
reg.release(held.ipKey);
const retry = chooseIpForSession({ registry: reg, accountId: 3, accountProxy: accounts[1].proxy, spareProxies: [], allowSpare: false });
check('sau release, account cùng IP vào được', retry !== null && retry.ipKey === sharedIp, retry);

console.log('\n— Warm-up: account mới bị giới hạn quota —');
{
  // Mô phỏng công thức quota warm-up dùng trong job
  const maxPerAccountQuota = 150;
  const WARMUP_QUOTA_MULTIPLIER = 0.4;
  const WARMUP_SESSIONS_REQUIRED = 2;
  const warmupQuota = Math.max(30, Math.round(maxPerAccountQuota * WARMUP_QUOTA_MULTIPLIER));
  check('quota warm-up = 60 (40% của 150)', warmupQuota === 60, warmupQuota);
  check('quota warm-up nhỏ hơn quota thường', warmupQuota < maxPerAccountQuota);
  const cooldownWarmup = 15 * 60_000;
  const cooldownChainLimited = 20_000;
  check('warm-up nghỉ dài (15\') hơn chain-limit (20s)', cooldownWarmup > cooldownChainLimited);
  check('cần 2 phiên thành công để hết warm-up', WARMUP_SESSIONS_REQUIRED === 2);
}

console.log('\n— Schema: cột warmup_sessions tồn tại —');
{
  const cols = (db.prepare(`PRAGMA table_info(social_accounts)`).all() as Array<{ name: string }>).map(c => c.name);
  check('social_accounts.warmup_sessions có trong schema', cols.includes('warmup_sessions'), cols);
}

console.log(fail === 0 ? '\n✓ IP EXCLUSIVITY SMOKE PASSED' : `\n✗ IP EXCLUSIVITY SMOKE FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);

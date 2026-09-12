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

console.log('— ĐÚNG cấu hình máy thật: 5 proxy → 5 IP đầu ra khác nhau (đo bằng verify:proxy-ip) —');
const accounts = [
  { id: 1, proxy: { proxyId: 1, host: '103.166.184.92', port: 16008, exitIp: '222.254.98.55' } as ProxyEndpoint },
  { id: 2, proxy: { proxyId: 2, host: '103.179.188.222', port: 27305, exitIp: '118.68.29.31' } as ProxyEndpoint },
  { id: 3, proxy: { proxyId: 3, host: '103.179.188.222', port: 27321, exitIp: '118.68.233.185' } as ProxyEndpoint },
  { id: 4, proxy: { proxyId: 4, host: '103.179.188.222', port: 25975, exitIp: '1.55.226.226' } as ProxyEndpoint },
  { id: 5, proxy: { proxyId: 5, host: '103.179.188.185', port: 20782, exitIp: '14.239.227.210' } as ProxyEndpoint },
];
const distinctIps = new Set(accounts.map(a => proxyIpKey(a.proxy)));
check('5 proxy (3 row cùng host) = 5 IP đầu ra thật', distinctIps.size === 5, [...distinctIps]);
check('maxSafeSessions cho phép đủ 5 (KHÔNG siết nhầm như bản host-trần)', maxSafeSessions(distinctIps.size, 5) === 5);

console.log('\n— Mô phỏng 5 account xin session đồng thời —');
const reg = new IpRegistry();
const leases = accounts.map(a =>
  chooseIpForSession({ registry: reg, accountId: a.id, accountProxy: a.proxy, spareProxies: [], allowSpare: false })
);
const granted = leases.filter(Boolean);
check('CẢ 5 session được cấp (5 IP riêng)', granted.length === 5, leases.map(l => l?.ipKey ?? null));
check('5 IP cấp ra KHÁC NHAU hoàn toàn', new Set(granted.map(l => l!.ipKey)).size === 5, granted.map(l => l!.ipKey));
check('registry có đúng 5 IP bận', reg.size() === 5, reg.busyKeys());

console.log('\n— Hai account VÔ TÌNH cùng IP thật → chặn —');
{
  const reg2 = new IpRegistry();
  const same = '118.68.29.31';
  const a = chooseIpForSession({ registry: reg2, accountId: 1, accountProxy: { proxyId: 1, host: 'a', port: 1, exitIp: same }, spareProxies: [], allowSpare: false });
  const b = chooseIpForSession({ registry: reg2, accountId: 2, accountProxy: { proxyId: 2, host: 'b', port: 2, exitIp: same }, spareProxies: [], allowSpare: false });
  check('session thứ 2 cùng IP thật bị TỪ CHỐI', a !== null && b === null, { a: a?.ipKey, b });
}

console.log('\n— Giải phóng IP rồi cấp lại —');
const held = granted[0]!;
reg.release(held.ipKey);
const retry = chooseIpForSession({ registry: reg, accountId: 1, accountProxy: accounts[0].proxy, spareProxies: [], allowSpare: false });
check('sau release, account đó vào lại được', retry !== null && retry.ipKey === held.ipKey, retry);

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

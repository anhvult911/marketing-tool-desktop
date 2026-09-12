/**
 * Unit test: IP registry (Tầng 1) + phân loại chặn (Tầng 1).
 * Chạy: npx tsx scripts/test-ip-guard.ts
 */
import {
  IpRegistry, normalizeIpKey, proxyIpKey, chooseIpForSession, maxSafeSessions, ProxyEndpoint,
} from '../src/lib/ip-registry';
import { assessBlock, detectFacebookCheckpoint } from '../src/lib/facebook-crawler';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 260) : ''); fail++; }
}

const proxy = (id: number, host: string, port = 8080): ProxyEndpoint => ({ proxyId: id, host, port });

console.log('— normalizeIpKey / proxyIpKey —');
check('host rỗng → direct', normalizeIpKey('') === 'direct' && normalizeIpKey(null) === 'direct');
check('bỏ khoảng trắng + hạ chữ thường', normalizeIpKey('  103.179.188.222  ') === '103.179.188.222');

// BÀI HỌC ĐO THỰC: cùng host khác port ra IP khác nhau, nên danh tính KHÔNG được là host trần.
console.log('— proxyIpKey: danh tính phải theo IP đo thật —');
check('chưa đo → host:port (không dùng host trần)',
  proxyIpKey(proxy(7, '103.179.188.222', 27305)) === '103.179.188.222:27305',
  proxyIpKey(proxy(7, '103.179.188.222', 27305)));
check('hai port cùng host → HAI danh tính khác nhau',
  proxyIpKey(proxy(7, '103.179.188.222', 27305)) !== proxyIpKey(proxy(8, '103.179.188.222', 27321)));
check('đã đo exit_ip → dùng exit_ip, bỏ qua host:port',
  proxyIpKey({ proxyId: 7, host: '103.179.188.222', port: 27305, exitIp: '118.68.29.31' }) === '118.68.29.31');
check('exit_ip rỗng → quay về host:port',
  proxyIpKey({ proxyId: 7, host: 'h', port: 1, exitIp: '' }) === 'h:1');
check('hai proxy khác host:port nhưng CÙNG exit_ip → cùng danh tính (phát hiện trùng thật)',
  proxyIpKey({ proxyId: 1, host: 'a', port: 1, exitIp: '9.9.9.9' }) === proxyIpKey({ proxyId: 2, host: 'b', port: 2, exitIp: '9.9.9.9' }));

console.log('— IpRegistry: mỗi IP 1 session (điểm mấu chốt) —');
{
  const reg = new IpRegistry();
  const a = reg.acquire('118.68.29.31', 2, 'account', proxy(2, '103.179.188.222', 27305));
  check('IP rảnh → cấp lease', a !== null && a.ipKey === '118.68.29.31', a);
  const b = reg.acquire('118.68.29.31', 4, 'account', proxy(4, '103.179.188.222', 25975));
  check('CÙNG IP thật (khác proxy row) → TỪ CHỐI', b === null, b);
  const c = reg.acquire('1.55.226.226', 5, 'account', proxy(5, '103.179.188.222', 25975));
  check('IP khác → cấp bình thường', c !== null);
  reg.release('118.68.29.31');
  const d = reg.acquire('118.68.29.31', 4, 'account');
  check('sau release → cấp lại được', d !== null);
  check('isBusy phản ánh đúng', reg.isBusy('1.55.226.226') && reg.isBusy('118.68.29.31') && !reg.isBusy('9.9.9.9'));
  check('busyKeys + size đúng', reg.size() === 2, reg.busyKeys());
  check('heldBy lọc theo account', reg.heldBy(5).length === 1 && reg.heldBy(4).length === 1);
  check('snapshot có accountId', reg.snapshot().every(s => typeof s.accountId === 'number'));
}

console.log('— chooseIpForSession: 5 account / 5 IP riêng (đúng thực tế đo được) —');
{
  const reg = new IpRegistry();
  // Đúng cấu hình máy thật: 5 proxy, 5 IP đầu ra khác nhau
  const real = [
    { id: 1, ep: { proxyId: 1, host: '103.166.184.92', port: 16008, exitIp: '222.254.98.55' } as ProxyEndpoint },
    { id: 2, ep: { proxyId: 2, host: '103.179.188.222', port: 27305, exitIp: '118.68.29.31' } as ProxyEndpoint },
    { id: 3, ep: { proxyId: 3, host: '103.179.188.222', port: 27321, exitIp: '118.68.233.185' } as ProxyEndpoint },
    { id: 4, ep: { proxyId: 4, host: '103.179.188.222', port: 25975, exitIp: '1.55.226.226' } as ProxyEndpoint },
    { id: 5, ep: { proxyId: 5, host: '103.179.188.185', port: 20782, exitIp: '14.239.227.210' } as ProxyEndpoint },
  ];
  const leases = real.map(r => chooseIpForSession({ registry: reg, accountId: r.id, accountProxy: r.ep, spareProxies: [], allowSpare: false }));
  check('CẢ 5 account đều được cấp session (5 IP riêng)', leases.every(l => l !== null), leases.map(l => l?.ipKey ?? null));
  check('5 IP cấp ra đều KHÁC NHAU', new Set(leases.map(l => l!.ipKey)).size === 5, leases.map(l => l!.ipKey));
  check('không bị siết nhầm xuống 2 như bản host-trần', reg.size() === 5, reg.busyKeys());

  // Trùng IP thật (2 proxy khác host:port nhưng cùng exit_ip) → phải chặn
  const reg2 = new IpRegistry();
  const shareA = { proxyId: 9, host: 'x', port: 1, exitIp: '9.9.9.9' } as ProxyEndpoint;
  const shareB = { proxyId: 10, host: 'y', port: 2, exitIp: '9.9.9.9' } as ProxyEndpoint;
  const first = chooseIpForSession({ registry: reg2, accountId: 1, accountProxy: shareA, spareProxies: [], allowSpare: false });
  const second = chooseIpForSession({ registry: reg2, accountId: 2, accountProxy: shareB, spareProxies: [], allowSpare: false });
  check('hai proxy cùng exit_ip → session thứ 2 bị TỪ CHỐI', first !== null && second === null, { first, second });
}

console.log('— chooseIpForSession: tôn trọng pass 1 (không đổi IP sớm) —');
{
  const reg = new IpRegistry();
  const busyProxy = proxy(2, '103.179.188.222', 27305);
  // Chiếm IP bằng ĐÚNG danh tính mà hệ thống sẽ dùng (host:port khi chưa đo exit_ip)
  reg.acquire(proxyIpKey(busyProxy), 2, 'account', busyProxy);
  const s = chooseIpForSession({
    registry: reg, accountId: 4, accountProxy: proxy(4, '103.179.188.222', 27305),
    spareProxies: [proxy(5, '103.179.188.185')], allowSpare: false,
  });
  check('pass 1 + IP bận → null (không mượn spare khi chưa qua chain đầu)', s === null, s);

  // Cùng host nhưng KHÁC port = IP khác (bài học đo thực) → phải cấp được bình thường
  const other = chooseIpForSession({
    registry: reg, accountId: 4, accountProxy: proxy(4, '103.179.188.222', 27321),
    spareProxies: [], allowSpare: false,
  });
  check('cùng host khác port → vẫn cấp được (không bị chặn nhầm)', other !== null, other);
}

console.log('— chooseIpForSession: tài khoản không proxy (IP máy) —');
{
  const reg = new IpRegistry();
  const s1 = chooseIpForSession({ registry: reg, accountId: 1, accountProxy: null, spareProxies: [], allowSpare: false });
  check('account không proxy → dùng direct', s1?.source === 'direct' && s1.ipKey === 'direct', s1);
  const s2 = chooseIpForSession({ registry: reg, accountId: 2, accountProxy: null, spareProxies: [], allowSpare: true });
  check('account thứ 2 cũng không proxy → null (chung IP máy)', s2 === null, s2);
}

console.log('— maxSafeSessions —');
check('5 IP thật, cấu hình 5 → cho phép đủ 5 (không siết nhầm)', maxSafeSessions(5, 5) === 5);
check('3 IP, cấu hình 5 → clamp còn 3', maxSafeSessions(3, 5) === 3);
check('5 IP, cấu hình 2 → giữ 2', maxSafeSessions(5, 2) === 2);
check('0 IP → tối thiểu 1', maxSafeSessions(0, 5) === 1);
check('1 IP, cấu hình 1 → 1', maxSafeSessions(1, 1) === 1);

console.log('— assessBlock: KHÔNG báo oan (đúng ca account #4) —');
{
  const benignUrl = 'https://www.facebook.com/groups/3048351128886692/members/?ref=login&disabled=0';
  const benignHtml = '<html><body><script>window.__checkpoint_enabled=false;var login_form=null;checkpoint_marker=1;</script><div>Bài viết nhóm</div></body></html>';
  check('URL có ?ref=login + ?disabled + HTML có tên biến checkpoint/login_form → none',
    assessBlock(benignUrl, benignHtml).kind === 'none', assessBlock(benignUrl, benignHtml));
  check('detectFacebookCheckpoint tương thích: false cho trang bình thường',
    detectFacebookCheckpoint(benignUrl, benignHtml) === false);

  const normalGroup = '<html><body><a href="/groups/123/members/">Thành viên</a> <div>Bài viết</div></body></html>';
  check('trang group bình thường → none', assessBlock('https://mbasic.facebook.com/groups/123/members/', normalGroup).kind === 'none');
}

console.log('— assessBlock: bắt ĐÚNG checkpoint thật —');
{
  const cases: Array<[string, string, string]> = [
    ['redirect /checkpoint/', 'https://www.facebook.com/checkpoint/1234/', '<html></html>'],
    ['câu "tài khoản của bạn tạm thời bị khóa"', 'https://www.facebook.com/', '<div>Tài khoản của bạn tạm thời bị khóa</div>'],
    ['câu "vui lòng xác nhận danh tính"', 'https://www.facebook.com/', '<h1>Vui lòng xác nhận danh tính</h1>'],
    ['câu "you’re temporarily blocked"', 'https://facebook.com/', '<p>You’re temporarily blocked</p>'],
    ['câu "action blocked"', 'https://facebook.com/', '<span>Action Blocked</span>'],
  ];
  for (const [label, url, html] of cases) {
    const a = assessBlock(url, html);
    check(`checkpoint thật: ${label}`, a.kind === 'checkpoint', a);
  }
}

console.log('— assessBlock: nhận login wall là mức NHẸ —');
{
  const a1 = assessBlock('https://mbasic.facebook.com/login.php?next=%2Fme%2F', '<html>login</html>');
  check('redirect /login.php → login (không phải checkpoint)', a1.kind === 'login', a1);
  const a2 = assessBlock('https://www.facebook.com/', '<h1>Đăng nhập vào Facebook</h1>');
  check('câu "Đăng nhập vào Facebook" → login', a2.kind === 'login', a2);
  const a3 = assessBlock('https://www.facebook.com/', '<h1>Log in to Facebook</h1>');
  check('câu "Log in to Facebook" → login', a3.kind === 'login', a3);
  check('login KHÔNG bị coi là checkpoint (tránh cooldown oan)',
    detectFacebookCheckpoint('https://mbasic.facebook.com/login.php', '<h1>Log in to Facebook</h1>') === false);
}

console.log(fail === 0 ? '\n✓ IP GUARD PASSED' : `\n✗ IP GUARD FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);

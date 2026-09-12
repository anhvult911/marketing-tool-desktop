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
check('proxyIpKey trả host, KHÔNG phải proxyId', proxyIpKey(proxy(7, '1.2.3.4')) === '1.2.3.4');

console.log('— IpRegistry: mỗi IP 1 session (điểm mấu chốt) —');
{
  const reg = new IpRegistry();
  const a = reg.acquire('103.179.188.222', 2, 'account', proxy(2, '103.179.188.222'));
  check('IP rảnh → cấp lease', a !== null && a.ipKey === '103.179.188.222', a);
  const b = reg.acquire('103.179.188.222', 4, 'account', proxy(4, '103.179.188.222'));
  check('CÙNG IP (khác proxy row) → TỪ CHỐI', b === null, b);
  const c = reg.acquire('103.179.188.185', 5, 'account', proxy(5, '103.179.188.185'));
  check('IP khác → cấp bình thường', c !== null);
  reg.release('103.179.188.222');
  const d = reg.acquire('103.179.188.222', 4, 'account');
  check('sau release → cấp lại được', d !== null);
  check('isBusy phản ánh đúng', reg.isBusy('103.179.188.185') && reg.isBusy('103.179.188.222') && !reg.isBusy('9.9.9.9'));
  check('busyKeys + size đúng', reg.size() === 2, reg.busyKeys());
  check('heldBy lọc theo account', reg.heldBy(5).length === 1 && reg.heldBy(4).length === 1);
  check('snapshot có accountId', reg.snapshot().every(s => typeof s.accountId === 'number'));
}

console.log('— chooseIpForSession: không bao giờ trùng IP —');
{
  const reg = new IpRegistry();
  const accProxy = proxy(2, '103.179.188.222');
  const spares = [proxy(5, '103.179.188.185'), proxy(1, '103.166.184.92')];

  const s1 = chooseIpForSession({ registry: reg, accountId: 2, accountProxy: accProxy, spareProxies: spares, allowSpare: true });
  check('session 1 lấy IP mặc định của account', s1?.source === 'account' && s1.ipKey === '103.179.188.222', s1);

  // account 4 dùng CÙNG proxy mặc định → phải KHÔNG lấy được IP đó
  const s2 = chooseIpForSession({ registry: reg, accountId: 4, accountProxy: proxy(4, '103.179.188.222'), spareProxies: spares, allowSpare: true });
  check('account khác cùng IP mặc định → chuyển sang spare, KHÔNG trùng', s2?.source === 'spare' && s2.ipKey === '103.179.188.185', s2);

  const s3 = chooseIpForSession({ registry: reg, accountId: 3, accountProxy: proxy(3, '103.179.188.222'), spareProxies: spares, allowSpare: true });
  check('session 3 lấy spare còn lại', s3?.source === 'spare' && s3.ipKey === '103.166.184.92', s3);

  // account 9 KHÔNG có proxy (dùng IP máy) — 'direct' chưa bị chiếm nên vẫn cấp được,
  // nhưng nếu đã có session khác dùng IP máy thì phải bị từ chối.
  const s4 = chooseIpForSession({ registry: reg, accountId: 9, accountProxy: null, spareProxies: spares, allowSpare: true });
  check('account không proxy → dùng IP máy (direct)', s4?.source === 'direct' && s4.ipKey === 'direct', s4);
  const s5 = chooseIpForSession({ registry: reg, accountId: 10, accountProxy: null, spareProxies: spares, allowSpare: true });
  check('account không proxy thứ 2 → null (không chung IP máy)', s5 === null, s5);
  check('registry phản ánh 4 IP đang bận', reg.size() === 4, reg.busyKeys());
}

console.log('— chooseIpForSession: tôn trọng pass 1 (không đổi IP sớm) —');
{
  const reg = new IpRegistry();
  reg.acquire('103.179.188.222', 2, 'account');
  const s = chooseIpForSession({
    registry: reg, accountId: 4, accountProxy: proxy(4, '103.179.188.222'),
    spareProxies: [proxy(5, '103.179.188.185')], allowSpare: false,
  });
  check('pass 1 + IP bận → null (không mượn spare khi chưa qua chain đầu)', s === null, s);
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

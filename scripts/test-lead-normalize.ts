/**
 * Unit test cho chuẩn hoá lead (P4). Chạy: npx tsx scripts/test-lead-normalize.ts
 */
import { normalizeLeadValue } from '../src/lib/lead-normalize';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
}
const same = (p: string, a: string, b: string) => normalizeLeadValue(p, a) === normalizeLeadValue(p, b);
const diff = (p: string, a: string, b: string) => normalizeLeadValue(p, a) !== normalizeLeadValue(p, b);

console.log('— Telegram —');
check('@User = user = t.me/user', same('telegram', '@User', 'user') && same('telegram', 'user', 'https://t.me/user'));
check('t.me/user/ = user (slash đuôi)', same('telegram', 't.me/user/', '@user'));
check('invite +hash = joinchat/hash', same('telegram', 'https://t.me/+AbCdEf', 'https://t.me/joinchat/AbCdEf'));
check('invite KHÁC handle cùng chuỗi', diff('telegram', 'https://t.me/+abc', '@abc'));
check('private c/123 khác handle 123', diff('telegram', 'https://t.me/c/123/45', '@123'));
check('hai handle khác nhau không gộp', diff('telegram', '@alice', '@bob'));
check('query đuôi bị bỏ', same('telegram', 'https://t.me/user?start=xyz', '@user'));

console.log('— Zalo / WhatsApp (SĐT) —');
check('0901234567 = +84901234567', same('zalo', '0901234567', '+84901234567'));
check('0901234567 = 84901234567', same('zalo', '0901234567', '84901234567'));
check('0901234567 = 090 123 4567', same('zalo', '090 123 4567', '0901234567'));
check('hai SĐT khác nhau không gộp', diff('zalo', '0901234567', '0901234568'));
check('zalo ≠ whatsapp cùng số', diff('zalo', '0901234567', '0901234567') === false && normalizeLeadValue('zalo', '0901234567') !== normalizeLeadValue('whatsapp', '0901234567'));

console.log('— Facebook —');
check('URL Page = page (case + www + slash)', same('facebook', 'https://www.facebook.com/Page/', 'https://facebook.com/page'));
check('UID số = nhau, khác vanity', diff('facebook', '100012345678901', 'somepage'));
check('profile.php?id= = UID số', same('facebook', 'https://facebook.com/profile.php?id=100012345678901', '100012345678901'));
check('/user/123 = UID 123', same('facebook', 'https://www.facebook.com/user/1000123456789', '1000123456789'));
check('post link = nhau dù khác tracking', same('facebook', 'https://facebook.com/page/posts/123?utm_source=abc&fbclid=x', 'https://www.facebook.com/page/posts/123'));
check('post link KHÁC vanity cùng page', diff('facebook', 'https://facebook.com/page/posts/123', 'page'));
check('vanity khác UID không bị gộp', diff('facebook', 'page', '1000123456789'));
check('platform facebook ≠ telegram cùng chuỗi', normalizeLeadValue('facebook', 'user') !== normalizeLeadValue('telegram', 'user'));

console.log('— Social (link seeding) —');
check('link FB dưới platform social về khoá facebook', normalizeLeadValue('social', 'https://facebook.com/page/posts/9') === normalizeLeadValue('facebook', 'https://facebook.com/page/posts/9'));
check('link ngoài FB giữ khoá social', normalizeLeadValue('social', 'https://example.com/x') === 'social:url:example.com/x');

console.log('— X / Threads —');
check('@Handle = x.com/handle', same('x', '@Handle', 'https://x.com/handle'));
check('status link = nhau dù khác tracking', same('x', 'https://x.com/a/status/1?ref_src=twsrc', 'https://twitter.com/a/status/1'));
check('handle khác status link', diff('x', 'https://x.com/a/status/1', 'https://x.com/a'));
check('threads @user = url', same('threads', '@user', 'https://www.threads.net/@user'));
check('threads post link khác handle', diff('threads', 'https://threads.net/@u/post/9', 'https://threads.net/@u'));

console.log('— Biên —');
check('rỗng → chuỗi rỗng', normalizeLeadValue('facebook', '') === '');
check('platform lạ + URL vẫn chuẩn hoá', normalizeLeadValue('unknown', 'https://Example.com/x/') === 'unknown:url:example.com/x');
check('platform lạ không URL → value lower', normalizeLeadValue('unknown', ' ABC ') === 'unknown:value:abc');
check('idempotent: chuẩn hoá 2 lần như nhau', (() => {
  const k1 = normalizeLeadValue('telegram', '@User');
  return k1 === normalizeLeadValue('telegram', k1.replace('telegram:handle:', '@'));
})());

console.log(fail === 0 ? '\n✓ LEAD NORMALIZE PASSED' : `\n✗ LEAD NORMALIZE FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);

/**
 * P4 — CHUẨN HOÁ GIÁ TRỊ LEAD (dedup đa biến thể).
 *
 * Cùng một mục tiêu có thể vào kho dưới nhiều dạng:
 *   @User  ·  user  ·  https://t.me/user
 *   0901234567  ·  +84901234567  ·  84901234567
 *   https://www.facebook.com/Page  ·  https://facebook.com/page/
 *   https://x.com/acc/status/123?utm_source=abc  ·  .../status/123
 * `spam_leads.value` là UNIQUE nên chỉ bắt được trùng KHỚP TUYỆT ĐỐI. Hàm dưới
 * sinh khoá chuẩn hoá để bắt trùng ngữ nghĩa trước khi insert.
 *
 * NGUYÊN TẮC: không bao giờ gộp hai thứ khác nhau. Vanity (tên tự chọn) và UID
 * số là hai khoá tách biệt — gộp chúng cần resolve qua mạng, không thể suy diễn.
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'ref_src', 'ref_url', 'igshid', 'si', '__cft__', '__tn__',
  'mibextid', 'rdid', 'share_url', 'sfnsn', 'locale', 'hl',
]);

/** Chuẩn hoá URL: host thường hoá (bỏ www), path thường hoá, bỏ tham số tracking. */
function normalizeUrl(raw: string): string {
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    // twitter.com và x.com là cùng mạng sau rebrand — quy về một host để bắt trùng.
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^(mobile\.)?twitter\.com$/, 'x.com');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const kept = Array.from(u.searchParams.entries())
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${host}${path}${kept ? `?${kept}` : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** SĐT → E.164 rút gọn cho VN: 0901234567 / +84901234567 / 84901234567 → 84901234567. */
function normalizePhone(value: string): string {
  let d = digitsOnly(value);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('84')) return d;
  if (d.startsWith('0')) return `84${d.slice(1)}`;
  return d;
}

function facebookKey(value: string): string {
  const v = value.trim();
  if (/^\d{6,20}$/.test(v)) return `facebook:uid:${v}`;

  // Link dạng /user/<id>, profile.php?id=<id>, /people/<name>/<id> → UID số
  const userMatch = v.match(/\/user\/(\d{6,20})/);
  if (userMatch) return `facebook:uid:${userMatch[1]}`;
  const profileMatch = v.match(/profile\.php\?[^#]*\bid=(\d{6,20})/);
  if (profileMatch) return `facebook:uid:${profileMatch[1]}`;
  const peopleMatch = v.match(/\/people\/[^/?#]+\/(\d{6,20})/);
  if (peopleMatch) return `facebook:uid:${peopleMatch[1]}`;

  const isPost = /\/(posts|permalink|photos|videos|reel|reels|watch|share|story)\//i.test(v) ||
    /\bpfbid|fbid=|story_fbid=/.test(v);
  if (v.startsWith('http') || v.startsWith('facebook.com') || v.startsWith('www.facebook.com') || v.startsWith('m.facebook.com')) {
    return isPost ? `facebook:post:${normalizeUrl(v)}` : `facebook:vanity:${vanitySlug(v)}`;
  }
  return `facebook:vanity:${v.replace(/^@/, '').toLowerCase()}`;
}

function vanitySlug(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return normalizeUrl(url);
    const id = u.searchParams.get('id');
    if (u.pathname.toLowerCase() === '/profile.php' && id) return id.toLowerCase();
    return parts[0].toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function telegramKey(value: string): string {
  const raw = value.trim();
  const v = raw.replace(/^https?:\/\/(www\.)?t\.me\//i, '').replace(/^t\.me\//i, '').replace(/^@/, '');
  if (/^\+/.test(v) || /^joinchat\//i.test(v)) {
    const hash = v.replace(/^joinchat\//i, '').replace(/^\+/, '');
    return `telegram:invite:${hash.toLowerCase()}`;
  }
  if (/^c\//i.test(v)) {
    const id = v.split('/')[1] || '';
    return `telegram:private:${id}`;
  }
  // Query/hash đuôi không thuộc handle
  const handle = v.split(/[/?#]/)[0].toLowerCase();
  return `telegram:handle:${handle}`;
}

function xKey(value: string): string {
  const v = value.trim();
  if (/\/(status|i\/web\/status)\//i.test(v)) return `x:post:${normalizeUrl(v)}`;
  if (/^https?:\/\//i.test(v) || /^(www\.)?(x|twitter)\.com\//i.test(v)) {
    const slug = vanillaHandle(v);
    return slug ? `x:handle:${slug}` : `x:url:${normalizeUrl(v)}`;
  }
  return `x:handle:${v.replace(/^@/, '').toLowerCase()}`;
}

function threadsKey(value: string): string {
  const v = value.trim();
  if (/\/post\//i.test(v)) return `threads:post:${normalizeUrl(v)}`;
  if (/^https?:\/\//i.test(v)) {
    const slug = vanillaHandle(v);
    return slug ? `threads:handle:${slug}` : `threads:url:${normalizeUrl(v)}`;
  }
  return `threads:handle:${v.replace(/^@/, '').toLowerCase()}`;
}

/** Lấy handle đầu tiên từ URL mạng xã hội (bỏ segment hệ thống). */
function vanillaHandle(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    const first = parts[0].replace(/^@/, '').toLowerCase();
    if (!first || ['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'settings'].includes(first)) return '';
    return first;
  } catch {
    return '';
  }
}

/**
 * Khoá chuẩn hoá dùng cho dedup. Luôn có tiền tố platform để hai platform khác
 * nhau không bao giờ đụng khoá dù giá trị trùng chuỗi.
 */
export function normalizeLeadValue(platform: string, value: string): string {
  const p = (platform || '').toLowerCase().trim();
  const v = (value || '').trim();
  if (!v) return '';

  switch (p) {
    case 'facebook':
    case 'messenger':
      return facebookKey(v);
    case 'social': {
      // platform 'social' = link bài viết dùng cho seeding. Link Facebook về đúng
      // khoá facebook để không tạo bản trùng với lead thu từ crawler.
      if (/facebook\.com/i.test(v)) return facebookKey(v);
      if (/^https?:\/\//i.test(v)) return `social:url:${normalizeUrl(v)}`;
      return `social:value:${v.toLowerCase()}`;
    }
    case 'telegram':
    case 'telegram_name':
      return telegramKey(v);
    case 'zalo':
      return `zalo:phone:${normalizePhone(v)}`;
    case 'whatsapp':
      return `whatsapp:phone:${normalizePhone(v)}`;
    case 'x':
    case 'twitter':
      return xKey(v);
    case 'threads':
      return threadsKey(v);
    default:
      if (/^https?:\/\//i.test(v)) return `${p || 'link'}:url:${normalizeUrl(v)}`;
      if (/^\+?[\d\s\-().]{9,17}$/.test(v)) return `${p}:phone:${normalizePhone(v)}`;
      return `${p || 'raw'}:value:${v.toLowerCase()}`;
  }
}

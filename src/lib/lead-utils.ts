/**
 * P2/P3 — Tiện ích lead dùng chung cho mọi platform (FB, Telegram, …).
 * Tách khỏi facebook-crawler để telegram-crawler không phải import engine Playwright
 * nặng chỉ vì 1 regex SĐT.
 */

// Đầu số di động Việt Nam: 03x 05x 07x 08x 09x (đã gồm 032-039, 052/056/058/059,
// 070/076-079, 081-089, 090-099) — 10 chữ số sau khi chuẩn hoá.
const VN_PHONE_REGEX = /(?:(?:\+84|84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9]))\d{7}\b/g;

/**
 * Bóc SĐT Việt Nam từ text tự do (bình luận, bio, tin nhắn, nội dung bài viết).
 * Chuẩn hoá về dạng nội địa 0xxxxxxxxx, khử trùng lặp.
 */
export function extractVietnamesePhones(text: string): string[] {
  if (!text) return [];
  const matches = text.match(VN_PHONE_REGEX) || [];
  const unique = new Set<string>();

  for (let p of matches) {
    p = p.replace(/\D/g, '');
    if (p.startsWith('84')) {
      p = '0' + p.substring(2);
    }
    if (p.length === 10) {
      unique.add(p);
    }
  }

  return Array.from(unique);
}

/** Bóc SĐT từ HTML thô (bỏ tag + entity cơ bản) — dùng cho mbasic/markup. */
export function minePhonesFromHtml(html: string): string[] {
  if (!html) return [];
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return extractVietnamesePhones(text);
}

/**
 * CHÍNH SÁCH CẬP NHẬT PHIÊN BẢN — logic thuần, không phụ thuộc Electron.
 *
 * Cách làm chuẩn cho app desktop không có server riêng:
 *   1. `update-policy.json` được version-control trong repo (có lịch sử review).
 *   2. CI copy file đó thành ASSET của GitHub Release.
 *   3. App tải qua URL ổn định `releases/latest/download/update-policy.json`
 *      (GitHub CDN, không tốn rate-limit API, không cần token).
 *   4. Cache lại trong userData → vẫn ép được cập nhật khi offline.
 *
 * Vì sao không nhét `minimumVersion` vào `latest.yml`: electron-builder TỰ SINH
 * file đó và sẽ ghi đè mọi trường lạ. Còn `MIN_SUPPORTED_VERSION` qua biến môi
 * trường thì app đã đóng gói không bao giờ nhận được (code cũ vì thế mà chết).
 */

/** Khớp electron-builder.json → publish. Có test kiểm tra không được lệch. */
export const GITHUB_OWNER = 'anhvult911';
export const GITHUB_REPO = 'marketing-tool-desktop';

/** Tên asset cố định — URL tải phụ thuộc tên này, đổi là vỡ client cũ. */
export const POLICY_ASSET_NAME = 'update-policy.json';

export const POLICY_URL =
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${POLICY_ASSET_NAME}`;

export const RELEASE_PAGE_URL =
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface UpdatePolicy {
  /** Dưới mức này → BẮT BUỘC cập nhật mới dùng được. '0.0.0' = không ép. */
  minimumVersion: string;
  /** Dưới mức này → chỉ nhắc (banner), vẫn dùng bình thường. */
  recommendedVersion: string;
  /** Lời nhắn hiển thị trong popup/banner (tuỳ chọn). */
  message: string;
}

export const DEFAULT_POLICY: UpdatePolicy = {
  minimumVersion: '0.0.0',
  recommendedVersion: '0.0.0',
  message: '',
};

export type UpdateLevel = 'none' | 'recommended' | 'required';

/**
 * So sánh semver rút gọn: bỏ tiền tố 'v', so từng đoạn số, xử lý prerelease.
 * Trả -1 nếu a < b, 0 nếu bằng, 1 nếu a > b.
 * Prerelease: 1.0.0-beta < 1.0.0 (đúng semver) và beta.2 < beta.10.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (raw: string): { nums: number[]; pre: string[] } => {
    const clean = String(raw || '').trim().replace(/^v/i, '');
    const [base, ...rest] = clean.split('-');
    const nums = base.split('.').map(p => {
      const n = parseInt(p.replace(/[^0-9]/g, ''), 10);
      return Number.isFinite(n) ? n : 0;
    });
    const pre = rest.join('-').split('.').filter(Boolean);
    return { nums, pre };
  };

  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i++) {
    const x = A.nums[i] ?? 0;
    const y = B.nums[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }

  // Phần số bằng nhau → xét prerelease
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  if (A.pre.length === 0) return 1;  // bản chính thức > prerelease
  if (B.pre.length === 0) return -1;

  const preLen = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < preLen; i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x) ? parseInt(x, 10) : null;
    const yNum = /^\d+$/.test(y) ? parseInt(y, 10) : null;
    if (xNum !== null && yNum !== null) {
      if (xNum < yNum) return -1;
      if (xNum > yNum) return 1;
      continue;
    }
    // số < chữ (semver); còn lại so chuỗi
    if (xNum !== null) return -1;
    if (yNum !== null) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function readString(source: Record<string, unknown>, key: string): string {
  const v = source[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Đọc & kiểm tra policy từ JSON chưa tin cậy. Trả null nếu không hợp lệ —
 * caller giữ policy cũ thay vì áp dụng rác (một file hỏng không được phép
 * khoá toàn bộ người dùng).
 */
export function parsePolicy(raw: unknown): UpdatePolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const minimumVersion = readString(obj, 'minimumVersion') || '0.0.0';
  const recommendedVersion = readString(obj, 'recommendedVersion') || '0.0.0';
  const message = readString(obj, 'message');

  // Chỉ chấp nhận chuỗi giống version; 'latest'/'*' vô tình viết vào sẽ khoá hết.
  const looksLikeVersion = (v: string) => /^v?\d+(\.\d+)*([.-][0-9A-Za-z.]+)?$/.test(v);
  if (!looksLikeVersion(minimumVersion) || !looksLikeVersion(recommendedVersion)) return null;

  return { minimumVersion, recommendedVersion, message };
}

/** Phiên bản hiện tại có thuộc diện bắt buộc / nên cập nhật không. */
export function evaluatePolicy(currentVersion: string, policy: UpdatePolicy): { level: UpdateLevel; reason: string } {
  if (compareVersions(currentVersion, policy.minimumVersion) < 0) {
    return { level: 'required', reason: `Bản ${currentVersion} thấp hơn mức tối thiểu ${policy.minimumVersion}` };
  }
  if (compareVersions(currentVersion, policy.recommendedVersion) < 0) {
    return { level: 'recommended', reason: `Có bản ${policy.recommendedVersion} nên dùng` };
  }
  return { level: 'none', reason: '' };
}

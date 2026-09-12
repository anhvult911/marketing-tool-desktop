/**
 * IP REGISTRY — quản lý danh tính IP của session, dựa trên IP ĐO THẬT.
 *
 * BÀI HỌC ĐO ĐƯỢC (script tmp-proxy-exit-ip.ts, chạy thật trên máy này):
 *   proxy #2 103.179.188.222:27305 → 118.68.29.31
 *   proxy #3 103.179.188.222:27321 → 118.68.233.185
 *   proxy #4 103.179.188.222:25975 → 1.55.226.226
 * Cùng host, khác port → KHÁC IP đầu ra. Vậy KHÔNG được dùng `host` làm danh tính
 * (phiên bản đầu của module này đã làm vậy và siết nhầm 5 IP xuống còn 2).
 * Cũng KHÔNG nên suy đoán `host:port` — đó vẫn là giả định về cách provider làm việc.
 *
 * Cách đúng: đo IP đầu ra thật rồi lưu vào `proxies.exit_ip`, dùng nó làm danh tính.
 * Khi chưa đo được thì tạm dùng host:port (an toàn hơn host trần vì mỗi port là một
 * session riêng ở phần lớn provider), và lần đo kế tiếp sẽ thay bằng số thật.
 *
 * Hai luật cốt lõi:
 *   1. Danh tính = exit_ip nếu đã đo, ngược lại host:port. Không bao giờ chỉ dùng proxy_id.
 *   2. Mỗi danh tính chỉ cho 1 session đồng thời. Không ngoại lệ cho proxy mặc định.
 *
 * Pure logic (nhận dữ liệu, không tự query DB) → unit-test được.
 */

/** Thông tin proxy đã chuẩn hoá để dùng cho 1 session. */
export interface ProxyEndpoint {
  /** id row trong bảng proxies (để set cooldown khi checkpoint) */
  proxyId: number;
  /** host gateway của provider (KHÔNG phải IP đầu ra) */
  host: string;
  port: number;
  /**
   * IP ĐẦU RA THẬT, đo bằng truy vấn công khai (proxies.exit_ip).
   * Có giá trị → đây là danh tính. Chưa đo → dùng host:port làm danh tính tạm.
   */
  exitIp?: string | null;
  username?: string;
  password?: string;
  protocol?: string;
}

/** Nguồn IP của một session. */
export type IpSource = 'direct' | 'account' | 'spare';

export interface IpLease {
  /** khoá duy nhất của IP: host đã chuẩn hoá, hoặc 'direct' cho IP máy */
  ipKey: string;
  source: IpSource;
  /** proxy đi kèm (không có với 'direct') */
  proxy?: ProxyEndpoint;
}

/** Chuẩn hoá host để so trùng: hạ chữ thường, bỏ khoảng trắng. */
export function normalizeIpKey(host: string | null | undefined): string {
  const h = String(host || '').trim().toLowerCase();
  return h || 'direct';
}

/**
 * Danh tính IP của một proxy.
 * Thứ tự: exit_ip đã đo → host:port (mỗi port thường là một session/IP riêng).
 * TUYỆT ĐỐI không dùng host trần: đo thực tế cho thấy cùng host ra nhiều IP.
 */
export function proxyIpKey(proxy: ProxyEndpoint): string {
  const measured = String(proxy.exitIp || '').trim().toLowerCase();
  if (measured) return measured;
  const host = String(proxy.host || '').trim().toLowerCase();
  if (!host) return 'direct';
  return `${host}:${proxy.port}`;
}

/**
 * Sổ đăng ký IP đang bận. Không phải singleton toàn cục để test được độc lập;
 * job tạo một instance và truyền xuống các session.
 */
export class IpRegistry {
  private busy = new Map<string, { accountId: number; label: string; since: number }>();

  /** IP đang được dùng? */
  isBusy(ipKey: string): boolean {
    return this.busy.has(normalizeIpKey(ipKey));
  }

  /** Danh sách IP đang bận (chẩn đoán/log). */
  busyKeys(): string[] {
    return Array.from(this.busy.keys());
  }

  /**
   * Đăng ký IP cho một session. Trả lease nếu IP rảnh, null nếu đã bị chiếm.
   * Caller phải tự chọn IP khác hoặc chờ; KHÔNG tự động dùng chung.
   */
  acquire(ipKey: string, accountId: number, source: IpSource, proxy?: ProxyEndpoint): IpLease | null {
    const key = normalizeIpKey(ipKey);
    if (this.busy.has(key)) return null;
    const label = source === 'direct' ? 'direct' : `${key}:${proxy?.port ?? ''}`;
    this.busy.set(key, { accountId, label, since: Date.now() });
    return { ipKey: key, source, proxy };
  }

  /** Giải phóng IP sau khi session kết thúc (luôn gọi trong finally). */
  release(ipKey: string): void {
    this.busy.delete(normalizeIpKey(ipKey));
  }

  /** IP nào đang bị account này giữ (để giải phóng khi session lỗi bất ngờ). */
  heldBy(accountId: number): string[] {
    const out: string[] = [];
    for (const [key, info] of this.busy) {
      if (info.accountId === accountId) out.push(key);
    }
    return out;
  }

  /** Chẩn đoán: mọi IP đang bận kèm account. */
  snapshot(): Array<{ ipKey: string; accountId: number; source: string; heldMs: number }> {
    const now = Date.now();
    return Array.from(this.busy.entries()).map(([ipKey, info]) => ({
      ipKey,
      accountId: info.accountId,
      source: info.label,
      heldMs: now - info.since,
    }));
  }

  size(): number {
    return this.busy.size;
  }
}

/**
 * Chọn IP cho session theo thứ tự ưu tiên, KHÔNG bao giờ trả về IP đang bận.
 *
 * Thứ tự:
 *   1. IP mặc định của account (quen thuộc nhất với tài khoản → ít rủi ro nhất)
 *   2. IP dự phòng rảnh (chỉ khi pass ≥ 2 — chuỗi mới cần IP mới, hoặc khi IP
 *      mặc định đang bận vì account khác dùng chung)
 *
 * Trả null khi mọi IP khả dụng đều đang bận → caller nên nhường slot, KHÔNG chạy.
 */
export function chooseIpForSession(params: {
  registry: IpRegistry;
  accountId: number;
  /** proxy mặc định của account (null = dùng IP máy) */
  accountProxy: ProxyEndpoint | null;
  /** proxy dự phòng đã lọc sẵn (rảnh, không trùng IP account) */
  spareProxies: ProxyEndpoint[];
  /** đã qua chain đầu chưa — pass ≥ 2 mới cho phép đổi sang IP dự phòng */
  allowSpare: boolean;
}): IpLease | null {
  const { registry, accountId, accountProxy, spareProxies, allowSpare } = params;

  // Account KHÔNG có proxy dùng IP máy. Nhiều account như vậy = nhiều session trên
  // cùng một IP → phải đi qua đúng luật độc quyền, không được tự động cấp 'direct'.
  // (Thiếu nhánh này, 2 account không proxy sẽ chạy song song trên IP máy.)
  if (!accountProxy) {
    if (!registry.isBusy('direct')) {
      return registry.acquire('direct', accountId, 'direct');
    }
    if (!allowSpare) return null;
    for (const spare of spareProxies) {
      const key = proxyIpKey(spare);
      if (registry.isBusy(key)) continue;
      const lease = registry.acquire(key, accountId, 'spare', spare);
      if (lease) return lease;
    }
    return null;
  }

  const accountKey = proxyIpKey(accountProxy);
  if (!registry.isBusy(accountKey)) {
    return registry.acquire(accountKey, accountId, 'account', accountProxy);
  }

  if (!allowSpare) return null;

  for (const spare of spareProxies) {
    const key = proxyIpKey(spare);
    if (registry.isBusy(key)) continue;
    const lease = registry.acquire(key, accountId, 'spare', spare);
    if (lease) return lease;
  }
  return null;
}

/**
 * Số session tối đa an toàn = số IP THẬT khả dụng (không phải số account).
 * Dùng để clamp `max_scrape_sessions` trước khi mở job: chạy nhiều session hơn số IP
 * chỉ tạo ra session bị chặn chờ, không tăng sản lượng mà tăng rủi ro.
 */
export function maxSafeSessions(addressableIps: number, configuredSessions: number): number {
  const ips = Math.max(1, addressableIps);
  const configured = Math.max(1, configuredSessions);
  return Math.max(1, Math.min(ips, configured));
}

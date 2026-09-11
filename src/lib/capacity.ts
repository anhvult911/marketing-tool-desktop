/**
 * CD7 — CAPACITY CALCULATOR: dự báo sản lượng thu leads từ hằng số ĐO THỰC TẾ
 * (phiên 2026-09-09, target follower list công khai, query ProfileCometAppCollectionListRendererPaginationQuery):
 *
 * HẰNG SỐ ĐO (không phỏng đoán):
 * - LEADS_PER_CHAIN_SLOT: 8 leads/request — FB ép node size 8, tham số count=200 bị bỏ qua
 * - CHAIN_SLOTS: ~18 request liên tục trước khi HTTP 500 (đo bg_1: req 0-17 OK, req 18 = 500)
 * - PASSIVE_LEADS_PER_CHAIN: 18 × 8 = 144 leads/1 chuỗi (khớp 144 đo được trong job #39 pass 1)
 * - CHAIN_COOLDOWN_MIN: ~10 phút — thời gian FB gỡ block phân trang theo IP+session
 *   (dẫn chứng: nghỉ 5' vẫn 500, nghỉ 10' + IP mới → 200 ngay)
 * - SESSION_MIN: ~7 phút/phiên passive thực tế (job #39: 40 scroll × 3.5-4.5s + wait 16s đầu)
 * - PASSIVE_SUCCESS_RATE: 0.8 — hệ số an toàn cho capture miss/checkpoint/DOM chậm
 */

export const MEASURED = {
  LEADS_PER_REQUEST: 8,
  CHAIN_REQUESTS: 18,
  CHAIN_LEADS: 144, // 18 × 8
  CHAIN_COOLDOWN_MIN: 10,
  SESSION_MIN: 7,
  PASSIVE_SUCCESS_RATE: 0.8,
} as const;

export interface PoolInput {
  liveAccounts: number;      // số account Facebook cookie sống
  spareProxies: number;      // số proxy 'working' KHÔNG gắn account nào
  targetLeads: number;       // mục tiêu leads cần thu
}

export interface CapacityPlan {
  chainsPerAccountPerHour: number;   // số chuỗi 1 account chạy được mỗi giờ
  leadsPerAccountPerHour: number;    // sản lượng 1 account/giờ
  totalLeadsPerHour: number;         // sản lượng toàn pool/giờ
  hoursToTarget: number;             // thời gian đạt target (giờ, 1 chữ số thập phân)
  recommendedAccounts: number;       // số account nên có cho target trong ≤6 giờ
  recommendedSpareProxies: number;   // số proxy rảnh tương ứng (mỗi pass ≥2 cần 1 IP mới)
  notes: string[];
}

/**
 * Tính toán kế hoạch. Công thức:
 * - 1 chuỗi = 1 phiên passive (scroll, FB tự bắn) ≈ SESSION_MIN phút, cho ~CHAIN_LEADS × SUCCESS_RATE leads
 * - Giữa 2 chuỗi cùng account: nghỉ CHAIN_COOLDOWN_MIN (hoặc đổi proxy rảnh → hồi phục gần tức thì,
 *   nhưng vẫn tính bảo守 CHAIN_COOLDOWN_MIN/2 để an toàn fingerprint)
 * - Proxy rảnh cho phép account thứ i chạy chuỗi kế trên IP khác mà không chờ full cooldown
 */
export function planCapacity(input: PoolInput): CapacityPlan {
  const { liveAccounts, spareProxies, targetLeads } = input;
  const notes: string[] = [];

  const effectiveLeadsPerChain = Math.floor(MEASURED.CHAIN_LEADS * MEASURED.PASSIVE_SUCCESS_RATE); // 115

  // Chu kỳ 1 chuỗi + nghỉ: có proxy rảnh → nghỉ nửa cooldown (5'), không có → đủ 10'
  const restWithSpare = (MEASURED.CHAIN_COOLDOWN_MIN / 2) + MEASURED.SESSION_MIN; // 12 phút/chuỗi
  const restWithoutSpare = MEASURED.CHAIN_COOLDOWN_MIN + MEASURED.SESSION_MIN;    // 17 phút/chuỗi

  // Trung bình pool: số chuỗi/giờ mỗi account phụ thuộc tỉ lệ có spare proxy
  // Pass 1 dùng proxy mặc định (không tốn spare). Từ pass 2 mỗi chuỗi cần 1 spare.
  // Giả định xoay vòng spare: mỗi account dùng luân phiên tất cả spare.
  const spareRatio = liveAccounts > 0 ? Math.min(1, spareProxies / Math.max(1, liveAccounts)) : 0;
  const avgCycleMin = restWithoutSpare - spareRatio * (restWithoutSpare - restWithSpare);

  const chainsPerAccountPerHour = 60 / avgCycleMin;
  const leadsPerAccountPerHour = Math.floor(chainsPerAccountPerHour * effectiveLeadsPerChain);
  const totalLeadsPerHour = leadsPerAccountPerHour * liveAccounts;

  const hoursToTarget = totalLeadsPerHour > 0
    ? Math.round((targetLeads / totalLeadsPerHour) * 10) / 10
    : Infinity;

  // Khuyến nghị: đạt target trong ≤ 6 giờ
  const neededThroughput = targetLeads / 6; // leads/giờ
  const recommendedAccounts = Math.max(1, Math.ceil(neededThroughput / Math.max(1, leadsPerAccountPerHour || effectiveLeadsPerChain * (60 / restWithoutSpare))));
  // Mỗi account cần ~1 spare proxy để chạy ≥2 chuỗi liên tục không nghỉ dài
  const recommendedSpareProxies = recommendedAccounts;

  if (liveAccounts === 0) notes.push('Không có account live — nạp cookie trước khi chạy.');
  if (spareProxies === 0) notes.push('Không có proxy rảnh: mỗi account chỉ 1 chuỗi/17 phút (~' + Math.floor(60 / restWithoutSpare * effectiveLeadsPerChain) + ' leads/giờ). Thêm proxy để nhân tốc độ.');
  if (spareProxies < liveAccounts) notes.push(`Thiếu proxy rảnh: ${liveAccounts} account nhưng chỉ ${spareProxies} spare — ${liveAccounts - spareProxies} account sẽ chạy chậm (17 phút/chuỗi).`);
  if (hoursToTarget > 12) notes.push(`Target ${targetLeads} cần >12 giờ với pool hiện tại — cân nhắc thêm account/proxy.`);

  return {
    chainsPerAccountPerHour: Math.round(chainsPerAccountPerHour * 10) / 10,
    leadsPerAccountPerHour,
    totalLeadsPerHour,
    hoursToTarget,
    recommendedAccounts,
    recommendedSpareProxies,
    notes,
  };
}

/**
 * P5 — AUTO-TUNE từ TELEMETRY ĐO THỰC.
 *
 * Telemetry ghi mỗi chain: requests, leads_new, http_500, duration_ms,
 * first_500_at_request, account_id. Từ đó suy ra:
 *   - sản lượng thực (leads/giờ) theo account/engine
 *   - tỷ lệ 500 và "chuỗi bền" (500 đầu tiên ở request thứ mấy)
 *   - khuyến nghị pacing khởi điểm + cooldown cho account
 *
 * Nguyên tắc: CHỈ siết chặt hơn mặc định khi dữ liệu xấu, và siết có trần —
 * không bao giờ nới lỏng dưới ngưỡng an toàn đã đo (floor 3000ms, cooldown ≥ 60s).
 * Thiếu dữ liệu → giữ nguyên mặc định.
 *
 * Pure logic (nhận rows, không tự query) → unit-test được.
 */

/** Mặc định đã đo của hệ thống (khớp CD2/CD3/CD6 đang chạy). */
export interface PacingDefaults {
  basePacingMs: number;
  minPacingMs: number;
  maxPacingMs: number;
  quotaCooldownMs: number;
  emptyCooldownMs: number;
  minCooldownMs: number;
  throttledCooldownMs: number;
}

export const PACING_DEFAULTS: PacingDefaults = {
  /** pacing khởi điểm cho cursor engine (ms) */
  basePacingMs: 3200,
  /** sàn tuyệt đối — FB 500 khi replay < 2.5s (đo 2026-09) */
  minPacingMs: 3000,
  /** trần pacing — trên mức này chậm vô ích */
  maxPacingMs: 8000,
  /** nghỉ sau chain hết quota */
  quotaCooldownMs: 10 * 60_000,
  /** nghỉ sau chain 0 lead */
  emptyCooldownMs: 5 * 60_000,
  /** nghỉ tối thiểu sau chain bình thường */
  minCooldownMs: 60_000,
  /** nghỉ khi bị throttle */
  throttledCooldownMs: 2 * 60_000,
};

export interface TelemetryRow {
  account_id: number | null;
  engine: string;
  requests: number;
  leads_new: number;
  http_500: number;
  duration_ms?: number | null;
  first_500_at_request?: number | null;
  created_at: string;
}

export interface AccountStats {
  accountId: number;
  chains: number;
  requests: number;
  leads: number;
  http500: number;
  /** 500 / request — 0..1 */
  fiveHundredRate: number;
  /** leads / giờ (chỉ tính chain có duration > 0) */
  leadsPerHour: number;
  /** request trung bình trước lần 500 đầu — càng nhỏ càng dễ bị chặn */
  avgFirstFiveHundredAt: number;
  /** chain có 0 lead / tổng chain */
  emptyChainRatio: number;
}

export interface PacingRecommendation {
  pacingMs: number;
  cooldownMs: number;
  /** lý do bằng tiếng Việt để hiển thị UI/log */
  note: string;
  /** dữ liệu có đủ tin cậy không (số chain tối thiểu) */
  confident: boolean;
}

/** Số chain tối thiểu để tin khuyến nghị thay vì dùng mặc định. */
export const MIN_CHAINS_FOR_CONFIDENCE = 3;

/** 500/request vượt ngưỡng này = pacing/IP đang bị soi. */
export const HIGH_500_RATE = 0.1;
/** Chuỗi bền dưới mức này (request trước 500 đầu) = cần pacing chậm hơn. */
export const SHORT_CHAIN_REQUESTS = 12;

export function parseTelemetryTime(value: string): number {
  if (!value) return 0;
  const t = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const ms = Date.parse(t);
  return isNaN(ms) ? 0 : ms;
}

/** Lọc rows trong cửa sổ thời gian gần đây (mặc định 7 ngày). */
export function withinWindow(rows: TelemetryRow[], nowMs: number, windowMs: number): TelemetryRow[] {
  if (windowMs <= 0) return rows;
  const cutoff = nowMs - windowMs;
  return rows.filter(r => {
    const t = parseTelemetryTime(r.created_at);
    return t === 0 || t >= cutoff;
  });
}

function toAccountStats(accountId: number, rows: TelemetryRow[]): AccountStats {
  const chains = rows.length;
  const requests = rows.reduce((n, r) => n + (r.requests || 0), 0);
  const leads = rows.reduce((n, r) => n + (r.leads_new || 0), 0);
  const http500 = rows.reduce((n, r) => n + (r.http_500 || 0), 0);

  const timedRows = rows.filter(r => (r.duration_ms || 0) > 0);
  const totalHours = timedRows.reduce((n, r) => n + (r.duration_ms || 0), 0) / 3600_000;
  const timedLeads = timedRows.reduce((n, r) => n + (r.leads_new || 0), 0);

  const chainHits = rows.filter(r => (r.first_500_at_request || 0) > 0);
  const avgFirst = chainHits.length > 0
    ? chainHits.reduce((n, r) => n + (r.first_500_at_request || 0), 0) / chainHits.length
    : 0;

  return {
    accountId,
    chains,
    requests,
    leads,
    http500,
    fiveHundredRate: requests > 0 ? http500 / requests : 0,
    leadsPerHour: totalHours > 0 ? Math.round(timedLeads / totalHours) : 0,
    avgFirstFiveHundredAt: Math.round(avgFirst),
    emptyChainRatio: chains > 0 ? rows.filter(r => (r.leads_new || 0) === 0).length / chains : 0,
  };
}

/** Gộp telemetry theo account (bỏ account_id null/0 vì là guest/lỗi launch). */
export function summarizeByAccount(rows: TelemetryRow[]): AccountStats[] {
  const byAccount = new Map<number, TelemetryRow[]>();
  for (const r of rows) {
    const id = r.account_id || 0;
    if (id <= 0) continue;
    const list = byAccount.get(id);
    if (list) list.push(r);
    else byAccount.set(id, [r]);
  }
  return Array.from(byAccount.entries())
    .map(([id, list]) => toAccountStats(id, list))
    .sort((a, b) => b.leads - a.leads);
}

/**
 * Khuyến nghị pacing + cooldown cho 1 account từ số liệu đo.
 * Mặc định khi thiếu dữ liệu: giữ nguyên cấu hình đang chạy.
 */
export function recommendPacing(stats: AccountStats | undefined): PacingRecommendation {
  if (!stats || stats.chains < MIN_CHAINS_FOR_CONFIDENCE) {
    return {
      pacingMs: PACING_DEFAULTS.basePacingMs,
      cooldownMs: PACING_DEFAULTS.quotaCooldownMs,
      note: 'Chưa đủ dữ liệu đo — dùng pacing/cooldown mặc định.',
      confident: false,
    };
  }

  let pacingMs = PACING_DEFAULTS.basePacingMs;
  let cooldownMs = PACING_DEFAULTS.quotaCooldownMs;
  const reasons: string[] = [];

  // Tỷ lệ 500 cao → chậm lại theo bậc, tối đa trần
  if (stats.fiveHundredRate >= HIGH_500_RATE * 2) {
    pacingMs = PACING_DEFAULTS.maxPacingMs;
    cooldownMs = Math.max(cooldownMs, 20 * 60_000);
    reasons.push(`500/request ${(stats.fiveHundredRate * 100).toFixed(1)}% (rất cao) → pacing tối đa + nghỉ 20'`);
  } else if (stats.fiveHundredRate >= HIGH_500_RATE) {
    pacingMs = Math.min(PACING_DEFAULTS.maxPacingMs, PACING_DEFAULTS.basePacingMs + 1800);
    cooldownMs = Math.max(cooldownMs, 15 * 60_000);
    reasons.push(`500/request ${(stats.fiveHundredRate * 100).toFixed(1)}% (cao) → chậm lại + nghỉ 15'`);
  }

  // Chuỗi ngắn bất thường (500 đến sớm) → chậm lại chút
  if (stats.avgFirstFiveHundredAt > 0 && stats.avgFirstFiveHundredAt < SHORT_CHAIN_REQUESTS && stats.fiveHundredRate < HIGH_500_RATE) {
    pacingMs = Math.min(PACING_DEFAULTS.maxPacingMs, pacingMs + 800);
    reasons.push(`chuỗi chỉ bền ~${stats.avgFirstFiveHundredAt} request → chậm lại 0.8s`);
  }

  // Nhiều chain 0 lead → account đang bị chặn mềm, nghỉ lâu hơn
  if (stats.emptyChainRatio >= 0.5) {
    cooldownMs = Math.max(cooldownMs, PACING_DEFAULTS.emptyCooldownMs + 5 * 60_000);
    reasons.push(`${Math.round(stats.emptyChainRatio * 100)}% chain 0 lead → nghỉ dài hơn`);
  }

  // Sản lượng tốt, không 500 → thưởng: nghỉ ngắn hơn (không dưới sàn)
  if (stats.fiveHundredRate === 0 && stats.leadsPerHour >= 400) {
    cooldownMs = Math.max(PACING_DEFAULTS.minCooldownMs, Math.round(cooldownMs * 0.6));
    reasons.push(`sản lượng tốt (${stats.leadsPerHour} lead/giờ, 0 lỗi 500) → nghỉ ngắn hơn`);
  }

  pacingMs = Math.max(PACING_DEFAULTS.minPacingMs, Math.min(PACING_DEFAULTS.maxPacingMs, pacingMs));
  cooldownMs = Math.max(PACING_DEFAULTS.minCooldownMs, cooldownMs);

  return {
    pacingMs: Math.round(pacingMs),
    cooldownMs: Math.round(cooldownMs),
    note: reasons.length > 0 ? reasons.join('; ') : `Ổn định (${stats.leadsPerHour} lead/giờ, ${stats.chains} chain) — giữ mặc định.`,
    confident: true,
  };
}

/** Gộp telemetry theo engine (cho dashboard). */
export function summarizeByEngine(rows: TelemetryRow[]): Array<{ engine: string; chains: number; requests: number; leads: number; http500: number; leadsPerHour: number }> {
  const byEngine = new Map<string, TelemetryRow[]>();
  for (const r of rows) {
    const list = byEngine.get(r.engine);
    if (list) list.push(r);
    else byEngine.set(r.engine, [r]);
  }
  return Array.from(byEngine.entries())
    .map(([engine, list]) => {
      const timed = list.filter(r => (r.duration_ms || 0) > 0);
      const hours = timed.reduce((n, r) => n + (r.duration_ms || 0), 0) / 3600_000;
      const leads = list.reduce((n, r) => n + (r.leads_new || 0), 0);
      return {
        engine,
        chains: list.length,
        requests: list.reduce((n, r) => n + (r.requests || 0), 0),
        leads,
        http500: list.reduce((n, r) => n + (r.http_500 || 0), 0),
        leadsPerHour: hours > 0 ? Math.round(leads / hours) : 0,
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

/**
 * Ước lượng hằng số vận hành từ đo thực để nuôi capacity calculator.
 * Chỉ trả về giá trị khi có đủ mẫu; thiếu → undefined (caller giữ hằng số gốc).
 */
export function estimateMeasuredConstants(rows: TelemetryRow[]): {
  leadsPerRequest?: number;
  chainLeads?: number;
  /** thời lượng trung bình một chuỗi (phút) — dùng làm sessionMin cho capacity */
  chainDurationMin?: number;
  successRate?: number;
} | undefined {
  const chains = rows.filter(r => (r.requests || 0) > 0);
  if (chains.length < MIN_CHAINS_FOR_CONFIDENCE) return undefined;

  const totalRequests = chains.reduce((n, r) => n + (r.requests || 0), 0);
  const totalLeads = chains.reduce((n, r) => n + (r.leads_new || 0), 0);
  const leadsPerRequest = totalRequests > 0 ? totalLeads / totalRequests : undefined;

  // Chain chỉ tính khi có cursor engine (nơi có 500 → biết chain dài bao nhiêu)
  const with500 = chains.filter(r => (r.http_500 || 0) > 0 && (r.first_500_at_request || 0) > 0);
  const chainLeads = with500.length > 0
    ? Math.round(with500.reduce((n, r) => n + (r.leads_new || 0), 0) / with500.length)
    : undefined;
  const chainDurationMin = with500.length >= MIN_CHAINS_FOR_CONFIDENCE
    ? Math.round(with500.reduce((n, r) => n + (r.duration_ms || 0), 0) / with500.length / 60_000)
    : undefined;

  // Tỷ lệ chain có lead (thay PASSIVE_SUCCESS_RATE)
  const successRate = chains.length > 0 ? chains.filter(r => (r.leads_new || 0) > 0).length / chains.length : undefined;

  return { leadsPerRequest, chainLeads, chainDurationMin, successRate };
}

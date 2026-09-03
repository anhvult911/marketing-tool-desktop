import { getPlatformSafetyRule } from '@/config/platform-safety';

export interface CampaignEstimationInput {
  platform: string;
  action: string;
  numLeads: number;
  desiredDurationMinutes: number;
  safetyLevel: 'safe' | 'balanced' | 'turbo' | 'fast';
  selectedAccsCount: number;
  scheduledStart?: string;
}

export interface DangerFactor {
  title: string;
  description: string;
  severity: 'warning' | 'critical';
}

export interface CampaignEstimationResult {
  minAccsNeeded: number;
  recommendedAccs: number;
  selectedAccsCount: number;
  capacityPerAccInDuration: number;
  safeDailyQuota: number;
  minSafeDelayMins: number;
  actualAvgDelayMins: number;
  actualLeadsPerAcc: number;
  
  // Risk assessment
  riskLevel: 'safe' | 'moderate' | 'high_risk';
  riskScore: number; // 0 -> 100%
  dangerFactors: DangerFactor[];
  banRiskDescription: string;
  penaltyType: string;
  
  // Timeline projections
  projectedStartTime: Date;
  projectedEndTime: Date;
  safeEndTimeWithCurrentAccs: Date;
  isDelayCappedByMinSafe: boolean;
}

export function estimateCampaignResources(input: CampaignEstimationInput): CampaignEstimationResult {
  const {
    platform,
    action,
    numLeads,
    desiredDurationMinutes,
    safetyLevel,
    selectedAccsCount,
    scheduledStart
  } = input;

  const normSafety = safetyLevel === 'fast' ? 'turbo' : safetyLevel;
  const rule = getPlatformSafetyRule(platform, action);
  
  const minSafeDelay = rule.minDelayMins[normSafety] || 3;
  const dailyQuota = rule.maxDailyCapacity[normSafety] || 40;
  
  // Năng suất tối đa 1 tài khoản có thể hoàn thành an toàn trong thời gian T (phút):
  // 1. Giới hạn bởi giãn cách tối thiểu (Time & Delay Bound):
  const maxByMinDelay = Math.max(1, Math.floor(desiredDurationMinutes / minSafeDelay));
  
  // 2. Giới hạn bởi trần công suất tối đa trong ngày (Daily Quota Bound):
  const maxByDailyQuota = dailyQuota;
  
  // 3. Năng suất thực tế của 1 tài khoản trong chiến dịch này:
  const capacityPerAccInDuration = Math.min(maxByMinDelay, maxByDailyQuota);

  // Số lượng tài khoản tối thiểu và khuyến nghị (+15% buffer an toàn)
  const rawMinAccs = numLeads > 0 ? Math.ceil(numLeads / capacityPerAccInDuration) : 1;
  const minAccsNeeded = Math.max(1, rawMinAccs);
  const recommendedAccs = Math.max(1, Math.ceil(minAccsNeeded * 1.15));

  // Phân tích thực tế với số tài khoản đang được chọn
  const safeAccsCount = Math.max(1, selectedAccsCount);
  const actualLeadsPerAcc = numLeads > 0 ? Math.ceil(numLeads / safeAccsCount) : 0;
  
  // Delay thực tế giữa 2 tin của 1 tài khoản nếu chia đều trong khoảng thời gian mong muốn
  const rawAvgDelay = actualLeadsPerAcc > 1 ? desiredDurationMinutes / (actualLeadsPerAcc - 1) : desiredDurationMinutes;
  const actualAvgDelayMins = Math.round(rawAvgDelay * 10) / 10;
  
  // Đánh giá nguy cơ (Risk Assessment)
  const dangerFactors: DangerFactor[] = [];
  let riskScore = 10; // Base baseline risk

  // Yếu tố 1: Delay quá gấp so với ngưỡng an toàn tối thiểu
  if (selectedAccsCount > 0 && actualLeadsPerAcc > 1) {
    if (actualAvgDelayMins < rule.criticalMinDelayMins) {
      riskScore += 50;
      dangerFactors.push({
        title: 'Tần suất gửi quá dồn dập (Burst Delay)',
        description: `Mỗi tài khoản phải gửi 1 tin mỗi ~${actualAvgDelayMins >= 1 ? `${actualAvgDelayMins} phút` : `${Math.round(actualAvgDelayMins * 60)} giây`}. Ngưỡng an toàn tối thiểu của ${platform.toUpperCase()} là ${minSafeDelay} phút/tin.`,
        severity: 'critical'
      });
    } else if (actualAvgDelayMins < minSafeDelay) {
      riskScore += 25;
      dangerFactors.push({
        title: 'Khoảng cách giữa các tin hơi gấp',
        description: `Delay trung bình ~${actualAvgDelayMins} phút/tin nằm dưới mức khuyên dùng (${minSafeDelay} phút/tin).`,
        severity: 'warning'
      });
    }
  }

  // Yếu tố 2: Vượt quá công suất tối đa cho phép trong ngày
  if (selectedAccsCount > 0 && actualLeadsPerAcc > rule.criticalDailyCapacity) {
    riskScore += 45;
    dangerFactors.push({
      title: 'Vượt nghiêm trọng hạn mức gửi trong ngày',
      description: `Mỗi tài khoản phải gửi ${actualLeadsPerAcc} tin trong chiến dịch này. Ngưỡng báo động đỏ của ${platform.toUpperCase()} là ${rule.criticalDailyCapacity} tin/ngày (Hạn mức an toàn là ${dailyQuota} tin/ngày).`,
      severity: 'critical'
    });
  } else if (selectedAccsCount > 0 && actualLeadsPerAcc > dailyQuota) {
    riskScore += 20;
    dangerFactors.push({
      title: 'Khối lượng gửi hơi cao so với số tài khoản',
      description: `Mỗi tài khoản phải gửi ${actualLeadsPerAcc} tin/ngày (vượt nhẹ mức khuyên dùng ${dailyQuota} tin/ngày).`,
      severity: 'warning'
    });
  }

  // Yếu tố 3: Thiếu tài khoản nghiêm trọng
  if (selectedAccsCount > 0 && selectedAccsCount < minAccsNeeded) {
    const shortageRatio = (minAccsNeeded - selectedAccsCount) / minAccsNeeded;
    if (shortageRatio >= 0.5) {
      riskScore += 30;
      dangerFactors.push({
        title: `Thiếu tài khoản trầm trọng (Đang thiếu ${minAccsNeeded - selectedAccsCount} acc)`,
        description: `Cần tối thiểu ${minAccsNeeded} tài khoản để hoàn thành ${numLeads} leads trong ${desiredDurationMinutes} phút an toàn, hiện bạn chỉ chọn ${selectedAccsCount} tài khoản.`,
        severity: 'critical'
      });
    }
  }

  // Phân loại Level Rủi ro
  let riskLevel: 'safe' | 'moderate' | 'high_risk' = 'safe';
  if (riskScore >= 60 || dangerFactors.some(f => f.severity === 'critical')) {
    riskLevel = 'high_risk';
  } else if (riskScore >= 35 || dangerFactors.some(f => f.severity === 'warning')) {
    riskLevel = 'moderate';
  }

  // Timeline Projections
  const startTime = scheduledStart ? new Date(scheduledStart) : new Date();
  const projectedEndTime = new Date(startTime.getTime() + desiredDurationMinutes * 60 * 1000);
  
  // Thời gian an toàn nếu giữ nguyên số acc hiện tại
  const safeMinsNeededWithCurrentAccs = actualLeadsPerAcc > 0 ? (actualLeadsPerAcc - 1) * minSafeDelay : desiredDurationMinutes;
  const safeEndTimeWithCurrentAccs = new Date(startTime.getTime() + Math.max(desiredDurationMinutes, safeMinsNeededWithCurrentAccs) * 60 * 1000);

  return {
    minAccsNeeded,
    recommendedAccs,
    selectedAccsCount,
    capacityPerAccInDuration,
    safeDailyQuota: dailyQuota,
    minSafeDelayMins: minSafeDelay,
    actualAvgDelayMins,
    actualLeadsPerAcc,
    riskLevel,
    riskScore: Math.min(99, riskScore),
    dangerFactors,
    banRiskDescription: rule.banRiskDescription,
    penaltyType: rule.penaltyType,
    projectedStartTime: startTime,
    projectedEndTime,
    safeEndTimeWithCurrentAccs,
    isDelayCappedByMinSafe: actualAvgDelayMins < minSafeDelay
  };
}

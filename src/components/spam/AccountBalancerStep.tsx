import React from 'react';
import { DURATION_PRESETS, getPlatformSafetyRule } from '@/config/platform-safety';
import { estimateCampaignResources, CampaignEstimationResult } from '@/lib/campaign-estimator';

interface Account {
  id: number;
  platform: string;
  username: string;
  status: string;
}

interface AccountBalancerStepProps {
  accounts: Account[];
  campPlatform: string;
  campAction: string;
  campSelectedAccs: number[];
  setCampSelectedAccs: React.Dispatch<React.SetStateAction<number[]>>;
  accSearch: string;
  setAccSearch: (val: string) => void;
  PLATFORM_ACTIONS: Record<string, Array<{ value: string; label: string; desc: string }>>;
  setCampPlatform: (platform: string) => void;
  setCampAction: (action: string) => void;
  campNumLeads: string;
  setCampNumLeads: (val: string) => void;
  selectedLeadIds: Set<number>;
  leads?: any[];
  readyLeadsCount: number;
  campScheduledStart: string;
  setCampScheduledStart: (val: string) => void;
  safetyLevel: 'safe' | 'balanced' | 'fast';
  setSafetyLevel: (level: 'safe' | 'balanced' | 'fast') => void;
  setCurrentStep: (step: number) => void;
  desiredDuration: string;
  setDesiredDuration: (val: string) => void;
  customDurationMinutes: number;
  setCustomDurationMinutes: (val: number) => void;
  onAutoSelectOptimalAccounts?: (count: number) => void;
  onAutoExtendDuration?: (recommendedMins: number) => void;
}

export default function AccountBalancerStep({
  accounts,
  campPlatform,
  campAction,
  campSelectedAccs,
  setCampSelectedAccs,
  accSearch,
  setAccSearch,
  PLATFORM_ACTIONS,
  setCampPlatform,
  setCampAction,
  campNumLeads,
  setCampNumLeads,
  selectedLeadIds,
  leads = [],
  readyLeadsCount,
  campScheduledStart,
  setCampScheduledStart,
  safetyLevel,
  setSafetyLevel,
  setCurrentStep,
  desiredDuration,
  setDesiredDuration,
  customDurationMinutes,
  setCustomDurationMinutes,
  onAutoSelectOptimalAccounts,
  onAutoExtendDuration
}: AccountBalancerStepProps) {
  const activeAccsForPlatform = accounts.filter(a => a.platform === campPlatform && a.status === 'live');
  const allAccsForPlatform = accounts.filter(a => a.platform === campPlatform);
  const filteredAccs = allAccsForPlatform.filter(a => 
    a.username.toLowerCase().includes(accSearch.toLowerCase())
  );
  const hasNoActiveAccs = activeAccsForPlatform.length === 0;

  // Compute total target leads
  const targetPlatform = campPlatform === 'messenger' ? 'facebook' : campPlatform;
  const selectedManualCount = leads.length > 0
    ? leads.filter(l => selectedLeadIds.has(l.id) && (l.platform === targetPlatform || (targetPlatform === 'facebook' && l.platform === 'social')) && l.status === 'pending').length
    : selectedLeadIds.size;
  
  const effectiveNumLeads = selectedManualCount > 0 ? selectedManualCount : (parseInt(campNumLeads, 10) || 0);

  const quantityWarning = selectedManualCount === 0 && parseInt(campNumLeads, 10) > readyLeadsCount;
  const scheduleWarning = campScheduledStart && new Date(campScheduledStart) < new Date();

  // Compute duration in minutes
  let durationMins = 720;
  if (desiredDuration === 'custom') {
    durationMins = customDurationMinutes > 0 ? customDurationMinutes : 60;
  } else {
    const preset = DURATION_PRESETS.find(p => p.value === desiredDuration);
    durationMins = preset ? preset.minutes : 720;
  }

  // Calculate campaign resource estimation & risk
  const estimation: CampaignEstimationResult = estimateCampaignResources({
    platform: campPlatform,
    action: campAction,
    numLeads: effectiveNumLeads,
    desiredDurationMinutes: durationMins,
    safetyLevel,
    selectedAccsCount: campSelectedAccs.length,
    scheduledStart: campScheduledStart
  });

  const handleAutoSelect = () => {
    const targetCount = estimation.recommendedAccs;
    const availableLive = activeAccsForPlatform.map(a => a.id);
    const toSelect = availableLive.slice(0, targetCount);
    setCampSelectedAccs(toSelect);
    if (onAutoSelectOptimalAccounts) {
      onAutoSelectOptimalAccounts(targetCount);
    }
  };

  const handleAutoExtend = () => {
    // Calculate how many minutes needed for current selected accounts to be 100% safe
    const rule = getPlatformSafetyRule(campPlatform, campAction);
    const minSafeDelay = rule.minDelayMins[safetyLevel === 'fast' ? 'turbo' : safetyLevel] || 4;
    const leadsPerAcc = campSelectedAccs.length > 0 ? Math.ceil(effectiveNumLeads / campSelectedAccs.length) : effectiveNumLeads;
    const safeMins = Math.max(60, (leadsPerAcc - 1) * minSafeDelay);
    
    // Choose suitable preset or set custom
    if (safeMins <= 120) {
      setDesiredDuration('2h');
    } else if (safeMins <= 720) {
      setDesiredDuration('12h');
    } else if (safeMins <= 1440) {
      setDesiredDuration('24h');
    } else {
      setDesiredDuration('custom');
      setCustomDurationMinutes(safeMins);
    }

    if (onAutoExtendDuration) {
      onAutoExtendDuration(safeMins);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 1. Channel Selection Card */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          1. Chọn Kênh & Tác vụ thực thi
        </h3>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <select
            className="select"
            value={campPlatform}
            onChange={(e) => {
              const newPlatform = e.target.value;
              setCampPlatform(newPlatform);
              setCampSelectedAccs([]);
              const actions = PLATFORM_ACTIONS[newPlatform] || [];
              if (actions.length > 0) {
                setCampAction(actions[0].value);
              }
            }}
            style={{ width: '100%', height: '2.5rem', fontSize: '0.9rem', marginBottom: '1rem' }}
          >
            <optgroup label="Kênh chính thức">
              <option value="facebook">Facebook</option>
              <option value="x">X (Twitter)</option>
              <option value="threads">Threads</option>
              <option value="newf319">newF319.com</option>
              <option value="zalo">Zalo</option>
              <option value="telegram">Telegram</option>
            </optgroup>
            <optgroup label="Tính năng thử nghiệm">
              <option value="instagram">Instagram Mock</option>
              <option value="tiktok">TikTok Mock</option>
              <option value="youtube">YouTube Mock</option>
            </optgroup>
          </select>

          {/* Tác vụ Selection */}
          <div style={{ marginTop: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
              Chọn Tác vụ chiến dịch:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
              {(PLATFORM_ACTIONS[campPlatform] || []).map(action => (
                <div
                  key={action.value}
                  onClick={() => setCampAction(action.value)}
                  style={{
                    border: campAction === action.value ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '0.85rem',
                    cursor: 'pointer',
                    backgroundColor: campAction === action.value ? 'rgba(47, 129, 247, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                    boxShadow: campAction === action.value ? '0 0 10px rgba(47, 129, 247, 0.1)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: campAction === action.value ? 'var(--color-primary-hover)' : 'var(--text-primary)', fontSize: '0.85rem' }}>
                    <input
                      type="radio"
                      name="campActionRadio"
                      value={action.value}
                      checked={campAction === action.value}
                      onChange={() => {}}
                      style={{ pointerEvents: 'none', margin: 0 }}
                    />
                    {action.label}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: '1.3rem', lineHeight: 1.4 }}>
                    {action.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Campaign Timing & Scope Configuration */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          2. Cấu hình Mục tiêu & Thời gian hoàn thành
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Thiết lập số lượng lead cần gửi và thời gian mong muốn để hệ thống tính toán tài nguyên tối ưu.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* Target Leads */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
              🎯 Số mục tiêu (Leads) cần gửi
            </label>
            
            {selectedManualCount > 0 ? (
              <div style={{ 
                padding: '0.65rem 0.85rem', 
                borderRadius: '6px', 
                border: '1px solid rgba(46, 160, 67, 0.3)', 
                backgroundColor: 'rgba(46, 160, 67, 0.05)', 
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: '2.5rem'
              }}>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>✓ Đang chọn từ Bước 1:</span>
                  <strong style={{ marginLeft: '0.35rem' }}>{selectedManualCount} mục tiêu ({campPlatform.toUpperCase()})</strong>
                </div>
                <button 
                  type="button" 
                  onClick={() => setCurrentStep(1)} 
                  className="btn btn-secondary" 
                  style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', height: 'auto', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                >
                  ✏️ Sửa danh sách
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
                    {['10', '50', '100', '500'].map(num => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setCampNumLeads(num)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', height: 'auto' }}
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCampNumLeads(readyLeadsCount.toString())}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', height: 'auto' }}
                    >
                      Tất cả ({readyLeadsCount})
                    </button>
                  </div>
                </div>
                
                <input
                  type="number"
                  className={"form-input " + (quantityWarning ? "input-invalid" : "")}
                  min="1"
                  value={campNumLeads}
                  onChange={(e) => setCampNumLeads(e.target.value)}
                  style={{ width: '100%', height: '2.5rem', fontSize: '0.9rem' }}
                />
                
                {quantityWarning ? (
                  <span className="validation-error-text" style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem', display: 'block' }}>
                    ⚠️ Số lượng vượt quá số lead sẵn có trong kho ({readyLeadsCount} lead).
                  </span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                    Hệ thống sẽ chia đều số lượng gửi cho các tài khoản đã chọn.
                  </span>
                )}
              </>
            )}
          </div>

          {/* Scheduled Start Time */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
              ⏰ Thời điểm bắt đầu chạy
            </label>
            <input
              type="datetime-local"
              className={"form-input " + (scheduleWarning ? "input-invalid" : "")}
              value={campScheduledStart}
              onChange={(e) => setCampScheduledStart(e.target.value)}
              style={{ width: '100%', height: '2.5rem', fontSize: '0.9rem' }}
            />
            {scheduleWarning ? (
              <span className="validation-error-text" style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem', display: 'block' }}>
                ⚠️ Thời gian bắt đầu đã nằm trong quá khứ. Vui lòng kiểm tra lại.
              </span>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                Để trống nếu muốn khởi chạy ngay lập tức.
              </span>
            )}
          </div>
        </div>

        {/* Desired Duration Selector */}
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
            ⏱️ Thời gian mong muốn hoàn thành chiến dịch:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {DURATION_PRESETS.map(preset => {
              const isSelected = desiredDuration === preset.value;
              return (
                <div
                  key={preset.value}
                  onClick={() => setDesiredDuration(preset.value)}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: isSelected ? '2px solid var(--color-primary-hover)' : '1px solid var(--border-color)',
                    backgroundColor: isSelected ? 'rgba(47, 129, 247, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.2rem'
                  }}
                >
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isSelected ? 'var(--color-primary-hover)' : 'var(--text-primary)' }}>
                    {preset.label}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    {preset.desc}
                  </span>
                </div>
              );
            })}
          </div>

          {desiredDuration === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-tertiary)', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Nhập thời lượng tùy chỉnh (Phút):</label>
              <input
                type="number"
                min="5"
                max="43200"
                value={customDurationMinutes}
                onChange={(e) => setCustomDurationMinutes(parseInt(e.target.value, 10) || 60)}
                className="form-input"
                style={{ width: '120px', height: '2rem', fontSize: '0.85rem' }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                (~{Math.round((customDurationMinutes / 60) * 10) / 10} giờ)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Safety Level & Antiban Settings */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          3. Cấp độ An toàn & Chống Khóa (Anti-Ban Safety Policy)
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Lựa chọn chính sách vận hành phù hợp với mục đích chiến dịch.
        </p>

        <div className="safety-slider-container">
          <div 
            className={`safety-card ${safetyLevel === 'safe' ? 'active' : ''}`}
            onClick={() => setSafetyLevel('safe')}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-success)' }}>
              🛡️ Safe (An toàn cao)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Ưu tiên bảo vệ nick tối đa. Giãn cách dài, phù hợp nick mới tạo hoặc nuôi lâu dài.
            </span>
          </div>

          <div 
            className={`safety-card ${safetyLevel === 'balanced' ? 'active' : ''}`}
            onClick={() => setSafetyLevel('balanced')}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-primary-hover)' }}>
              ⚖️ Balanced (Cân bằng)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Tốc độ vừa phải, an toàn tiêu chuẩn. Phương án khuyên dùng cho phần lớn chiến dịch.
            </span>
          </div>

          <div 
            className={`safety-card ${safetyLevel === 'fast' ? 'active' : ''}`}
            onClick={() => setSafetyLevel('fast')}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-warning)' }}>
              ⚡ Turbo (Tốc độ nhanh)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Tăng tốc gửi dồn dập khi cần phủ sóng gấp. Yêu cầu dàn tài khoản cứng (đã ngâm lâu).
            </span>
          </div>
        </div>
      </div>

      {/* 4. REAL-TIME CAMPAIGN ESTIMATOR & DANGER ALERT BOX */}
      {effectiveNumLeads > 0 && (
        <div className="card" style={{ 
          padding: '1.5rem',
          border: estimation.riskLevel === 'high_risk' 
            ? '2px solid rgba(248, 81, 73, 0.8)' 
            : estimation.riskLevel === 'moderate' 
            ? '1px solid rgba(210, 153, 34, 0.6)' 
            : '1px solid rgba(63, 185, 80, 0.5)',
          backgroundColor: estimation.riskLevel === 'high_risk' 
            ? 'rgba(248, 81, 73, 0.05)' 
            : estimation.riskLevel === 'moderate' 
            ? 'rgba(210, 153, 34, 0.04)' 
            : 'rgba(63, 185, 80, 0.04)'
        }}>
          {/* Header Status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.4rem' }}>
                {estimation.riskLevel === 'high_risk' ? '🚨' : estimation.riskLevel === 'moderate' ? '⚠️' : '🛡️'}
              </span>
              <div>
                <strong style={{ 
                  fontSize: '0.95rem', 
                  color: estimation.riskLevel === 'high_risk' 
                    ? 'var(--color-danger)' 
                    : estimation.riskLevel === 'moderate' 
                    ? 'var(--color-warning)' 
                    : 'var(--color-success)' 
                }}>
                  {estimation.riskLevel === 'high_risk' 
                    ? `CẢNH BÁO MẠO HIỂM: NGUY CƠ BỊ KHÓA TÀI KHOẢN CAO (${estimation.riskScore}% BAN RISK)`
                    : estimation.riskLevel === 'moderate'
                    ? 'CẢNH BÁO: TẢI TRUNG BÌNH - NÊN BỔ SUNG TÀI KHOẢN'
                    : 'CẤU HÌNH TỐI ƯU & AN TOÀN TUYỆT ĐỐI'
                  }
                </strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>
                  Kênh {campPlatform.toUpperCase()} • {effectiveNumLeads} Leads trong {Math.round(durationMins / 60 * 10) / 10} giờ ({safetyLevel.toUpperCase()})
                </span>
              </div>
            </div>

            <span className="badge" style={{ 
              fontSize: '0.75rem', 
              fontWeight: 700,
              backgroundColor: estimation.riskLevel === 'high_risk' 
                ? 'rgba(248, 81, 73, 0.2)' 
                : estimation.riskLevel === 'moderate' 
                ? 'rgba(210, 153, 34, 0.2)' 
                : 'rgba(63, 185, 80, 0.2)',
              color: estimation.riskLevel === 'high_risk' 
                ? 'var(--color-danger)' 
                : estimation.riskLevel === 'moderate' 
                ? 'var(--color-warning)' 
                : 'var(--color-success)',
              padding: '0.35rem 0.75rem',
              borderRadius: '20px'
            }}>
              {estimation.riskLevel === 'high_risk' 
                ? 'RỦI RO CAO (HIGH RISK)' 
                : estimation.riskLevel === 'moderate' 
                ? 'RỦI RO TRUNG BÌNH' 
                : 'HOÀN HẢO (SAFE)'}
            </span>
          </div>

          {/* Key Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Số Acc Đã Chọn</span>
              <strong style={{ fontSize: '1.1rem', color: campSelectedAccs.length < estimation.minAccsNeeded ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                {campSelectedAccs.length} Acc
              </strong>
            </div>

            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Tối Thiểu Cần Có</span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                {estimation.minAccsNeeded} Acc
              </strong>
            </div>

            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Khuyên Dùng (+20% đệm)</span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--color-primary-hover)' }}>
                {estimation.recommendedAccs} Acc LIVE
              </strong>
            </div>

            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Giãn Cách TB / Acc</span>
              <strong style={{ fontSize: '1.1rem', color: estimation.actualAvgDelayMins < estimation.minSafeDelayMins ? 'var(--color-danger)' : 'var(--color-success)' }}>
                ~{estimation.actualAvgDelayMins} phút
              </strong>
            </div>

            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Số Tin / Acc</span>
              <strong style={{ fontSize: '1.1rem', color: estimation.actualLeadsPerAcc > estimation.safeDailyQuota ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                {estimation.actualLeadsPerAcc} tin
              </strong>
            </div>
          </div>

          {/* Danger Factors & Risk Explanation */}
          {estimation.dangerFactors.length > 0 && (
            <div style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.2)', 
              padding: '1rem', 
              borderRadius: '6px', 
              borderLeft: `4px solid ${estimation.riskLevel === 'high_risk' ? 'var(--color-danger)' : 'var(--color-warning)'}`,
              marginBottom: '1rem' 
            }}>
              <strong style={{ fontSize: '0.82rem', color: estimation.riskLevel === 'high_risk' ? 'var(--color-danger)' : 'var(--color-warning)', display: 'block', marginBottom: '0.4rem' }}>
                ⚠️ Yếu tố kích hoạt bộ lọc Spam của {campPlatform.toUpperCase()}:
              </strong>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {estimation.dangerFactors.map((factor, idx) => (
                  <li key={idx} style={{ marginBottom: '0.25rem' }}>
                    <strong>{factor.title}:</strong> {factor.description}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                💥 <strong>Hệ quả phạt dự báo:</strong> {estimation.penaltyType}
              </div>
            </div>
          )}

          {/* Timeline Projections */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem', padding: '0.5rem 0', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              🚀 <strong>Bắt đầu:</strong> {estimation.projectedStartTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div>
              🏁 <strong>Dự kiến xong:</strong> {estimation.projectedEndTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
            </div>
            <div>
              🛡️ <strong>Chạy an toàn với dàn acc hiện tại:</strong> {estimation.safeEndTimeWithCurrentAccs.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
            </div>
          </div>

          {/* Smart 1-Click Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {campSelectedAccs.length < estimation.recommendedAccs && activeAccsForPlatform.length >= estimation.minAccsNeeded && (
              <button
                type="button"
                onClick={handleAutoSelect}
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
              >
                ⚡ Tự động chọn đủ {estimation.recommendedAccs} Acc Live khỏe nhất
              </button>
            )}

            {estimation.riskLevel !== 'safe' && (
              <button
                type="button"
                onClick={handleAutoExtend}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', borderColor: 'var(--color-primary-hover)', color: 'var(--color-primary-hover)' }}
              >
                🕒 Tự động dãn thời gian an toàn cho {campSelectedAccs.length || 1} Acc
              </button>
            )}
          </div>
        </div>
      )}

      {/* 5. Social Accounts Selector Grid */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            4. Danh sách Tài khoản ({campSelectedAccs.length} đã chọn / {activeAccsForPlatform.length} Live)
          </h3>
          
          {!hasNoActiveAccs && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Lọc tài khoản..."
                className="form-input"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: 'auto', width: '130px', margin: 0 }}
                value={accSearch}
                onChange={(e) => setAccSearch(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  const allLiveIds = activeAccsForPlatform.map(a => a.id);
                  setCampSelectedAccs(prev => Array.from(new Set([...prev, ...allLiveIds])));
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', height: 'auto' }}
              >
                Chọn tất cả Live
              </button>
              <button
                type="button"
                onClick={() => {
                  const filteredIds = filteredAccs.map(a => a.id);
                  setCampSelectedAccs(prev => prev.filter(id => !filteredIds.includes(id)));
                }}
                className="btn"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', height: 'auto', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
              >
                Bỏ chọn
              </button>
            </div>
          )}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Chọn một hoặc nhiều tài khoản Live để phân phối chiến dịch (hệ thống sẽ tự động chia đều lượt gửi để giảm tải).
        </p>

        {hasNoActiveAccs ? (
          <div style={{ padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.01)' }}>
            ⚠️ Không tìm thấy tài khoản nào ở trạng thái LIVE cho kênh {campPlatform.toUpperCase()}. Vui lòng kiểm tra lại cấu hình tài khoản.
          </div>
        ) : filteredAccs.length === 0 ? (
          <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
            Không tìm thấy tài khoản nào khớp với từ khóa "{accSearch}".
          </div>
        ) : (
          <div className="selection-grid">
            {filteredAccs.map(acc => {
              const isSelected = campSelectedAccs.includes(acc.id);
              const isLive = acc.status === 'live';
              const firstLetter = acc.username ? acc.username.charAt(0).toUpperCase() : 'U';
              return (
                <div 
                  key={acc.id} 
                  className={"account-select-card " + (isSelected ? 'selected' : '')}
                  onClick={() => {
                    setCampSelectedAccs(prev => 
                      prev.includes(acc.id) ? prev.filter(id => id !== acc.id) : [...prev, acc.id]
                    );
                  }}
                  style={{ opacity: isLive ? 1 : 0.6 }}
                >
                  <div className="card-checkbox-wrapper">
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={() => {}} 
                      style={{ pointerEvents: 'none' }}
                    />
                  </div>
                  
                  <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '50%', 
                    backgroundColor: isLive ? 'rgba(47, 129, 247, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                    color: isLive ? 'var(--color-primary-hover)' : 'var(--text-secondary)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontWeight: 'bold',
                    fontSize: '0.85rem'
                  }}>
                    {firstLetter}
                  </div>

                  <div className="card-details">
                    <span className="card-title">{acc.username}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      ID: {acc.id}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem' }}>
                      <span className={isLive ? "badge-live" : "badge-dead"} style={{ width: '6px', height: '6px', borderRadius: '50%' }} />
                      <span style={{ fontSize: '0.65rem', color: isLive ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
                        {acc.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

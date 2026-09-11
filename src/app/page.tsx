'use client';

import { useState, useEffect } from 'react';

interface DailyStat {
  date: string;
  success: number;
  failed: number;
  pending: number;
  paused: number;
  total: number;
}

interface CampaignStat {
  campaign_id: string;
  scheduled_at: string;
  type: string;
  platform: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  pending_jobs: number;
  processing_jobs: number;
  paused_jobs: number;
}

interface PlatformStat {
  platform: string;
  total_jobs: number;
  success: number;
  failed: number;
  pending: number;
}

interface KPI {
  totalSuccess: number;
  totalFailed: number;
  totalPending: number;
  totalJobs: number;
}

interface JobWithAccount {
  id: number;
  username: string | null;
  type: string;
  target_url: string | null;
  post_content: string | null;
  scheduled_at: string | null;
  run_at: string | null;
  status: string;
  error_log: string | null;
  platform?: string;
}

interface OperationalStats {
  accounts: {
    total: number;
    live: number;
    die: number;
    checkpoint: number;
  };
  proxies: {
    total: number;
    working: number;
  };
  targets: {
    total: number;
  };
  recentJobs: JobWithAccount[];
}

interface AnalyticsData {
  daily: DailyStat[];
  campaigns: CampaignStat[];
  platforms: PlatformStat[];
  kpi: KPI;
  operational: OperationalStats;
}

const PLATFORM_COLORS: Record<string, string> = {
  x: '#f0f6fc',
  threads: '#c9d1d9',
  zalo: '#0068ff',
  telegram: '#229ed9',
  facebook: '#1877f2',
  instagram: '#e1306c',
  youtube: '#ff0000',
  tiktok: '#00f2fe',
  unknown: '#8b949e'
};

const PLATFORM_NAMES: Record<string, string> = {
  x: 'X (Twitter)',
  threads: 'Threads',
  zalo: 'Zalo',
  telegram: 'Telegram',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  unknown: 'Hệ thống'
};

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}

export default function Home() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'7' | '14' | '30' | 'all'>('7');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Hover states for tooltips
  const [hoveredLinePoint, setHoveredLinePoint] = useState<{
    x: number;
    y: number;
    successY: number;
    failedY: number;
    date: string;
    success: number;
    failed: number;
    total: number;
  } | null>(null);

  const [hoveredBar, setHoveredBar] = useState<{
    x: number;
    y: number;
    platform: string;
    success: number;
    failed: number;
    pending: number;
    total: number;
  } | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/analytics');
      const text = await res.text();
      if (!text || !text.trim()) {
        setError(`Máy chủ phản hồi rỗng (HTTP ${res.status}). Đang thử kết nối lại...`);
        return;
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        setError('Đang khởi động dữ liệu hệ thống, vui lòng chờ trong giây lát...');
        return;
      }
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Không thể tải dữ liệu Dashboard.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng hoặc kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Đang tải trung tâm chỉ huy...</p>
        <style jsx>{`
          .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 60vh;
            color: var(--text-secondary);
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--border-color);
            border-top: 4px solid var(--color-primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 1rem;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="error-container">
        <div className="error-card">
          <span style={{ fontSize: '2rem' }}>⚠️</span>
          <h3>Đã xảy ra lỗi tải Dashboard</h3>
          <p>{error || 'Không có dữ liệu.'}</p>
          <button className="btn btn-primary" onClick={fetchData}>Thử lại</button>
        </div>
        <style jsx>{`
          .error-container {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 60vh;
          }
          .error-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 2rem;
            border-radius: 12px;
            text-align: center;
            max-width: 400px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
          }
          .btn {
            background-color: var(--color-primary);
            color: var(--text-primary);
            border: none;
            padding: 0.5rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
          }
          .btn:hover {
            background-color: var(--color-primary-hover);
          }
        `}</style>
      </div>
    );
  }

  const getFilteredDailyStats = (): DailyStat[] => {
    const daily = data.daily || [];
    if (timeRange === 'all') return daily;
    const daysLimit = parseInt(timeRange, 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    return daily.filter(item => item.date >= cutoffStr);
  };

  const filteredDaily = getFilteredDailyStats();

  const getFilteredKPIs = () => {
    if (timeRange === 'all') {
      return data.kpi;
    }
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalPending = 0;
    let totalJobs = 0;
    filteredDaily.forEach(item => {
      totalSuccess += item.success;
      totalFailed += item.failed;
      totalPending += item.pending;
      totalJobs += item.total;
    });
    return { totalSuccess, totalFailed, totalPending, totalJobs };
  };

  const currentKPIs = getFilteredKPIs();
  const successRate = currentKPIs.totalJobs > 0
    ? Math.round((currentKPIs.totalSuccess / (currentKPIs.totalSuccess + currentKPIs.totalFailed || 1)) * 100)
    : 0;

  const filteredCampaigns = data.campaigns.filter(c => {
    const matchesSearch = c.campaign_id.toLowerCase().includes(campaignSearch.toLowerCase()) ||
                          c.type.toLowerCase().includes(campaignSearch.toLowerCase());
    const matchesPlatform = selectedPlatform === 'all' || c.platform === selectedPlatform;
    
    let statusText = 'running';
    const processed = c.completed_jobs + c.failed_jobs;
    if (c.campaign_id === 'SINGLE_POSTS') {
      statusText = 'single';
    } else if (processed === c.total_jobs && c.total_jobs > 0) {
      if (c.failed_jobs === c.total_jobs) statusText = 'failed';
      else statusText = 'completed';
    } else if (c.paused_jobs > 0 && c.pending_jobs === 0) {
      statusText = 'paused';
    }
    const matchesStatus = selectedStatus === 'all' || statusText === selectedStatus;
    
    return matchesSearch && matchesPlatform && matchesStatus;
  });

  const getBezierPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cp1x = p0.x + (p1.x - p0.x) * 0.35;
      const cp1y = p0.y;
      const cp2x = p1.x - (p1.x - p0.x) * 0.35;
      const cp2y = p1.y;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const getBezierArea = (points: { x: number; y: number }[], bottomY: number) => {
    if (points.length === 0) return '';
    const linePath = getBezierPath(points);
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  };

  // Line Chart Renderer (Compact height: 130px)
  const renderLineChart = () => {
    const chartWidth = 550;
    const chartHeight = 130;
    const paddingTop = 15;
    const paddingBottom = 20;
    const paddingLeft = 30;
    const paddingRight = 10;

    if (filteredDaily.length === 0) {
      return (
        <div className="empty-chart">
          Không có dữ liệu trong khoảng thời gian này
        </div>
      );
    }

    const maxVal = Math.max(
      ...filteredDaily.map(d => Math.max(d.success, d.failed)),
      5
    );
    const yMax = Math.ceil(maxVal * 1.15);

    const getX = (index: number) => {
      const usableWidth = chartWidth - paddingLeft - paddingRight;
      const count = filteredDaily.length;
      if (count <= 1) return paddingLeft + usableWidth / 2;
      return paddingLeft + (index * usableWidth) / (count - 1);
    };

    const getY = (val: number) => {
      const usableHeight = chartHeight - paddingTop - paddingBottom;
      return chartHeight - paddingBottom - (val * usableHeight) / yMax;
    };

    const successPoints = filteredDaily.map((d, i) => ({ x: getX(i), y: getY(d.success) }));
    const failedPoints = filteredDaily.map((d, i) => ({ x: getX(i), y: getY(d.failed) }));

    const successPath = getBezierPath(successPoints);
    const failedPath = getBezierPath(failedPoints);
    const successArea = getBezierArea(successPoints, chartHeight - paddingBottom);
    const failedArea = getBezierArea(failedPoints, chartHeight - paddingBottom);

    const gridYCounts = 2;
    const yGridLines = Array.from({ length: gridYCounts + 1 }, (_, i) => {
      const val = Math.round((yMax / gridYCounts) * i);
      return { val, y: getY(val) };
    });

    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="svg-chart">
          <defs>
            <linearGradient id="successGradHome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="failedGradHome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-danger)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-danger)" stopOpacity="0.0" />
            </linearGradient>

            <filter id="glow-success" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-danger" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines */}
          {yGridLines.map((line, idx) => (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={line.y}
                x2={chartWidth - paddingRight}
                y2={line.y}
                stroke="var(--border-color)"
                strokeWidth="0.8"
                strokeDasharray="4,4"
              />
              <text
                x={paddingLeft - 8}
                y={line.y + 3}
                fill="var(--text-secondary)"
                fontSize="9"
                textAnchor="end"
              >
                {line.val}
              </text>
            </g>
          ))}

          {/* Area gradients */}
          {filteredDaily.length > 1 && (
            <>
              <path d={successArea} fill="url(#successGradHome)" />
              <path d={failedArea} fill="url(#failedGradHome)" />
            </>
          )}

          {/* Glowing Bezier lines */}
          <path d={successPath} fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow-success)" />
          <path d={failedPath} fill="none" stroke="var(--color-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow-danger)" />

          {/* X axis labels */}
          {filteredDaily.map((d, i) => {
            const step = Math.max(1, Math.round(filteredDaily.length / 6));
            if (i % step !== 0 && i !== filteredDaily.length - 1) return null;

            const x = getX(i);
            const displayDate = d.date.slice(5); // MM-DD
            return (
              <text
                key={i}
                x={x}
                y={chartHeight - 6}
                fill="var(--text-secondary)"
                fontSize="9"
                textAnchor="middle"
              >
                {displayDate}
              </text>
            );
          })}

          {/* Hover line */}
          {hoveredLinePoint && (
            <line
              x1={hoveredLinePoint.x}
              y1={paddingTop}
              x2={hoveredLinePoint.x}
              y2={chartHeight - paddingBottom}
              stroke="var(--text-muted)"
              strokeWidth="0.8"
            />
          )}

          {/* Nodes and event handlers */}
          {filteredDaily.map((d, i) => {
            const x = getX(i);
            const ySuccess = getY(d.success);
            const yFailed = getY(d.failed);

            return (
              <g key={i}>
                <circle cx={x} cy={ySuccess} r="2.5" fill="var(--bg-primary)" stroke="var(--color-success)" strokeWidth="1.8" />
                <circle cx={x} cy={yFailed} r="2.5" fill="var(--bg-primary)" stroke="var(--color-danger)" strokeWidth="1.8" />
                <rect
                  x={x - 12}
                  y={paddingTop}
                  width="24"
                  height={chartHeight - paddingTop - paddingBottom}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => {
                    setHoveredLinePoint({
                      x,
                      y: (ySuccess + yFailed) / 2,
                      successY: ySuccess,
                      failedY: yFailed,
                      date: d.date,
                      success: d.success,
                      failed: d.failed,
                      total: d.total
                    });
                  }}
                  onMouseLeave={() => setHoveredLinePoint(null)}
                />
              </g>
            );
          })}
        </svg>

        {/* Line Tooltip */}
        {hoveredLinePoint && (
          <div
            className="chart-tooltip"
            style={{
              position: 'absolute',
              left: `${(hoveredLinePoint.x / chartWidth) * 100}%`,
              top: `${(Math.min(hoveredLinePoint.successY, hoveredLinePoint.failedY) / chartHeight) * 100 - 30}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="tooltip-title">{hoveredLinePoint.date}</div>
            <div className="tooltip-row success">
              <span>Thành công:</span> <strong>{hoveredLinePoint.success}</strong>
            </div>
            <div className="tooltip-row error">
              <span>Lỗi:</span> <strong>{hoveredLinePoint.failed}</strong>
            </div>
            <div className="tooltip-row total">
              <span>Tổng cộng:</span> <strong>{hoveredLinePoint.total}</strong>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Stacked Bar Chart Renderer (Compact height: 130px)
  const renderBarChart = () => {
    const chartWidth = 400;
    const chartHeight = 130;
    const paddingTop = 15;
    const paddingBottom = 20;
    const paddingLeft = 25;
    const paddingRight = 10;

    const platforms = data.platforms || [];

    if (platforms.length === 0) {
      return (
        <div className="empty-chart">
          Chưa có dữ liệu kênh mạng xã hội
        </div>
      );
    }

    const maxVal = Math.max(...platforms.map(p => p.total_jobs), 5);
    const yMax = Math.ceil(maxVal * 1.1);

    const getY = (val: number) => {
      const usableHeight = chartHeight - paddingTop - paddingBottom;
      return chartHeight - paddingBottom - (val * usableHeight) / yMax;
    };

    const barWidth = 20;
    const usableWidth = chartWidth - paddingLeft - paddingRight;
    const spacing = usableWidth / platforms.length;

    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="svg-chart">
          {/* Grid lines */}
          {Array.from({ length: 3 }, (_, i) => {
            const val = Math.round((yMax / 2) * i);
            const y = getY(val);
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="var(--border-color)"
                  strokeWidth="0.8"
                  strokeDasharray="4,4"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  fill="var(--text-secondary)"
                  fontSize="9"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {platforms.map((p, idx) => {
            const x = paddingLeft + (idx * spacing) + (spacing - barWidth) / 2;

            const successHeight = (p.success * (chartHeight - paddingTop - paddingBottom)) / yMax;
            const failedHeight = (p.failed * (chartHeight - paddingTop - paddingBottom)) / yMax;
            const pendingHeight = (p.pending * (chartHeight - paddingTop - paddingBottom)) / yMax;

            const ySuccessStart = chartHeight - paddingBottom - successHeight;
            const yFailedStart = ySuccessStart - failedHeight;
            const yPendingStart = yFailedStart - pendingHeight;

            const platformName = PLATFORM_NAMES[p.platform] || p.platform.toUpperCase();

            return (
              <g key={idx}>
                {/* Success (green) */}
                {p.success > 0 && (
                  <rect x={x} y={ySuccessStart} width={barWidth} height={successHeight} fill="var(--color-success)" opacity="0.85" rx="2" />
                )}
                {/* Failed (red) */}
                {p.failed > 0 && (
                  <rect x={x} y={yFailedStart} width={barWidth} height={failedHeight} fill="var(--color-danger)" opacity="0.85" rx="2" />
                )}
                {/* Pending (blue) */}
                {p.pending > 0 && (
                  <rect x={x} y={yPendingStart} width={barWidth} height={pendingHeight} fill="var(--color-primary)" opacity="0.6" rx="2" />
                )}

                <text
                  x={x + barWidth / 2}
                  y={chartHeight - 6}
                  fill="var(--text-secondary)"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {p.platform.toUpperCase()}
                </text>

                <rect
                  x={x}
                  y={paddingTop}
                  width={barWidth}
                  height={chartHeight - paddingTop - paddingBottom}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => {
                    setHoveredBar({
                      x: x + barWidth / 2,
                      y: Math.min(ySuccessStart, yFailedStart, yPendingStart),
                      platform: platformName,
                      success: p.success,
                      failed: p.failed,
                      pending: p.pending,
                      total: p.total_jobs
                    });
                  }}
                  onMouseLeave={() => setHoveredBar(null)}
                />
              </g>
            );
          })}
        </svg>

        {/* Bar Tooltip */}
        {hoveredBar && (
          <div
            className="chart-tooltip"
            style={{
              position: 'absolute',
              left: `${(hoveredBar.x / chartWidth) * 100}%`,
              top: `${(hoveredBar.y / chartHeight) * 100 - 30}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="tooltip-title">{hoveredBar.platform}</div>
            <div className="tooltip-row success">
              <span>Thành công:</span> <strong>{hoveredBar.success}</strong>
            </div>
            <div className="tooltip-row error">
              <span>Thất bại:</span> <strong>{hoveredBar.failed}</strong>
            </div>
            <div className="tooltip-row total">
              <span>Đang chờ:</span> <strong>{hoveredBar.pending}</strong>
            </div>
            <div className="tooltip-row total" style={{ borderTop: '1px solid var(--border-color)', marginTop: '4px', paddingTop: '4px' }}>
              <span>Tổng jobs:</span> <strong>{hoveredBar.total}</strong>
            </div>
          </div>
        )}
      </div>
    );
  };

  const { accounts, proxies, targets, recentJobs } = data.operational;

  return (
    <div className="dashboard-container">
      {/* Header and filters */}
      <div className="flex-between header-section">
        <div>
          <h2 className="title">Trung tâm Chỉ huy Hệ thống</h2>
          <p className="subtitle">Giám sát tài khoản, proxy, sản lượng bài viết và tiến độ hoạt động đa kênh.</p>
        </div>

        <div className="filter-group">
          <button
            className={`filter-btn ${timeRange === '7' ? 'active' : ''}`}
            onClick={() => setTimeRange('7')}
          >
            7 ngày
          </button>
          <button
            className={`filter-btn ${timeRange === '14' ? 'active' : ''}`}
            onClick={() => setTimeRange('14')}
          >
            14 ngày
          </button>
          <button
            className={`filter-btn ${timeRange === '30' ? 'active' : ''}`}
            onClick={() => setTimeRange('30')}
          >
            30 ngày
          </button>
          <button
            className={`filter-btn ${timeRange === 'all' ? 'active' : ''}`}
            onClick={() => setTimeRange('all')}
          >
            Tất cả
          </button>
          <button className="refresh-btn" onClick={fetchData} title="Tải lại dữ liệu">
            🔄
          </button>
        </div>
      </div>

      {/* KPI Stats Grid - 6 columns including System Status */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Tài khoản liên kết</span>
          <div className="stat-value">{accounts.total}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--color-success)' }}>Live: {accounts.live}</span> |{' '}
            <span style={{ color: 'var(--color-warning)' }}>CP: {accounts.checkpoint}</span> |{' '}
            <span style={{ color: 'var(--color-danger)' }}>Die: {accounts.die}</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-label">Proxy kết nối</span>
          <div className="stat-value">{proxies.total}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--color-success)' }}>Live: {proxies.working}</span> |{' '}
            <span>Die: {proxies.total - proxies.working}</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-label">Mục tiêu cào</span>
          <div className="stat-value">{targets.total}</div>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-primary-hover)' }}>
            Scraper tự động
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Hàng đợi công việc</span>
          <div className="stat-value text-glow-blue">{currentKPIs.totalPending}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--color-success)' }}>Xong: {currentKPIs.totalSuccess}</span> |{' '}
            <span style={{ color: 'var(--color-danger)' }}>Lỗi: {currentKPIs.totalFailed}</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-label">Tỷ lệ thành công</span>
          <div className="stat-value text-glow-green">{successRate}%</div>
          <span className="stat-sub">Độ tin cậy của phiên đăng</span>
        </div>

        {/* Restructured 6th Card: System & Worker Status */}
        <div className="stat-card">
          <span className="stat-label">Trạng thái Hệ thống</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', marginBottom: '0.15rem' }}>
            <span className="pulse-indicator" title="Worker is active"></span>
            <div className="stat-value text-glow-green" style={{ fontSize: '1.25rem', lineHeight: '1.2' }}>RUNNING</div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            SQLite WAL | <LiveClock />
          </div>
        </div>
      </div>

      {/* SVG Charts Row - Shrunk Side-by-Side Layout */}
      <div className="charts-row">
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">
            <span>Xu hướng đăng bài hàng ngày</span>
            <span className="legend-indicator">
              <span className="legend-dot green"></span>Thành công
              <span className="legend-dot red" style={{ marginLeft: '12px' }}></span>Lỗi
            </span>
          </div>
          <div className="chart-wrapper">
            {renderLineChart()}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">
            <span>Hiệu suất theo Nền tảng</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
              (Thành công / Lỗi / Chờ)
            </span>
          </div>
          <div className="chart-wrapper">
            {renderBarChart()}
          </div>
        </div>
      </div>

      {/* Campaign Progress & Real-time Logs - Symmetrical Layout */}
      <div className="responsive-grid-split tables-row">
        
        {/* Left Column: Campaign Progress Table */}
        <div className="card" style={{ marginBottom: 0, flex: 1.4 }}>
          <div className="flex-between card-header-action" style={{ marginBottom: '0.75rem' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Tiến độ Chiến dịch Marketing
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {/* Search with 🔍 icon */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '7px', color: 'var(--text-secondary)', fontSize: '0.7rem', pointerEvents: 'none' }}>
                  🔍
                </span>
                <input
                  type="text"
                  placeholder="Tìm tên/loại..."
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  className="search-input"
                />
              </div>

              {/* Platform Filter Dropdown */}
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="filter-select"
              >
                <option value="all">Mọi Kênh</option>
                <option value="x">Kênh X</option>
                <option value="threads">Kênh Threads</option>
                <option value="zalo">Kênh Zalo</option>
                <option value="telegram">Kênh Telegram</option>
              </select>

              {/* Status Filter Dropdown */}
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="filter-select"
              >
                <option value="all">Mọi Trạng thái</option>
                <option value="completed">Hoàn thành</option>
                <option value="running">Đang chạy</option>
                <option value="paused">Tạm dừng</option>
                <option value="failed">Thất bại</option>
                <option value="single">Bài đăng đơn</option>
              </select>
            </div>
          </div>

          {filteredCampaigns.length === 0 ? (
            <div className="empty-state">
              Không tìm thấy chiến dịch nào tương thích.
            </div>
          ) : (
            <div className="table-container max-height-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mã chiến dịch</th>
                    <th>Platform</th>
                    <th>Bài đăng (Chi tiết)</th>
                    <th>Tiến trình</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((camp) => {
                    const success = camp.completed_jobs;
                    const failed = camp.failed_jobs;
                    const total = camp.total_jobs;
                    const processed = success + failed;
                    const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
                    const successPct = total > 0 ? (success / total) * 100 : 0;
                    const failedPct = total > 0 ? (failed / total) * 100 : 0;

                    let statusBadge = 'badge-unknown';
                    let statusText = 'Đang chạy';
                    if (camp.campaign_id === 'SINGLE_POSTS') {
                      statusText = 'Bài đăng đơn';
                      statusBadge = 'badge-unknown';
                    } else if (processed === total && total > 0) {
                      if (failed === total) {
                        statusText = 'Thất bại';
                        statusBadge = 'badge-die';
                      } else {
                        statusText = 'Hoàn thành';
                        statusBadge = 'badge-live';
                      }
                    } else if (camp.paused_jobs > 0 && camp.pending_jobs === 0) {
                      statusText = 'Tạm dừng';
                      statusBadge = 'badge-checkpoint';
                    }

                    const pColor = PLATFORM_COLORS[camp.platform] || 'var(--text-secondary)';

                    return (
                      <tr key={`${camp.campaign_id}_${camp.type}_${camp.platform}`}>
                        <td>
                          <strong style={{ fontSize: '0.8rem' }}>
                            {camp.campaign_id === 'SINGLE_POSTS' ? 'Đăng đơn lẻ' : camp.campaign_id}
                          </strong>
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              border: `1px solid ${pColor}`,
                              color: pColor,
                              backgroundColor: 'transparent',
                              textTransform: 'uppercase',
                              fontSize: '0.65rem',
                              padding: '0.1rem 0.3rem'
                            }}
                          >
                            {camp.platform}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className="count-badge count-success" title="Bài đăng thành công">
                              ✓ {success}
                            </span>
                            <span className={`count-badge ${failed > 0 ? 'count-danger' : 'count-muted'}`} title="Bài đăng bị lỗi">
                              ✗ {failed}
                            </span>
                            <span className="count-badge count-info" title="Tổng số bài đăng">
                              ∑ {total}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', width: '90px' }}>
                            <div className="progress-bar-bg">
                              <div className="progress-bar-fill green" style={{ width: `${successPct}%` }} />
                              <div className="progress-bar-fill red" style={{ width: `${failedPct}%` }} />
                            </div>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                              {progressPct}% ({processed}/{total})
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${statusBadge}`} style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>{statusText}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Recent Jobs Table (matching Campaigns height for absolute symmetry) */}
        <div className="card" style={{ marginBottom: 0, flex: 1 }}>
          <div className="card-title" style={{ marginBottom: '0.75rem' }}>Tác vụ vừa chạy</div>
          {recentJobs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Hàng đợi chưa có công việc nào.
            </div>
          ) : (
            <div className="table-container max-height-table">
              <table className="table" style={{ fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Tác vụ</th>
                    <th>Nội dung / Target</th>
                    <th>Thời gian</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => {
                    let badgeClass = 'badge-unknown';
                    if (job.status === 'completed') badgeClass = 'badge-live';
                    else if (job.status === 'failed') badgeClass = 'badge-die';
                    else if (job.status === 'processing') badgeClass = 'badge-checkpoint';

                    // Format Job type nicely
                    let typeLabel = job.type.toUpperCase();
                    let typeClass = 'count-muted';
                    if (job.type.includes('post')) {
                      typeLabel = 'POST';
                      typeClass = 'count-info';
                    } else if (job.type.includes('comment')) {
                      typeLabel = 'COMMENT';
                      typeClass = 'count-success';
                    } else if (job.type.includes('message')) {
                      typeLabel = 'MSG';
                      typeClass = 'count-success';
                    }

                    // Format execution time
                    const jobTime = job.run_at
                      ? new Date(job.run_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : job.scheduled_at
                      ? new Date(job.scheduled_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '-';

                    return (
                      <tr key={job.id}>
                        <td>
                          <strong>{job.username || 'System'}</strong>
                          {job.platform && (
                            <span className="badge" style={{ fontSize: '0.55rem', padding: '0rem 0.2rem', marginLeft: '0.25rem', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                              {job.platform}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`count-badge ${typeClass}`} style={{ fontSize: '0.65rem', padding: '0.05rem 0.25rem' }}>
                            {typeLabel}
                          </span>
                        </td>
                        <td style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.type === 'comment' || job.type.endsWith('_comment') ? (
                            <span style={{ color: 'var(--color-primary-hover)' }}>{job.target_url}</span>
                          ) : (
                            job.post_content
                          )}
                        </td>
                        <td style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                          {jobTime}
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem' }}>{job.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Enhanced Styles for Compact Dashboard Layout */}
      <style jsx global>{`
        .dashboard-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding-bottom: 1rem;
          overflow-y: auto;
          height: 100%;
        }

        .header-section {
          margin-bottom: 0rem;
        }

        .title {
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 0.8rem;
          margin-top: 0.15rem;
        }

        /* Glassmorphic card styling is now standard in globals.css */
        .card-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }

        /* Filter buttons styling */
        .filter-group {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          padding: 0.15rem;
          border-radius: 6px;
        }

        .filter-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 0.25rem 0.55rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.7rem;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .filter-btn:hover {
          color: var(--text-primary);
          background-color: var(--bg-tertiary);
        }

        .filter-btn.active {
          color: var(--text-primary);
          background-color: var(--color-primary);
          box-shadow: 0 2px 6px rgba(47, 129, 247, 0.35);
        }

        .refresh-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0.25rem;
          border-radius: 4px;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease;
        }

        .refresh-btn:hover {
          transform: rotate(30deg);
          background-color: var(--bg-tertiary);
        }

        /* Charts Row: side-by-side on desktop, stacked on mobile */
        .charts-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
        }

        @media (min-width: 992px) {
          .charts-row {
            grid-template-columns: 1fr 1fr;
          }
        }

        .chart-wrapper {
          padding-top: 0.25rem;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 130px;
        }

        .svg-chart {
          width: 100%;
          height: auto;
          overflow: visible;
        }

        .empty-chart {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          font-size: 0.75rem;
          height: 110px;
          width: 100%;
          border: 1px dashed var(--border-color);
          border-radius: 6px;
        }

        .legend-indicator {
          display: flex;
          align-items: center;
          font-size: 0.65rem;
          font-weight: normal;
          color: var(--text-secondary);
        }

        .legend-dot {
          display: inline-block;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          margin-right: 3px;
        }

        .legend-dot.green { background-color: var(--color-success); }
        .legend-dot.red { background-color: var(--color-danger); }

        .chart-tooltip {
          background-color: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          padding: 5px 8px;
          border-radius: 6px;
          font-size: 9px;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(8px);
          z-index: 10;
          min-width: 90px;
        }

        .tooltip-title {
          font-weight: bold;
          margin-bottom: 2px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 1px;
        }

        .tooltip-row {
          display: flex;
          justify-content: space-between;
          margin: 1px 0;
        }

        .tooltip-row.success { color: var(--color-success); }
        .tooltip-row.error { color: var(--color-danger); }
        .tooltip-row.total { color: var(--text-secondary); }

        /* Campaign Search styling */
        .card-header-action {
          align-items: center;
          gap: 1rem;
        }

        .search-box {
          position: relative;
        }

        .search-input {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 0.25rem 0.5rem 0.25rem 1.4rem;
          border-radius: 5px;
          font-size: 0.7rem;
          width: 110px;
          outline: none;
          transition: all 0.2s ease;
        }

        .search-input:focus {
          border-color: var(--color-primary);
          width: 140px;
        }

        .filter-select {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 0.25rem 0.4rem;
          border-radius: 5px;
          font-size: 0.7rem;
          outline: none;
          cursor: pointer;
          transition: border-color 0.2s ease;
        }

        .filter-select:focus {
          border-color: var(--color-primary);
        }

        .empty-state {
          padding: 1.5rem;
          text-align: center;
          color: var(--text-secondary);
          font-size: 0.75rem;
          border: 1px dashed var(--border-color);
          border-radius: 6px;
        }

        /* Constrained Heights for Tables to prevent page scroll */
        .max-height-table {
          max-height: 165px;
          overflow-y: auto;
        }

        /* Borderless table styling */
        .table {
          border-collapse: collapse;
          width: 100%;
        }

        .table th {
          border-bottom: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 6px 8px;
          text-align: left;
        }

        .table td {
          border-bottom: 1px solid var(--border-subtle);
          padding: 8px;
          vertical-align: middle;
        }

        .table tr:hover td {
          background-color: rgba(139, 148, 158, 0.03);
        }

        /* Compact labeled counts */
        .count-badge {
          display: inline-flex;
          align-items: center;
          font-size: 0.65rem;
          font-weight: 600;
          padding: 0.1rem 0.3rem;
          border-radius: 3px;
          gap: 0.1rem;
          white-space: nowrap;
        }

        .count-success {
          background-color: rgba(63, 185, 80, 0.1);
          color: var(--color-success);
          border: 1px solid rgba(63, 185, 80, 0.2);
        }

        .count-danger {
          background-color: rgba(248, 81, 73, 0.1);
          color: var(--color-danger);
          border: 1px solid rgba(248, 81, 73, 0.2);
        }

        .count-muted {
          background-color: rgba(139, 148, 158, 0.05);
          color: var(--text-secondary);
          border: 1px solid rgba(139, 148, 158, 0.12);
        }

        .count-info {
          background-color: rgba(47, 129, 247, 0.06);
          color: var(--color-primary-hover);
          border: 1px solid rgba(47, 129, 247, 0.18);
        }

        /* Progress bars styling */
        .progress-bar-bg {
          height: 4px;
          background-color: rgba(139, 148, 158, 0.1);
          border-radius: 2px;
          overflow: hidden;
          display: flex;
          width: 100%;
        }

        .progress-bar-fill {
          height: 100%;
        }

        .progress-bar-fill.green {
          background-color: var(--color-success);
        }

        .progress-bar-fill.red {
          background-color: var(--color-danger);
        }

        /* Pulsing indicator for active worker status */
        .pulse-indicator {
          width: 6px;
          height: 6px;
          background-color: var(--color-success);
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
          animation: pulse 1.6s infinite;
          display: inline-block;
        }

        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 4px rgba(63, 185, 80, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0);
          }
        }

        @media (max-width: 768px) {
          .header-section {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }
          .filter-group {
            width: 100%;
            justify-content: space-between;
          }
          .search-input {
            width: 100%;
          }
          .search-input:focus {
            width: 100%;
          }
          .card-header-action {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>
    </div>
  );
}

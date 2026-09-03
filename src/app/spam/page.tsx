'use client';

import { useState, useEffect, useRef } from 'react';
import { PLATFORMS_MAP } from '@/config/platforms';
import { DURATION_PRESETS, getPlatformSafetyRule } from '@/config/platform-safety';
import { estimateCampaignResources, CampaignEstimationResult } from '@/lib/campaign-estimator';
import ScrapeDrawer from '@/components/spam/ScrapeDrawer';
import LeadManagerStep from '@/components/spam/LeadManagerStep';
import TemplateMatrixStep from '@/components/spam/TemplateMatrixStep';
import AccountBalancerStep from '@/components/spam/AccountBalancerStep';
import MonitoringDashboard from '@/components/spam/MonitoringDashboard';
import LiveWatcherTab from '@/components/spam/LiveWatcherTab';

interface ScrapeTarget {
  id: number;
  type: string;
  value: string;
  status: string;
  platform?: string;
  template_id?: number | null;
  keyword_filter?: string | null;
}

interface SpamTemplate {
  id: number;
  name: string;
  content: string;
}

interface Job {
  id: number;
  username: string | null;
  type: string;
  target_url: string | null;
  post_content: string | null;
  run_at: string | null;
  status: string;
  error_log: string | null;
  campaign_id?: string | null;
  scheduled_at?: string | null;
  platform?: string | null;
}

// Spintax helper function
function parseSpintax(text: string): string {
  const spintaxPattern = /\{([^{}]+)\}/g;
  let matches = spintaxPattern.exec(text);
  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    spintaxPattern.lastIndex = 0;
    matches = spintaxPattern.exec(text);
  }
  return text;
}

function detectPlatformFromUrl(inputUrl: string) {
  const url = inputUrl.trim();
  if (!url.startsWith('http') && !url.includes('.')) return null;

  try {
    const urlWithProto = url.startsWith('http') ? url : 'https://' + url;
    const parsed = new URL(urlWithProto);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
      const match = pathname.match(/^\/([a-zA-Z0-9_]{1,15})(?:\/|$)/);
      if (match && !['home', 'search', 'explore', 'notifications', 'messages', 'i'].includes(match[1])) {
        return { platform: 'x', type: 'username', value: '@' + match[1] };
      }
      return { platform: 'x', type: 'username', value: url };
    }
    
    if (hostname.includes('newf319.com')) {
      const match = pathname.match(/\/forums\/([^\/]+)/);
      if (match) {
        return { platform: 'newf319', type: 'category', value: match[1] };
      }
      return { platform: 'newf319', type: 'category', value: url };
    }

    if (hostname.includes('t.me')) {
      return { platform: 'telegram', type: 'channel_group', value: url };
    }

    if (hostname.includes('wa.me') || hostname.includes('whatsapp.com')) {
      if (hostname.includes('chat.whatsapp.com') || pathname.includes('/chat.whatsapp.com')) {
        return { platform: 'whatsapp', type: 'group_link', value: url };
      }
      return { platform: 'whatsapp', type: 'phone', value: url };
    }

    if (hostname.includes('zalo.me')) {
      return { platform: 'zalo', type: 'group_link', value: url };
    }

    if (hostname.includes('facebook.com')) {
      if (pathname.includes('/groups/')) {
        return { platform: 'facebook', type: 'group', value: url };
      }
      return { platform: 'facebook', type: 'page', value: url };
    }

    if (hostname.includes('instagram.com')) {
      const match = pathname.match(/^\/([a-zA-Z0-9_\.]{1,30})(?:\/|$)/);
      if (match && !['explore', 'direct', 'stories'].includes(match[1])) {
        return { platform: 'instagram', type: 'username', value: '@' + match[1] };
      }
      return { platform: 'instagram', type: 'username', value: url };
    }

    if (hostname.includes('tiktok.com')) {
      const match = pathname.match(/^\/(@[a-zA-Z0-9_\.]{1,30})(?:\/|$)/);
      if (match) {
        return { platform: 'tiktok', type: 'username', value: match[1] };
      }
      return { platform: 'tiktok', type: 'username', value: url };
    }

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return { platform: 'youtube', type: 'channel', value: url };
    }
  } catch (e) {
    // Ignore URL parse errors
  }
  return null;
}

const PLATFORM_ACTIONS: Record<string, Array<{ value: string; label: string; desc: string }>> = {
  facebook: [
    { value: 'comment', label: '💬 Bình luận Seeding', desc: 'Bình luận lên các bài đăng mục tiêu (Post URLs)' },
    { value: 'message', label: '✉️ Gửi tin nhắn Inbox', desc: 'Gửi tin nhắn trực tiếp đến các trang cá nhân/UID mục tiêu' }
  ],
  x: [
    { value: 'comment', label: '💬 Bình luận Seeding', desc: 'Bình luận lên các tweet mục tiêu (Tweet URLs)' }
  ],
  threads: [
    { value: 'comment', label: '💬 Bình luận Seeding', desc: 'Bình luận (Reply) dưới các bài đăng Threads mục tiêu' },
    { value: 'post', label: '📢 Tag Nhắc tên', desc: 'Đăng bài mới trên trang chủ Threads và nhắc tên các tài khoản mục tiêu (Usernames)' }
  ],
  newf319: [
    { value: 'comment', label: '💬 Bình luận trả lời chủ đề', desc: 'Gửi bài viết trả lời (comment thread) dưới chủ đề mục tiêu' },
    { value: 'post', label: '📝 Đăng bài viết mới', desc: 'Tạo chủ đề thảo luận mới trong chuyên mục diễn đàn mục tiêu' }
  ],
  zalo: [
    { value: 'message', label: '✉️ Nhắn tin Zalo', desc: 'Tự động kết bạn và gửi tin nhắn đến số điện thoại mục tiêu' }
  ],
  whatsapp: [
    { value: 'message', label: '✉️ Nhắn tin WhatsApp 1-1', desc: 'Gửi tin nhắn trực tiếp đến danh sách số điện thoại mục tiêu' },
    { value: 'group_post', label: '📢 Gửi tin nhắn vào Nhóm WhatsApp', desc: 'Đăng bài và gửi thông báo vào các nhóm WhatsApp mục tiêu' }
  ],
  telegram: [
    { value: 'message', label: '✉️ Nhắn tin/Gửi bài Telegram', desc: 'Gửi tin nhắn riêng đến Username hoặc đăng bài vào các Nhóm Telegram mục tiêu' }
  ],
  instagram: [
    { value: 'comment', label: '💬 Bình luận Seeding (Mock)', desc: 'Thử nghiệm viết bình luận trên các bài đăng Instagram' }
  ],
  tiktok: [
    { value: 'comment', label: '💬 Bình luận Seeding (Mock)', desc: 'Thử nghiệm viết bình luận dưới video TikTok chỉ định' }
  ],
  youtube: [
    { value: 'comment', label: '💬 Bình luận Seeding (Mock)', desc: 'Thử nghiệm viết bình luận dưới video YouTube chỉ định' }
  ]
};

const getMatchingLeads = (allLeads: any[], platform: string, action: string, status?: string) => {
  return allLeads.filter(l => {
    if (l.platform !== platform) return false;
    if (status && l.status !== status) return false;
    
    const val = l.value || '';
    if (platform === 'facebook') {
      const isPostUrl = val.includes('/posts/') || 
                        val.includes('/permalink') || 
                        val.includes('/photos/') || 
                        val.includes('/videos/') || 
                        val.includes('pfbid') ||
                        val.includes('share/p/') ||
                        val.includes('share/v/') ||
                        val.includes('share/r/') ||
                        val.includes('/share/') ||
                        val.includes('/watch') ||
                        val.includes('fbid=');
      if (action === 'comment') return isPostUrl;
      if (action === 'message') return !isPostUrl;
    }
    if (platform === 'threads') {
      const isPostUrl = val.includes('/post/');
      if (action === 'comment') return isPostUrl;
      if (action === 'post') return !isPostUrl;
    }
    if (platform === 'newf319') {
      const isPostUrl = val.includes('/threads/') || val.includes('t=');
      if (action === 'comment') return isPostUrl;
      if (action === 'post') return !isPostUrl;
    }
    return true;
  });
};

export default function SpamPage() {
  const [mainTab, setMainTab] = useState<'outreach' | 'watcher'>('outreach');

  const [targets, setTargets] = useState<ScrapeTarget[]>([]);
  const [templates, setTemplates] = useState<SpamTemplate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedAccountIdFilter, setSelectedAccountIdFilter] = useState<string>('all');
  const [leads, setLeads] = useState<any[]>([]);

  // Form states for Scrape Targets
  const [targetType, setTargetType] = useState<string>('username');
  const [targetPlatform, setTargetPlatform] = useState('x');
  const [targetValue, setTargetValue] = useState('');
  const [isBulkMode, setIsBulkMode] = useState<boolean>(false);
  const [bulkTargetText, setBulkTargetText] = useState<string>('');
  const [rawLeads, setRawLeads] = useState('');
  const [showActiveTargetsOnly, setShowActiveTargetsOnly] = useState(true);

  // Target Mode for Step 1
  const [targetMode, setTargetMode] = useState<'crm' | 'quick'>('crm');
  const [quickLeadText, setQuickLeadText] = useState('');

  // Campaign Launcher states
  const [accounts, setAccounts] = useState<any[]>([]);
  const [campPlatform, setCampPlatform] = useState('facebook');
  const [campAction, setCampAction] = useState('comment');
  const [campSelectedAccs, setCampSelectedAccs] = useState<number[]>([]);
  const [campSelectedTemplates, setCampSelectedTemplates] = useState<number[]>([]);
  const [campNumLeads, setCampNumLeads] = useState('5');
  const [campScheduledStart, setCampScheduledStart] = useState('');
  const [safetyLevel, setSafetyLevel] = useState<'safe' | 'balanced' | 'fast'>('safe');
  const [desiredDuration, setDesiredDuration] = useState<string>('12h');
  const [customDurationMinutes, setCustomDurationMinutes] = useState<number>(720);
  const [showRiskModal, setShowRiskModal] = useState<boolean>(false);
  const [pendingEstimation, setPendingEstimation] = useState<CampaignEstimationResult | null>(null);

  const [crawlerLogs, setCrawlerLogs] = useState<any[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<'campaigns' | 'jobs' | 'crawler'>('campaigns');
  const [isScrapeDrawerOpen, setIsScrapeDrawerOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [accSearch, setAccSearch] = useState<string>('');
  const [previewTemplate, setPreviewTemplate] = useState<any | null>(null);
  const [previewParsedText, setPreviewParsedText] = useState<string>('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const isInitializedRef = useRef(false);

  // Status state
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!isInitializedRef.current && leads.length > 0) {
      const pendingIds = leads.filter(l => l.status === 'pending').map(l => l.id);
      setSelectedLeadIds(new Set(pendingIds));
      isInitializedRef.current = true;
    }
  }, [leads]);

  const handleToggleSelectLead = (id: number) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllOnPage = (paginatedLeads: any[]) => {
    const pendingOnPage = paginatedLeads.filter(l => l.status === 'pending');
    if (pendingOnPage.length === 0) return;
    const allChecked = pendingOnPage.every(l => selectedLeadIds.has(l.id));
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (allChecked) {
        pendingOnPage.forEach(l => next.delete(l.id));
      } else {
        pendingOnPage.forEach(l => next.add(l.id));
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: any[]) => {
    const pendingIds = filteredList.filter(l => l.status === 'pending').map(l => l.id);
    setSelectedLeadIds(new Set(pendingIds));
  };

  const handleDeselectAll = () => {
    setSelectedLeadIds(new Set());
  };

  const handleSelectCollection = (sourceTag: string) => {
    const targetLeads = sourceTag
      ? leads.filter(l => l.source === sourceTag && l.status === 'pending')
      : leads.filter(l => l.status === 'pending');
    setSelectedLeadIds(new Set(targetLeads.map(l => l.id)));
  };

  const fetchLeads = async () => {
    try {
      const res = await fetch('/api/spam/leads');
      const data = await res.json();
      if (data.success) {
        setLeads(data.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchData = async () => {
    try {
      const resTargets = await fetch('/api/spam/targets');
      const dataTargets = await resTargets.json();
      if (dataTargets.success) setTargets(dataTargets.data);

      await Promise.allSettled([
        (async () => {
          const resTemplates = await fetch('/api/spam/templates');
          const dataTemplates = await resTemplates.json();
          if (dataTemplates.success) setTemplates(dataTemplates.data);
        })(),
        (async () => {
          const resJobs = await fetch('/api/jobs');
          const dataJobs = await resJobs.json();
          if (dataJobs.success) setJobs(dataJobs.data);
        })(),
        (async () => {
          const resCamps = await fetch('/api/spam/campaign');
          const dataCamps = await resCamps.json();
          if (dataCamps.success) setCampaigns(dataCamps.data);
        })(),
        (async () => {
          const resAccs = await fetch('/api/accounts');
          const dataAccs = await resAccs.json();
          if (dataAccs.success && Array.isArray(dataAccs.data)) {
            setAccounts(dataAccs.data.filter((a: any) => {
              const stat = (a.status || '').toLowerCase().trim();
              return stat === 'live' || stat === 'ready' || stat === 'active';
            }));
          }
        })(),
        fetchLeads(),
        (async () => {
          const resLogs = await fetch('/api/spam/crawler-logs');
          const dataLogs = await resLogs.json();
          if (dataLogs.success) setCrawlerLogs(dataLogs.data);
        })()
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCampaignAction = async (campaignId: string, action: 'pause' | 'resume' | 'cancel' | 'delete', accountId?: number) => {
    try {
      setLoading(true);
      const res = await fetch('/api/spam/campaign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, action, accountId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleJobAction = async (id: number | number[], action: 'pause' | 'resume' | 'run_now' | 'delete') => {
    try {
      setLoading(true);
      const isBulk = Array.isArray(id);
      const payload = isBulk ? { ids: id, action } : { id, action };

      if (action === 'delete') {
        const res = await fetch('/api/jobs', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success) {
          setMessage({ text: data.message, type: 'success' });
          fetchData();
        } else {
          setMessage({ text: data.error, type: 'error' });
        }
      } else {
        const res = await fetch('/api/jobs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success) {
          setMessage({ text: data.message, type: 'success' });
          fetchData();
        } else {
          setMessage({ text: data.error, type: 'error' });
        }
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformChange = (platformKey: string) => {
    setTargetPlatform(platformKey);
    const config = PLATFORMS_MAP[platformKey];
    if (config && config.targetTypes.length > 0) {
      setTargetType(config.targetTypes[0].value);
    }
  };

  const handleTargetValuePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    const detected = detectPlatformFromUrl(pastedText);
    if (detected) {
      e.preventDefault();
      setTargetPlatform(detected.platform);
      setTargetType(detected.type);
      setTargetValue(detected.value);
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      let payload: any = null;

      if (isBulkMode) {
        if (!bulkTargetText.trim()) {
          setLoading(false);
          return;
        }
        const lines = bulkTargetText.split('\n').map(l => l.trim()).filter(Boolean);
        const targetsPayload = lines.map(line => {
          const detected = detectPlatformFromUrl(line);
          if (detected) return detected;
          
          const platform = targetPlatform;
          const config = PLATFORMS_MAP[platform];
          const type = config ? config.targetTypes[0].value : 'username';
          let val = line;
          
          const typeConfig = config ? config.targetTypes.find((t: any) => t.value === type) : null;
          if (typeConfig) {
            if (typeConfig.prefixBehavior === 'username' && !val.startsWith('@')) {
              val = '@' + val;
            } else if (typeConfig.prefixBehavior === 'hashtag' && !val.startsWith('#')) {
              val = '#' + val;
            }
          }
          return { platform, type, value: val };
        });

        payload = targetsPayload;
      } else {
        if (!targetValue.trim()) {
          setLoading(false);
          return;
        }

        let cleanVal = targetValue.trim();
        const config = PLATFORMS_MAP[targetPlatform];
        const typeConfig = config ? config.targetTypes.find((t: any) => t.value === targetType) : null;
        if (typeConfig) {
          if (typeConfig.prefixBehavior === 'username' && !cleanVal.startsWith('@')) {
            cleanVal = '@' + cleanVal;
          } else if (typeConfig.prefixBehavior === 'hashtag' && !cleanVal.startsWith('#')) {
            cleanVal = '#' + cleanVal;
          }
        }

        payload = { type: targetType, value: cleanVal, platform: targetPlatform };
      }

      const res = await fetch('/api/spam/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        if (isBulkMode) {
          setBulkTargetText('');
        } else {
          setTargetValue('');
        }
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa nguồn theo dõi bài viết này?')) return;
    try {
      const res = await fetch('/api/spam/targets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTargetAction = async (id: number, action: 'pause' | 'resume') => {
    try {
      setLoading(true);
      const res = await fetch('/api/spam/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchData();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportLeads = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawLeads.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/spam/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawLeads })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        setRawLeads('');
        fetchLeads();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const uploadLeadFile = async (file: File) => {
    if (!file) return;
    setLoading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/spam/leads', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchLeads();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLead = async (id: number) => {
    try {
      const res = await fetch('/api/spam/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        fetchLeads();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAllLeads = async (all: boolean) => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách target?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/spam/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: 'Đã xóa sạch danh sách target.', type: 'success' });
        fetchLeads();
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleResetLeads = async (all: boolean, ids?: number[]) => {
    if (all && !confirm('Bạn có chắc chắn muốn đặt lại trạng thái của tất cả các Leads về "Chờ gửi"?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/spam/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all, ids })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        fetchLeads();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleClearCrawlerLogs = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ nhật ký cào bài viết?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/spam/crawler-logs', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setCrawlerLogs([]);
        setMessage({ text: data.message, type: 'success' });
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (campSelectedAccs.length === 0) {
      setMessage({ text: 'Vui lòng chọn ít nhất 1 tài khoản gửi.', type: 'error' });
      return;
    }
    if (campSelectedTemplates.length === 0) {
      setMessage({ text: 'Vui lòng chọn ít nhất 1 kịch bản mẫu.', type: 'error' });
      return;
    }

    // Compute effective number of leads & desired duration
    const targetPlatform = campPlatform === 'messenger' ? 'facebook' : campPlatform;
    const selectedManualCount = leads.filter(l => selectedLeadIds.has(l.id) && (l.platform === targetPlatform || (targetPlatform === 'facebook' && l.platform === 'social')) && l.status === 'pending').length;
    const effectiveLeadsCount = targetMode === 'quick' 
      ? quickLeadText.split('\n').filter(Boolean).length 
      : (selectedManualCount > 0 ? selectedManualCount : (parseInt(campNumLeads, 10) || 0));

    let durationMins = 720;
    if (desiredDuration === 'custom') {
      durationMins = customDurationMinutes > 0 ? customDurationMinutes : 60;
    } else {
      const preset = DURATION_PRESETS.find(p => p.value === desiredDuration);
      durationMins = preset ? preset.minutes : 720;
    }

    // Evaluate risk
    const estimation = estimateCampaignResources({
      platform: campPlatform,
      action: campAction,
      numLeads: effectiveLeadsCount,
      desiredDurationMinutes: durationMins,
      safetyLevel,
      selectedAccsCount: campSelectedAccs.length,
      scheduledStart: campScheduledStart
    });

    // If high risk, interrupt with confirmation modal
    if (estimation.riskLevel === 'high_risk') {
      setPendingEstimation(estimation);
      setShowRiskModal(true);
      return;
    }

    await executeLaunchCampaign(durationMins);
  };

  const executeLaunchCampaign = async (durationMinsOverride?: number) => {
    setShowRiskModal(false);
    setLoading(true);
    setMessage(null);

    let durationMins = durationMinsOverride;
    if (!durationMins) {
      if (desiredDuration === 'custom') {
        durationMins = customDurationMinutes > 0 ? customDurationMinutes : 60;
      } else {
        const preset = DURATION_PRESETS.find(p => p.value === desiredDuration);
        durationMins = preset ? preset.minutes : 720;
      }
    }

    try {
      // Filter active lead IDs to ensure only leads matching the selected platform are passed
      const targetPlatform = campPlatform === 'messenger' ? 'facebook' : campPlatform;
      let activeLeadIds = Array.from(selectedLeadIds).filter(id => {
        return leads.some(l => l.id === id && (l.platform === targetPlatform || (targetPlatform === 'facebook' && l.platform === 'social')) && l.status === 'pending');
      });

      if (targetMode === 'quick') {
        if (!quickLeadText.trim()) {
          setMessage({ text: 'Vui lòng nhập danh sách mục tiêu tức thì.', type: 'error' });
          setLoading(false);
          return;
        }
        const importRes = await fetch('/api/spam/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: quickLeadText, source: 'Quick_Input_Adhoc' })
        });
        const importData = await importRes.json();
        if (importData.success) {
          await fetchLeads();
        }
      }

      const res = await fetch('/api/spam/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: campPlatform,
          campaignType: campAction,
          accountIds: campSelectedAccs,
          templateIds: campSelectedTemplates,
          numLeads: parseInt(campNumLeads, 10),
          leadIds: activeLeadIds.length > 0 ? activeLeadIds : undefined,
          scheduledStart: campScheduledStart ? new Date(campScheduledStart).toISOString() : undefined,
          desiredDurationMinutes: durationMins,
          safetyLevel
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        setCampSelectedAccs([]);
        setCampSelectedTemplates([]);
        setCampNumLeads('5');
        setCampScheduledStart('');
        setQuickLeadText('');
        setSelectedLeadIds(new Set());
        fetchData();
        setCurrentStep(1);
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="spam-page-container wizard-content-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Page Header & Main Tab Bar */}
      <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🤖 Trung tâm Vận hành Spam & Seeding
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>
              Quản lý chiến dịch Seeding chủ động và thiết lập Canh Bài mới tự động từ KOLs / Forum
            </p>
          </div>
        </div>

        {/* 2 Main Top Tabs */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="button"
            onClick={() => setMainTab('outreach')}
            style={{
              padding: '0.75rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainTab === 'outreach' ? 'var(--color-primary-hover)' : 'rgba(255,255,255,0.04)',
              color: mainTab === 'outreach' ? '#fff' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease'
            }}
          >
            🚀 1. Chiến dịch Seeding Chủ động (Outreach)
          </button>
          <button
            type="button"
            onClick={() => setMainTab('watcher')}
            style={{
              padding: '0.75rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainTab === 'watcher' ? 'var(--color-primary-hover)' : 'rgba(255,255,255,0.04)',
              color: mainTab === 'watcher' ? '#fff' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease'
            }}
          >
            📡 2. Nguồn Theo dõi & Seeding Bài viết Mới (Live Watcher)
          </button>
        </div>
      </div>

      {/* Alerts */}
      {message && (
        <div 
          className="card alert-card" 
          style={{ 
            padding: '1rem', 
            backgroundColor: message.type === 'success' ? 'rgba(63, 185, 80, 0.15)' : 'rgba(248, 81, 73, 0.15)',
            borderColor: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ border: 'none', background: 'none', color: 'currentColor', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* MAIN TAB 1: OUTREACH CAMPAIGNS */}
      {mainTab === 'outreach' ? (
        <>
          {/* Progress Stepper */}
          <div className="wizard-stepper">
            <div className={"wizard-step " + (currentStep === 1 ? "active" : "") + (currentStep > 1 ? " completed" : "")}>
              <span className="wizard-step-num">{currentStep > 1 ? "✓" : "1"}</span>
              <span>1. Chọn Nguồn Mục tiêu (Dual Mode)</span>
            </div>
            <div className={"wizard-stepper-line " + (currentStep > 1 ? "active" : "")} />
            <div className={"wizard-step " + (currentStep === 2 ? "active" : "") + (currentStep > 2 ? " completed" : "")}>
              <span className="wizard-step-num">{currentStep > 2 ? "✓" : "2"}</span>
              <span>2. Ma trận Kịch bản (Spintax Matrix)</span>
            </div>
            <div className={"wizard-stepper-line " + (currentStep > 2 ? "active" : "")} />
            <div className={"wizard-step " + (currentStep === 3 ? "active" : "") + (currentStep > 3 ? " completed" : "")}>
              <span className="wizard-step-num">{currentStep > 3 ? "✓" : "3"}</span>
              <span>3. Phân bổ & Giãn cách (Load Balancer)</span>
            </div>
            <div className={"wizard-stepper-line " + (currentStep > 3 ? "active" : "")} />
            <div className={"wizard-step " + (currentStep === 4 ? "active" : "")}>
              <span className="wizard-step-num">4</span>
              <span>4. Tóm tắt & Bắt đầu</span>
            </div>
          </div>

          {/* Wizard Step Content */}
          <div className="wizard-step-container">
            {currentStep === 1 && (
              <LeadManagerStep
                leads={leads}
                selectedLeadIds={selectedLeadIds}
                onToggleSelectLead={handleToggleSelectLead}
                onToggleSelectAllOnPage={handleToggleSelectAllOnPage}
                onSelectAllFiltered={handleSelectAllFiltered}
                onDeselectAll={handleDeselectAll}
                onResetLeads={handleResetLeads}
                onDeleteLead={handleDeleteLead}
                onClearAllLeads={handleClearAllLeads}
                onImportLeads={handleImportLeads}
                uploadLeadFile={uploadLeadFile}
                rawLeads={rawLeads}
                setRawLeads={setRawLeads}
                loading={loading}
                onOpenScrapeDrawer={() => setIsScrapeDrawerOpen(true)}
                targetMode={targetMode}
                setTargetMode={setTargetMode}
                quickLeadText={quickLeadText}
                setQuickLeadText={setQuickLeadText}
                onSelectCollection={handleSelectCollection}
              />
            )}

            {currentStep === 2 && (
              <TemplateMatrixStep
                templates={templates}
                campSelectedTemplates={campSelectedTemplates}
                setCampSelectedTemplates={setCampSelectedTemplates}
                parseSpintax={parseSpintax}
                setPreviewTemplate={setPreviewTemplate}
                setPreviewParsedText={setPreviewParsedText}
                campPlatform={campPlatform}
              />
            )}

            {currentStep === 3 && (
              <AccountBalancerStep
                accounts={accounts}
                campPlatform={campPlatform}
                campAction={campAction}
                campSelectedAccs={campSelectedAccs}
                setCampSelectedAccs={setCampSelectedAccs}
                accSearch={accSearch}
                setAccSearch={setAccSearch}
                PLATFORM_ACTIONS={PLATFORM_ACTIONS}
                setCampPlatform={setCampPlatform}
                setCampAction={setCampAction}
                campNumLeads={campNumLeads}
                setCampNumLeads={setCampNumLeads}
                selectedLeadIds={selectedLeadIds}
                leads={leads}
                readyLeadsCount={getMatchingLeads(leads, campPlatform, campAction, 'pending').length}
                campScheduledStart={campScheduledStart}
                setCampScheduledStart={setCampScheduledStart}
                safetyLevel={safetyLevel}
                setSafetyLevel={setSafetyLevel}
                setCurrentStep={setCurrentStep}
                desiredDuration={desiredDuration}
                setDesiredDuration={setDesiredDuration}
                customDurationMinutes={customDurationMinutes}
                setCustomDurationMinutes={setCustomDurationMinutes}
                onAutoSelectOptimalAccounts={(count) => {
                  setMessage({ text: `Đã tự động chọn ${count} tài khoản Live tốt nhất.`, type: 'success' });
                }}
                onAutoExtendDuration={(safeMins) => {
                  setMessage({ text: `Đã tự động dãn thời gian chiến dịch lên ~${Math.round(safeMins / 60 * 10) / 10} giờ để an toàn 100%.`, type: 'success' });
                }}
              />
            )}

            {currentStep === 4 && renderStep4Summary()}
          </div>

          {/* Sticky Wizard Footer Controls */}
          <div className="wizard-sticky-footer">
            <div className="wizard-footer-left">
              <div className="wizard-footer-stat">
                <span className="wizard-footer-stat-val">{campSelectedAccs.length}</span>
                <span className="wizard-footer-stat-lbl">Tài khoản đã chọn</span>
              </div>
              <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)' }} />
              <div className="wizard-footer-stat">
                <span className="wizard-footer-stat-val">
                  {(() => {
                    if (targetMode === 'quick') {
                      return quickLeadText.split('\n').filter(Boolean).length;
                    }
                    const targetPlatform = campPlatform === 'messenger' ? 'facebook' : campPlatform;
                    const matchingSelectedCount = leads.filter(l => selectedLeadIds.has(l.id) && (l.platform === targetPlatform || (targetPlatform === 'facebook' && l.platform === 'social')) && l.status === 'pending').length;
                    return matchingSelectedCount > 0 ? matchingSelectedCount : getMatchingLeads(leads, campPlatform, campAction, 'pending').length;
                  })()}
                </span>
                <span className="wizard-footer-stat-lbl">
                  {targetMode === 'quick' ? "Leads nhập nhanh" : "Leads mục tiêu phù hợp"}
                </span>
              </div>
              <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)' }} />
              <div className="wizard-footer-stat">
                <span className="wizard-footer-stat-val">{safetyLevel.toUpperCase()}</span>
                <span className="wizard-footer-stat-lbl">Độ an toàn</span>
              </div>
            </div>

            <div className="wizard-footer-right">
              {currentStep > 1 && (
                <button 
                  type="button" 
                  onClick={() => setCurrentStep(prev => prev - 1)}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
                  disabled={loading}
                >
                  Quay lại
                </button>
              )}

              {currentStep === 1 && (
                <button 
                  type="button" 
                  onClick={() => {
                    if (targetMode === 'crm' && leads.length === 0) {
                      setMessage({ text: 'Kho Leads hiện tại đang trống. Vui lòng nạp Leads trước.', type: 'error' });
                      return;
                    }
                    if (targetMode === 'quick' && !quickLeadText.trim()) {
                      setMessage({ text: 'Vui lòng nhập danh sách mục tiêu tức thì.', type: 'error' });
                      return;
                    }
                    setCurrentStep(2);
                    setMessage(null);
                  }}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Tiếp tục chọn Kịch bản ➔
                </button>
              )}

              {currentStep === 2 && (
                <button 
                  type="button" 
                  onClick={() => {
                    if (campSelectedTemplates.length === 0) {
                      setMessage({ text: 'Vui lòng chọn ít nhất 1 kịch bản mẫu.', type: 'error' });
                      return;
                    }
                    setCurrentStep(3);
                    setMessage(null);
                  }}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Cấu hình Tài khoản & An toàn ➔
                </button>
              )}

              {currentStep === 3 && (
                <button 
                  type="button" 
                  onClick={() => {
                    if (campSelectedAccs.length === 0) {
                      setMessage({ text: 'Vui lòng chọn ít nhất 1 tài khoản để gửi tin/comment.', type: 'error' });
                      return;
                    }
                    if (campScheduledStart && new Date(campScheduledStart) < new Date()) {
                      setMessage({ text: 'Thời gian bắt đầu không thể nằm trong quá khứ.', type: 'error' });
                      return;
                    }
                    setCurrentStep(4);
                    setMessage(null);
                  }}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Xem Tóm tắt Chiến dịch ➔
                </button>
              )}

              {currentStep === 4 && (
                <button 
                  type="button" 
                  onClick={handleLaunchCampaign}
                  className="btn btn-success"
                  style={{ padding: '0.5rem 2rem', fontSize: '0.85rem', fontWeight: 'bold' }}
                  disabled={loading}
                >
                  {loading ? 'Đang khởi chạy...' : '🚀 BẮT ĐẦU CHIẾN DỊCH'}
                </button>
              )}
            </div>
          </div>

          {/* Monitoring Dashboard Section */}
          <MonitoringDashboard
            campaigns={campaigns}
            jobs={jobs}
            crawlerLogs={crawlerLogs}
            activeLogTab={activeLogTab}
            setActiveLogTab={setActiveLogTab}
            handleCampaignAction={handleCampaignAction}
            handleJobAction={handleJobAction}
            handleClearCrawlerLogs={handleClearCrawlerLogs}
            loading={loading}
            selectedAccountIdFilter={selectedAccountIdFilter}
            setSelectedAccountIdFilter={setSelectedAccountIdFilter}
          />
        </>
      ) : (
        /* MAIN TAB 2: LIVE AUTO-SEEDING WATCHER */
        <LiveWatcherTab
          targets={targets}
          templates={templates}
          handleAddTarget={handleAddTarget}
          handleTargetAction={handleTargetAction}
          handleDeleteTarget={handleDeleteTarget}
          loading={loading}
          isBulkMode={isBulkMode}
          setIsBulkMode={setIsBulkMode}
          bulkTargetText={bulkTargetText}
          setBulkTargetText={setBulkTargetText}
          targetPlatform={targetPlatform}
          setTargetPlatform={setTargetPlatform}
          targetType={targetType}
          setTargetType={setTargetType}
          targetValue={targetValue}
          setTargetValue={setTargetValue}
          handleTargetValuePaste={handleTargetValuePaste}
          handlePlatformChange={handlePlatformChange}
          showActiveTargetsOnly={showActiveTargetsOnly}
          setShowActiveTargetsOnly={setShowActiveTargetsOnly}
          PLATFORMS_MAP={PLATFORMS_MAP}
        />
      )}

      {/* Scrape Drawer */}
      <ScrapeDrawer
        isOpen={isScrapeDrawerOpen}
        onClose={() => setIsScrapeDrawerOpen(false)}
        accounts={accounts}
        campaigns={campaigns}
        onSuccess={fetchLeads}
      />

      {/* High Risk Confirmation Modal */}
      {showRiskModal && pendingEstimation && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '2px solid var(--color-danger)',
            borderRadius: '12px',
            maxWidth: '550px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '2rem' }}>🚨</span>
              <div>
                <h3 style={{ margin: 0, color: 'var(--color-danger)', fontSize: '1.1rem', fontWeight: 700 }}>
                  CẢNH BÁO MẠO HIỂM: NGUY CƠ BỊ BAN CAO ({pendingEstimation.riskScore}%)
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Chiến dịch có thể khiến tài khoản của bạn bị nền tảng {campPlatform.toUpperCase()} khóa hoặc hạn chế!
                </span>
              </div>
            </div>

            <div style={{
              backgroundColor: 'rgba(248, 81, 73, 0.08)',
              border: '1px solid rgba(248, 81, 73, 0.2)',
              borderRadius: '8px',
              padding: '1rem',
              fontSize: '0.8rem',
              lineHeight: 1.5,
              color: 'var(--text-primary)'
            }}>
              <strong style={{ color: 'var(--color-danger)', display: 'block', marginBottom: '0.4rem' }}>
                ⚠️ Các yếu tố vi phạm bộ lọc spam:
              </strong>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {pendingEstimation.dangerFactors.map((f, idx) => (
                  <li key={idx} style={{ marginBottom: '0.3rem' }}>
                    <strong>{f.title}:</strong> {f.description}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                💥 <strong>Hình phạt dự kiến:</strong> {pendingEstimation.penaltyType}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  setShowRiskModal(false);
                  setCurrentStep(3);
                }}
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.75rem', fontSize: '0.9rem', fontWeight: 600 }}
              >
                🛡️ Quay lại Bước 3 để Tối ưu An toàn (Khuyên dùng)
              </button>

              <button
                type="button"
                onClick={() => executeLaunchCampaign()}
                className="btn"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  fontSize: '0.8rem',
                  color: 'var(--color-danger)',
                  border: '1px solid var(--color-danger)',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                ⚠️ Tôi chấp nhận rủi ro, vẫn muốn khởi chạy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderStep4Summary() {
    const selectedAccsCount = campSelectedAccs.length;
    const selectedAccountsObjs = accounts.filter(a => campSelectedAccs.includes(a.id));
    const selectedTpls = templates.filter(t => campSelectedTemplates.includes(t.id));
    const templatesListStr = selectedTpls.map(t => t.name).join(', ');

    const targetLeadsCount = targetMode === 'quick' ? quickLeadText.split('\n').filter(Boolean).length : (selectedLeadIds.size > 0 ? selectedLeadIds.size : parseInt(campNumLeads));

    let durationMins = 720;
    if (desiredDuration === 'custom') {
      durationMins = customDurationMinutes > 0 ? customDurationMinutes : 60;
    } else {
      const preset = DURATION_PRESETS.find(p => p.value === desiredDuration);
      durationMins = preset ? preset.minutes : 720;
    }

    const step4Estimation = estimateCampaignResources({
      platform: campPlatform,
      action: campAction,
      numLeads: targetLeadsCount,
      desiredDurationMinutes: durationMins,
      safetyLevel,
      selectedAccsCount,
      scheduledStart: campScheduledStart
    });

    const formattedStartTime = campScheduledStart
      ? new Date(campScheduledStart).toLocaleString('vi-VN')
      : 'Khởi chạy ngay lập tức';

    return (
      <div className="card" style={{ padding: '2rem', maxWidth: '650px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem', textAlign: 'center' }}>
          Tóm tắt & Xác nhận Chiến dịch
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '2rem' }}>
          Vui lòng kiểm tra lại tất cả các thông số trước khi bấm khởi chạy chiến dịch.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '1.5rem 0', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Kênh chiến dịch:</span>
            <strong style={{ color: 'var(--text-primary)', textTransform: 'uppercase', fontSize: '0.95rem' }}>{campPlatform}</strong>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Tác vụ thực hiện:</span>
            <strong style={{ color: 'var(--color-primary-hover)', fontSize: '0.9rem' }}>
              {(PLATFORM_ACTIONS[campPlatform] || []).find(a => a.value === campAction)?.label || campAction}
            </strong>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Tài khoản gửi ({selectedAccsCount}):</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxWidth: '350px', justifyContent: 'flex-end' }}>
              {selectedAccountsObjs.map(acc => (
                <span 
                  key={acc.id} 
                  style={{ 
                    fontSize: '0.75rem', 
                    padding: '0.15rem 0.45rem', 
                    backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '4px',
                    color: 'var(--text-primary)'
                  }}
                >
                  👤 {acc.username}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Nguồn & Số lượng mục tiêu:</span>
            <strong style={{ color: 'var(--text-primary)' }}>
              {targetMode === 'quick' ? `${targetLeadsCount} mục tiêu (Nhập nhanh)` : `${targetLeadsCount} mục tiêu (Kho CRM)`}
            </strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Kịch bản ({selectedTpls.length}):</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end', maxWidth: '350px' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{templatesListStr || 'Không có'}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Thời lượng mong muốn:</span>
            <strong style={{ color: 'var(--text-primary)' }}>
              ~{Math.round(durationMins / 60 * 10) / 10} giờ ({durationMins} phút)
            </strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Đánh giá An toàn (Antiban):</span>
            <strong style={{ 
              color: step4Estimation.riskLevel === 'high_risk' 
                ? 'var(--color-danger)' 
                : step4Estimation.riskLevel === 'moderate' 
                ? 'var(--color-warning)' 
                : 'var(--color-success)' 
            }}>
              {step4Estimation.riskLevel === 'high_risk' 
                ? `🚨 RỦI RO CAO (${step4Estimation.riskScore}%)` 
                : step4Estimation.riskLevel === 'moderate' 
                ? '⚠️ TẢI TRUNG BÌNH' 
                : '🛡️ AN TOÀN TUYỆT ĐỐI'}
            </strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Thời gian bắt đầu:</span>
            <strong style={{ color: 'var(--color-primary-hover)' }}>{formattedStartTime}</strong>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Dự kiến hoàn thành:</span>
            <strong style={{ color: 'var(--text-primary)' }}>
              {step4Estimation.projectedEndTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
            </strong>
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '0.5rem', 
          padding: '1rem', 
          borderRadius: '6px', 
          backgroundColor: step4Estimation.riskLevel === 'high_risk' ? 'rgba(248, 81, 73, 0.08)' : 'rgba(63, 185, 80, 0.05)', 
          border: step4Estimation.riskLevel === 'high_risk' ? '1px solid rgba(248, 81, 73, 0.3)' : '1px solid rgba(63, 185, 80, 0.15)', 
          color: step4Estimation.riskLevel === 'high_risk' ? 'var(--color-danger)' : 'var(--color-success)', 
          fontSize: '0.8rem', 
          lineHeight: '1.4' 
        }}>
          <span style={{ fontWeight: 600 }}>
            {step4Estimation.riskLevel === 'high_risk' ? '🚨 Lưu ý rủi ro mạo hiểm:' : '💡 Mẹo vận hành an toàn:'}
          </span>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {step4Estimation.riskLevel === 'high_risk' ? (
              <>
                <li>Chiến dịch đang thiết lập thời gian quá gấp hoặc thiếu tài khoản Live.</li>
                <li>Nên quay lại Bước 3 chọn thêm tài khoản để tránh bị checkpoint tài khoản.</li>
              </>
            ) : (
              <>
                <li>Nên sử dụng kịch bản có cú pháp Spin Tax <code>{`{nội dung 1|nội dung 2}`}</code> để xáo trộn văn bản.</li>
                <li>Các tác vụ sau khi tạo sẽ được phân bổ chạy ngầm qua hàng đợi Queue tự động.</li>
              </>
            )}
          </ul>
        </div>
      </div>
    );
  }
}

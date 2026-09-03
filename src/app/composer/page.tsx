'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { getTwitterLength } from '@/lib/twitter';

const PLATFORM_LIMITS: Record<string, { name: string; max: number }> = {
  x: { name: 'X (Twitter)', max: 280 },
  threads: { name: 'Threads', max: 500 },
  zalo: { name: 'Zalo', max: 2000 },
  whatsapp: { name: 'WhatsApp', max: 65536 },
  telegram: { name: 'Telegram', max: 4000 },
  facebook: { name: 'Facebook', max: 50000 },
  tiktok: { name: 'TikTok', max: 2200 },
  instagram: { name: 'Instagram', max: 2200 },
  youtube: { name: 'YouTube', max: 10000 }
};

interface Account {
  id: number;
  platform: string;
  username: string;
  status: string;
  extra_data?: any;
}

interface Job {
  id: number;
  username: string | null;
  platform?: string | null;
  type: string;
  post_content: string | null;
  media_paths?: any;
  scheduled_at: string | null;
  status: string;
  error_log: string | null;
  post_url?: string | null;
}

function safeParseMediaPaths(mediaPaths: any): string[] {
  if (!mediaPaths) return [];
  if (Array.isArray(mediaPaths)) return mediaPaths;
  if (typeof mediaPaths === 'object') return Object.values(mediaPaths).map(String);
  if (typeof mediaPaths === 'string') {
    try {
      const parsed = JSON.parse(mediaPaths);
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch (e) {
      return mediaPaths.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export default function ComposerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const composerJobs = jobs.filter(j => j.type === 'post' || j.type.endsWith('_post') || j.type === 'telegram_message' || j.type === 'zalo_message' || j.type === 'whatsapp_message' || j.type === 'whatsapp_group_post' || j.type === 'whatsapp_status');
  const [templates, setTemplates] = useState<any[]>([]);
  
  const [customContentPerPlatform, setCustomContentPerPlatform] = useState(false);
  const [platformContents, setPlatformContents] = useState<Record<string, string>>({});
  const [previewPlatform, setPreviewPlatform] = useState('x');

  // Selection states
  const [selectedAccs, setSelectedAccs] = useState<number[]>([]);
  const [postContent, setPostContent] = useState('');
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled' | 'staggered'>('now');
  const [baseTime, setBaseTime] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const [composerMode, setComposerMode] = useState<'single' | 'multi_library'>('single');
  const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);
  const [mixMode, setMixMode] = useState<'round_robin' | 'random' | 'post_all'>('round_robin');
  const [staggerPostMinutes, setStaggerPostMinutes] = useState<string>('15');
  const [telegramTargets, setTelegramTargets] = useState<string>('');
  const [saveAsDefaultTelegram, setSaveAsDefaultTelegram] = useState<boolean>(false);
  const [zaloTargets, setZaloTargets] = useState<string>('');
  const [saveAsDefaultZalo, setSaveAsDefaultZalo] = useState<boolean>(false);
  const [whatsappTargets, setWhatsappTargets] = useState<string>('');
  const [saveAsDefaultWhatsapp, setSaveAsDefaultWhatsapp] = useState<boolean>(false);
  const [newf319BoxId, setNewf319BoxId] = useState<string>('3');
  const [activePlatformFilter, setActivePlatformFilter] = useState<string>('all');
  const [uploadedMedia, setUploadedMedia] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Status state
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // AI states
  const [generalAiLoading, setGeneralAiLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  const handleAIOptimizeGeneral = async () => {
    if (!postContent.trim()) return;
    setGeneralAiLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: postContent, platform: 'general' })
      });
      const data = await res.json();
      if (data.success) {
        setPostContent(data.data);
        setMessage({ text: 'Đã tối ưu câu từ bằng AI thành công.', type: 'success' });
      } else {
        setMessage({ text: data.error || 'Lỗi tối ưu hóa AI.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi mạng khi gọi AI.', type: 'error' });
    } finally {
      setGeneralAiLoading(false);
    }
  };

  const handleAIOptimize = async (platform: string) => {
    const sourceContent = postContent || platformContents[platform] || '';
    if (!sourceContent.trim()) {
      setMessage({ text: 'Vui lòng viết nội dung nháp ở khung soạn thảo chính trước.', type: 'error' });
      return;
    }
    
    setAiLoading(prev => ({ ...prev, [platform]: true }));
    setMessage(null);
    try {
      const res = await fetch('/api/ai/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: sourceContent, platform })
      });
      const data = await res.json();
      if (data.success) {
        setPlatformContents(prev => ({ ...prev, [platform]: data.data }));
        setMessage({ text: `Đã tối ưu hóa nội dung cho ${platform.toUpperCase()} bằng AI thành công.`, type: 'success' });
      } else {
        setMessage({ text: data.error || 'Lỗi tối ưu hóa AI.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi mạng khi gọi AI.', type: 'error' });
    } finally {
      setAiLoading(prev => ({ ...prev, [platform]: false }));
    }
  };

  const selectedPlatforms = Array.from(new Set(selectedAccs.map(id => accounts.find(a => a.id === id)?.platform).filter(Boolean))) as string[];

  useEffect(() => {
    if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(previewPlatform)) {
      setPreviewPlatform(selectedPlatforms[0]);
    }
  }, [selectedAccs, selectedPlatforms, previewPlatform]);

  const prevSelectedAccsStrRef = useRef<string>('');

  // Load default target chats when selected accounts change (prevents overwriting input during polling)
  useEffect(() => {
    const selectedAccsStr = [...selectedAccs].sort().join(',');
    if (selectedAccsStr === prevSelectedAccsStrRef.current) {
      return;
    }
    prevSelectedAccsStrRef.current = selectedAccsStr;

    // Telegram targets
    const teleAccs = selectedAccs
      .map(id => accounts.find(a => a.id === id))
      .filter(a => a?.platform === 'telegram') as Account[];
    
    if (teleAccs.length > 0) {
      const allTargets: string[] = [];
      teleAccs.forEach(acc => {
        let extra = (acc as any).extra_data;
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch {}
        }
        if (extra && extra.target_chats && Array.isArray(extra.target_chats)) {
          extra.target_chats.forEach((t: string) => {
            if (t && !allTargets.includes(t)) {
              allTargets.push(t);
            }
          });
        }
      });
      setTelegramTargets(allTargets.join(', '));
    } else {
      setTelegramTargets('');
    }

    // Zalo targets
    const zaloAccs = selectedAccs
      .map(id => accounts.find(a => a.id === id))
      .filter(a => a?.platform === 'zalo') as Account[];
    
    if (zaloAccs.length > 0) {
      const allTargets: string[] = [];
      zaloAccs.forEach(acc => {
        let extra = (acc as any).extra_data;
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch {}
        }
        if (extra && extra.target_chats && Array.isArray(extra.target_chats)) {
          extra.target_chats.forEach((t: string) => {
            if (t && !allTargets.includes(t)) {
              allTargets.push(t);
            }
          });
        }
      });
      setZaloTargets(allTargets.join(', '));
    } else {
      setZaloTargets('');
    }

    // WhatsApp targets
    const waAccs = selectedAccs
      .map(id => accounts.find(a => a.id === id))
      .filter(a => a?.platform === 'whatsapp') as Account[];
    
    if (waAccs.length > 0) {
      const allTargets: string[] = [];
      waAccs.forEach(acc => {
        let extra = (acc as any).extra_data;
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch {}
        }
        if (extra && extra.target_chats && Array.isArray(extra.target_chats)) {
          extra.target_chats.forEach((t: string) => {
            if (t && !allTargets.includes(t)) {
              allTargets.push(t);
            }
          });
        }
      });
      setWhatsappTargets(allTargets.join(', ') || 'status');
    } else {
      setWhatsappTargets('');
    }
  }, [selectedAccs, accounts]);

  const fetchData = async () => {
    try {
      const resAccs = await fetch('/api/accounts');
      const dataAccs = await resAccs.json();
      if (dataAccs.success) {
        // Only allow active accounts to be selected
        setAccounts(dataAccs.data.filter((acc: Account) => acc.status === 'live'));
      }

      const resJobs = await fetch('/api/jobs');
      const dataJobs = await resJobs.json();
      if (dataJobs.success) {
        setJobs(dataJobs.data);
      }

      const resTemplates = await fetch('/api/library');
      const dataTemplates = await resTemplates.json();
      if (dataTemplates.success) {
        setTemplates(dataTemplates.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchData();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get('templateId');
    if (templateId) {
      fetch(`/api/library?id=${templateId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data) {
            setPostContent(data.data.content || '');
            setUploadedMedia(safeParseMediaPaths(data.data.media_paths));
            setMessage({ text: `Đã nạp bài viết mẫu: "${data.data.title}" từ kho lưu trữ.`, type: 'success' });
            
            // Clean up the URL parameter without page reload
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
          }
        })
        .catch(err => console.error(err));
    }
  }, []);

  const handleAccountToggle = (id: number) => {
    setSelectedAccs(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedAccs.length === accounts.length) {
      setSelectedAccs([]);
    } else {
      setSelectedAccs(accounts.map(a => a.id));
    }
  };

  const handleDeleteJob = async (id: number, status: string) => {
    const confirmMsg = status === 'pending' 
      ? 'Bạn có chắc chắn muốn hủy lịch bài đăng này không?' 
      : 'Bạn có chắc chắn muốn xóa lịch sử bài đăng này khỏi danh sách không?';
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetch('/api/jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: status === 'pending' ? 'Đã hủy lịch đăng bài thành công.' : 'Đã xóa lịch sử bài viết thành công.', type: 'success' });
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLoadToEditor = (job: Job) => {
    setPostContent(job.post_content || '');
    
    // Extract media paths
    setUploadedMedia(safeParseMediaPaths(job.media_paths));

    // Find account by username
    const account = accounts.find(a => a.username === job.username);
    if (account) {
      setSelectedAccs([account.id]);
    } else {
      setSelectedAccs([]);
    }
    
    // Smooth scroll to composer form
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMessage({ text: `Đã nạp nội dung bài đăng #${job.id} vào khung soạn thảo.`, type: 'success' });
  };

  const handleQuickRepost = async (job: Job) => {
    const account = accounts.find(a => a.username === job.username);
    if (!account) {
      setMessage({ text: 'Không tìm thấy tài khoản tương ứng hoặc tài khoản không hoạt động.', type: 'error' });
      return;
    }
    
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: [account.id],
          content: job.post_content,
          scheduleType: 'now',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: `Đã xếp hàng đăng lại thành công bài đăng #${job.id}.`, type: 'success' });
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

  const handleJobSelectToggle = (id: number) => {
    setSelectedJobs(prev => 
      prev.includes(id) ? prev.filter(j => j !== id) : [...prev, id]
    );
  };

  const handleSelectAllJobs = () => {
    if (selectedJobs.length === composerJobs.length) {
      setSelectedJobs([]);
    } else {
      setSelectedJobs(composerJobs.map(j => j.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobs.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa/hủy ${selectedJobs.length} bài viết đã chọn không?`)) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedJobs }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: `Đã xóa thành công ${selectedJobs.length} bài viết.`, type: 'success' });
        setSelectedJobs([]);
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

  const handleBulkRepost = async () => {
    if (selectedJobs.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn đăng lại ${selectedJobs.length} bài viết đã chọn?`)) return;
    
    setLoading(true);
    let successCount = 0;
    let failCount = 0;
    
    for (const jobId of selectedJobs) {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        const account = accounts.find(a => a.username === job.username);
        if (account) {
          try {
            const res = await fetch('/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountIds: [account.id],
                content: job.post_content,
                scheduleType: 'now',
              }),
            });
            const data = await res.json();
            if (data.success) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            failCount++;
            console.error(err);
          }
        } else {
          failCount++;
        }
      }
    }
    
    setMessage({ 
      text: `Đã xử lý xong: Đăng lại thành công ${successCount} bài viết, thất bại ${failCount} bài viết.`, 
      type: successCount > 0 ? 'success' : 'error' 
    });
    setSelectedJobs([]);
    fetchData();
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setUploadedMedia(prev => [...prev, ...data.paths]);
        setMessage({ text: 'Tải tệp đính kèm thành công.', type: 'success' });
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveMedia = (pathToRemove: string) => {
    setUploadedMedia(prev => prev.filter(p => p !== pathToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAccs.length === 0) {
      setMessage({ text: 'Vui lòng chọn ít nhất 1 tài khoản.', type: 'error' });
      return;
    }

    const hasTelegramSelected = selectedAccs.some(id => accounts.find(a => a.id === id)?.platform === 'telegram');
    if (hasTelegramSelected && !telegramTargets.trim()) {
      setMessage({ text: 'Vui lòng nhập Kênh/Nhóm Telegram đích cần đăng bài.', type: 'error' });
      return;
    }

    const hasZaloSelected = selectedAccs.some(id => accounts.find(a => a.id === id)?.platform === 'zalo');
    if (hasZaloSelected && !zaloTargets.trim()) {
      setMessage({ text: 'Vui lòng nhập danh sách Số điện thoại Zalo đích cần gửi tin.', type: 'error' });
      return;
    }

    const hasWhatsappSelected = selectedAccs.some(id => accounts.find(a => a.id === id)?.platform === 'whatsapp');

    if (composerMode === 'multi_library') {
      if (selectedTemplates.length === 0) {
        setMessage({ text: 'Vui lòng chọn ít nhất 1 bài viết từ kho.', type: 'error' });
        return;
      }
    } else {
      if (!customContentPerPlatform) {
        if (!postContent.trim()) {
          setMessage({ text: 'Nội dung bài viết không được trống.', type: 'error' });
          return;
        }
        
        // Validate character limit constraints for selected platforms
        const selectedPlats = Array.from(new Set(selectedAccs.map(id => accounts.find(a => a.id === id)?.platform).filter(Boolean))) as string[];
        const exceededPlats: string[] = [];
        for (const plat of selectedPlats) {
          const limitInfo = PLATFORM_LIMITS[plat];
          if (limitInfo) {
            const currentLen = plat === 'x' ? getTwitterLength(postContent) : postContent.length;
            if (currentLen > limitInfo.max) {
              exceededPlats.push(`${limitInfo.name} (Tối đa ${limitInfo.max} ký tự, hiện tại ${currentLen})`);
            }
          }
        }
        if (exceededPlats.length > 0) {
          setMessage({ 
            text: `Không thể đăng bài. Nội dung vượt quá giới hạn của các nền tảng sau:\n- ${exceededPlats.join('\n- ')}\nVui lòng chỉnh sửa lại hoặc chọn chế độ 'Cấu hình riêng cho từng nền tảng'.`, 
            type: 'error' 
          });
          return;
        }
      } else {
        const selectedPlats = Array.from(new Set(selectedAccs.map(id => accounts.find(a => a.id === id)?.platform).filter(Boolean))) as string[];
        for (const plat of selectedPlats) {
          if (!platformContents[plat] || !platformContents[plat].trim()) {
            setMessage({ text: `Vui lòng nhập nội dung bài viết cho nền tảng ${plat.toUpperCase()}.`, type: 'error' });
            return;
          }
        }
      }
    }

    if ((scheduleType === 'scheduled' || scheduleType === 'staggered') && !baseTime) {
      setMessage({ text: 'Vui lòng chọn thời gian bắt đầu lên lịch.', type: 'error' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      let isSuccess = false;
      let successMsg = '';

      if (composerMode === 'multi_library') {
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountIds: selectedAccs,
            templateIds: selectedTemplates,
            mixMode,
            staggerPostMinutes: staggerPostMinutes,
            scheduleType,
            baseTime: baseTime ? new Date(baseTime).toISOString() : undefined,
            telegramTargets: hasTelegramSelected ? telegramTargets : undefined,
            zaloTargets: hasZaloSelected ? zaloTargets : undefined,
            whatsappTargets: hasWhatsappSelected ? whatsappTargets : undefined,
            newf319BoxId: selectedPlatforms.includes('newf319') ? newf319BoxId : undefined,
          }),
        });
        const data = await res.json();
        if (data.success) {
          isSuccess = true;
          successMsg = data.message;
          setSelectedTemplates([]);
          setSelectedAccs([]);
          setScheduleType('now');
          setBaseTime('');
          fetchData();
        } else {
          setMessage({ text: data.error, type: 'error' });
        }
      } else if (!customContentPerPlatform) {
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountIds: selectedAccs,
            content: postContent,
            scheduleType,
            baseTime: baseTime ? new Date(baseTime).toISOString() : undefined,
            mediaPaths: uploadedMedia,
            telegramTargets: hasTelegramSelected ? telegramTargets : undefined,
            zaloTargets: hasZaloSelected ? zaloTargets : undefined,
            whatsappTargets: hasWhatsappSelected ? whatsappTargets : undefined,
            newf319BoxId: selectedPlatforms.includes('newf319') ? newf319BoxId : undefined,
          }),
        });
        const data = await res.json();
        if (data.success) {
          isSuccess = true;
          successMsg = data.message;
          setPostContent('');
          setSelectedAccs([]);
          setUploadedMedia([]);
          setScheduleType('now');
          setBaseTime('');
          fetchData();
        } else {
          setMessage({ text: data.error, type: 'error' });
        }
      } else {
        const selectedPlats = Array.from(new Set(selectedAccs.map(id => accounts.find(a => a.id === id)?.platform).filter(Boolean))) as string[];
        let successCount = 0;
        let errors: string[] = [];

        for (const plat of selectedPlats) {
          const platAccIds = selectedAccs.filter(id => accounts.find(a => a.id === id)?.platform === plat);
          const platContent = platformContents[plat];

          const res = await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountIds: platAccIds,
              content: platContent,
              scheduleType,
              baseTime: baseTime ? new Date(baseTime).toISOString() : undefined,
              mediaPaths: uploadedMedia,
              telegramTargets: plat === 'telegram' ? telegramTargets : undefined,
              zaloTargets: plat === 'zalo' ? zaloTargets : undefined,
              whatsappTargets: plat === 'whatsapp' ? whatsappTargets : undefined,
              newf319BoxId: plat === 'newf319' ? newf319BoxId : undefined,
            }),
          });
          const data = await res.json();
          if (data.success) {
            successCount += platAccIds.length;
          } else {
            errors.push(`${plat.toUpperCase()}: ${data.error}`);
          }
        }

        if (errors.length === 0) {
          isSuccess = true;
          successMsg = `Đã lên lịch đăng bài thành công cho ${successCount} tài khoản.`;
          setSelectedAccs([]);
          setPlatformContents({});
          setUploadedMedia([]);
          setScheduleType('now');
          setBaseTime('');
          fetchData();
        } else {
          setMessage({ text: `Một số lỗi xảy ra: ${errors.join(', ')}`, type: 'error' });
        }
      }

      // Save Telegram default targets if checked
      let savedDefaultsMessage = '';
      if (isSuccess) {
        if (hasTelegramSelected && saveAsDefaultTelegram) {
          const teleAccs = selectedAccs.filter(id => accounts.find(a => a.id === id)?.platform === 'telegram');
          const targetsArray = telegramTargets.split(',').map(t => t.trim()).filter(Boolean);
          
          for (const accId of teleAccs) {
            const acc = accounts.find(a => a.id === accId);
            let extra = acc?.extra_data || {};
            if (typeof extra === 'string') {
              try { extra = JSON.parse(extra); } catch {}
            }
            const updatedExtra = { ...extra, target_chats: targetsArray };
            
            await fetch('/api/accounts', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountId: accId,
                extraData: updatedExtra
              })
            });
          }
          savedDefaultsMessage += ' Đã lưu danh sách kênh đích mặc định cho các tài khoản Telegram.';
        }

        if (isSuccess && hasZaloSelected && saveAsDefaultZalo) {
          const zaloAccs = selectedAccs.filter(id => accounts.find(a => a.id === id)?.platform === 'zalo');
          const targetsArray = zaloTargets.split(',').map(t => t.trim()).filter(Boolean);
          
          for (const accId of zaloAccs) {
            const acc = accounts.find(a => a.id === accId);
            let extra = acc?.extra_data || {};
            if (typeof extra === 'string') {
              try { extra = JSON.parse(extra); } catch {}
            }
            const updatedExtra = { ...extra, target_chats: targetsArray };
            
            await fetch('/api/accounts', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountId: accId,
                extraData: updatedExtra
              })
            });
          }
          savedDefaultsMessage += ' Đã lưu danh sách số điện thoại đích mặc định cho các tài khoản Zalo.';
        }

        if (isSuccess && hasWhatsappSelected && saveAsDefaultWhatsapp) {
          const waAccs = selectedAccs.filter(id => accounts.find(a => a.id === id)?.platform === 'whatsapp');
          const targetsArray = whatsappTargets.split(',').map(t => t.trim()).filter(Boolean);
          
          for (const accId of waAccs) {
            const acc = accounts.find(a => a.id === accId);
            let extra = acc?.extra_data || {};
            if (typeof extra === 'string') {
              try { extra = JSON.parse(extra); } catch {}
            }
            const updatedExtra = { ...extra, target_chats: targetsArray };
            
            await fetch('/api/accounts', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountId: accId,
                extraData: updatedExtra
              })
            });
          }
          savedDefaultsMessage += ' Đã lưu danh sách nhóm/đích mặc định cho các tài khoản WhatsApp.';
        }

        setMessage({ text: `${successMsg}${savedDefaultsMessage}`, type: 'success' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const charCount = getTwitterLength(postContent);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Đăng bài & Lịch trình</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Soạn thảo nội dung và lên lịch đăng bài giãn cách cho các tài khoản X.
        </p>
      </div>

      {/* Message Alert */}
      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="responsive-grid-split composer-layout">
        {/* LEFT COLUMN: COMPOSER FORM */}
        <div>
          <div className="card">
            <div className="card-title">Biên tập bài đăng</div>
            <form onSubmit={handleSubmit}>
              
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Chọn tài khoản đăng bài ({selectedAccs.length} đã chọn)</span>
                  {accounts.length > 0 && (
                    <button 
                      type="button" 
                      onClick={handleSelectAll} 
                      style={{ background: 'none', border: 'none', color: 'var(--color-primary-hover)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}
                    >
                      {selectedAccs.length === accounts.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                </label>
                {/* Platform Filter Tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                  {[
                    { id: 'all', label: 'Tất cả' },
                    { id: 'x', label: 'X (Twitter)' },
                    { id: 'newf319', label: 'newf319.com' },
                    { id: 'zalo', label: 'Zalo' },
                    { id: 'whatsapp', label: 'WhatsApp' },
                    { id: 'telegram', label: 'Telegram' },
                    { id: 'threads', label: 'Threads' },
                    { id: 'facebook', label: 'Facebook' },
                    { id: 'instagram', label: 'Instagram' },
                    { id: 'tiktok', label: 'TikTok' },
                    { id: 'youtube', label: 'YouTube' },
                    { id: 'other', label: 'Khác' },
                  ].map(tag => {
                    const isActive = activePlatformFilter === tag.id;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          setActivePlatformFilter(tag.id);
                          if (tag.id !== 'all' && tag.id !== 'other') {
                            setPreviewPlatform(tag.id);
                          }
                        }}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                          backgroundColor: isActive ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.05)',
                          color: isActive ? '#ffffff' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: isActive ? 600 : 400,
                          transition: 'all 0.15s ease-in-out'
                        }}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>

                {accounts.length === 0 ? (
                  <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
                    ⚠️ Không có tài khoản hoạt động (Live). Hãy kiểm tra trạng thái tài khoản tại trang Tài khoản trước!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-primary)' }}>
                    {(() => {
                      const mainPlatforms = ['x', 'newf319', 'zalo', 'telegram', 'threads', 'facebook', 'instagram', 'tiktok', 'youtube'];
                      const otherPlatforms = Array.from(new Set(accounts.map(a => a.platform).filter(p => !mainPlatforms.includes(p))));
                      
                      let platformsToRender = [...mainPlatforms];
                      if (activePlatformFilter === 'all') {
                        platformsToRender = [...mainPlatforms, ...otherPlatforms];
                      } else if (activePlatformFilter === 'other') {
                        platformsToRender = otherPlatforms;
                      } else {
                        platformsToRender = [activePlatformFilter];
                      }

                      const visibleGroups = platformsToRender.map(plat => {
                        const platAccs = accounts.filter(a => a.platform === plat);
                        if (platAccs.length === 0) return null;
                        const platName = plat === 'x' ? 'X (Twitter)' : plat.charAt(0).toUpperCase() + plat.slice(1);
                        const isAllPlatSelected = platAccs.every(a => selectedAccs.includes(a.id));
                        return (
                          <div key={plat} style={{ borderBottom: '1px dashed var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary-hover)', textTransform: 'uppercase' }}>{platName}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const platIds = platAccs.map(a => a.id);
                                  if (isAllPlatSelected) {
                                    setSelectedAccs(prev => prev.filter(id => !platIds.includes(id)));
                                  } else {
                                    setSelectedAccs(prev => Array.from(new Set([...prev, ...platIds])));
                                  }
                                }}
                                style={{ background: 'none', border: 'none', color: 'var(--color-primary-hover)', cursor: 'pointer', fontSize: '0.75rem' }}
                              >
                                {isAllPlatSelected ? 'Bỏ chọn' : 'Chọn nhóm'}
                              </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.4rem' }}>
                              {platAccs.map(acc => (
                                <label key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={selectedAccs.includes(acc.id)}
                                    onChange={() => handleAccountToggle(acc.id)}
                                  />
                                  @{acc.username}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      }).filter(Boolean);

                      if (visibleGroups.length === 0) {
                        return (
                          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            📭 Không tìm thấy tài khoản nào thuộc nền tảng này.
                          </div>
                        );
                      }
                      return visibleGroups;
                    })()}
                  </div>
                )}
              </div>

              {/* Chọn chế độ soạn thảo (Soạn đơn / Đăng hàng loạt từ kho) */}
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Chế độ soạn thảo</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    type="button"
                    className={`btn ${composerMode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setComposerMode('single')}
                    style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem' }}
                  >
                    ✍️ Soạn bài viết đơn
                  </button>
                  <button
                    type="button"
                    className={`btn ${composerMode === 'multi_library' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setComposerMode('multi_library')}
                    style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem' }}
                  >
                    🗂️ Chọn nhiều bài từ kho
                  </button>
                </div>
              </div>

              {/* CHẾ ĐỘ SOẠN ĐƠN BÀI */}
              {composerMode === 'single' && (
                <>
                  {/* Checkbox for custom content per platform */}
                  {selectedAccs.length > 0 && (
                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                        <input
                          type="checkbox"
                          checked={customContentPerPlatform}
                          onChange={(e) => setCustomContentPerPlatform(e.target.checked)}
                        />
                        ✍️ Cấu hình nội dung riêng cho từng nền tảng
                      </label>
                    </div>
                  )}

                  {/* Chọn bài viết từ kho */}
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>📁 Chọn nhanh bài viết từ kho</label>
                      <Link href="/library" style={{ fontSize: '0.75rem', color: 'var(--color-primary-hover)', textDecoration: 'underline' }}>
                        + Quản lý kho bài viết
                      </Link>
                    </div>
                    <select 
                      className="input" 
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        const selected = templates.find(t => t.id === parseInt(id));
                        if (selected) {
                          if (customContentPerPlatform) {
                            const newContents: Record<string, string> = {};
                            selectedPlatforms.forEach(plat => {
                              newContents[plat] = selected.content || '';
                            });
                            setPlatformContents(newContents);
                          } else {
                            setPostContent(selected.content || '');
                          }
                          
                          setUploadedMedia(safeParseMediaPaths(selected.media_paths));
                          setMessage({ text: `Đã nạp bài viết: "${selected.title}" vào khung soạn thảo.`, type: 'success' });
                        }
                        e.target.value = ''; // Reset select
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>-- Chọn một bài viết từ kho --</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>

                  {/* Post Editor Textarea */}
                  {!customContentPerPlatform ? (
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>Nội dung bài đăng</label>
                        <button
                          type="button"
                          onClick={handleAIOptimizeGeneral}
                          className="btn"
                          style={{ 
                            padding: '0.15rem 0.6rem', 
                            fontSize: '0.75rem', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.25rem', 
                            height: '1.8rem',
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%)',
                            border: '1px solid rgba(147, 51, 234, 0.4)',
                            borderRadius: '6px',
                            color: '#d8b4fe',
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          disabled={generalAiLoading || !postContent.trim()}
                        >
                          {generalAiLoading ? '⏳ Đang tối ưu...' : '✨ Sửa văn bản bằng AI'}
                        </button>
                      </div>
                      <textarea
                        className="textarea"
                        value={postContent}
                        onChange={(e) => setPostContent(e.target.value)}
                        placeholder="Hôm nay thị trường Crypto thế nào? #Bitcoin #Ethereum..."
                        style={{ minHeight: '140px' }}
                      />
                      
                      {/* Dynamic Platform limits checker */}
                      {selectedPlatforms.length > 0 ? (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                            📊 Giới hạn ký tự theo các nền tảng đã chọn:
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {selectedPlatforms.map(plat => {
                              const limitInfo = PLATFORM_LIMITS[plat] || { name: plat.toUpperCase(), max: 999999 };
                              const currentLen = plat === 'x' ? getTwitterLength(postContent) : postContent.length;
                              const isExceeded = currentLen > limitInfo.max;
                              return (
                                <span 
                                  key={plat} 
                                  style={{ 
                                    fontSize: '0.75rem', 
                                    padding: '0.2rem 0.5rem', 
                                    borderRadius: '4px', 
                                    display: 'inline-flex', 
                                    alignItems: 'center', 
                                    gap: '0.25rem',
                                    backgroundColor: isExceeded ? 'var(--color-danger-glow)' : 'var(--bg-primary)',
                                    color: isExceeded ? 'var(--color-danger)' : 'var(--text-secondary)',
                                    border: isExceeded ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
                                    fontWeight: isExceeded ? '600' : '400'
                                  }}
                                >
                                  {isExceeded ? '❌' : '✅'} {limitInfo.name}: {currentLen}/{limitInfo.max}
                                </span>
                              );
                            })}
                          </div>
                          
                          {/* Exceeded warning label */}
                          {selectedPlatforms.some(plat => {
                            const limitInfo = PLATFORM_LIMITS[plat] || { name: plat.toUpperCase(), max: 999999 };
                            const currentLen = plat === 'x' ? getTwitterLength(postContent) : postContent.length;
                            return currentLen > limitInfo.max;
                          }) && (
                            <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--color-danger)', fontWeight: 500 }}>
                              ⚠️ Có nền tảng vượt quá giới hạn. Vui lòng rút ngắn nội dung hoặc bật "Cấu hình riêng".
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <span>Nội dung văn bản</span>
                          <span>{postContent.length} ký tự</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Custom Content per Platform */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
                      {selectedPlatforms.map(plat => {
                        const contentVal = platformContents[plat] || '';
                        const platName = plat === 'x' ? 'X (Twitter)' : plat.charAt(0).toUpperCase() + plat.slice(1);
                        const platCharCount = getTwitterLength(contentVal);
                        const isPlatOverLimit = plat === 'x' && platCharCount > 280;
                        return (
                          <div key={plat} className="form-group" style={{ border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-secondary)', marginBottom: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <label className="form-label" style={{ fontWeight: 600, color: 'var(--color-primary-hover)', marginBottom: 0 }}>
                                Nội dung đăng lên {platName}
                              </label>
                              <button
                                type="button"
                                onClick={() => handleAIOptimize(plat)}
                                className="btn"
                                style={{ 
                                  padding: '0.15rem 0.6rem', 
                                  fontSize: '0.75rem', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '0.25rem', 
                                  height: '1.8rem',
                                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%)',
                                  border: '1px solid rgba(147, 51, 234, 0.4)',
                                  borderRadius: '6px',
                                  color: '#d8b4fe',
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                disabled={aiLoading[plat] || (!postContent.trim() && !contentVal.trim())}
                              >
                                {aiLoading[plat] ? '⏳ Đang tối ưu...' : '✨ Tối ưu bằng AI'}
                              </button>
                            </div>
                            <textarea
                              className="textarea"
                              value={contentVal}
                              onChange={(e) => setPlatformContents(prev => ({ ...prev, [plat]: e.target.value }))}
                              placeholder={`Nhập nội dung cho ${platName}...`}
                              style={{ minHeight: '100px', backgroundColor: 'var(--bg-primary)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: isPlatOverLimit ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                              <span>{plat === 'x' ? 'Giới hạn X: 280 ký tự' : plat === 'threads' ? 'Giới hạn Threads: 500 ký tự' : 'Không giới hạn ký tự'}</span>
                              <span>{platCharCount} ký tự</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Media File Upload Section */}
                  <div className="form-group">
                    <label className="form-label">Hình ảnh / Video đính kèm</label>
                    <div 
                      style={{ 
                        border: '2px dashed var(--border-color)', 
                        borderRadius: '8px', 
                        padding: '1.25rem', 
                        textAlign: 'center', 
                        backgroundColor: 'var(--bg-secondary)',
                        cursor: 'pointer',
                        position: 'relative'
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        onChange={handleFileUpload}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          opacity: 0,
                          cursor: 'pointer'
                        }}
                        disabled={uploading}
                      />
                      <span style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                        {uploading ? '⏳ Đang tải file lên...' : '📁 Kéo thả hoặc click để tải ảnh/video'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Hỗ trợ tải lên nhiều hình ảnh hoặc 1 video
                      </span>
                    </div>

                    {/* Uploaded media previews */}
                    {uploadedMedia.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        {uploadedMedia.map((path, idx) => {
                          const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                          return (
                            <div 
                              key={idx} 
                              style={{ 
                                position: 'relative', 
                                width: '80px', 
                                height: '80px', 
                                borderRadius: '6px', 
                                border: '1px solid var(--border-color)', 
                                overflow: 'hidden',
                                backgroundColor: '#000000'
                              }}
                            >
                              {isVideo ? (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                                  🎥
                                </div>
                              ) : (
                                <img src={path} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveMedia(path)}
                                style={{
                                  position: 'absolute',
                                  top: '2px',
                                  right: '2px',
                                  backgroundColor: 'rgba(255, 0, 0, 0.8)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '50%',
                                  width: '18px',
                                  height: '18px',
                                  fontSize: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  fontWeight: 'bold',
                                  lineHeight: 1
                                }}
                                title="Xóa tệp đính kèm"
                              >
                                &times;
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* CHẾ ĐỘ ĐĂNG NHIỀU BÀI TỪ KHO */}
              {composerMode === 'multi_library' && (
                <>
                  {/* Danh sách bài viết mẫu để tick */}
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>📁 Chọn các bài viết mẫu từ kho ({selectedTemplates.length} đã chọn)</label>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {templates.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedTemplates.length === templates.length) {
                                setSelectedTemplates([]);
                              } else {
                                setSelectedTemplates(templates.map(t => t.id));
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary-hover)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}
                          >
                            {selectedTemplates.length === templates.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                          </button>
                        )}
                        <Link href="/library" style={{ fontSize: '0.75rem', color: 'var(--color-primary-hover)', textDecoration: 'underline' }}>
                          + Quản lý kho bài viết
                        </Link>
                      </div>
                    </div>

                    {templates.length === 0 ? (
                      <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
                        ⚠️ Kho bài viết trống. Vui lòng tạo bài viết mẫu trước!
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-primary)' }}>
                        {templates.map(t => (
                          <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>
                            <input
                              type="checkbox"
                              style={{ marginTop: '0.2rem' }}
                              checked={selectedTemplates.includes(t.id)}
                              onChange={() => {
                                setSelectedTemplates(prev => 
                                  prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                                );
                              }}
                            />
                            <div style={{ fontSize: '0.85rem' }}>
                              <strong style={{ color: 'var(--color-primary-hover)' }}>{t.title}</strong>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.1rem 0 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {t.content}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cấu hình trộn bài và phân bổ */}
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label className="form-label">🔄 Phương thức trộn bài & Phân bổ</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="radio"
                          name="mixMode"
                          checked={mixMode === 'round_robin'}
                          onChange={() => setMixMode('round_robin')}
                        />
                        <span><strong>Xoay vòng (Round Robin)</strong>: Lần lượt gán bài viết từ danh sách đã chọn cho từng tài khoản.</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="radio"
                          name="mixMode"
                          checked={mixMode === 'random'}
                          onChange={() => setMixMode('random')}
                        />
                        <span><strong>Ngẫu nhiên (Random)</strong>: Chọn ngẫu nhiên một bài viết trong danh sách cho mỗi tài khoản.</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="radio"
                          name="mixMode"
                          checked={mixMode === 'post_all'}
                          onChange={() => setMixMode('post_all')}
                        />
                        <span><strong>Đăng tất cả (Post All)</strong>: Mỗi tài khoản sẽ đăng toàn bộ danh sách bài viết đã chọn.</span>
                      </label>
                    </div>
                  </div>

                  {/* Cấu hình giãn cách cho Post All */}
                  {mixMode === 'post_all' && (
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                      <label className="form-label">⏳ Khoảng cách giữa các bài đăng của cùng tài khoản (phút)</label>
                      <input
                        type="number"
                        className="input"
                        value={staggerPostMinutes}
                        onChange={(e) => setStaggerPostMinutes(e.target.value)}
                        min="1"
                        style={{ maxWidth: '120px' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.2rem' }}>
                        Mỗi bài viết tiếp theo của tài khoản đó sẽ được lên lịch trễ hơn bài trước số phút tương ứng.
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Cấu hình kênh/nhóm đích riêng cho Telegram */}
              {selectedPlatforms.includes('telegram') && (
                <div className="form-group" style={{ 
                  backgroundColor: 'rgba(23, 162, 184, 0.05)', 
                  border: '1px solid rgba(23, 162, 184, 0.2)', 
                  padding: '1rem', 
                  borderRadius: '6px', 
                  marginTop: '1rem', 
                  marginBottom: '1.25rem' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, color: '#17a2b8' }}>
                      ✈️ Kênh/Nhóm Telegram đích
                    </label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={telegramTargets}
                    onChange={(e) => setTelegramTargets(e.target.value)}
                    placeholder="Ví dụ: @kenh_seeding, https://t.me/nhom_seeding"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', lineHeight: '1.4' }}>
                    Nhập tên kênh (ví dụ: <code>@channel_username</code>), đường dẫn nhóm/kênh công khai (ví dụ: <code>https://t.me/group_username</code>) hoặc đường dẫn nhóm riêng tư. Phân tách bằng dấu phẩy nếu đăng lên nhiều đích.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: '0.6rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={saveAsDefaultTelegram}
                      onChange={(e) => setSaveAsDefaultTelegram(e.target.checked)}
                    />
                    Lưu danh sách đích này làm mặc định cho các tài khoản Telegram đã chọn
                  </label>
                </div>
              )}

              {/* Cấu hình số điện thoại đích riêng cho Zalo */}
              {selectedPlatforms.includes('zalo') && (
                <div className="form-group" style={{ 
                  backgroundColor: 'rgba(40, 167, 69, 0.05)', 
                  border: '1px solid rgba(40, 167, 69, 0.2)', 
                  padding: '1rem', 
                  borderRadius: '6px', 
                  marginTop: '1rem', 
                  marginBottom: '1.25rem' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, color: '#28a745' }}>
                      💬 Số điện thoại Zalo đích
                    </label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={zaloTargets}
                    onChange={(e) => setZaloTargets(e.target.value)}
                    placeholder="Ví dụ: 0912345678, 0987654321"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', lineHeight: '1.4' }}>
                    Nhập danh sách số điện thoại nhận tin nhắn Zalo. Phân tách bằng dấu phẩy nếu gửi lên nhiều đích.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: '0.6rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={saveAsDefaultZalo}
                      onChange={(e) => setSaveAsDefaultZalo(e.target.checked)}
                    />
                    Lưu danh sách đích này làm mặc định cho các tài khoản Zalo đã chọn
                  </label>
                </div>
              )}

              {/* Cấu hình đích riêng cho WhatsApp */}
              {selectedPlatforms.includes('whatsapp') && (
                <div className="form-group" style={{ 
                  backgroundColor: 'rgba(37, 211, 102, 0.05)', 
                  border: '1px solid rgba(37, 211, 102, 0.25)', 
                  padding: '1rem', 
                  borderRadius: '6px', 
                  marginTop: '1rem', 
                  marginBottom: '1.25rem' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, color: '#25D366' }}>
                      🟢 Đích đến WhatsApp (Số điện thoại / Link nhóm / Status)
                    </label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={whatsappTargets}
                    onChange={(e) => setWhatsappTargets(e.target.value)}
                    placeholder="Ví dụ: status (đăng 24h), https://chat.whatsapp.com/InviteCode123, 84912345678"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', lineHeight: '1.4' }}>
                    Nhập <code>status</code> để đăng lên WhatsApp Status (24h), nhập link nhóm <code>https://chat.whatsapp.com/...</code> để gửi vào nhóm, hoặc nhập SĐT quốc tế (ví dụ: <code>84912345678</code>). Phân tách bằng dấu phẩy nếu nhiều đích.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: '0.6rem', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={saveAsDefaultWhatsapp}
                      onChange={(e) => setSaveAsDefaultWhatsapp(e.target.checked)}
                    />
                    Lưu danh sách đích này làm mặc định cho các tài khoản WhatsApp đã chọn
                  </label>
                </div>
              )}

              {/* Cấu hình Box ID riêng cho newf319 */}
              {selectedPlatforms.includes('newf319') && (
                <div className="form-group" style={{ 
                  backgroundColor: 'rgba(233, 84, 32, 0.05)', 
                  border: '1px solid rgba(233, 84, 32, 0.2)', 
                  padding: '1rem', 
                  borderRadius: '6px', 
                  marginTop: '1rem', 
                  marginBottom: '1.25rem' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, color: '#e95420' }}>
                      📌 Mã chuyên mục (Box ID) newf319
                    </label>
                  </div>
                  <input
                    type="number"
                    className="input"
                    value={newf319BoxId}
                    onChange={(e) => setNewf319BoxId(e.target.value)}
                    placeholder="Mặc định: 3 (Thị trường chứng khoán)"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', maxWidth: '200px' }}
                    min="1"
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', lineHeight: '1.4' }}>
                    Nhập mã chuyên mục ID của diễn đàn newf319 (Mặc định: 3 - Thị trường chứng khoán). Ví dụ: 3, 2, 12...
                  </div>
                </div>
              )}


              {/* Schedule Type Selection */}
              <div className="form-group">
                <label className="form-label">Thời điểm đăng bài</label>
                <div style={{ display: 'flex', gap: '1.5rem', margin: '0.25rem 0', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="scheduleType"
                      checked={scheduleType === 'now'}
                      onChange={() => setScheduleType('now')}
                    />
                    Đăng ngay lập tức
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="scheduleType"
                      checked={scheduleType === 'scheduled'}
                      onChange={() => setScheduleType('scheduled')}
                    />
                    Đồng loạt lên lịch
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="scheduleType"
                      checked={scheduleType === 'staggered'}
                      onChange={() => setScheduleType('staggered')}
                    />
                    Đăng giãn cách (5-15 phút) 🛡️
                  </label>
                </div>
              </div>

              {/* Datetime picker for scheduled types */}
              {(scheduleType === 'scheduled' || scheduleType === 'staggered') && (
                <div className="form-group">
                  <label className="form-label">Chọn thời gian bắt đầu</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={baseTime}
                    onChange={(e) => setBaseTime(e.target.value)}
                    style={{ maxWidth: '250px' }}
                  />
                  {scheduleType === 'staggered' && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Mỗi tài khoản sẽ được lên lịch đăng cách nhau một khoảng trễ ngẫu nhiên từ 5 đến 15 phút.
                    </span>
                  )}
                </div>
              )}

              <button className="btn btn-primary" type="submit" disabled={loading || accounts.length === 0} style={{ marginTop: '0.5rem' }}>
                {loading ? '⏳ Đang lập lịch...' : '📝 Thực hiện Đăng / Lên lịch'}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: PREVIEW & HELP NOTES */}
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div className="card-title" style={{ margin: 0 }}>Xem trước ({previewPlatform.toUpperCase()})</div>
              {customContentPerPlatform && selectedPlatforms.length > 1 && (
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {selectedPlatforms.map(plat => (
                    <button
                      key={plat}
                      type="button"
                      onClick={() => setPreviewPlatform(plat)}
                      className="btn"
                      style={{
                        padding: '0.2rem 0.4rem',
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        backgroundColor: previewPlatform === plat ? 'var(--color-primary-hover)' : 'var(--bg-secondary)',
                        color: previewPlatform === plat ? '#ffffff' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      {plat}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ 
              border: '1px solid var(--border-color)', 
              borderRadius: '12px', 
              padding: '1rem', 
              backgroundColor: (previewPlatform === 'telegram' || previewPlatform === 'zalo') 
                ? '#0f172a' 
                : previewPlatform === 'newf319' 
                  ? '#ffffff' 
                  : '#000000', 
              backgroundImage: previewPlatform === 'telegram' ? 'linear-gradient(135deg, #17212b 0%, #0e1621 100%)' : 'none',
              fontSize: '0.95rem' 
            }}>
              {(previewPlatform === 'telegram' || previewPlatform === 'zalo') ? (
                /* CHAT STYLE MOCKUP (Telegram & Zalo) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '380px', margin: '0 auto' }}>
                  <div style={{ 
                    alignSelf: 'flex-start',
                    backgroundColor: previewPlatform === 'telegram' ? '#182533' : '#1e293b', 
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px 12px 12px 3px', 
                    padding: '0.75rem',
                    color: '#e7e9ea',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    width: '100%'
                  }}>
                    {/* Channel / Sender Header for Telegram */}
                    {previewPlatform === 'telegram' && (
                      <div style={{ fontWeight: 600, color: '#5288c1', fontSize: '0.85rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        📢 MKT Tools Channel <span style={{ fontSize: '0.75rem', color: '#8899a6', fontWeight: 'normal' }}>(Public)</span>
                      </div>
                    )}
                    
                    {/* Media content inside bubble if present (above text is cleaner) */}
                    {composerMode === 'single' && uploadedMedia.length > 0 && (
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: uploadedMedia.length === 1 ? '1fr' : '1fr 1fr', 
                        gap: '4px', 
                        marginBottom: '0.6rem', 
                        borderRadius: '8px', 
                        overflow: 'hidden' 
                      }}>
                        {uploadedMedia.map((path, idx) => {
                          const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                          return (
                            <div key={idx} style={{ position: 'relative', paddingBottom: uploadedMedia.length === 1 ? '56.25%' : '100%', height: 0, backgroundColor: '#15181c' }}>
                              {isVideo ? (
                                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                                  🎥 Video
                                </div>
                              ) : (
                                <img src={path} alt="Preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Text content */}
                    <div style={{ whiteSpace: 'pre-wrap', color: '#e7e9ea', wordBreak: 'break-word', fontSize: '0.9rem', lineHeight: '1.4' }}>
                      {composerMode === 'multi_library' ? (
                        selectedTemplates.length > 0 ? (
                          <div>
                            <p style={{ color: '#5288c1', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                              📝 Đã chọn {selectedTemplates.length} bài viết từ kho:
                            </p>
                            <ul style={{ paddingLeft: '1.25rem', margin: 0, listStyleType: 'disc', fontSize: '0.8rem' }}>
                              {selectedTemplates.map(id => {
                                const t = templates.find(temp => temp.id === id);
                                return t ? <li key={id} style={{ marginBottom: '0.25rem' }}>{t.title}</li> : null;
                              })}
                            </ul>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa chọn bài viết nào từ kho...</span>
                        )
                      ) : (
                        (customContentPerPlatform ? (platformContents[previewPlatform] || '') : postContent) || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Nội dung tin nhắn sẽ hiển thị ở đây...</span>
                      )}
                    </div>

                    {/* Footer inside bubble */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', color: '#8899a6', fontSize: '0.75rem' }}>
                      {previewPlatform === 'telegram' && <span>👁️ 1.2K</span>}
                      <span>10:42 PM</span>
                      <span style={{ color: '#5288c1' }}>✓✓</span>
                    </div>
                  </div>
                </div>
              ) : previewPlatform === 'newf319' ? (
                /* NEWF319 FORUM THREAD MOCKUP */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', backgroundColor: '#f0f4f9', border: '1px solid #d1d9e6', borderRadius: '8px', padding: '1rem', color: '#1c1e21', width: '100%' }}>
                  {/* Forum Header / Breadcrumb */}
                  <div style={{ fontSize: '0.75rem', color: '#65676b', display: 'flex', alignItems: 'center', gap: '0.25rem', borderBottom: '1px solid #e4e6eb', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
                    <span>Diễn đàn F319</span>
                    <span>›</span>
                    <span>Thị trường chứng khoán</span>
                  </div>
                  
                  {/* Thread Title */}
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0966c2', marginBottom: '0.5rem', wordBreak: 'break-word', lineHeight: '1.3' }}>
                    {(() => {
                      const text = composerMode === 'multi_library'
                        ? (selectedTemplates.length > 0 ? templates.find(t => t.id === selectedTemplates[0])?.title || 'Chủ đề mới' : 'Chủ đề mới')
                        : ((customContentPerPlatform ? platformContents['newf319'] : postContent) || '');
                      
                      // Title is the first line of the post content
                      const firstLine = text.split('\n')[0].trim();
                      return firstLine || 'Tiêu đề chủ đề mới (Dòng đầu tiên của nội dung)';
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {/* User Info Column */}
                    <div style={{ width: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', borderRight: '1px solid #e4e6eb', paddingRight: '0.5rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '4px', backgroundColor: '#e4e6eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', marginBottom: '0.25rem' }}>
                        👤
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.75rem', color: '#0966c2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>username</span>
                      <span style={{ fontSize: '0.6rem', color: '#65676b', backgroundColor: '#e4e6eb', padding: '0.1rem 0.25rem', borderRadius: '2px', marginTop: '0.1rem' }}>Thành viên</span>
                    </div>

                    {/* Post Content Column */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.7rem', color: '#65676b', marginBottom: '0.5rem' }}>
                        Đăng hôm nay lúc 10:42 PM
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', color: '#050505', fontSize: '0.85rem', lineHeight: '1.5', minHeight: '60px' }}>
                        {composerMode === 'multi_library' ? (
                          selectedTemplates.length > 0 ? (
                            <div>
                              <p style={{ color: 'var(--color-primary-hover)', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                                📝 Đã chọn {selectedTemplates.length} bài viết từ kho:
                              </p>
                              <ul style={{ paddingLeft: '1.25rem', margin: 0, listStyleType: 'disc', fontSize: '0.85rem' }}>
                                {selectedTemplates.map(id => {
                                  const t = templates.find(temp => temp.id === id);
                                  return t ? <li key={id} style={{ marginBottom: '0.25rem' }}>{t.title}</li> : null;
                                })}
                              </ul>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa chọn bài viết nào từ kho...</span>
                          )
                        ) : (
                          (() => {
                            const text = (customContentPerPlatform ? (platformContents['newf319'] || '') : postContent) || '';
                            const lines = text.split('\n');
                            // Content is from the second line onwards
                            const bodyText = lines.slice(1).join('\n').trim();
                            return bodyText || <span style={{ color: '#8c8c8c', fontStyle: 'italic' }}>Nội dung chi tiết bài viết sẽ hiển thị ở đây (từ dòng thứ 2)...</span>;
                          })()
                        )}
                      </div>

                      {composerMode === 'single' && uploadedMedia.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: uploadedMedia.length === 1 ? '1fr' : '1fr 1fr', gap: '4px', marginTop: '0.5rem', borderRadius: '4px', overflow: 'hidden' }}>
                          {uploadedMedia.map((path, idx) => {
                            const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                            return (
                              <div key={idx} style={{ position: 'relative', paddingBottom: uploadedMedia.length === 1 ? '56.25%' : '100%', height: 0, backgroundColor: '#f0f2f5' }}>
                                {isVideo ? (
                                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', color: '#65676b' }}>
                                    🎥 Video
                                  </div>
                                ) : (
                                  <img src={path} alt="Preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#65676b', fontSize: '0.75rem', marginTop: '1rem', borderTop: '1px solid #e4e6eb', paddingTop: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                          <span style={{ cursor: 'pointer', color: '#0966c2' }}>👍 Thích</span>
                          <span style={{ cursor: 'pointer' }}>⚠️ Báo vi phạm</span>
                        </div>
                        <span style={{ cursor: 'pointer', color: '#0966c2', fontWeight: 600 }}>💬 Trả lời</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* SOCIAL CARD MOCKUP (X & Threads) */
                <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#21262d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                    {previewPlatform === 'x' ? '🐦' : '👤'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>Tài khoản đại diện</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>@username · 1s</span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem', color: '#e7e9ea', fontSize: '0.9rem', lineHeight: '1.4' }}>
                      {composerMode === 'multi_library' ? (
                        selectedTemplates.length > 0 ? (
                          <div>
                            <p style={{ color: 'var(--color-primary-hover)', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                              📝 Đã chọn {selectedTemplates.length} bài viết từ kho:
                            </p>
                            <ul style={{ paddingLeft: '1.25rem', margin: 0, listStyleType: 'disc', fontSize: '0.85rem' }}>
                              {selectedTemplates.map(id => {
                                const t = templates.find(temp => temp.id === id);
                                return t ? <li key={id} style={{ marginBottom: '0.25rem' }}>{t.title}</li> : null;
                              })}
                            </ul>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa chọn bài viết nào từ kho...</span>
                        )
                      ) : (
                        (customContentPerPlatform ? (platformContents[previewPlatform] || '') : postContent) || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Nội dung bài viết sẽ hiển thị ở đây...</span>
                      )}
                    </div>
                    {composerMode === 'single' && uploadedMedia.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: uploadedMedia.length === 1 ? '1fr' : '1fr 1fr', gap: '4px', marginTop: '0.5rem', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                        {uploadedMedia.map((path, idx) => {
                          const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                          return (
                            <div key={idx} style={{ position: 'relative', paddingBottom: uploadedMedia.length === 1 ? '56.25%' : '100%', height: 0, backgroundColor: '#15181c' }}>
                              {isVideo ? (
                                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
                                  🎥 Video
                                </div>
                              ) : (
                                <img src={path} alt="Preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#71767b', fontSize: '0.85rem', marginTop: '1rem', maxWidth: '300px' }}>
                      <span>💬 0</span>
                      <span>🔁 0</span>
                      <span>❤️ 0</span>
                      <span>📊 0</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Giải thích cơ chế đăng giãn cách</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p>
                Nếu bạn chọn <strong>Đăng giãn cách</strong> cho 3 tài khoản với thời gian khởi điểm là 10:00:
              </p>
              <ul style={{ listStyle: 'decimal', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <li>Tài khoản 1: Lên lịch lúc 10:00 + (trễ ngẫu nhiên 5-15 phút) = <strong>~10:07</strong></li>
                <li>Tài khoản 2: Lên lịch lúc 10:07 + (trễ ngẫu nhiên 5-15 phút) = <strong>~10:19</strong></li>
                <li>Tài khoản 3: Lên lịch lúc 10:19 + (trễ ngẫu nhiên 5-15 phút) = <strong>~10:31</strong></li>
              </ul>
              <p style={{ color: 'var(--color-success)', fontWeight: 500 }}>
                ✔️ Giúp phân tán tần suất yêu cầu IP, giảm thiểu tỷ lệ liên kết tài khoản chéo và chống bị quét bot hàng loạt!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM TABLE: ACTIVE SCHEDULER JOBS */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div className="card-title" style={{ margin: 0 }}>
            Danh sách bài đăng đã lên lịch / hoạt động ({composerJobs.length})
          </div>
          {selectedJobs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', backgroundColor: 'var(--border-color)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 600 }}>Đã chọn: {selectedJobs.length}</span>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handleBulkRepost}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                disabled={loading}
              >
                🔄 Đăng lại đã chọn
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                onClick={handleBulkDelete}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: 'var(--color-danger)', border: 'none', color: '#ffffff' }}
                disabled={loading}
              >
                🗑️ Xóa đã chọn
              </button>
            </div>
          )}
        </div>
        {composerJobs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Chưa có bài viết nào được lên lịch.
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input 
                      type="checkbox" 
                      checked={composerJobs.length > 0 && selectedJobs.length === composerJobs.length} 
                      onChange={handleSelectAllJobs}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>ID</th>
                  <th>Tài khoản</th>
                  <th>Nội dung</th>
                  <th>Thời gian chạy</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {composerJobs.map((job) => {
                  let badgeClass = 'badge-unknown';
                  if (job.status === 'completed') badgeClass = 'badge-live';
                  else if (job.status === 'failed') badgeClass = 'badge-die';
                  else if (job.status === 'processing') badgeClass = 'badge-checkpoint';

                  return (
                    <tr key={job.id}>
                      <td>
                        <input 
                          type="checkbox" 
                          checked={selectedJobs.includes(job.id)} 
                          onChange={() => handleJobSelectToggle(job.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td>#{job.id}</td>
                      <td>
                        <strong>@{job.username || 'unknown'}</strong>
                        {job.platform && (
                          <span className="badge badge-unknown" style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', marginLeft: '0.4rem', textTransform: 'uppercase' }}>
                            {job.platform}
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.post_content || ''}>
                        {job.post_content}
                      </td>
                      <td>
                        {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString('vi-VN') : '-'}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{job.status}</span>
                        {job.status === 'completed' && job.post_url && (
                          <div style={{ marginTop: '0.25rem' }}>
                            <a 
                              href={job.post_url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style={{ 
                                color: '#3b82f6', 
                                fontSize: '0.75rem', 
                                textDecoration: 'underline',
                                fontWeight: 500,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px'
                              }}
                              title="Mở bài viết đã đăng trên nền tảng"
                            >
                              Xem bài viết 🔗
                            </a>
                          </div>
                        )}
                        {job.status === 'failed' && job.error_log && (
                          <div style={{ color: 'var(--color-danger)', fontSize: '0.75rem', marginTop: '0.2rem', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.error_log}>
                            Lỗi: {job.error_log}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => handleLoadToEditor(job)}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: 'var(--border-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                            title="Nạp vào khung soạn thảo để chỉnh sửa và đăng lại"
                          >
                            ✏️ Sửa
                          </button>
                          {(job.status === 'completed' || job.status === 'failed') && (
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={() => handleQuickRepost(job)}
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                              title="Đăng lại ngay lập tức bài viết này"
                            >
                              🔄 Đăng lại
                            </button>
                          )}
                          <button
                            className="btn btn-danger"
                            type="button"
                            onClick={() => handleDeleteJob(job.id, job.status)}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: 'transparent', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
                            title={job.status === 'pending' ? 'Hủy lịch đăng bài' : 'Xóa lịch sử bài đăng'}
                          >
                            {job.status === 'pending' ? '❌ Hủy' : '🗑️ Xóa'}
                          </button>
                        </div>
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
  );
}

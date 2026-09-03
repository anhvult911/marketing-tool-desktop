'use client';

import { useState, useEffect, useRef } from 'react';
import { getTwitterLength } from '@/lib/twitter';

interface Template {
  id: number;
  title: string;
  content: string;
  media_paths: any;
  tags: string | null;
  type?: string;
  created_at: string;
  updated_at: string;
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

function safeParseTags(tags: any): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch (e) {
      return tags.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

interface CompatibilityResult {
  valid: boolean;
  charCount: number;
  maxChars: number;
  message: string;
  error?: string;
}

const checkPlatformCompatibility = (
  content: string,
  media: string[]
): Record<string, CompatibilityResult> => {
  const isVideoFile = (path: string) => {
    const p = path.toLowerCase();
    return p.endsWith('.mp4') || p.endsWith('.webm') || p.endsWith('.mov');
  };

  const charCount = content.length;
  const numImages = media.filter(p => !isVideoFile(p)).length;
  const numVideos = media.filter(p => isVideoFile(p)).length;
  const totalMedia = numImages + numVideos;

  // 1. Facebook
  const fbMax = 50000;
  const fbValid = charCount <= fbMax;
  const fbResult: CompatibilityResult = {
    valid: fbValid,
    charCount,
    maxChars: fbMax,
    message: fbValid ? 'Hợp lệ' : `Vượt quá ${fbMax} ký tự`,
    error: fbValid ? undefined : 'Quá giới hạn ký tự'
  };

  // 2. X (Twitter)
  const xMax = 280;
  const xCharCount = getTwitterLength(content);
  let xValid = xCharCount <= xMax;
  let xError = '';
  if (!xValid) {
    xError = 'Quá giới hạn ký tự';
  } else {
    if (numVideos > 0 && numImages > 0) {
      xValid = false;
      xError = 'Không được trộn ảnh & video';
    } else if (numVideos > 1) {
      xValid = false;
      xError = 'Tối đa 1 video';
    } else if (numImages > 4) {
      xValid = false;
      xError = 'Tối đa 4 ảnh';
    }
  }
  const xResult: CompatibilityResult = {
    valid: xValid,
    charCount: xCharCount,
    maxChars: xMax,
    message: xValid ? 'Hợp lệ' : xError,
    error: xValid ? undefined : xError
  };

  // 3. Threads
  const threadsMax = 500;
  let threadsValid = charCount <= threadsMax;
  let threadsError = '';
  if (!threadsValid) {
    threadsError = 'Quá giới hạn ký tự';
  } else if (totalMedia > 10) {
    threadsValid = false;
    threadsError = 'Tối đa 10 ảnh/video';
  }
  const threadsResult: CompatibilityResult = {
    valid: threadsValid,
    charCount,
    maxChars: threadsMax,
    message: threadsValid ? 'Hợp lệ' : threadsError,
    error: threadsValid ? undefined : threadsError
  };

  // 4. Zalo
  const zaloMax = 2000;
  let zaloValid = charCount <= zaloMax;
  let zaloError = '';
  if (!zaloValid) {
    zaloError = 'Quá giới hạn ký tự';
  } else {
    if (numVideos > 0 && numImages > 0) {
      zaloValid = false;
      zaloError = 'Không được trộn ảnh & video';
    } else if (numVideos > 1) {
      zaloValid = false;
      zaloError = 'Tối đa 1 video';
    } else if (numImages > 9) {
      zaloValid = false;
      zaloError = 'Tối đa 9 ảnh';
    }
  }
  const zaloResult: CompatibilityResult = {
    valid: zaloValid,
    charCount,
    maxChars: zaloMax,
    message: zaloValid ? 'Hợp lệ' : zaloError,
    error: zaloValid ? undefined : zaloError
  };

  // 5. Telegram
  const teleMax = totalMedia > 0 ? 1024 : 4000;
  let teleValid = charCount <= teleMax;
  let teleError = '';
  if (!teleValid) {
    teleError = totalMedia > 0 ? 'Caption tối đa 1024 ký tự' : 'Tin nhắn tối đa 4000 ký tự';
  } else if (totalMedia > 10) {
    teleValid = false;
    teleError = 'Tối đa 10 ảnh/video';
  }
  const telegramResult: CompatibilityResult = {
    valid: teleValid,
    charCount,
    maxChars: teleMax,
    message: teleValid ? 'Hợp lệ' : teleError,
    error: teleValid ? undefined : teleError
  };

  // 6. Instagram
  const instaMax = 2200;
  let instaValid = charCount <= instaMax;
  let instaError = '';
  if (!instaValid) {
    instaError = 'Quá giới hạn ký tự';
  } else if (totalMedia === 0) {
    instaValid = false;
    instaError = 'Bắt buộc có ít nhất 1 ảnh/video';
  } else if (totalMedia > 10) {
    instaValid = false;
    instaError = 'Tối đa 10 ảnh/video';
  }
  const instagramResult: CompatibilityResult = {
    valid: instaValid,
    charCount,
    maxChars: instaMax,
    message: instaValid ? 'Hợp lệ' : instaError,
    error: instaValid ? undefined : instaError
  };

  // 7. TikTok
  const tiktokMax = 2200;
  let tiktokValid = charCount <= tiktokMax;
  let tiktokError = '';
  if (!tiktokValid) {
    tiktokError = 'Quá giới hạn ký tự';
  } else if (totalMedia === 0) {
    tiktokValid = false;
    tiktokError = 'Bắt buộc có ít nhất 1 tệp media';
  } else if (numVideos > 1) {
    tiktokValid = false;
    tiktokError = 'Tối đa 1 video';
  } else if (numImages > 10) {
    tiktokValid = false;
    tiktokError = 'Tối đa 10 ảnh';
  }
  const tiktokResult: CompatibilityResult = {
    valid: tiktokValid,
    charCount,
    maxChars: tiktokMax,
    message: tiktokValid ? 'Hợp lệ' : tiktokError,
    error: tiktokValid ? undefined : tiktokError
  };

  // 8. YouTube
  const ytMax = 10000;
  let ytValid = charCount <= ytMax;
  let ytError = '';
  if (!ytValid) {
    ytError = 'Quá giới hạn ký tự';
  } else if (numVideos > 0) {
    ytValid = false;
    ytError = 'Chỉ hỗ trợ ảnh cho bài đăng cộng đồng';
  } else if (numImages > 5) {
    ytValid = false;
    ytError = 'Tối đa 5 ảnh';
  }
  const youtubeResult: CompatibilityResult = {
    valid: ytValid,
    charCount,
    maxChars: ytMax,
    message: ytValid ? 'Hợp lệ' : ytError,
    error: ytValid ? undefined : ytError
  };

  return {
    facebook: fbResult,
    x: xResult,
    threads: threadsResult,
    zalo: zaloResult,
    telegram: telegramResult,
    instagram: instagramResult,
    tiktok: tiktokResult,
    youtube: youtubeResult
  };
};

export default function LibraryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  
  // Form states
  const [editingId, setEditingId] = useState<number | null>(null);
  const [contentType, setContentType] = useState<'post' | 'seeding'>('post');
  const [spinTrigger, setSpinTrigger] = useState<number>(0);
  const [title, setTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [uploadedMedia, setUploadedMedia] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [activePopoverIndex, setActivePopoverIndex] = useState<number | null>(null);

  const tagInputRef = useRef(tagInput);
  useEffect(() => {
    tagInputRef.current = tagInput;
  }, [tagInput]);

  // Search, Filter, and Sort states
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [contentTypeFilter, setContentTypeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('latest');

  // Modal and Pagination states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, tagFilter]);

  const handleNewClick = () => {
    resetForm();
    setIsFormModalOpen(true);
  };

  const handlePreviewClick = (tpl: Template) => {
    setPreviewTemplate(tpl);
    setIsPreviewModalOpen(true);
  };
  
  // Status states
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tag-pill-container')) {
        setActivePopoverIndex(null);
      }
    };
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  // Auto-rotate spintax preview every 2.5 seconds
  useEffect(() => {
    if (contentType !== 'seeding' || !isFormModalOpen) return;
    const interval = setInterval(() => {
      setSpinTrigger(prev => prev + 1);
    }, 2500);
    return () => clearInterval(interval);
  }, [contentType, isFormModalOpen]);

  // Compute all unique tags in current workspace
  const allExistingTags = Array.from(
    new Set(
      templates.flatMap(tpl => safeParseTags(tpl.tags))
    )
  ).filter(Boolean);

  // Filter suggestions
  const suggestions = allExistingTags.filter(tag => {
    const isAlreadySelected = selectedTags.some(t => t.toLowerCase() === tag.toLowerCase());
    const matchesInput = tag.toLowerCase().includes(tagInput.toLowerCase());
    return !isAlreadySelected && matchesInput;
  });

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) {
      setIsAddingTag(false);
      return;
    }
    const isDuplicate = selectedTags.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (!isDuplicate) {
      setSelectedTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
    tagInputRef.current = '';
    setShowAutocomplete(false);
    setIsAddingTag(false);
    setActiveSuggestionIndex(0);
  };

  const removeTag = (indexToRemove: number) => {
    setSelectedTags(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showAutocomplete && suggestions.length > 0 && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        addTag(suggestions[activeSuggestionIndex]);
      } else {
        addTag(tagInput);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showAutocomplete) {
        setShowAutocomplete(true);
      } else if (suggestions.length > 0) {
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showAutocomplete && suggestions.length > 0) {
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      }
    } else if (e.key === 'Escape') {
      setShowAutocomplete(false);
    }
  };

  const handleTagInputFocus = () => {
    setShowAutocomplete(true);
  };

  const handleTagInputBlur = () => {
    setTimeout(() => {
      const currentVal = tagInputRef.current;
      if (currentVal.trim()) {
        addTag(currentVal);
      } else {
        setIsAddingTag(false);
        setShowAutocomplete(false);
      }
    }, 200);
  };

  // Filter & sort templates list
  const processedTemplates = templates
    .filter(tpl => {
      const matchesSearch = searchQuery.trim() === '' || 
        tpl.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tpl.content.toLowerCase().includes(searchQuery.toLowerCase());
      
      let matchesTag = true;
      if (tagFilter) {
        const tagsList = safeParseTags(tpl.tags);
        matchesTag = tagsList.some(t => t.toLowerCase() === tagFilter.toLowerCase());
      }

      let matchesType = true;
      if (contentTypeFilter !== 'all') {
        const itemType = tpl.type || 'post';
        matchesType = itemType === contentTypeFilter;
      }

      return matchesSearch && matchesTag && matchesType;
    })
    .sort((a, b) => {
      if (sortBy === 'latest') {
        const timeA = new Date(a.updated_at || a.created_at).getTime();
        const timeB = new Date(b.updated_at || b.created_at).getTime();
        return timeB - timeA;
      }
      if (sortBy === 'oldest') {
        const timeA = new Date(a.updated_at || a.created_at).getTime();
        const timeB = new Date(b.updated_at || b.created_at).getTime();
        return timeA - timeB;
      }
      if (sortBy === 'title_asc') {
        return a.title.localeCompare(b.title, 'vi');
      }
      if (sortBy === 'title_desc') {
        return b.title.localeCompare(a.title, 'vi');
      }
      return 0;
    });

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/library');
      const data = await res.json();
      if (data.success) {
        setTemplates(data.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

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
        setMessage({ text: 'Tải ảnh/video đính kèm thành công.', type: 'success' });
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

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setPostContent('');
    setUploadedMedia([]);
    setSelectedTags([]);
    setTagInput('');
    setIsAddingTag(false);
    setActivePopoverIndex(null);
    setIsFormModalOpen(false); // Close modal
    setMessage(null);
    setContentType('post');
  };

  const handleCancelClick = () => {
    const isDirty = title.trim() !== '' || postContent.trim() !== '' || uploadedMedia.length > 0 || selectedTags.length > 0;
    if (isDirty) {
      if (confirm('Bạn có chắc chắn muốn hủy bỏ? Mọi nội dung đang soạn thảo sẽ không được lưu.')) {
        resetForm();
      }
    } else {
      resetForm();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !postContent.trim()) {
      setMessage({ text: 'Vui lòng nhập tiêu đề và nội dung bài viết.', type: 'error' });
      return;
    }

    setLoading(true);
    setMessage(null);

    const isEditing = editingId !== null;
    const url = '/api/library';
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          title: title.trim(),
          content: postContent,
          mediaPaths: contentType === 'post' ? uploadedMedia : [],
          tags: selectedTags,
          type: contentType
        })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: 'success' });
        resetForm();
        fetchTemplates();
      } else {
        setMessage({ text: data.error, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleEditLoad = (tpl: Template) => {
    setEditingId(tpl.id);
    setContentType(tpl.type === 'seeding' ? 'seeding' : 'post');
    setTitle(tpl.title);
    setPostContent(tpl.content);
    setUploadedMedia(safeParseMediaPaths(tpl.media_paths));
    setSelectedTags(safeParseTags(tpl.tags));
    setIsFormModalOpen(true); // Open form modal
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài viết mẫu này khỏi kho lưu trữ?')) return;
    try {
      const res = await fetch('/api/library', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        fetchTemplates();
        if (editingId === id) {
          resetForm();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePublishRedirect = (id: number) => {
    window.location.href = `/composer?templateId=${id}`;
  };

  return (
    <div>
      <style>{`
        .tags-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
        }

        .tag-pill-container {
          position: relative;
          display: inline-block;
        }

        .tag-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.3rem 0.75rem;
          border-radius: 50px;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          user-select: none;
          transition: all 0.15s ease;
        }

        .tag-pill:hover {
          background-color: var(--border-color);
          border-color: var(--text-muted);
        }

        .tag-pill-arrow {
          color: var(--text-secondary);
          font-size: 0.55rem;
          transition: transform 0.15s ease;
        }

        .tag-pill-container.active .tag-pill-arrow {
          transform: rotate(180deg);
        }

        .tag-remove-popover {
          position: absolute;
          top: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 0.35rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 10;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .btn-remove-tag {
          background-color: var(--color-primary);
          color: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 0.35rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 0.15s ease;
        }

        .btn-remove-tag:hover {
          background-color: var(--color-primary-hover);
        }

        .add-tag-trigger {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.3rem 0.75rem;
          border-radius: 50px;
          background-color: rgba(47, 129, 247, 0.1);
          border: 1px solid rgba(47, 129, 247, 0.2);
          color: var(--color-primary-hover);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .add-tag-trigger:hover {
          background-color: rgba(47, 129, 247, 0.18);
          border-color: var(--color-primary-hover);
        }

        .active-tag-input-container {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.65rem;
          border-radius: 50px;
          background-color: var(--bg-primary);
          border: 1.5px solid var(--color-primary);
          box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.25);
          height: 32px;
          position: relative;
        }

        .active-tag-input-plus {
          color: var(--color-primary-hover);
          font-weight: bold;
          font-size: 0.95rem;
          user-select: none;
        }

        .active-tag-input {
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-size: 0.85rem;
          width: 90px;
          padding: 0;
        }

        .tag-autocomplete-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          width: 180px;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          z-index: 1200;
          max-height: 180px;
          overflow-y: auto;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        /* Modal Layout */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1100;
          padding: 1rem;
        }

        .modal-content {
          background-color: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          width: 100%;
          max-width: 650px;
          max-height: 90vh;
          overflow: hidden;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
        }

        .modal-header {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
        }

        .modal-title {
          font-size: 1.2rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .modal-close-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 1.5rem;
          cursor: pointer;
          line-height: 1;
        }

        .modal-close-btn:hover {
          color: var(--text-primary);
        }

        .modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
        }

        .modal-footer {
          padding: 1rem 1.5rem;
          border-top: 1px solid var(--border-color);
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          flex-shrink: 0;
          background-color: rgba(0,0,0,0.1);
        }

        /* Table Layout */
        .mkt-table-container {
          width: 100%;
          overflow-x: auto;
          margin-top: 1rem;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background-color: var(--bg-card);
        }

        .mkt-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }

        .mkt-table th, .mkt-table td {
          padding: 0.85rem 1rem;
          text-align: left;
          border-bottom: 1px solid var(--border-color);
        }

        .mkt-table th {
          background-color: var(--bg-tertiary);
          color: var(--text-secondary);
          font-weight: 600;
          user-select: none;
        }

        .mkt-table tr:last-child td {
          border-bottom: none;
        }

        .mkt-table tr:hover {
          background-color: rgba(255, 255, 255, 0.015);
        }

        .td-title {
          font-weight: 600;
          color: var(--color-primary-hover);
          cursor: pointer;
        }

        .td-title:hover {
          text-decoration: underline;
        }

        .td-content-preview {
          color: var(--text-secondary);
          max-width: 250px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .action-cell {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          justify-content: center;
          flex-wrap: nowrap;
        }

        .btn-action {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.4rem 0.7rem;
          font-size: 0.8rem;
          font-weight: 500;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          background-color: var(--bg-tertiary);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          line-height: 1.2;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .btn-action:hover {
          background-color: var(--border-color);
          color: var(--text-primary);
          border-color: var(--text-muted);
          transform: translateY(-1px);
        }

        .btn-action:active {
          transform: translateY(0);
        }

        .btn-action-primary {
          background-color: rgba(47, 129, 247, 0.1);
          border-color: rgba(47, 129, 247, 0.35);
          color: var(--color-primary-hover);
        }

        .btn-action-primary:hover {
          background-color: var(--color-primary);
          border-color: var(--color-primary);
          color: #ffffff;
          box-shadow: 0 0 8px rgba(47, 129, 247, 0.4);
        }

        .btn-action-danger {
          background-color: rgba(248, 81, 73, 0.05);
          border-color: rgba(248, 81, 73, 0.25);
          color: var(--color-danger);
        }

        .btn-action-danger:hover {
          background-color: var(--color-danger);
          border-color: var(--color-danger);
          color: #ffffff;
          box-shadow: 0 0 8px rgba(248, 81, 73, 0.4);
        }

        .btn-warning {
          background-color: var(--color-warning-glow);
          border-color: rgba(210, 153, 34, 0.3);
          color: var(--color-warning);
        }

        .btn-warning:hover {
          background-color: var(--color-warning);
          border-color: var(--color-warning);
          color: #ffffff;
          box-shadow: 0 0 8px rgba(210, 153, 34, 0.4);
        }

        /* Pagination */
        .pagination-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 1.25rem;
          padding: 0.5rem;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .pagination-pages {
          display: flex;
          gap: 0.35rem;
        }

        .pagination-btn {
          padding: 0.35rem 0.75rem;
          border-radius: 6px;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .pagination-btn:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
          border-color: var(--text-muted);
        }

        .pagination-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
}

        .pagination-btn.active {
          background-color: rgba(47, 129, 247, 0.15);
          color: var(--color-primary-hover);
          border-color: var(--color-primary);
        }

        /* Platform Compatibility Checker Styles */
        .compatibility-section {
          margin-top: 0.75rem;
          padding: 0.75rem;
          background-color: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 8px;
        }

        .compatibility-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }

        .compatibility-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 0.5rem;
        }

        .compatibility-card {
          padding: 0.5rem 0.6rem;
          border-radius: 6px;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          font-size: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          transition: all 0.15s ease;
        }

        .compatibility-card.valid {
          border-left: 3px solid var(--color-success);
        }

        .compatibility-card.invalid {
          border-left: 3px solid var(--color-danger);
          background-color: rgba(248, 81, 73, 0.03);
        }

        .compatibility-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 600;
        }

        .compatibility-status-icon {
          font-size: 0.75rem;
        }

        .compatibility-details {
          color: var(--text-secondary);
          font-size: 0.7rem;
        }

        .compatibility-error-msg {
          color: var(--color-danger);
          font-size: 0.65rem;
          line-height: 1.15;
          margin-top: 0.15rem;
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Kho bài viết (Content Pool)</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Lưu trữ, biên tập trước các mẫu bài viết và dễ dàng phát hành lên các tài khoản xã hội.
          </p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={handleNewClick}
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.6rem 1.2rem', fontWeight: 600 }}
        >
          ➕ Thêm mẫu bài đăng
        </button>
      </div>

      {/* Message Alert */}
      {message && !isFormModalOpen && (
        <div className={`alert alert-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Full-width Listing Toolbar */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Search box */}
          <div style={{ flex: 2, minWidth: '250px' }}>
            <input
              type="text"
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Tìm kiếm tiêu đề hoặc nội dung..."
              style={{ width: '100%', height: '38px' }}
            />
          </div>

          {/* Filter by Tag */}
          <div style={{ flex: 1, minWidth: '160px' }}>
            <select
              className="input"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              style={{ width: '100%', height: '38px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              <option value="">🏷️ Tất cả tag / epic</option>
              {allExistingTags.map((tag, idx) => (
                <option key={idx} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>

          {/* Filter by Content Type */}
          <div style={{ flex: 1, minWidth: '160px' }}>
            <select
              className="input"
              value={contentTypeFilter}
              onChange={(e) => setContentTypeFilter(e.target.value)}
              style={{ width: '100%', height: '38px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              <option value="all">📂 Tất cả loại</option>
              <option value="post">📝 Bài viết chiến dịch</option>
              <option value="seeding">💬 Kịch bản Seeding</option>
            </select>
          </div>

          {/* Sort dropdown */}
          <div style={{ flex: 1, minWidth: '160px' }}>
            <select
              className="input"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ width: '100%', height: '38px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              <option value="latest">⏱️ Mới nhất</option>
              <option value="oldest">⏱️ Cũ nhất</option>
              <option value="title_asc">🔤 Tiêu đề A-Z</option>
              <option value="title_desc">🔤 Tiêu đề Z-A</option>
            </select>
          </div>
        </div>

        {/* Clear filter button if filtering active */}
        {(searchQuery || tagFilter || contentTypeFilter !== 'all') && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tìm thấy {processedTemplates.length} / {templates.length} kết quả.</span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setTagFilter('');
                setContentTypeFilter('all');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary-hover)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: 0,
                textDecoration: 'underline'
              }}
            >
              Xóa bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* Listing Content */}
      <div className="card" style={{ padding: '0.5rem' }}>
        {templates.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '1rem' }}>📭</span>
            Kho bài viết trống. Hãy nhấn nút <strong>Thêm mẫu bài đăng</strong> phía trên để tạo bài viết đầu tiên!
          </div>
        ) : processedTemplates.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '1rem' }}>🔍</span>
            Không tìm thấy bài viết nào khớp với từ khóa hoặc bộ lọc thẻ đã chọn.
          </div>
        ) : (
          <>
            <div className="mkt-table-container">
              <table className="mkt-table">
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>Tiêu đề</th>
                    <th style={{ width: 'auto' }}>Nội dung mẫu</th>
                    <th style={{ width: '18%' }}>Tag / Epic</th>
                    <th style={{ width: '110px', minWidth: '110px' }}>Cập nhật</th>
                    <th style={{ width: '290px', minWidth: '290px', textAlign: 'center' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {processedTemplates
                    .slice((currentPage - 1) * 25, currentPage * 25)
                    .map((tpl) => {
                      return (
                        <tr key={tpl.id}>
                          <td className="td-title" onClick={() => handlePreviewClick(tpl)}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span style={{ fontWeight: 500 }}>{tpl.title}</span>
                              <span style={{
                                alignSelf: 'flex-start',
                                fontSize: '0.65rem',
                                padding: '0.05rem 0.35rem',
                                borderRadius: '4px',
                                backgroundColor: tpl.type === 'seeding' ? 'rgba(247, 129, 47, 0.15)' : 'rgba(47, 129, 247, 0.15)',
                                color: tpl.type === 'seeding' ? '#f0883e' : '#2f81f7',
                                border: tpl.type === 'seeding' ? '1px solid rgba(247, 129, 47, 0.3)' : '1px solid rgba(47, 129, 247, 0.3)',
                                fontWeight: 500
                              }}>
                                {tpl.type === 'seeding' ? '💬 Seeding' : '📝 Bài viết'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="td-content-preview">{tpl.content}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {safeParseTags(tpl.tags).length > 0 ? (
                                safeParseTags(tpl.tags).map((t, idx) => (
                                  <span 
                                    key={idx} 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTagFilter(t);
                                    }}
                                    style={{
                                      fontSize: '0.7rem',
                                      padding: '0.15rem 0.35rem',
                                      borderRadius: '4px',
                                      backgroundColor: 'var(--bg-tertiary)',
                                      border: '1px solid var(--border-color)',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    🏷️ {t}
                                  </span>
                                ))
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Chưa phân loại</span>
                              )}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', width: '110px', minWidth: '110px' }}>
                            {new Date(tpl.updated_at || tpl.created_at).toLocaleDateString('vi-VN')}
                          </td>
                          <td style={{ textAlign: 'center', width: '290px', minWidth: '290px' }}>
                            <div className="action-cell">
                              <button
                                className="btn-action"
                                onClick={() => handlePreviewClick(tpl)}
                                title="Xem chi tiết"
                              >
                                👁️ Xem
                              </button>
                              <button
                                className="btn-action"
                                onClick={() => handleEditLoad(tpl)}
                                title="Sửa bài viết"
                              >
                                ✏️ Sửa
                              </button>
                              <button
                                className="btn-action btn-action-danger"
                                onClick={() => handleDelete(tpl.id)}
                                title="Xóa bài viết"
                              >
                                🗑️ Xóa
                              </button>
                              <button
                                className="btn-action btn-action-primary"
                                onClick={() => handlePublishRedirect(tpl.id)}
                                title="Đăng bài này"
                              >
                                🚀 Đăng
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {processedTemplates.length > 25 && (
              <div className="pagination-container">
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Hiển thị {(currentPage - 1) * 25 + 1} - {Math.min(currentPage * 25, processedTemplates.length)} trong tổng số {processedTemplates.length} dòng
                </span>
                <div className="pagination-pages">
                  <button
                    className="pagination-btn"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  >
                    Trước
                  </button>
                  {Array.from({ length: Math.ceil(processedTemplates.length / 25) }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    className="pagination-btn"
                    disabled={currentPage === Math.ceil(processedTemplates.length / 25)}
                    onClick={() => setCurrentPage(prev => Math.min(Math.ceil(processedTemplates.length / 25), prev + 1))}
                  >
                    Sau
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* POPUP MODAL: CREATE / EDIT FORM */}
      {isFormModalOpen && (
        <div className="modal-overlay" onClick={handleCancelClick}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {editingId ? `Chỉnh sửa mẫu bài viết #${editingId}` : 'Thêm mẫu bài viết mới'}
              </h3>
              <button className="modal-close-btn" onClick={handleCancelClick}>
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                {message && (
                  <div className={`alert alert-${message.type}`}>
                    <span>{message.type === 'success' ? '✅' : '⚠️'} {message.text}</span>
                  </div>
                )}
                {/* Content Type Selector */}
                <div className="form-group">
                  <label className="form-label">Loại nội dung</label>
                  <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: contentType === 'post' ? 600 : 400 }}>
                      <input
                        type="radio"
                        name="contentType"
                        checked={contentType === 'post'}
                        onChange={() => setContentType('post')}
                      />
                      📝 Bài viết chiến dịch (Facebook, X, Telegram...)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: contentType === 'seeding' ? 600 : 400 }}>
                      <input
                        type="radio"
                        name="contentType"
                        checked={contentType === 'seeding'}
                        onChange={() => setContentType('seeding')}
                      />
                      💬 Kịch bản Seeding (Spin Text)
                    </label>
                  </div>
                </div>

                {/* Title Input */}
                <div className="form-group">
                  <label className="form-label">
                    {contentType === 'seeding' ? 'Tên mẫu kịch bản Seeding' : 'Tiêu đề mẫu bài đăng'}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={contentType === 'seeding' ? "Ví dụ: Seeding sản phẩm, Kịch bản chào mừng..." : "Ví dụ: Cập nhật Bitcoin sáng thứ 2, Khuyến mãi nạp..."}
                  />
                </div>

                {/* Text Area Content */}
                <div className="form-group">
                  <label className="form-label">
                    {contentType === 'seeding' ? 'Nội dung kịch bản (Spin Text)' : 'Nội dung bài viết'}
                  </label>
                  <textarea
                    className="textarea"
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    placeholder={contentType === 'seeding' 
                      ? "Soạn nội dung kịch bản seeding ở đây. Có thể dùng cú pháp Spin Text để ngẫu nhiên hóa tin nhắn, ví dụ:\n{Chào bạn|Hi|Hello} mình là {chuyên viên|admin}..." 
                      : "Soạn nội dung mẫu ở đây..."
                    }
                    style={{ minHeight: '160px' }}
                  />

                  {/* Spin Text Tester for Seeding Content */}
                  {contentType === 'seeding' && (
                    <div style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-primary-hover)' }}>
                          🔍 Thử nghiệm Spin Text ngẫu nhiên:
                        </span>
                        <button
                          type="button"
                          onClick={() => setSpinTrigger(prev => prev + 1)}
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '4px',
                            backgroundColor: 'var(--color-primary)',
                            color: '#ffffff',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          Xoay ngẫu nhiên ({spinTrigger})
                        </button>
                      </div>
                      <div 
                        key={spinTrigger}
                        style={{ 
                          fontSize: '0.85rem', 
                          color: 'var(--text-primary)', 
                          fontStyle: 'italic', 
                          whiteSpace: 'pre-wrap',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          minHeight: '2rem',
                          animation: 'spintax-fade 0.3s ease-out'
                        }}
                      >
                        {(() => {
                          if (!postContent.trim()) return 'Chưa có nội dung soạn thảo...';
                          const _ = spinTrigger;
                          return postContent.replace(/{([^{}]+)}/g, (match, choices) => {
                            const arr = choices.split('|');
                            return arr[Math.floor(Math.random() * arr.length)];
                          });
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Platform Compatibility Checker */}
                  {contentType === 'post' && (() => {
                    const comp = checkPlatformCompatibility(postContent, uploadedMedia);
                    const platforms = [
                      { id: 'facebook', name: 'Facebook', icon: '📘' },
                      { id: 'x', name: 'X (Twitter)', icon: '🐦' },
                      { id: 'threads', name: 'Threads', icon: '🪶' },
                      { id: 'zalo', name: 'Zalo', icon: '💬' },
                      { id: 'telegram', name: 'Telegram', icon: '✈️' },
                      { id: 'instagram', name: 'Instagram', icon: '📸' },
                      { id: 'tiktok', name: 'TikTok', icon: '🎵' },
                      { id: 'youtube', name: 'YouTube', icon: '📺' }
                    ];

                    return (
                      <div className="compatibility-section">
                        <div className="compatibility-title">
                          📊 Tính toán tương thích nền tảng
                        </div>
                        <div className="compatibility-grid">
                          {platforms.map((p) => {
                            const res = comp[p.id];
                            return (
                              <div key={p.id} className={`compatibility-card ${res.valid ? 'valid' : 'invalid'}`}>
                                <div className="compatibility-card-header">
                                  <span>{p.icon} {p.name}</span>
                                  <span className="compatibility-status-icon">
                                    {res.valid ? '✅' : '❌'}
                                  </span>
                                </div>
                                <div className="compatibility-details">
                                  {res.charCount.toLocaleString()}/{res.maxChars.toLocaleString()} ký tự
                                </div>
                                {res.error && (
                                  <div className="compatibility-error-msg">
                                    ⚠️ {res.error}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Tag / Epic Input */}
                <div className="form-group">
                  <label className="form-label">Phân loại (Tag / Epic)</label>
                  <div className="tags-container">
                    {selectedTags.map((tag, idx) => (
                      <div 
                        key={idx} 
                        className={`tag-pill-container ${activePopoverIndex === idx ? 'active' : ''}`}
                      >
                        <button
                          type="button"
                          className="tag-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePopoverIndex(prev => prev === idx ? null : idx);
                          }}
                        >
                          🏷️ {tag} <span className="tag-pill-arrow">▼</span>
                        </button>

                        {/* Remove Popover */}
                        {activePopoverIndex === idx && (
                          <div className="tag-remove-popover">
                            <button
                              type="button"
                              className="btn-remove-tag"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTag(idx);
                                setActivePopoverIndex(null);
                              }}
                            >
                              Remove tag
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add Tag Section */}
                    {isAddingTag ? (
                      <div className="active-tag-input-container">
                        <span className="active-tag-input-plus">+</span>
                        <input
                          type="text"
                          className="active-tag-input"
                          autoFocus
                          value={tagInput}
                          onChange={(e) => {
                            setTagInput(e.target.value);
                            setShowAutocomplete(true);
                            setActiveSuggestionIndex(0);
                          }}
                          onFocus={handleTagInputFocus}
                          onKeyDown={handleTagInputKeyDown}
                          onBlur={handleTagInputBlur}
                          placeholder=""
                        />

                        {/* Autocomplete Dropdown */}
                        {showAutocomplete && suggestions.length > 0 && (
                          <div className="tag-autocomplete-dropdown">
                            {suggestions.map((sug, idx) => (
                              <div
                                key={idx}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  addTag(sug);
                                }}
                                style={{
                                  padding: '0.5rem 0.75rem',
                                  cursor: 'pointer',
                                  fontSize: '0.85rem',
                                  backgroundColor: idx === activeSuggestionIndex ? 'rgba(47, 129, 247, 0.2)' : 'transparent',
                                  color: idx === activeSuggestionIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  transition: 'background-color 0.15s ease'
                                }}
                                onMouseEnter={() => setActiveSuggestionIndex(idx)}
                              >
                                🏷️ {sug}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="add-tag-trigger"
                        onClick={() => {
                          setIsAddingTag(true);
                          setShowAutocomplete(true);
                          setActiveSuggestionIndex(0);
                        }}
                      >
                        + Add tag
                      </button>
                    )}
                  </div>
                </div>

                {/* Media File Upload (Only for post) */}
                {contentType === 'post' && (
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
                        File đính kèm sẽ được lưu trữ cùng bài đăng mẫu
                      </span>
                    </div>

                    {/* Previews */}
                    {uploadedMedia.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        {uploadedMedia.map((path, idx) => {
                          const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                          return (
                            <div 
                              key={idx} 
                              style={{ 
                                position: 'relative', 
                                width: '70px', 
                                height: '70px', 
                                borderRadius: '6px', 
                                border: '1px solid var(--border-color)', 
                                overflow: 'hidden',
                                backgroundColor: '#000000'
                              }}
                            >
                              {isVideo ? (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
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
                                  cursor: 'pointer'
                                }}
                              >
                                &times;
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={handleCancelClick} disabled={loading}>
                  ❌ Hủy
                </button>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? '⏳ Đang lưu...' : editingId ? '💾 Cập nhật mẫu' : '💾 Lưu vào kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* POPUP MODAL: PREVIEW DETAIL */}
      {isPreviewModalOpen && previewTemplate && (
        <div className="modal-overlay" onClick={() => setIsPreviewModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Xem chi tiết bài viết</h3>
              <button className="modal-close-btn" onClick={() => setIsPreviewModalOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong style={{ fontSize: '1.2rem', color: 'var(--color-primary-hover)' }}>
                  {previewTemplate.title}
                </strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Cập nhật cuối: {new Date(previewTemplate.updated_at || previewTemplate.created_at).toLocaleString('vi-VN')}
                </div>
              </div>

              {/* Tags Display */}
              {safeParseTags(previewTemplate.tags).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {safeParseTags(previewTemplate.tags).map((t, idx) => (
                    <span 
                      key={idx}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      🏷️ {t}
                    </span>
                  ))}
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />

              {/* Content body */}
              <div 
                style={{ 
                  color: 'var(--text-primary)', 
                  whiteSpace: 'pre-wrap', 
                  fontSize: '0.95rem',
                  lineHeight: '1.6',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  paddingRight: '0.25rem'
                }}
              >
                {previewTemplate.content}
              </div>

              {/* Media Attachments */}
              {(() => {
                let mediaList: string[] = safeParseMediaPaths(previewTemplate.media_paths);

                if (mediaList.length === 0) return null;

                return (
                  <div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                      Hình ảnh / Video đính kèm:
                    </span>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {mediaList.map((path, idx) => {
                        const isVideo = path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov');
                        return (
                          <div 
                            key={idx} 
                            style={{ 
                              width: '100px', 
                              height: '100px', 
                              borderRadius: '6px', 
                              border: '1px solid var(--border-color)', 
                              overflow: 'hidden',
                              backgroundColor: '#000000',
                              cursor: 'zoom-in'
                            }}
                            onClick={() => window.open(path, '_blank')}
                          >
                            {isVideo ? (
                              <video src={path} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                            ) : (
                              <img src={path} alt="Attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => setIsPreviewModalOpen(false)}
              >
                ❌ Đóng
              </button>
              <button 
                className="btn btn-warning" 
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  handleEditLoad(previewTemplate);
                }}
              >
                ✏️ Sửa bài viết
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  handlePublishRedirect(previewTemplate.id);
                }}
              >
                🚀 Đăng bài này
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

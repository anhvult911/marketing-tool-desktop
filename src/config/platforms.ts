export interface TargetTypeConfig {
  value: string;
  label: string;
  placeholder: string;
  prefixBehavior: 'none' | 'username' | 'hashtag';
  validateRegex?: string; // stored as string for flexibility
}

export interface PlatformConfig {
  id: string;
  label: string;
  isCrawlerSupported: boolean;
  targetTypes: TargetTypeConfig[];
}

export const PLATFORMS_MAP: Record<string, PlatformConfig> = {
  x: {
    id: 'x',
    label: 'X (Twitter)',
    isCrawlerSupported: true,
    targetTypes: [
      { value: 'username', label: 'KOL (Username)', placeholder: 'Nhập @username (ví dụ: @elonmusk)', prefixBehavior: 'username' },
      { value: 'hashtag', label: 'Hashtag thị trường', placeholder: 'Nhập #hashtag (ví dụ: #Bitcoin hoặc Crypto)', prefixBehavior: 'hashtag' }
    ]
  },
  newf319: {
    id: 'newf319',
    label: 'newF319.com (Diễn đàn)',
    isCrawlerSupported: true,
    targetTypes: [
      { value: 'category', label: 'Chuyên mục (ID / URL)', placeholder: 'Nhập mã chuyên mục (ví dụ: thi-truong-chung-khoan.2 hoặc 2 hoặc URL)', prefixBehavior: 'none' }
    ]
  },
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'channel_group', label: 'Kênh/Nhóm (Link hoặc @username)', placeholder: 'Nhập https://t.me/ten_nhom hoặc @ten_nhom', prefixBehavior: 'none' }
    ]
  },
  zalo: {
    id: 'zalo',
    label: 'Zalo',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'group_link', label: 'Link nhóm Zalo', placeholder: 'Nhập https://zalo.me/g/xxxxxx', prefixBehavior: 'none' },
      { value: 'phone', label: 'Số điện thoại', placeholder: 'Nhập số điện thoại (ví dụ: 0912345678)', prefixBehavior: 'none' }
    ]
  },
  threads: {
    id: 'threads',
    label: 'Threads',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'username', label: 'KOL (Username)', placeholder: 'Nhập @username (ví dụ: @zuck)', prefixBehavior: 'username' },
      { value: 'hashtag', label: 'Hashtag thị trường', placeholder: 'Nhập #hashtag (ví dụ: #marketing)', prefixBehavior: 'hashtag' }
    ]
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    isCrawlerSupported: true,
    targetTypes: [
      { value: 'page', label: 'Liên kết Fanpage', placeholder: 'Nhập https://facebook.com/page_name', prefixBehavior: 'none' },
      { value: 'group', label: 'Liên kết Nhóm (Group)', placeholder: 'Nhập https://facebook.com/groups/id', prefixBehavior: 'none' }
    ]
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'username', label: 'KOL Profile', placeholder: 'Nhập @username (ví dụ: @cristiano)', prefixBehavior: 'username' },
      { value: 'hashtag', label: 'Hashtag', placeholder: 'Nhập #hashtag (ví dụ: #travel)', prefixBehavior: 'hashtag' }
    ]
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'username', label: 'KOL Profile', placeholder: 'Nhập @username (ví dụ: @tiktok)', prefixBehavior: 'username' },
      { value: 'hashtag', label: 'Hashtag', placeholder: 'Nhập #hashtag (ví dụ: #fyp)', prefixBehavior: 'hashtag' }
    ]
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    isCrawlerSupported: false,
    targetTypes: [
      { value: 'channel', label: 'Kênh (Link hoặc @handle)', placeholder: 'Nhập @MrBeast hoặc URL kênh', prefixBehavior: 'none' },
      { value: 'keyword', label: 'Từ khóa tìm kiếm', placeholder: 'Nhập từ khóa (ví dụ: tin tức bitcoin)', prefixBehavior: 'none' }
    ]
  }
};

export interface PlatformSafetyRule {
  minDelayMins: {
    safe: number;
    balanced: number;
    turbo: number;
  };
  maxDailyCapacity: {
    safe: number;
    balanced: number;
    turbo: number;
  };
  criticalMinDelayMins: number; // Ngưỡng delay dưới mức này sẽ báo động đỏ
  criticalDailyCapacity: number; // Ngưỡng số tin/ngày vượt mức này sẽ báo động đỏ
  banRiskDescription: string;
  penaltyType: string;
}

export const PLATFORM_SAFETY_MAP: Record<string, Record<string, PlatformSafetyRule>> = {
  facebook: {
    message: {
      minDelayMins: { safe: 5, balanced: 3, turbo: 1.5 },
      maxDailyCapacity: { safe: 20, balanced: 35, turbo: 55 },
      criticalMinDelayMins: 1.5,
      criticalDailyCapacity: 45,
      banRiskDescription: 'Thuật toán Facebook Messenger tự động phát hiện chuỗi tin nhắn gửi liên tục đến người lạ, dẫn đến hạn chế chat hoặc khóa tài khoản.',
      penaltyType: 'Checkpoint 282/956 & Khóa vĩnh viễn tính năng nhắn tin (Messenger Block)'
    },
    comment: {
      minDelayMins: { safe: 4, balanced: 2, turbo: 1 },
      maxDailyCapacity: { safe: 35, balanced: 55, turbo: 80 },
      criticalMinDelayMins: 1.0,
      criticalDailyCapacity: 75,
      banRiskDescription: 'Facebook tự động gắn cờ Spam nếu bình luận cùng 1 nội dung hoặc tần suất quá dày trên nhiều bài viết/nhóm.',
      penaltyType: 'Khóa tính năng bình luận (24h - 7 ngày) & Ẩn bình luận (Shadowban)'
    }
  },
  telegram: {
    message: {
      minDelayMins: { safe: 6, balanced: 3.5, turbo: 2 },
      maxDailyCapacity: { safe: 15, balanced: 30, turbo: 50 },
      criticalMinDelayMins: 2.0,
      criticalDailyCapacity: 35,
      banRiskDescription: 'Telegram có cơ chế Peer-to-Peer SpamBot cực nhạy khi gửi DM cho người dùng chưa lưu danh bạ hoặc chưa từng chat.',
      penaltyType: 'Mute Spambot vĩnh viễn & Lỗi FloodWait (chặn gửi tin 24h - 48h)'
    },
    group_post: {
      minDelayMins: { safe: 3, balanced: 1.5, turbo: 0.8 },
      maxDailyCapacity: { safe: 35, balanced: 60, turbo: 100 },
      criticalMinDelayMins: 0.8,
      criticalDailyCapacity: 80,
      banRiskDescription: 'Bot quản trị nhóm (RoseBot, Combot...) tự động kick và mute nick nếu phát hiện gửi bài tự động liên tục.',
      penaltyType: 'Cấm chat (Mute) & Kick khỏi tất cả các nhóm mục tiêu'
    }
  },
  zalo: {
    message: {
      minDelayMins: { safe: 4, balanced: 2.5, turbo: 1.5 },
      maxDailyCapacity: { safe: 25, balanced: 45, turbo: 70 },
      criticalMinDelayMins: 1.5,
      criticalDailyCapacity: 50,
      banRiskDescription: 'Zalo kiểm soát chặt chẽ hành vi tìm kiếm SĐT lạ và gửi tin nhắn mời kết bạn dồn dập trong ngày.',
      penaltyType: 'Tạm khóa tài khoản Zalo & Chặn tính năng tìm kiếm qua SĐT'
    }
  },
  whatsapp: {
    message: {
      minDelayMins: { safe: 5, balanced: 3, turbo: 1.5 },
      maxDailyCapacity: { safe: 20, balanced: 35, turbo: 60 },
      criticalMinDelayMins: 1.5,
      criticalDailyCapacity: 50,
      banRiskDescription: 'WhatsApp giám sát chặt chẽ tỷ lệ bị người lạ bấm "Report/Block". Gửi dồn dập nhiều SĐT lạ sẽ bị khóa tài khoản vĩnh viễn (Spam Flag).',
      penaltyType: 'Khóa tài khoản WhatsApp (Account Banned) & Mất phiên đăng nhập'
    },
    group_post: {
      minDelayMins: { safe: 4, balanced: 2, turbo: 1 },
      maxDailyCapacity: { safe: 30, balanced: 50, turbo: 80 },
      criticalMinDelayMins: 1.0,
      criticalDailyCapacity: 70,
      banRiskDescription: 'Gửi tin nhắn spam liên tục vào nhiều nhóm khác nhau sẽ bị admin nhóm report hoặc WhatsApp khóa quyền tham gia nhóm.',
      penaltyType: 'Cấm tham gia nhóm mới & Hạn chế quyền gửi tin trong nhóm'
    }
  },
  x: {
    comment: {
      minDelayMins: { safe: 3, balanced: 1.5, turbo: 0.8 },
      maxDailyCapacity: { safe: 40, balanced: 70, turbo: 100 },
      criticalMinDelayMins: 0.8,
      criticalDailyCapacity: 90,
      banRiskDescription: 'Hệ thống AI của X (Twitter) phát hiện và gắn cờ tài khoản Spam nếu reply quá nhiều tweet trong thời gian ngắn.',
      penaltyType: 'Shadowban tìm kiếm, ẩn reply vào mục "Probable Spam" & Đình chỉ tài khoản'
    }
  },
  threads: {
    comment: {
      minDelayMins: { safe: 3, balanced: 2, turbo: 1 },
      maxDailyCapacity: { safe: 35, balanced: 60, turbo: 90 },
      criticalMinDelayMins: 1.0,
      criticalDailyCapacity: 75,
      banRiskDescription: 'Threads áp dụng bộ lọc tương tự Instagram, tự động chặn hành động nếu gửi reply liên tục.',
      penaltyType: 'Chặn tương tác (Action Blocked) & Cảnh báo vi phạm tiêu chuẩn cộng đồng'
    },
    post: {
      minDelayMins: { safe: 6, balanced: 3, turbo: 2 },
      maxDailyCapacity: { safe: 20, balanced: 35, turbo: 50 },
      criticalMinDelayMins: 2.0,
      criticalDailyCapacity: 45,
      banRiskDescription: 'Đăng bài mới liên tục và gắn thẻ (tag) nhiều người dùng sẽ bị hệ thống phát hiện hành vi spam tag.',
      penaltyType: 'Giảm phân phối (Reach Limit) & Khóa tạm thời tài khoản Threads'
    }
  },
  newf319: {
    comment: {
      minDelayMins: { safe: 4, balanced: 2, turbo: 1 },
      maxDailyCapacity: { safe: 30, balanced: 50, turbo: 80 },
      criticalMinDelayMins: 1.0,
      criticalDailyCapacity: 65,
      banRiskDescription: 'Diễn đàn newF319 kiểm tra Flood Control giữa các bài viết trả lời.',
      penaltyType: 'Ban IP / Ban tài khoản diễn đàn do hành vi spam bài viết'
    },
    post: {
      minDelayMins: { safe: 10, balanced: 5, turbo: 3 },
      maxDailyCapacity: { safe: 10, balanced: 20, turbo: 35 },
      criticalMinDelayMins: 2.5,
      criticalDailyCapacity: 25,
      banRiskDescription: 'Tạo nhiều chủ đề (thread) liên tiếp trong thời gian ngắn vi phạm nội quy đăng tin diễn đàn.',
      penaltyType: 'Xóa toàn bộ bài viết & Khóa tài khoản vĩnh viễn'
    }
  },
  instagram: {
    comment: {
      minDelayMins: { safe: 3, balanced: 1.5, turbo: 0.8 },
      maxDailyCapacity: { safe: 40, balanced: 70, turbo: 100 },
      criticalMinDelayMins: 0.8,
      criticalDailyCapacity: 80,
      banRiskDescription: 'Bộ lọc tự động của Instagram quét tương tác giả lập.',
      penaltyType: 'Chặn tính năng bình luận (Action Blocked)'
    }
  },
  tiktok: {
    comment: {
      minDelayMins: { safe: 2, balanced: 1, turbo: 0.5 },
      maxDailyCapacity: { safe: 50, balanced: 90, turbo: 150 },
      criticalMinDelayMins: 0.5,
      criticalDailyCapacity: 120,
      banRiskDescription: 'Bộ lọc bình luận TikTok ẩn các bình luận có nội dung lặp lại.',
      penaltyType: 'Ẩn bình luận tự động (Shadow Mute)'
    }
  },
  youtube: {
    comment: {
      minDelayMins: { safe: 3, balanced: 1.5, turbo: 0.8 },
      maxDailyCapacity: { safe: 35, balanced: 60, turbo: 90 },
      criticalMinDelayMins: 0.8,
      criticalDailyCapacity: 80,
      banRiskDescription: 'Hệ thống chống Spam của YouTube tự động chuyển bình luận vào mục "Spam / Chờ duyệt".',
      penaltyType: 'Ẩn bình luận & Khóa kênh'
    }
  }
};

export const DURATION_PRESETS = [
  { value: '10m', label: '⚡ Siêu tốc (10 phút)', minutes: 10, desc: 'Chiến dịch Flash, bắt sóng sự kiện' },
  { value: '30m', label: '⏱️ 30 phút', minutes: 30, desc: 'Phủ sóng nhanh trong buổi' },
  { value: '2h', label: '🕐 2 giờ', minutes: 120, desc: 'Tốc độ vừa phải, giãn cách đều' },
  { value: '12h', label: '🌅 12 giờ (Khuyên dùng)', minutes: 720, desc: 'Chiến dịch ban ngày, an toàn cao' },
  { value: '24h', label: '📅 24 giờ', minutes: 1440, desc: 'Dàn đều cả ngày, tối ưu bảo vệ nick' },
  { value: 'custom', label: '🕒 Tùy chỉnh...', minutes: 0, desc: 'Nhập thời gian theo nhu cầu' }
];

export function getPlatformSafetyRule(platform: string, action: string): PlatformSafetyRule {
  const normPlatform = platform === 'messenger' ? 'facebook' : platform;
  const platformRules = PLATFORM_SAFETY_MAP[normPlatform] || PLATFORM_SAFETY_MAP['facebook'];
  
  if (platformRules[action]) {
    return platformRules[action];
  }
  
  // Fallback to first available action
  const firstKey = Object.keys(platformRules)[0];
  return platformRules[firstKey];
}

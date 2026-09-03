# 📑 KẾ HOẠCH CHI TIẾT: MIGRATION SANG ELECTRON DESKTOP EDITION

**Dự án:** MKT Tools - Desktop Edition  
**Thư mục đích:** `D:\Projects\marketing-tool-desktop`  
**Mục tiêu:** Chuyển đổi toàn bộ nền tảng Marketing Automation từ Web App (VPS/Docker/Postgres/Redis) sang Desktop App thuần (Electron + Next.js + SQLite + Playwright), tối ưu hóa khả năng chạy tự động hóa và giải quyết triệt để các vấn đề của VPS.

---

## 🏗️ 1. So sánh Kiến trúc (Web/VPS vs. Desktop)

```
               LỘ TRÌNH CHUYỂN ĐỔI KIẾN TRÚC TỔNG THỂ
               
  [Bản Web / VPS Cũ]                         [Bản Desktop Mới]
  ├── Postgres / Redis / BullMQ     ───►    ├── SQLite Local (better-sqlite3) + Event Queue
  ├── Next.js Server Auth (Cookies)  ───►    ├── Local Single-User & Desktop Workspace Context
  ├── Headless Chromium trên Linux   ───►    ├── Headful / Native Chromium trên Windows GUI
  ├── Next.js API Routes (Postgres)  ───►    ├── Refactor sang SQLite Queries
  └── PM2 Process Supervisor         ───►    └── Electron UtilityProcess (Background Engine)
```

---

## 🎯 2. Các Giai đoạn Thực hiện Chi tiết

### GIAI ĐOẠN 1: Chuẩn hóa & Di chuyển Toàn bộ API Routes sang SQLite
Refactor toàn bộ API trong `src/app/api/` từ cú pháp Postgres sang `better-sqlite3`:

1. **Accounts API (`src/app/api/accounts/route.ts`)**:
   - Chuyển toàn bộ truy vấn CRUD tài khoản mạng xã hội sang SQLite.
   - Quản lý đường dẫn profile an toàn tại `%APPDATA%\marketing-tool-desktop\profiles\`.
   - Đơn giản hóa cơ chế xác thực sang Local Session.
2. **Proxies API (`src/app/api/proxies/route.ts`)**:
   - Chuyển CRUD Proxies sang SQLite.
   - Hỗ trợ kiểm tra Live/Dead Proxy trực tiếp từ máy cục bộ.
3. **Jobs / Campaigns API (`src/app/api/jobs/route.ts`)**:
   - Chuyển logic đẩy hàng đợi `enqueueJob` sang `localQueue.addJob()`.
   - Lưu trữ và cập nhật trạng thái bài viết/chiến dịch vào bảng `jobs` SQLite.
4. **Spam & Seeding API (`src/app/api/spam/route.ts`)**:
   - Quản lý mục tiêu cào (`scrape_targets`), bài viết đã cào (`scraped_posts`).
   - Quản lý kịch bản SpinText (`spam_templates`) trong SQLite.
5. **Post Composer & Media Library (`src/app/api/library/route.ts`, `upload/route.ts`)**:
   - Lưu trữ nội dung mẫu và đường dẫn media trực tiếp tại `%APPDATA%\uploads\`.
6. **Analytics & Dashboard API (`src/app/api/analytics/route.ts`)**:
   - Tổng hợp số liệu từ bảng `jobs` để vẽ biểu đồ SVG thời gian thực.
7. **AI / Gemini API (`src/app/api/ai/route.ts`)**:
   - Lưu trữ và đọc `gemini_api_key` từ bảng `settings` SQLite.
8. **Workspace Management API (`src/app/api/workspace/route.ts`)**:
   - Hỗ trợ chuyển đổi nhanh giữa các Workspace trên máy tính cục bộ.

---

### GIAI ĐOẠN 2: Tái cấu trúc Worker & Automation Engine
1. **Viết lại `worker/worker.ts`**:
   - Loại bỏ hoàn toàn BullMQ và Redis.
   - Lắng nghe sự kiện từ `localQueue.on('process-job', async (job) => { ... })`.
   - Kết nối trực tiếp với các module tự động hóa: `XAutomation`, `ZaloAutomation`, `TelegramAutomation`, `ThreadsAutomation`, `FacebookAutomation`, `WhatsAppAutomation`.
   - Tích hợp vòng lặp tự động cào bài (Crawler Loop mỗi 5 phút) và quét nhóm (Scraper Loop mỗi 10 giây).
2. **Vận hành Worker an toàn trong Electron**:
   - Chạy Worker trong tiến trình ngầm `UtilityProcess` của Electron để đảm bảo giao diện UI không bị giật lag khi mở nhiều browser cùng lúc.

---

### GIAI ĐOẠN 3: Tích hợp Tính năng Desktop Đặc quyền
1. **Giải pháp Vượt Checkpoint / Đăng nhập Thủ công (Manual Browser Bypass)**:
   - Khi bấm nút "Mở trình duyệt", Electron gọi IPC `browser:open-manual` mở cửa sổ Chromium thật (headful) trước mắt người dùng.
   - Người dùng tự tay giải Captcha / nhập OTP.
   - Cookies & LocalStorage được lưu vĩnh viễn vào `%APPDATA%\profiles\account_xxx`.
2. **Khay Hệ thống (System Tray & Minimize to Tray)**:
   - Thu nhỏ ứng dụng xuống khay Taskbar góc phải để Background Worker tiếp tục chạy ngầm lịch đăng bài mà không chiếm diện tích màn hình.
3. **Thông báo Hệ điều hành (Native Windows Toast Notifications)**:
   - Báo cáo kết quả bài đăng hoàn tất hoặc cảnh báo tài khoản checkpoint ngay trên thanh thông báo Windows.

---

### GIAI ĐOẠN 4: Hệ thống Tự động Cập nhật (Auto-Updater) & Đóng gói (.exe)
1. **Cấu hình Đóng gói NSIS (`electron-builder.json`)**:
   - Tạo file cài đặt `MKT Tools Desktop Setup.exe` cho Windows 64-bit.
   - Tự động tạo Shortcut Desktop & Start Menu.
   - Bảo toàn dữ liệu: Không xóa `mkt.db` và `profiles` khi người dùng cài đè hoặc gỡ cài đặt.
2. **Tích hợp `electron-updater` & GitHub Releases**:
   - Ứng dụng tự động kiểm tra phiên bản mới từ GitHub Releases.
   - Tải ngầm bản update và hiển thị hộp thoại thông báo khởi động lại để cài đặt.

---

## 📅 3. Lộ trình Thực hiện (Step-by-Step Execution Plan)

| Bước | Nội dung công việc | File liên quan | Trạng thái |
| :---: | :--- | :--- | :---: |
| **B1** | Khởi tạo cấu trúc dự án & Electron Core | `package.json`, `electron/*`, `src/lib/db.ts`, `src/lib/queue.ts` | **[x] Đã hoàn thành** |
| **B2** | Refactor toàn bộ API Routes sang `better-sqlite3` & chuẩn hóa AppData | `src/app/api/**/*`, `src/lib/paths.ts` | **[x] Đã hoàn thành** |
| **B3** | Tái cấu trúc Worker (Bỏ Redis/BullMQ -> Dùng localQueue & utilityProcess) | `worker/worker.ts`, `electron/main.ts` | **[x] Đã hoàn thành** |
| **B4** | Kết nối Standalone Server & Worker Lifecycle trong Electron Main | `electron/main.ts`, `next.config.ts` | **[x] Đã hoàn thành** |
| **B5** | Kiểm thử biên dịch & Schema CSDL (Full Build Verification) | `npm run build` | **[x] Đã hoàn thành** |
| **B6** | Đóng gói bản cài đặt Windows (.exe) & Kiểm thử Auto-Updater | `npm run dist` | **[ ] Sẵn sàng đóng gói** |

---

## 🔒 4. Nguyên tắc Bảo toàn Dữ liệu & An toàn
- Toàn bộ cơ sở dữ liệu `mkt.db`, session trình duyệt `profiles/`, file tải lên `uploads/` đều được quy hoạch lưu tại thư mục hệ thống:  
  `%APPDATA%\marketing-tool-desktop`  
  -> **Cam kết 100% không bị mất dữ liệu khi ứng dụng cập nhật lên các phiên bản mới.**

# MKT Tools - Desktop Edition (Electron + Next.js + Playwright)

Ứng dụng Desktop tự động hóa Marketing đa kênh (X/Twitter, Threads, Zalo, Telegram, Facebook, WhatsApp...), tích hợp cơ sở dữ liệu SQLite cục bộ, hàng đợi local và hệ thống tự động cập nhật (Auto-Updater).

---

## 🛠️ Yêu cầu môi trường
- **Node.js**: Phiên bản `v20.x` trở lên
- **Nền tảng**: Windows 10/11 x64 (Khuyến nghị), macOS, Linux

---

## 🚀 Hướng dẫn Chạy Môi trường Phát triển (Development)

1. **Cài đặt thư viện phụ thuộc:**
   ```bash
   npm install
   ```

2. **Cài đặt nhân trình duyệt Playwright:**
   ```bash
   npx playwright install chromium
   ```

3. **Khởi chạy ứng dụng Desktop (Next.js + Electron cùng lúc):**
   ```bash
   npm run dev
   ```
   Ứng dụng sẽ tự động khởi động Next.js server cục bộ và mở cửa sổ Electron Desktop App.

---

## 📦 Đóng gói File Cài đặt Windows (.exe)

Để đóng gói thành file cài đặt NSIS Setup cho Windows:
```bash
npm run dist
```
File cài đặt hoàn chỉnh sẽ nằm trong thư mục `dist/` (Ví dụ: `dist/MKT Tools Desktop Setup 1.0.0.exe`).

---

## 🔄 Cơ chế Tự động Cập nhật (Auto-Updater)
- Ứng dụng tích hợp sẵn `electron-updater` liên kết với **GitHub Releases** của repo này.
- Khi đẩy Release mới lên GitHub, app Desktop của người dùng sẽ tự động kiểm tra, tải ngầm và hiển thị thông báo nâng cấp.
- Toàn bộ cơ sở dữ liệu (`mkt.db`) và session tài khoản (`profiles/`) được lưu an toàn tại `%APPDATA%\marketing-tool-desktop` nên **không bao giờ bị mất dữ liệu khi cập nhật phiên bản mới**.

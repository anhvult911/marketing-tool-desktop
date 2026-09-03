import type { Metadata } from "next";
import "./globals.css";
import ResponsiveLayout from "@/components/ResponsiveLayout";

export const metadata: Metadata = {
  title: "MKT Tools - Dashboard",
  description: "Hệ thống quản lý tài khoản và tự động hóa marketing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>
        <ResponsiveLayout>
          {children}
        </ResponsiveLayout>
      </body>
    </html>
  );
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bảo vệ các API routes (/api/*) chống lại Cross-Site Request Forgery (CSRF) & Drive-by access
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const secFetchSite = request.headers.get('sec-fetch-site');

    // 1. Chặn các request được trình duyệt ngoài đánh dấu là cross-site
    if (secFetchSite === 'cross-site') {
      return new NextResponse(
        JSON.stringify({ success: false, error: 'Truy cập bị từ chối: Chặn yêu cầu Cross-Site nguy hiểm.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Nếu có header Origin, bắt buộc host phải là localhost/127.0.0.1
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!ALLOWED_HOSTNAMES.has(originUrl.hostname)) {
          return new NextResponse(
            JSON.stringify({ success: false, error: 'Truy cập bị từ chối: Nguồn gốc yêu cầu (Origin) không hợp lệ.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch {
        return new NextResponse(
          JSON.stringify({ success: false, error: 'Truy cập bị từ chối: Header Origin sai định dạng.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Nếu có header Referer, kiểm tra hostname tương tự
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (!ALLOWED_HOSTNAMES.has(refererUrl.hostname)) {
          return new NextResponse(
            JSON.stringify({ success: false, error: 'Truy cập bị từ chối: Nguồn tham chiếu (Referer) không hợp lệ.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch {
        // Bỏ qua nếu referer không phân tích được cú pháp
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

function buildDashboardCsp(nonce: string): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(IS_DEVELOPMENT ? ["'unsafe-eval'"] : []),
  ].join(" ");
  const connectSources = IS_DEVELOPMENT
    ? "'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    : "'self'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

function buildCallSurfaceCsp(nonce: string): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(IS_DEVELOPMENT ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.zego.im https://*.zego.im wss://*.zego.im wss://*.zego.im:*",
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

function isCallSurface(pathname: string): boolean {
  return pathname === "/patient/join" || pathname.startsWith("/meetings/call/");
}

function permissionsPolicyFor(pathname: string): string {
  if (isCallSurface(pathname)) {
    return "camera=(self), microphone=(self), fullscreen=(self), geolocation=(), payment=(), usb=()";
  }
  return "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("x-nonce", nonce);
  response.headers.set(
    "Content-Security-Policy",
    isCallSurface(request.nextUrl.pathname) ? buildCallSurfaceCsp(nonce) : buildDashboardCsp(nonce),
  );
  response.headers.set("Permissions-Policy", permissionsPolicyFor(request.nextUrl.pathname));
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"],
};

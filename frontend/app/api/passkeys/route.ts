import { NextResponse } from "next/server";

function getApiProxyTarget(): string {
  const rawTarget =
    process.env.NEXT_SERVER_API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://127.0.0.1:8000";
  const normalizedTarget = rawTarget.endsWith("/")
    ? rawTarget.slice(0, -1)
    : rawTarget;

  if (
    normalizedTarget.startsWith("http://") ||
    normalizedTarget.startsWith("https://")
  ) {
    return normalizedTarget;
  }

  return "http://127.0.0.1:8000";
}

export async function GET(request: Request) {
  const headers = new Headers({
    Accept: "application/json",
  });
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.set("Authorization", authorization);
  }

  const response = await fetch(`${getApiProxyTarget()}/passkeys/`, {
    headers,
    cache: "no-store",
  });
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "application/json";

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    },
  });
}

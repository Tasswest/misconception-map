import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackAuthority(authority: string | null) {
  if (!authority) return false;

  try {
    const url = new URL(`http://${authority}`);
    return (
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * This app intentionally has no accounts: it is a single-teacher local
 * workspace. Guard every render and asset request against Host-header rebinding;
 * API routes repeat the check and additionally enforce same-origin writes.
 */
export function proxy(request: NextRequest) {
  if (!isLoopbackAuthority(request.headers.get("host"))) {
    return new NextResponse("Misconception Map is available only on this computer.", {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return NextResponse.next();
}

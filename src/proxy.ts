import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  hostedAccessCookieName,
  isHostedMode,
  verifyHostedAccessCookie,
} from "@/lib/hosted-access";

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
export async function proxy(request: NextRequest) {
  if (isHostedMode()) {
    const pathname = request.nextUrl.pathname;
    const isPublicAccessRoute =
      pathname === "/access" || pathname === "/api/access";
    const isFrameworkAsset =
      pathname.startsWith("/_next/") ||
      pathname === "/icon.svg" ||
      pathname === "/favicon.ico";
    if (isPublicAccessRoute || isFrameworkAsset) return NextResponse.next();

    const session = await verifyHostedAccessCookie(
      request.cookies.get(hostedAccessCookieName())?.value,
    );
    if (session) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "ACCESS_CODE_REQUIRED",
            message: "Enter the shared judge access code to continue.",
          },
        },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const destination = new URL("/access", request.url);
    destination.searchParams.set(
      "next",
      `${pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(destination);
  }

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

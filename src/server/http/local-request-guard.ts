import "server-only";

import { isHostedMode } from "@/lib/hosted-access";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class LocalRequestBodyError extends Error {
  readonly code: "LENGTH_REQUIRED" | "REQUEST_TOO_LARGE";
  readonly status: 411 | 413;

  constructor(
    code: LocalRequestBodyError["code"],
    message: string,
    status: LocalRequestBodyError["status"],
  ) {
    super(message);
    this.name = "LocalRequestBodyError";
    this.code = code;
    this.status = status;
  }
}

function parseLocalAuthority(authority: string | null) {
  if (!authority) return null;
  try {
    const url = new URL(`http://${authority}`);
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

/**
 * This build has no authentication because it is deliberately single-machine.
 * Bind-to-loopback is the first boundary; this request guard also blocks Host
 * header rebinding and browser cross-origin writes. Missing Origin is accepted
 * for explicit local CLI clients such as curl.
 */
export function guardLocalApiRequest(request: Request): Response | null {
  if (isHostedMode()) {
    const forwardedHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!forwardedHost) {
      return Response.json(
        { error: { code: "INVALID_HOST", message: "The request host is missing." } },
        { status: 403 },
      );
    }

    const origin = request.headers.get("origin");
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host.toLowerCase() !== forwardedHost.toLowerCase()) {
          throw new TypeError("Cross-origin hosted request.");
        }
      } catch {
        return Response.json(
          {
            error: {
              code: "CROSS_ORIGIN_REQUEST",
              message: "Cross-origin requests cannot change this shared workspace.",
            },
          },
          { status: 403 },
        );
      }
    }
    return null;
  }

  const host = request.headers.get("host")?.toLowerCase() ?? null;
  const localHost = parseLocalAuthority(host);
  if (!localHost) {
    return Response.json(
      {
        error: {
          code: "LOCAL_ACCESS_ONLY",
          message: "This local workspace accepts requests only on loopback.",
        },
      },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (
        !LOOPBACK_HOSTNAMES.has(originUrl.hostname.toLowerCase()) ||
        originUrl.host.toLowerCase() !== localHost.host.toLowerCase()
      ) {
        throw new TypeError("Cross-origin local request.");
      }
    } catch {
      return Response.json(
        {
          error: {
            code: "CROSS_ORIGIN_REQUEST",
            message: "Cross-origin requests cannot change this local workspace.",
          },
        },
        { status: 403 },
      );
    }
  }

  return null;
}

export function requireDeclaredBodyWithinLimit(
  request: Request,
  maximumBytes: number,
) {
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength || !/^\d+$/.test(declaredLength)) {
    throw new LocalRequestBodyError(
      "LENGTH_REQUIRED",
      "A valid Content-Length header is required for local intake.",
      411,
    );
  }

  const bytes = Number(declaredLength);
  if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) {
    throw new LocalRequestBodyError(
      "REQUEST_TOO_LARGE",
      "The request body is larger than this intake allows.",
      413,
    );
  }

  return bytes;
}

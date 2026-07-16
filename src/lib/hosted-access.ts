const COOKIE_NAME = "mm_judge_access";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

type AccessSession = {
  id: string;
  expiresAt: number;
};

export function isHostedMode() {
  return process.env.HOSTED_MODE === "1";
}

export function hostedAccessCookieName() {
  return COOKIE_NAME;
}

export function hostedAccessSessionLifetimeSeconds() {
  return SESSION_LIFETIME_SECONDS;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(payload: string, accessCode: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(accessCode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createHostedAccessCookie(sessionId: string) {
  const accessCode = process.env.JUDGE_ACCESS_CODE?.trim();
  if (!accessCode) throw new Error("JUDGE_ACCESS_CODE is not configured.");

  const session: AccessSession = {
    id: sessionId,
    expiresAt: Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS,
  };
  const payload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const signed = encodeBase64Url(await signature(payload, accessCode));
  return `${payload}.${signed}`;
}

export async function verifyHostedAccessCookie(value: string | null | undefined) {
  const accessCode = process.env.JUDGE_ACCESS_CODE?.trim();
  if (!accessCode || !value) return null;

  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  try {
    const expected = await signature(payload, accessCode);
    const supplied = decodeBase64Url(suppliedSignature);
    if (!constantTimeEqual(expected, supplied)) return null;

    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as Partial<AccessSession>;
    if (
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.id) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return { id: parsed.id, expiresAt: parsed.expiresAt } satisfies AccessSession;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "radar_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const encoder = new TextEncoder();

/**
 * The session cookie value is an HMAC derived from APP_PASSWORD, so no
 * session store is needed and changing the password signs everyone out.
 */
export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode("tech-radar-session-v1"));
  return Buffer.from(sig).toString("base64url");
}

/** Constant-time string comparison (compares digests so length leaks nothing). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function appPassword(): string | null {
  const p = process.env.APP_PASSWORD;
  return p && p.length >= 8 ? p : null;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  const password = appPassword();
  if (!password || !cookieValue) return false;
  return safeEqual(cookieValue, await sessionToken(password));
}

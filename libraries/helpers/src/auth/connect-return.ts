import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const RETURN_TTL = 24 * 60 * 60;
function parseOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return undefined;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.origin;
  } catch { return undefined; }
}
// Entries already reported, so a bad value warns once instead of on every request.
const warned = new Set<string>();
// CONNECT_RETURN_ORIGIN is a comma-separated list of allowed return origins.
// An invalid entry is skipped with a warning so the valid ones keep working;
// a value with no valid entry at all is an error.
export function connectOrigins(): string[] {
  const entries = (process.env.CONNECT_RETURN_ORIGIN || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const origins: string[] = [];
  for (const raw of entries) {
    const origin = parseOrigin(raw);
    if (origin) origins.push(origin);
    else if (!warned.has(raw)) { warned.add(raw); console.warn(`CONNECT_RETURN_ORIGIN: ignoring invalid origin "${raw}"`); }
  }
  if (entries.length && !origins.length) throw new Error('Invalid connect return origin');
  return origins;
}
// The first origin is the fallback when no return URL is known; undefined when
// none is configured or none is valid, so error paths never throw on it.
export function connectOrigin(): string | undefined {
  try { return connectOrigins()[0]; } catch { return undefined; }
}
export function safeConnectReturn(value: string): string {
  const url = new URL(value);
  if (!connectOrigins().includes(url.origin) || url.username || url.password || !/^\/connect\/[^/]+$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid connect return URL');
  return url.toString();
}
export function returnCookieName(state: string): string {
  return `connect-return-${createHash('sha256').update(state).digest('hex').slice(0, 32)}`;
}
export function signReturnContext(state: string, returnURL: string): string {
  const payload = Buffer.from(JSON.stringify({ state, returnURL: safeConnectReturn(returnURL), exp: Date.now() + RETURN_TTL * 1000 })).toString('base64url');
  const signature = createHmac('sha256', process.env.JWT_SECRET!).update(`connect-return-v1:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
export function readReturnContext(state: string, cookie?: string): string | undefined {
  try {
    if (!cookie || cookie.length > 12000) return undefined;
    const [payload, signature, extra] = cookie.split('.');
    if (extra || !payload || !signature) return undefined;
    const expected = createHmac('sha256', process.env.JWT_SECRET!).update(`connect-return-v1:${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.state !== state || !Number.isFinite(data.exp) || data.exp <= Date.now()) return undefined;
    return safeConnectReturn(data.returnURL);
  } catch { return undefined; }
}

import { z } from 'zod';
import { readBoundedJson } from './http';
import type { Decision, Operation } from './quota';
export function localRequest(request: Request, env: Env): boolean {
  const local = (host: string) => host === 'localhost' || host === '127.0.0.1';
  const origin = request.headers.get('Origin');
  return (
    env.DEMO_ENVIRONMENT === 'local' &&
    local(new URL(request.url).hostname) &&
    (origin !== null
      ? local(new URL(origin).hostname)
      : new URL(request.url).pathname === '/api/config' &&
        request.method === 'GET')
  );
}
export function accessConfigured(request: Request, env: Env): boolean {
  const testKey = (value: string) => /^[123]x0{10}/.test(value);
  return Boolean(
    env.DEMO_SESSIONS &&
    env.DEMO_BUDGET &&
    (env.ABUSE_HASH_SECRET?.length ?? 0) >= 32 &&
    (localRequest(request, env) ||
      (env.TURNSTILE_SITE_KEY?.trim() &&
        env.TURNSTILE_SECRET_KEY?.trim() &&
        !testKey(env.TURNSTILE_SITE_KEY) &&
        !testKey(env.TURNSTILE_SECRET_KEY))),
  );
}
export function accessError(
  headers: Headers,
  code: string,
  status: number,
  retryAfter?: number,
): Response {
  const messages: Record<string, string> = {
    verification_required:
      'A quick visitor check is needed before we chat. Please try again.',
    verification_failed: 'The visitor check didn’t complete. Please try again.',
    verification_expired:
      'Your visitor check has expired. Please try again to continue.',
    visitor_limit:
      'You’ve reached this short demo’s allowance. Please take a break and try again later.',
    network_limit:
      'This network has reached the demo allowance for today. You can still meet every character with About me.',
    demo_limit:
      'The live demo is taking a break for today. You can still meet every character with About me.',
    demo_paused:
      'The live demo is taking a break. You can still explore the characters and their introductions.',
    demo_busy: 'The gnomes are busy chatting. Please try again shortly.',
    request_in_progress:
      'A reply is already being prepared. Please wait a moment.',
    duplicate_request:
      'This request has already been handled. Please send a new message.',
    invalid_request: 'That request could not be read. Please try again.',
  };
  console.info(JSON.stringify({ event: 'demo_denied', code, status }));
  if (retryAfter !== undefined) headers.set('Retry-After', String(retryAfter));
  return Response.json(
    {
      error: {
        code,
        message:
          messages[code] ??
          'The live demo is temporarily unavailable. Please try again later.',
      },
    },
    { status, headers },
  );
}
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
export async function tokenHash(token: string): Promise<string> {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  );
}
async function signingKey(env: Env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ABUSE_HASH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
async function capability(
  nonce: string,
  expiresAt: number,
  origin: string,
  env: Env,
): Promise<string> {
  const payload = nonce + '.' + expiresAt;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(env),
    new TextEncoder().encode('demo:' + payload + ':' + origin),
  );
  return payload + '.' + hex(signature);
}
async function verifyCapability(
  token: string,
  origin: string,
  env: Env,
): Promise<string | undefined> {
  const parts = token.match(/^([a-f0-9]{64})\.(\d{13})\.([a-f0-9]{64})$/);
  if (!parts || Number(parts[2]) <= Date.now()) return undefined;
  const signature = Uint8Array.from(parts[3]!.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(env),
    signature,
    new TextEncoder().encode(
      'demo:' + parts[1] + '.' + parts[2] + ':' + origin,
    ),
  );
  return valid ? parts[1] : undefined;
}
export async function networkHash(
  request: Request,
  env: Env,
  day: string,
): Promise<string> {
  const key = await signingKey(env);
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(
        day + ':' + (request.headers.get('CF-Connecting-IP') ?? 'local'),
      ),
    ),
  );
}
export async function demoSession(
  request: Request,
  env: Env,
  headers: Headers,
  upstream: typeof fetch,
): Promise<Response> {
  let body: unknown;
  try {
    body = await readBoundedJson(new Response(request.body), 4096);
  } catch {
    return accessError(headers, 'invalid_request', 400);
  }
  const parsed = z
    .object({ turnstileToken: z.string().max(2048) })
    .strict()
    .safeParse(body);
  if (!parsed.success) return accessError(headers, 'invalid_request', 400);
  const day = new Date().toISOString().slice(0, 10);
  const ip = await networkHash(request, env, day);
  if (!(await env.DEMO_RATE_LIMITER.limit({ key: 'verify:' + ip })).success)
    return accessError(headers, 'demo_busy', 429, 60);
  if (!localRequest(request, env)) {
    if (!parsed.data.turnstileToken)
      return accessError(headers, 'verification_required', 403);
    const response = await upstream(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: parsed.data.turnstileToken,
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
      },
    );
    const result = response.ok
      ? z
          .object({
            success: z.literal(true),
            hostname: z.string(),
            action: z.literal('gnome_demo'),
          })
          .safeParse(await readBoundedJson(response, 4096))
      : undefined;
    if (!response.ok) await response.body?.cancel();
    if (
      !result?.success ||
      result.data.hostname !== new URL(request.headers.get('Origin')!).hostname
    )
      return accessError(headers, 'verification_failed', 403);
  }
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const hash = await tokenHash(nonce);
  const budget = env.DEMO_BUDGET.getByName(day);
  const decision = await budget.reserve(day, hash, ip, 'verification', 0);
  if (!decision.ok)
    return accessError(
      headers,
      decision.code,
      decision.status,
      decision.retryAfter,
    );
  const expiresAt = await env.DEMO_SESSIONS.getByName(hash).initialize(
    request.headers.get('Origin')!,
  );
  const token = await capability(
    nonce,
    expiresAt,
    request.headers.get('Origin')!,
    env,
  );
  console.info(
    JSON.stringify({ event: 'demo_verification', outcome: 'allowed' }),
  );
  return Response.json({ token, expiresAt }, { headers });
}
export interface Admission {
  finish: () => Promise<void>;
}
export async function admit(
  request: Request,
  env: Env,
  headers: Headers,
  operation: Operation,
  characters: number,
): Promise<Response | Admission> {
  const auth = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([a-f0-9]{64}\.\d{13}\.[a-f0-9]{64})$/);
  const id = request.headers.get('Idempotency-Key');
  if (!auth) return accessError(headers, 'verification_required', 401);
  if (
    !id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    return accessError(headers, 'invalid_request', 400);
  const nonce = await verifyCapability(
    auth[1]!,
    request.headers.get('Origin')!,
    env,
  );
  if (!nonce) return accessError(headers, 'verification_expired', 401);
  const hash = await tokenHash(nonce);
  const visitor = env.DEMO_SESSIONS.getByName(hash);
  const decision = await visitor.reserve(
    request.headers.get('Origin')!,
    id,
    operation,
    characters,
  );
  if (!decision.ok)
    return accessError(
      headers,
      decision.code,
      decision.status,
      decision.retryAfter,
    );
  const day = new Date().toISOString().slice(0, 10);
  const budget = env.DEMO_BUDGET.getByName(day);
  const reservation = await tokenHash(hash + ':' + id);
  const finish = async () => {
    // A missing cleanup cannot reopen a spending allowance: counters are never
    // refunded and leases expire after the bounded provider timeout.
    await Promise.all([
      visitor.finish(id, operation),
      budget.finish(reservation),
    ]);
  };
  let global: Decision;
  try {
    global = await budget.reserve(
      day,
      reservation,
      await networkHash(request, env, day),
      operation,
      characters,
    );
  } catch (error) {
    await visitor.finish(id, operation);
    throw error;
  }
  if (!global.ok) {
    await visitor.finish(id, operation);
    return accessError(headers, global.code, global.status, global.retryAfter);
  }
  return { finish };
}

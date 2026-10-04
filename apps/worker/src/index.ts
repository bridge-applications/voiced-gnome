import { characterRequest } from './characters';
import { DEFAULT_SESSION_SECONDS } from '@bridge-applications/voiced-gnome-types';
import {
  accessConfigured,
  accessError,
  demoSession,
  localRequest,
} from './access';
export { readBoundedJson } from './http';
export { DemoSession, DemoBudget } from './quota';

export async function handleRequest(
  request: Request,
  env: Env,
  upstream: typeof fetch = fetch,
): Promise<Response> {
  const started = Date.now();
  const path = new URL(request.url).pathname;
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const acceptedOrigin = origin !== null && allowed.includes(origin);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (acceptedOrigin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Idempotency-Key',
    );
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  const error = (code: string, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status, headers });
  if (origin !== null && !acceptedOrigin)
    return error('origin_denied', 'This origin is not allowed.', 403);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: acceptedOrigin ? 204 : 403, headers });
  if (path === '/api/config' && request.method === 'GET') {
    const available =
      env.DEMO_ENABLED === 'true' &&
      accessConfigured(request, env) &&
      Boolean(env.CHARACTER_AGENT_ID?.trim() && env.ELEVENLABS_API_KEY?.trim());
    return Response.json(
      {
        liveAvailable: available,
        charactersAvailable: available,
        maxSessionSeconds: DEFAULT_SESSION_SECONDS,
        verification: {
          required: !localRequest(request, env),
          ...(env.TURNSTILE_SITE_KEY
            ? { siteKey: env.TURNSTILE_SITE_KEY }
            : {}),
        },
      },
      { headers },
    );
  }
  // Removed variants are intentionally unreachable, including with valid credentials.
  if (
    ![
      '/api/demo/session',
      '/api/characters/session',
      '/api/characters/speech',
    ].includes(path)
  )
    return error('not_found', 'Route not found.', 404);
  if (request.method !== 'POST')
    return error('method_not_allowed', 'Use POST for conversations.', 405);
  if (!acceptedOrigin)
    return error(
      'origin_required',
      'A permitted browser origin is required.',
      403,
    );
  if (env.DEMO_ENABLED !== 'true')
    return accessError(headers, 'demo_paused', 503);
  if (!accessConfigured(request, env))
    return accessError(headers, 'budget_unavailable', 503);
  let response: Response;
  try {
    response =
      path === '/api/demo/session'
        ? await demoSession(request, env, headers, upstream)
        : await characterRequest(request, env, headers, upstream);
  } catch (cause) {
    console.warn(
      JSON.stringify({
        event: 'demo_failed',
        reason: cause instanceof Error ? cause.name : 'UnknownError',
      }),
    );
    response = accessError(headers, 'budget_unavailable', 503);
  }
  // No IPs, prompts, audio, tokens, signed URLs or provider response bodies.
  console.info(
    JSON.stringify({
      event: 'demo_request',
      route: path,
      status: response.status,
      latencyMs: Date.now() - started,
    }),
  );
  return response;
}
export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

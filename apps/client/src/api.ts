import {
  ApiErrorSchema,
  ConfigSchema,
  SessionSchema,
} from '@bridge-applications/voiced-gnome-types';

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export async function getConfig(signal: AbortSignal) {
  const response = await fetch(`${base}/api/config`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Configuration unavailable');
  return ConfigSchema.parse(await response.json());
}
export async function getSession(signal: AbortSignal) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    signal,
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : 'Unable to start the conversation.',
    );
  }
  const parsed = SessionSchema.safeParse(body);
  if (!parsed.success)
    throw new Error('The voice connection is unavailable. Please try again.');
  return parsed.data;
}

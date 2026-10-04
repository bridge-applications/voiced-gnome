import { voiceResponse } from './voice';
import {
  STORY_VOICES,
  StorySpeechSchema,
  StorySessionRequestSchema,
  StorySessionSchema,
} from '@bridge-applications/voiced-gnome-types';
import { readBoundedJson } from './index';
export async function storyRequest(
  request: Request,
  env: Env,
  headers: Headers,
  upstream: typeof fetch,
): Promise<Response> {
  const error = (message: string, status = 502) =>
    Response.json(
      { error: { code: 'story_unavailable', message } },
      { status, headers },
    );
  if (
    !env.ELEVENLABS_API_KEY?.trim() ||
    !env.STORY_PLANNER_AGENT_ID?.trim() ||
    !env.STORY_CHARACTER_AGENT_ID?.trim()
  )
    return error(
      'Story voices are not connected yet. You can still chat with the gnome.',
      503,
    );
  const path = new URL(request.url).pathname;
  let body: unknown;
  try {
    body = await readBoundedJson(new Response(request.body), 4096);
  } catch {
    return error('That request could not be read.', 400);
  }
  const speech = path === '/api/story/speech';
  const parsed = speech
    ? StorySpeechSchema.safeParse(body)
    : StorySessionRequestSchema.safeParse(body);
  if (!parsed.success)
    return error('Please use a supported story request.', 400);
  const limiter = speech ? env.STORY_RATE_LIMITER : env.SESSION_RATE_LIMITER;
  if (
    !(
      await limiter.limit({
        key: `story:${speech ? 'speech' : StorySessionRequestSchema.parse(body).purpose}:${request.headers.get('CF-Connecting-IP') ?? 'local-development'}`,
      })
    ).success
  ) {
    headers.set('Retry-After', '60');
    return error('Please wait a minute before trying again.', 429);
  }
  try {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(speech ? 60000 : 10000),
    ]);
    if (speech) {
      const input = StorySpeechSchema.parse(body);
      return await voiceResponse(
        request,
        env,
        headers,
        upstream,
        input.text,
        STORY_VOICES[input.speaker],
      );
    }
    const input = StorySessionRequestSchema.parse(body);
    const id =
      input.purpose === 'plan'
        ? env.STORY_PLANNER_AGENT_ID
        : env.STORY_CHARACTER_AGENT_ID;
    const url = new URL(
      'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url',
    );
    url.searchParams.set('agent_id', id);
    const response = await upstream(url, {
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return error('The story connection is unavailable. Please try again.');
    }
    const value = await readBoundedJson(response);
    if (typeof value !== 'object' || value === null || !('signed_url' in value))
      throw new Error('Invalid session');
    return Response.json(
      StorySessionSchema.parse({
        signedUrl: value.signed_url,
        maxSessionSeconds: 180,
      }),
      { headers },
    );
  } catch (cause) {
    console.warn(
      JSON.stringify({
        event: 'story_failed',
        reason: cause instanceof Error ? cause.name : 'UnknownError',
      }),
    );
    return error('The story connection was interrupted. Please try again.');
  }
}

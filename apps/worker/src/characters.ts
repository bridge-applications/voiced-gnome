import {
  CharacterSessionRequestSchema,
  CharacterSpeechSchema,
  CharacterSessionSchema,
  getCharacter,
} from '@bridge-applications/voiced-gnome-types';
import { readBoundedJson } from './http';
import { voiceResponse } from './voice';
import { admit, networkHash } from './access';
export async function characterRequest(
  request: Request,
  env: Env,
  headers: Headers,
  upstream: typeof fetch,
): Promise<Response> {
  const error = (message: string, status = 502) =>
    Response.json(
      { error: { code: 'character_unavailable', message } },
      { status, headers },
    );
  if (!env.CHARACTER_AGENT_ID?.trim() || !env.ELEVENLABS_API_KEY?.trim())
    return error('Character voices are not connected yet.', 503);
  const speech = new URL(request.url).pathname.endsWith('/speech');
  let body: unknown;
  try {
    body = await readBoundedJson(new Response(request.body), 4096);
  } catch {
    return error('That request could not be read.', 400);
  }
  const parsed = speech
    ? CharacterSpeechSchema.safeParse(body)
    : CharacterSessionRequestSchema.safeParse(body);
  if (!parsed.success)
    return error('Choose a supported character and a short message.', 400);
  const character = getCharacter(parsed.data.characterId);
  if (!character) return error('That character could not be found.', 400);
  const limiter = speech ? env.STORY_RATE_LIMITER : env.SESSION_RATE_LIMITER;
  if (
    !(
      await limiter.limit({
        key: `characters:${speech ? 'speech' : 'session'}:${await networkHash(request, env, new Date().toISOString().slice(0, 10))}`,
      })
    ).success
  ) {
    headers.set('Retry-After', '60');
    return error(
      'Please wait a minute before starting another conversation.',
      429,
    );
  }
  const admission = await admit(
    request,
    env,
    headers,
    speech ? 'speech' : 'conversation',
    speech ? CharacterSpeechSchema.parse(body).text.length : 0,
  );
  if (admission instanceof Response) return admission;
  let streaming = false;
  let finishing: Promise<void> | undefined;
  const finish = () =>
    (finishing ??= (async () => {
      try {
        await admission.finish();
      } catch {
        console.warn(JSON.stringify({ event: 'demo_lease_cleanup_failed' }));
      }
    })());
  try {
    if (speech) {
      const response = await voiceResponse(
        request,
        env,
        headers,
        upstream,
        CharacterSpeechSchema.parse(body).text,
        character.voiceId,
      );
      if (!response.ok || !response.body) return response;
      const reader = response.body.getReader();
      streaming = true;
      const audioBody = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              await finish();
              controller.close();
            } else controller.enqueue(value);
          } catch (cause) {
            await reader.cancel().catch(() => undefined);
            await finish();
            controller.error(cause);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await finish();
          }
        },
      });
      return new Response(audioBody, {
        status: response.status,
        headers: response.headers,
      });
    }
    const url = new URL(
      'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url',
    );
    url.searchParams.set('agent_id', env.CHARACTER_AGENT_ID);
    const response = await upstream(url, {
      redirect: 'manual',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: 'provider_failed',
          operation: 'conversation',
          status: response.status,
        }),
      );
      await response.body?.cancel();
      return error('The character could not connect. Please try again.');
    }
    const value = await readBoundedJson(response);
    if (typeof value !== 'object' || value === null || !('signed_url' in value))
      throw Error('Invalid session');
    return Response.json(
      CharacterSessionSchema.parse({
        signedUrl: value.signed_url,
        maxSessionSeconds: 180,
        characterId: character.id,
        voiceId: character.voiceId,
      }),
      { headers },
    );
  } catch (cause) {
    console.warn(
      JSON.stringify({
        event: 'character_failed',
        reason: cause instanceof Error ? cause.name : 'UnknownError',
      }),
    );
    return error('The conversation was interrupted. Please try again.');
  } finally {
    if (!streaming) await finish();
  }
}

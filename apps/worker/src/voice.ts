export async function voiceResponse(
  request: Request,
  env: Env,
  headers: Headers,
  upstream: typeof fetch,
  text: string,
  voiceId: string,
): Promise<Response> {
  const response = await upstream(
    'https://api.elevenlabs.io/v1/text-to-dialogue/stream/with-timestamps?output_format=mp3_44100_128',
    {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        model_id: 'eleven_v4_turbo',
        inputs: [{ text, voice_id: voiceId }],
      }),
    },
  );
  if (!response.ok || !response.body) {
    console.warn(
      JSON.stringify({
        event: 'provider_failed',
        operation: 'speech',
        status: response.status,
      }),
    );
    await response.body?.cancel();
    return Response.json(
      {
        error: {
          code: 'speech_unavailable',
          message: 'This reply could not be voiced. Please try again.',
        },
      },
      { status: 502, headers },
    );
  }
  let bytes = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      bytes += chunk.byteLength;
      if (bytes > 2_000_000) throw Error('Reply audio exceeded its limit');
      c.enqueue(chunk);
    },
  });
  const streamHeaders = new Headers(headers);
  streamHeaders.set('Content-Type', 'application/x-ndjson');
  return new Response(response.body.pipeThrough(bounded), {
    headers: streamHeaders,
  });
}

import { readFile, writeFile, rename } from 'node:fs/promises';
import { elevenLabsKey } from './elevenlabs-auth.mjs';
const metadata = JSON.parse(
  await readFile(
    new URL('../docs/preview-audio.json', import.meta.url),
    'utf8',
  ),
);
const clips = metadata.clips;
const key = await elevenLabsKey();
const names = process.argv.slice(2);
if (!names.length || names.some((name) => !Object.hasOwn(clips, name)))
  throw new Error('Pass one or more existing preview clip names.');
for (const name of names) {
  const clip = clips[name];
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(metadata.voice_id)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clip.text,
        model_id: metadata.model_id,
        voice_settings: metadata.voice_settings,
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Preview ${name} returned HTTP ${response.status}. Upstream body omitted.`,
    );
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1000 || audio.byteLength > 5_000_000)
    throw new Error('Unexpected preview audio size.');
  const destination = new URL(
    '../apps/client/public' + clip.file,
    import.meta.url,
  );
  const temporary = new URL(destination.href + '.tmp');
  await writeFile(temporary, audio);
  await rename(temporary, destination);
  console.log(`${name}: saved ${audio.byteLength} bytes`);
}

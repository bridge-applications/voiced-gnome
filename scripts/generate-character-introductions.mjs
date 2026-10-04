import {
  readFile,
  writeFile,
  rename,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { elevenLabsKey } from './elevenlabs-auth.mjs';
const root = new URL('../', import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL('docs/character-introductions.json', root), 'utf8'),
);
const catalog = JSON.parse(
  await readFile(new URL('packages/types/src/characters.json', root), 'utf8'),
);
const destination = new URL('apps/client/public/introductions/', root);
await mkdir(destination, { recursive: true });
const names = process.argv.slice(2);
if (names.some((name) => !Object.hasOwn(metadata.clips, name)))
  throw Error('Unknown introduction.');
const queue = names.length ? names : catalog.map((c) => c.id);
const key = await elevenLabsKey();
const run = promisify(execFile);
const rhubarb = process.env.RHUBARB_PATH || 'rhubarb';
let cursor = 0;
let failure;
async function generate(id) {
  const clip = metadata.clips[id];
  const character = catalog.find((c) => c.id === id);
  if (!clip || !character) throw Error('Missing introduction: ' + id);
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        clip,
        voiceId: character.voiceId,
        model: metadata.model_id,
        settings: metadata.voice_settings,
      }),
    )
    .digest('hex');
  const audioPath = new URL(id + '.mp3', destination),
    cuePath = new URL(id + '.json', destination);
  try {
    const saved = JSON.parse(await readFile(cuePath, 'utf8'));
    if (
      saved.sourceHash === sourceHash &&
      (await readFile(audioPath)).byteLength > 1000
    ) {
      console.log(id + ': already generated');
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(
    'https://api.elevenlabs.io/v1/text-to-speech/' +
      encodeURIComponent(character.voiceId) +
      '/with-timestamps?output_format=mp3_44100_128',
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
    throw Error(
      id + ': generation HTTP ' + response.status + ' (upstream body omitted)',
    );
  const result = await response.json();
  const audio = Buffer.from(result.audio_base64, 'base64');
  if (audio.byteLength < 1000 || audio.byteLength > 3_000_000)
    throw Error('Invalid audio size: ' + id);
  const alignment = result.normalized_alignment || result.alignment;
  if (!alignment?.characters?.length) throw Error('Missing alignment: ' + id);
  const transcript = alignment.characters.join('');
  const normalize = (value) =>
    value
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9]/g, '');
  const normalized = normalize(transcript);
  if (normalized !== normalize(clip.text))
    throw Error('Alignment text mismatch: ' + id);
  const map = [];
  alignment.characters.forEach((c, i) => {
    for (const char of normalize(c)) map.push(i);
  });
  const beats = clip.beats
    .map((beat) => {
      const offset = normalized.indexOf(normalize(beat.anchor));
      if (offset < 0) throw Error('Missing beat anchor: ' + id);
      return {
        time: alignment.character_start_times_seconds[map[offset]],
        gesture: beat.gesture,
      };
    })
    .sort((a, b) => a.time - b.time);
  const temporary = await mkdtemp(join(tmpdir(), 'gnome-intro-'));
  try {
    const mp3 = join(temporary, 'audio.mp3'),
      wav = join(temporary, 'audio.wav'),
      hint = join(temporary, 'dialogue.txt'),
      cues = join(temporary, 'cues.json');
    await writeFile(mp3, audio);
    await writeFile(hint, clip.text);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      mp3,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    await run(
      rhubarb,
      [
        '-f',
        'json',
        '--extendedShapes',
        'GHX',
        '--threads',
        '2',
        '-d',
        hint,
        '-o',
        cues,
        wav,
      ],
      { maxBuffer: 2_000_000 },
    );
    const timing = JSON.parse(await readFile(cues, 'utf8'));
    if (
      timing.metadata.duration < 8 ||
      timing.metadata.duration > 40 ||
      !timing.mouthCues.length
    )
      throw Error('Unexpected clip duration/cues: ' + id);
    for (const beat of beats)
      if (!Number.isFinite(beat.time) || beat.time > timing.metadata.duration)
        throw Error('Invalid gesture time: ' + id);
    const data = {
      characterId: id,
      text: clip.text,
      voiceId: character.voiceId,
      modelId: metadata.model_id,
      sourceHash,
      duration: timing.metadata.duration,
      beats,
      mouthCues: timing.mouthCues,
    };
    await writeFile(new URL(id + '.mp3.tmp', destination), audio);
    await writeFile(
      new URL(id + '.json.tmp', destination),
      await format(JSON.stringify(data), { parser: 'json' }),
    );
    await rename(new URL(id + '.mp3.tmp', destination), audioPath);
    await rename(new URL(id + '.json.tmp', destination), cuePath);
    console.log(
      `${character.name}: ${data.duration}s, ${audio.byteLength} bytes, ${data.mouthCues.length} mouth cues, ${beats.length} gestures`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function worker() {
  while (!failure && cursor < queue.length) {
    const id = queue[cursor++];
    try {
      await generate(id);
    } catch (error) {
      failure = error;
    }
  }
}
await Promise.all([worker(), worker()]);
if (failure) throw failure;

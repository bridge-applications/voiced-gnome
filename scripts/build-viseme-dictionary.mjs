import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source)
  throw new Error(
    'Usage: node scripts/build-viseme-dictionary.mjs /path/to/cmudict-en-us.dict',
  );
// Visual categories follow the nine-mouth rig. This modifies dictionary data,
// not audio, and does not claim phoneme timestamps.
const groups = {
  AA: 'D',
  AE: 'C',
  AH: 'C',
  AO: 'E',
  AW: 'DF',
  AY: 'DB',
  B: 'A',
  CH: 'B',
  D: 'B',
  DH: 'B',
  EH: 'C',
  ER: 'E',
  EY: 'CB',
  F: 'G',
  G: 'B',
  HH: 'C',
  IH: 'B',
  IY: 'B',
  JH: 'B',
  K: 'B',
  L: 'H',
  M: 'A',
  N: 'B',
  NG: 'B',
  OW: 'EF',
  OY: 'EB',
  P: 'A',
  R: 'E',
  S: 'B',
  SH: 'B',
  T: 'B',
  TH: 'B',
  UH: 'F',
  UW: 'F',
  V: 'G',
  W: 'F',
  Y: 'B',
  Z: 'B',
  ZH: 'B',
};
const dictionary = Object.create(null);
for (const line of (await readFile(source, 'utf8')).split(/\r?\n/)) {
  const [word, ...phones] = line.trim().split(/\s+/);
  if (!word || !phones.length || !/^[\p{L}']+$/u.test(word)) continue;
  const sequence = phones
    .map((phone) => groups[phone.replace(/[012]+$/, '')] || 'B')
    .join('');
  const compact = [...sequence]
    .filter((pose, index) => index === 0 || pose !== sequence[index - 1])
    .join('');
  const key = word.toLowerCase();
  if (compact && !Object.hasOwn(dictionary, key)) dictionary[key] = compact;
}
await writeFile(
  new URL('../apps/client/public/speech/english-visemes.json', import.meta.url),
  JSON.stringify(dictionary),
);
console.log(
  `Wrote ${Object.keys(dictionary).length} visual pronunciations. Retain the distributed CMUdict license.`,
);

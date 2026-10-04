import { assetUrl } from './assetUrl';
import {
  cueAt,
  parseMouthCues,
  type MouthCue,
  type MouthPose,
} from './gnome/speech';
import { playbackDrainMs } from './playbackDrain';

export const PREVIEW_LINES = {
  name: {
    file: assetUrl('/preview/name.mp3'),
    text: 'Lovely choice! What should we call the main character?',
  },
  hello: {
    file: assetUrl('/preview/hello.mp3'),
    text: 'Hello there! I’m a little gnome with a rather large wardrobe. Fancy choosing my next look?',
  },
  wave: {
    file: assetUrl('/preview/wave.mp3'),
    text: 'A wave? Absolutely! Hello, you magnificent human. This is my very best greeting.',
  },
  story: {
    file: assetUrl('/preview/story.mp3'),
    text: 'I once tried to grow a garden on my hat. The carrots were wonderful, but the watering was a little awkward.',
  },
  wardrobe: {
    file: assetUrl('/preview/wardrobe.mp3'),
    text: 'I have a rather large wardrobe! Fancy a different hat, or a whole new look? Start a conversation and tell me what style to try.',
  },
} as const;
export type PreviewLine = keyof typeof PREVIEW_LINES;

export interface PreviewOptions {
  onData?: (data: unknown) => void;
  onTime?: (time: number) => void;
  onError?: () => void;
  waitForCues?: boolean;
}
export class PreviewPlayer {
  private readonly audio = new Audio();
  private readonly context = new AudioContext();
  private readonly analyser = this.context.createAnalyser();
  private readonly samples = new Uint8Array(256);
  private readonly source = this.context.createMediaElementSource(this.audio);
  private disposed = false;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  private cues: MouthCue[] = [];
  private readonly cueRequest = new AbortController();
  private readonly cueLoaded: Promise<void>;
  constructor(
    line: PreviewLine | { file: string },
    onEnded: () => void,
    private readonly options: PreviewOptions = {},
  ) {
    const clip = typeof line === 'string' ? PREVIEW_LINES[line] : line;
    this.audio.src = clip.file;
    this.cueLoaded = fetch(clip.file.replace('.mp3', '.json'), {
      signal: this.cueRequest.signal,
    }).then(async (response) => {
      if (!response.ok) throw Error('Playback timing unavailable');
      const data: unknown = await response.json();
      if (this.disposed) return;
      this.cues = parseMouthCues(data);
      if (options.waitForCues && !this.cues.length)
        throw Error('Playback timing invalid');
      options.onData?.(data);
    });
    // Attach a rejection handler immediately; strict callers still await it in play().
    void this.cueLoaded.catch(() => undefined);
    this.audio.preload = 'none';
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.audio.onended = () => {
      if (this.disposed || this.finishTimer !== undefined) return;
      this.finishTimer = setTimeout(() => {
        this.finishTimer = undefined;
        if (!this.disposed) onEnded();
      }, playbackDrainMs(this.context));
    };
    this.audio.ontimeupdate = () => {
      if (!this.disposed) options.onTime?.(this.audio.currentTime);
    };
    this.audio.onplaying = () => {
      if (!this.disposed) options.onTime?.(this.audio.currentTime);
    };
    this.audio.onerror = () => {
      if (!this.disposed) options.onError?.();
    };
  }
  async play(): Promise<void> {
    // Resume the context while the initiating user gesture is still active.
    // Introductions then wait for their validated choreography; legacy previews
    // can play while cues load independently.
    await this.context.resume();
    if (this.options.waitForCues) await this.cueLoaded;
    if (this.disposed) return;
    await this.audio.play();
  }
  getLevel = (): number => {
    if (this.disposed || this.audio.paused) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  };
  getMouth = (): MouthPose | undefined =>
    this.disposed || this.audio.paused
      ? 'rest'
      : this.cues.length
        ? cueAt(this.cues, this.audio.currentTime)
        : undefined;
  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.finishTimer !== undefined) clearTimeout(this.finishTimer);
    this.finishTimer = undefined;
    this.cueRequest.abort();
    this.audio.onended = null;
    this.audio.ontimeupdate = null;
    this.audio.onplaying = null;
    this.audio.onerror = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.source.disconnect();
    this.analyser.disconnect();
    void this.context.close().catch(() => undefined);
  }
}

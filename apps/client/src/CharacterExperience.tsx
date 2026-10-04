import { assetUrl } from './assetUrl';
import { voiceAudioOptions } from './voiceAudio';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Conversation } from '@elevenlabs/react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CHARACTERS,
  EMOTES,
  ExpressionToolSchema,
  GestureToolSchema,
  type AppConfig,
  type CharacterPhase,
  type Expression,
  type Gesture,
} from '@bridge-applications/voiced-gnome-types';
import { getConfig } from './api';
import { DemoVerification } from './DemoVerification';
import {
  characterSession,
  conversationHistory,
  speechChunks,
  type CharacterMessage,
} from './characterConversation';
import { Gnome, type GnomeHandle } from './gnome/Gnome';
import { LiveSpeech, loadPronunciations } from './gnome/liveSpeech';
import { StoryPlayer } from './storyAudio';
import { displayMessage } from './transcript';
import { MicrophoneMeter } from './MicrophoneMeter';
import { PreviewPlayer } from './audio';
import { introductionData, IntroductionTimeline } from './introduction';

type Call = Awaited<ReturnType<typeof Conversation.startSession>>;
export function CharacterExperience() {
  const [index, setIndex] = useState(0);
  const character = CHARACTERS[index]!;
  const previousCharacter =
    CHARACTERS[(index - 1 + CHARACTERS.length) % CHARACTERS.length]!;
  const nextCharacter = CHARACTERS[(index + 1) % CHARACTERS.length]!;
  const selected = useRef(character);
  const [history, setHistory] = useState<Record<string, CharacterMessage[]>>(
    {},
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  const [config, setConfig] = useState<AppConfig>({
    liveAvailable: false,
    maxSessionSeconds: 180,
  });
  const [ready, setReady] = useState(false);
  const [transition, setTransition] = useState('');
  const changing = useRef(false);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expression, setExpression] = useState<Expression>('neutral');
  const [gesture, setGesture] = useState<{ name: Gesture; id: number } | null>(
    null,
  );
  const gestureId = useRef(0);
  const gnome = useRef<GnomeHandle>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [textOnly, setTextOnly] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const textOnlyRef = useRef(true);
  const call = useRef<Call | null>(null);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const outfitRequest = useRef<AbortController | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speech = useRef(new LiveSpeech());
  const player = useRef<StoryPlayer | null>(null);
  const [audioState, setAudioState] = useState('ended');
  const introduction = useRef<PreviewPlayer | null>(null);
  const [introState, setIntroState] = useState<'idle' | 'loading' | 'playing'>(
    'idle',
  );
  const ids = useRef(0);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phase: CharacterPhase = connecting
    ? 'connecting'
    : speaking || audioState === 'playing' || introState === 'playing'
      ? 'speaking'
      : thinking || audioState === 'loading' || introState === 'loading'
        ? 'thinking'
        : connected && !textOnly
          ? 'listening'
          : 'idle';
  const add = useCallback(
    (id: string, role: CharacterMessage['role'], text: string) => {
      setHistory((current) => ({
        ...current,
        [id]: [...(current[id] ?? []), { id: ++ids.current, role, text }].slice(
          -40,
        ),
      }));
    },
    [],
  );
  const playGesture = (name: Gesture) => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    setExpression(EMOTES[name].expression);
    setGesture({ name, id: ++gestureId.current });
    gestureTimer.current = setTimeout(() => setExpression('neutral'), 6000);
  };
  const stop = useCallback(() => {
    epoch.current++;
    introduction.current?.dispose();
    introduction.current = null;
    setIntroState('idle');
    request.current?.abort();
    request.current = null;
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    const previous = call.current;
    call.current = null;
    void previous?.endSession().catch(() => undefined);
    player.current?.dispose();
    player.current = null;
    speech.current.reset();
    gnome.current?.stopGesture();
    setConnected(false);
    setConnecting(false);
    setSpeaking(false);
    setThinking(false);
    setMicMuted(false);
    setAudioState('ended');
    setExpression('neutral');
    setGesture(null);
  }, []);
  const playIntroduction = async () => {
    if (introduction.current) {
      stop();
      return;
    }
    if (!ready || changing.current || connected || connecting) return;
    stop();
    setError(null);
    setIntroState('loading');
    const generation = epoch.current;
    const who = selected.current;
    let timeline: IntroductionTimeline | undefined;
    const current = () => epoch.current === generation;
    const fail = () => {
      if (!current()) return;
      stop();
      setError('The introduction couldn’t play. Please try again.');
    };
    try {
      const clip = new PreviewPlayer(
        { file: assetUrl(`/introductions/${who.id}.mp3`) },
        () => {
          if (current()) stop();
        },
        {
          waitForCues: true,
          onData: (value) => {
            if (!current()) return;
            const data = introductionData(value, who.id);
            timeline = new IntroductionTimeline(data.beats);
          },
          onTime: (time) => {
            if (current()) timeline?.advance(time, playGesture);
          },
          onError: fail,
        },
      );
      introduction.current = clip;
      clip.setMuted(mutedRef.current);
      await clip.play();
      if (current()) setIntroState('playing');
    } catch {
      fail();
    }
  };
  const switchCharacter = async (next: number, direction: number) => {
    if (changing.current || !ready || next === index) return;
    changing.current = true;
    stop();
    setError(null);
    setPrompt('');
    const abort = new AbortController();
    outfitRequest.current = abort;
    const nextCharacter = CHARACTERS[next]!;
    try {
      setTransition(direction > 0 ? 'moving-right' : 'moving-left');
      await gnome.current!.slideCharacters(
        direction as -1 | 1,
        {
          previous:
            CHARACTERS[(next - 1 + CHARACTERS.length) % CHARACTERS.length]!
              .outfit,
          previousSkinColor:
            CHARACTERS[(next - 1 + CHARACTERS.length) % CHARACTERS.length]!
              .skinColor,
          next: CHARACTERS[(next + 1) % CHARACTERS.length]!.outfit,
          nextSkinColor: CHARACTERS[(next + 1) % CHARACTERS.length]!.skinColor,
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      selected.current = nextCharacter;
      setIndex(next);
    } catch {
      if (!abort.signal.aborted)
        setError('That character’s outfit couldn’t load. Please try again.');
    } finally {
      changing.current = false;
      setTransition('');
      if (outfitRequest.current === abort) outfitRequest.current = null;
    }
  };
  const send = (text: string) => {
    player.current?.dispose();
    player.current = null;
    setAudioState('ended');
    speech.current.reset();
    setThinking(true);
    setError(null);
    add(selected.current.id, 'user', text);
    call.current?.sendUserMessage(text);
  };
  const start = async (typed: boolean, text?: string) => {
    if (connecting || changing.current || !ready) return;
    if (call.current && textOnlyRef.current === typed) {
      if (text) send(text);
      return;
    }
    // A typed prompt can also be sent into an ongoing microphone conversation.
    if (call.current && !textOnlyRef.current && text) {
      send(text);
      return;
    }
    stop();
    setError(null);
    setConnecting(true);
    setTextOnly(typed);
    textOnlyRef.current = typed;
    const generation = epoch.current,
      who = selected.current;
    const abort = new AbortController();
    request.current = abort;
    const current = () => epoch.current === generation && !abort.signal.aborted;
    try {
      const [session, dictionary] = await Promise.all([
        characterSession(who.id, abort.signal),
        loadPronunciations(),
      ]);
      if (!current()) return;
      speech.current.startSession(dictionary);
      const previous = historyRef.current[who.id] ?? [];
      const c = await Conversation.startSession({
        ...voiceAudioOptions,
        signedUrl: session.signedUrl,
        textOnly: typed,
        overrides: {
          tts: { voiceId: session.voiceId },
          agent: {
            firstMessage: typed
              ? ''
              : previous.length
                ? 'Welcome back! What shall we talk about?'
                : who.introduction,
          },
        },
        dynamicVariables: {
          character_profile: JSON.stringify(who),
          history: conversationHistory(previous),
        },
        onConversationCreated: (c) => {
          if (current()) call.current = c;
          else void c.endSession().catch(() => undefined);
        },
        onConnect: () => {
          if (current()) {
            setConnected(true);
            setConnecting(false);
            if (!typed) playGesture(who.greetingEmote);
          }
        },
        onIncomingEvent: (event) => {
          if (current() && !typed) speech.current.pushEvent(event);
        },
        onInterruption: (event) => {
          if (current()) {
            speech.current.reset(event.event_id);
            setSpeaking(false);
            setThinking(true);
          }
        },
        onModeChange: ({ mode }) => {
          if (current() && !typed) {
            setSpeaking(mode === 'speaking');
            if (mode === 'speaking') setThinking(false);
          }
        },
        onDisconnect: () => {
          if (current()) {
            call.current = null;
            setConnected(false);
            setConnecting(false);
            setSpeaking(false);
            setThinking(false);
            speech.current.reset();
          }
        },
        onError: () => {
          if (current()) {
            stop();
            setError('The conversation lost its connection. Please try again.');
          }
        },
        onMessage: (message) => {
          if (!current()) return;
          const text = displayMessage(
            message.source === 'user' ? 'user' : 'agent',
            message.message,
          );
          if (!text) return;
          // Typed user messages are already recorded when submitted.
          if (message.source === 'user') {
            if (!typed) add(who.id, 'user', text);
            setThinking(true);
            return;
          }
          add(who.id, 'agent', text);
          setThinking(false);
          if (typed) {
            player.current?.dispose();
            const p = new StoryPlayer(
              {
                turns: speechChunks(text).map((text) => ({
                  speaker: 'Hero' as const,
                  text,
                  expression: 'happy' as const,
                })),
              },
              dictionary,
              {
                prepare: async () => undefined,
                line: () => undefined,
                state: (state, message) => {
                  if (!current()) return;
                  setAudioState(state);
                  if (state === 'error')
                    setError(
                      message ?? 'The voice couldn’t play. Please try again.',
                    );
                },
              },
              who.id,
            );
            player.current = p;
            p.setMuted(mutedRef.current);
            void p.play();
          }
        },
        clientTools: {
          perform_gesture: (parameters) => {
            if (!current()) return 'Conversation ended.';
            const parsed = GestureToolSchema.safeParse(parameters);
            if (!parsed.success) return 'Choose a supported emote.';
            playGesture(parsed.data.gesture);
            return reducedMotion
              ? 'Expression shown; body motion is reduced by the visitor’s preference.'
              : 'Animation started.';
          },
          set_expression: (parameters) => {
            if (!current()) return 'Conversation ended.';
            const parsed = ExpressionToolSchema.safeParse(parameters);
            if (!parsed.success) return 'Choose a supported expression.';
            setExpression(parsed.data.expression);
            return 'Expression set.';
          },
        },
      });
      if (!current()) {
        await c.endSession();
        return;
      }
      call.current = c;
      if (!typed) c.setVolume({ volume: mutedRef.current ? 0 : 1 });
      limit.current = setTimeout(() => {
        if (current()) {
          stop();
          setError(
            'This short conversation has ended. You can try another character or play About me.',
          );
        }
      }, session.maxSessionSeconds * 1000);
      if (text) send(text);
    } catch (cause) {
      if (!current()) return;
      stop();
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to connect. Please try again.',
      );
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setPrompt('');
    void start(true, text);
  };
  const level = useCallback(
    () =>
      mutedRef.current
        ? 0
        : (introduction.current?.getLevel() ??
          player.current?.getLevel() ??
          (!textOnlyRef.current ? (call.current?.getOutputVolume() ?? 0) : 0)),
    [],
  );
  const mouth = useCallback(
    (value: number) =>
      mutedRef.current
        ? ('rest' as const)
        : (introduction.current?.getMouth() ??
          player.current?.getMouth() ??
          speech.current.sample(value)),
    [],
  );
  const micLevel = useCallback(
    () => (!textOnlyRef.current ? (call.current?.getInputVolume() ?? 0) : 0),
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    void getConfig(abort.signal)
      .then(setConfig)
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    introduction.current?.setMuted(muted);
    player.current?.setMuted(muted);
    if (!textOnlyRef.current)
      call.current?.setVolume({ volume: muted ? 0 : 1 });
  }, [muted]);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        outfitRequest.current?.abort();
        stop();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('keydown', escape);
      outfitRequest.current?.abort();
      stop();
    };
  }, [stop]);
  const active = connected && !textOnly;
  const busy = connecting || !!transition;
  return (
    <div className="story-shell character-shell">
      <main>
        <section className="character-theatre" aria-label="Meet the characters">
          <div className="character-stage" data-moving={!!transition}>
            <button
              className="story-icon character-sound"
              aria-label={muted ? 'Turn sound on' : 'Mute sound'}
              aria-pressed={muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <div className="character-slide">
              <Gnome
                ref={gnome}
                outfit={character.outfit}
                skinColor={character.skinColor}
                onReadyChange={setReady}
                phase={phase}
                expression={expression}
                gesture={gesture}
                level={level}
                mouth={mouth}
                reducedMotion={reducedMotion}
                neighbours={{
                  previous: previousCharacter.outfit,
                  previousSkinColor: previousCharacter.skinColor,
                  next: nextCharacter.outfit,
                  nextSkinColor: nextCharacter.skinColor,
                }}
              />
            </div>
            {(phase === 'connecting' || phase === 'thinking') && (
              <div className="character-waiting" role="status">
                <LoaderCircle size={21} className="spin" aria-hidden="true" />
                <span className="sr-only">
                  {character.name} is getting ready to speak…
                </span>
              </div>
            )}
            <button
              className="character-arrow previous"
              aria-label={`Select ${previousCharacter.name}`}
              disabled={!ready || !!transition}
              onClick={() =>
                void switchCharacter(
                  (index - 1 + CHARACTERS.length) % CHARACTERS.length,
                  1,
                )
              }
            >
              <ArrowLeft size={23} />
            </button>
            <span className="neighbour-title previous" aria-hidden="true">
              {previousCharacter.name}
            </span>
            <button
              className="character-arrow next"
              aria-label={`Select ${nextCharacter.name}`}
              disabled={!ready || !!transition}
              onClick={() =>
                void switchCharacter((index + 1) % CHARACTERS.length, -1)
              }
            >
              <ArrowRight size={23} />
            </button>
            <span className="neighbour-title next" aria-hidden="true">
              {nextCharacter.name}
            </span>
          </div>
          <div
            className="character-identity"
            aria-live="polite"
            data-moving={!!transition}
          >
            <h1>{character.name}</h1>
            <button
              className="character-about"
              onClick={() => void playIntroduction()}
              disabled={
                !ready ||
                busy ||
                connected ||
                audioState === 'playing' ||
                audioState === 'loading'
              }
              aria-label={
                introState === 'idle'
                  ? `About me: hear ${character.name}'s introduction`
                  : `Stop ${character.name}'s introduction`
              }
              aria-pressed={introState !== 'idle'}
            >
              {introState === 'loading' ? (
                <LoaderCircle size={15} className="spin" />
              ) : introState === 'playing' ? (
                <Square size={14} />
              ) : (
                <Play size={14} />
              )}
              {introState === 'idle' ? 'About me' : 'Stop'}
            </button>
          </div>
        </section>
        <section
          className="character-controls"
          aria-label={`Talk to ${character.name}`}
        >
          <button
            className="character-starter"
            disabled={busy || !ready || !config.charactersAvailable}
            onClick={() => void start(true, character.starter)}
          >
            “{character.starter}” <ArrowUp size={15} />
          </button>
          <form className="story-prompt" id="story-prompt" onSubmit={submit}>
            <label className="sr-only" htmlFor="character-prompt">
              Ask {character.name} a question or for a story
            </label>
            <input
              id="character-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={700}
              placeholder={`Ask ${character.name} something, or for a story…`}
              disabled={busy}
            />
            {prompt.trim().length > 0 && (
              <button
                className="story-icon"
                type="submit"
                aria-label="Send message"
                disabled={busy || !ready || !config.charactersAvailable}
              >
                <ArrowUp size={21} />
              </button>
            )}
            <button
              className={`story-icon character-mic ${active ? 'active' : ''}`}
              type="button"
              aria-label={
                active
                  ? 'End microphone conversation'
                  : `Speak to ${character.name} using your microphone`
              }
              disabled={busy || !ready || !config.charactersAvailable}
              onClick={() => (active ? stop() : void start(false))}
            >
              {connecting ? (
                <LoaderCircle size={20} className="spin" />
              ) : active ? (
                <Square size={17} />
              ) : (
                <Mic size={21} />
              )}
              <span>{active ? 'Stop' : 'Or speak'}</span>
            </button>
          </form>
          {active && (
            <div className="character-mic-controls">
              <MicrophoneMeter getLevel={micLevel} muted={micMuted} />
              <button
                className="story-icon"
                aria-label={micMuted ? 'Resume microphone' : 'Pause microphone'}
                aria-pressed={micMuted}
                onClick={() => {
                  const next = !micMuted;
                  call.current?.setMicMuted(next);
                  setMicMuted(next);
                }}
              >
                {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            </div>
          )}
          {!config.charactersAvailable && (
            <p className="story-helper">
              Live conversations are currently unavailable. You can still meet
              every character with About me.
            </p>
          )}
          <DemoVerification config={config} />
          {error && (
            <div className="story-error" role="alert">
              <span>{error}</span>
              <button
                className="story-icon"
                aria-label="Dismiss message"
                onClick={() => setError(null)}
              >
                <X size={17} />
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

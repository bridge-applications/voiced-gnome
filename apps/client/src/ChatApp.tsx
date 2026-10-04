import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react';
import {
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  Headphones,
  Leaf,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  MoveUpRight,
  Pause,
  Play,
  Sparkles,
  Square,
  Shirt,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DEFAULT_SESSION_SECONDS,
  DEFAULT_OUTFIT,
  OutfitToolSchema,
  WardrobeToolSchema,
  resolveOutfit,
  wardrobeSnapshot,
  outfitLabel,
  type OutfitLook,
  ExpressionToolSchema,
  GestureToolSchema,
  type AppConfig,
  type CharacterPhase,
  type Expression,
  type Gesture,
} from '@bridge-applications/voiced-gnome-types';
import { getConfig, getSession } from './api';
import { MicrophoneMeter } from './MicrophoneMeter';
import { displayMessage } from './transcript';
import { Gnome, type GnomeHandle } from './gnome/Gnome';
import { LiveSpeech, loadPronunciations } from './gnome/liveSpeech';
import type { MouthPose } from './gnome/speech';
import { PREVIEW_LINES, PreviewPlayer, type PreviewLine } from './audio';

type Message = { id: number; role: 'user' | 'agent'; text: string };
type Mode = 'preview' | 'live';
const prompts: {
  label: string;
  text: string;
  line: PreviewLine;
  gesture?: Gesture;
}[] = [
  { label: 'Say hello', text: 'Hello, little gnome!', line: 'hello' },
  {
    label: 'Give me a wave',
    text: 'Can you give me a wave?',
    line: 'wave',
    gesture: 'wave',
  },
  {
    label: 'Tell me a tiny story',
    text: 'Tell me a tiny story.',
    line: 'story',
    gesture: 'shrug',
  },
  {
    label: 'Show me a new look',
    text: 'Show me a new complete look from your wardrobe. Choose a style different from what you are wearing.',
    line: 'wardrobe',
  },
];

export function App() {
  return (
    <ConversationProvider>
      <GnomeExperience />
    </ConversationProvider>
  );
}

function GnomeExperience() {
  const controls = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [config, setConfig] = useState<AppConfig>({
    liveAvailable: false,
    maxSessionSeconds: DEFAULT_SESSION_SECONDS,
  });
  const [mode, setMode] = useState<Mode>('preview');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [expression, setExpression] = useState<Expression>('neutral');
  const [gesture, setGesture] = useState<{ name: Gesture; id: number } | null>(
    null,
  );
  const [outfit, setOutfit] = useState(DEFAULT_OUTFIT);
  const outfitRef = useRef(DEFAULT_OUTFIT);
  const gnome = useRef<GnomeHandle>(null);
  const [characterReady, setCharacterReady] = useState(false);
  const [wardrobeChanging, setWardrobeChanging] = useState(false);
  const wardrobeRequest = useRef<AbortController | null>(null);
  const showcaseIndex = useRef(0);
  const introShowcased = useRef(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [details, setDetails] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const preview = useRef<PreviewPlayer | null>(null);
  const liveSpeech = useRef(new LiveSpeech());
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const messageId = useRef(0);
  const gestureId = useRef(0);
  const active = status === 'connected';
  const connecting = busy || status === 'connecting';
  const lifecycle = useRef({ active, connecting, previewPlaying });
  lifecycle.current = { active, connecting, previewPlaying };
  const phase: CharacterPhase =
    previewPlaying || (active && isSpeaking)
      ? 'speaking'
      : connecting
        ? 'connecting'
        : active
          ? thinking
            ? 'thinking'
            : 'listening'
          : 'idle';
  const output = useRef({ mode, active, isSpeaking, soundMuted });
  output.current = { mode, active, isSpeaking, soundMuted };
  const level = useCallback(() => {
    const current = output.current;
    if (current.soundMuted) return 0;
    if (current.mode === 'preview') return preview.current?.getLevel() ?? 0;
    return current.active && current.isSpeaking
      ? controls.getOutputVolume()
      : 0;
  }, [controls.getOutputVolume]);

  const mouth = useCallback(
    (level: number): MouthPose | undefined => {
      const current = output.current;
      const pose =
        current.mode === 'preview'
          ? preview.current?.getMouth()
          : liveSpeech.current.sample(
              current.soundMuted ? controls.getOutputVolume() : level,
            );
      return current.soundMuted ? 'rest' : pose;
    },
    [controls.getOutputVolume],
  );

  const addMessage = useCallback((role: Message['role'], text: string) => {
    setMessages((current) =>
      [...current, { id: ++messageId.current, role, text }].slice(-30),
    );
  }, []);
  const playGesture = useCallback(
    (name: Gesture) => setGesture({ name, id: ++gestureId.current }),
    [],
  );
  const changeOutfit = useCallback(
    async (parameters: unknown, generation: number) => {
      const selection = resolveOutfit(
        OutfitToolSchema.parse(parameters),
        outfitRef.current,
      );
      wardrobeRequest.current?.abort();
      const abort = new AbortController();
      wardrobeRequest.current = abort;
      setError(null);
      setWardrobeChanging(true);
      try {
        if (!gnome.current) throw new Error('Character unavailable');
        await gnome.current.changeOutfit(selection, abort.signal);
        if (abort.signal.aborted || generation !== epoch.current)
          throw new DOMException('Cancelled', 'AbortError');
        outfitRef.current = selection;
        setOutfit(selection);
        playGesture('bow');
        return wardrobeSnapshot(selection);
      } catch (cause) {
        if (!abort.signal.aborted && generation === epoch.current)
          setError('That outfit couldn’t load. You can ask me to try again.');
        throw cause;
      } finally {
        if (wardrobeRequest.current === abort) {
          wardrobeRequest.current = null;
          setWardrobeChanging(false);
        }
      }
    },
    [playGesture],
  );
  const stop = useCallback(() => {
    epoch.current++;
    liveSpeech.current.reset();
    wardrobeRequest.current?.abort();
    wardrobeRequest.current = null;
    setWardrobeChanging(false);
    request.current?.abort();
    request.current = null;
    preview.current?.dispose();
    preview.current = null;
    controls.endSession();
    setPreviewPlaying(false);
    setBusy(false);
    setThinking(false);
    setExpression('neutral');
  }, [controls.endSession]);

  useEffect(() => {
    const abort = new AbortController();
    void getConfig(abort.signal)
      .then(setConfig)
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (
        document.hidden &&
        (lifecycle.current.active ||
          lifecycle.current.connecting ||
          lifecycle.current.previewPlaying)
      ) {
        stop();
        setNotice(
          'Conversation paused while you were away. Start again whenever you like.',
        );
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stop();
        setDetails(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('keydown', escape);
      epoch.current++;
      wardrobeRequest.current?.abort();
      request.current?.abort();
      preview.current?.dispose();
      controls.endSession();
    };
  }, [stop, controls.endSession]);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      if (seconds >= config.maxSessionSeconds) {
        stop();
        setNotice(
          'That was lovely. This short demo has ended; you can start another conversation.',
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active, config.maxSessionSeconds, stop]);
  useEffect(() => {
    if (active) controls.setVolume({ volume: soundMuted ? 0 : 1 });
    preview.current?.setMuted(soundMuted);
  }, [soundMuted, active, controls.setVolume]);
  useEffect(() => {
    if (isSpeaking) setThinking(false);
  }, [isSpeaking]);

  const playPreview = async (
    line: PreviewLine,
    userText?: string,
    requestedGesture?: Gesture,
  ) => {
    stop();
    setError(null);
    setNotice(null);
    const generation = epoch.current;
    if (userText) addMessage('user', userText);
    addMessage('agent', PREVIEW_LINES[line].text);
    try {
      const player = new PreviewPlayer(line, () => {
        if (generation !== epoch.current) return;
        preview.current?.dispose();
        preview.current = null;
        setPreviewPlaying(false);
        setExpression('neutral');
      });
      preview.current = player;
      player.setMuted(soundMuted);
      await player.play();
      if (generation !== epoch.current) {
        player.dispose();
        return;
      }
      setPreviewPlaying(true);
      setExpression('happy');
      if (requestedGesture) playGesture(requestedGesture);
      if (
        line === 'wardrobe' ||
        (line === 'hello' && characterReady && !introShowcased.current)
      ) {
        introShowcased.current = true;
        const looks: OutfitLook[] = ['pirate', 'dragon', 'royal', 'cozy'];
        const look = looks[showcaseIndex.current++ % looks.length]!;
        void changeOutfit({ look }, generation).catch(() => undefined);
      }
    } catch (cause: unknown) {
      if (generation !== epoch.current) return;
      preview.current?.dispose();
      preview.current = null;
      setPreviewPlaying(false);
      setError(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Your browser paused audio. Tap the preview button to try again.'
          : 'The preview audio could not play. Please try again.',
      );
    }
  };

  const startLive = async () => {
    if (!config.liveAvailable || connecting || active) return;
    stop();
    setError(null);
    setNotice(null);
    setBusy(true);
    const generation = epoch.current;
    const abort = new AbortController();
    request.current = abort;
    // The SDK acquires and owns the microphone; no extra getUserMedia stream
    // is opened here. It releases its tracks when the conversation ends.
    try {
      const [session, dictionary] = await Promise.all([
        getSession(abort.signal),
        loadPronunciations(),
      ]);
      if (generation !== epoch.current) return;
      liveSpeech.current.startSession(dictionary);
      controls.startSession({
        conversationToken: session.conversationToken,
        connectionType: 'webrtc',
        onConversationCreated: (conversation) => {
          if (generation !== epoch.current)
            void conversation.endSession().catch(() => undefined);
        },
        onConnect: () => {
          if (generation !== epoch.current) {
            controls.endSession();
            return;
          }
          setBusy(false);
          setExpression('happy');
          playGesture('wave');
        },
        onIncomingEvent: (event) => {
          if (generation === epoch.current) liveSpeech.current.pushEvent(event);
        },
        // WebRTC can report listening during a pause inside a single reply.
        // Keep its queued cues; the next aligned reply or interruption resets
        // them, while the renderer rests whenever speech is inactive.
        onDisconnect: () => {
          if (generation === epoch.current) {
            epoch.current++;
            wardrobeRequest.current?.abort();
            wardrobeRequest.current = null;
            setWardrobeChanging(false);
            liveSpeech.current.reset();
            setBusy(false);
            setThinking(false);
            setExpression('neutral');
          }
        },
        onError: (message) => {
          if (generation !== epoch.current) return;
          setBusy(false);
          setThinking(false);
          const permission = /permission|denied|notallowed/i.test(message);
          setError(
            permission
              ? 'Microphone access is needed to talk. You can enable it in your browser, or try the preview.'
              : 'The conversation could not connect. Please try again, or play the preview.',
          );
          controls.endSession();
        },
        onMessage: (message) => {
          if (generation !== epoch.current) return;
          const role = message.source === 'user' ? 'user' : 'agent';
          const text = displayMessage(role, message.message);
          if (!text) return;
          addMessage(role, text);
          if (message.source === 'user') {
            setThinking(true);
            setExpression('curious');
          }
        },
        onInterruption: (event) => {
          if (generation === epoch.current) {
            liveSpeech.current.reset(event.event_id);
            setThinking(false);
            setExpression('curious');
          }
        },
        clientTools: {
          get_wardrobe: (parameters) => {
            if (generation !== epoch.current)
              return JSON.stringify({
                success: false,
                message: 'Session ended',
              });
            if (!WardrobeToolSchema.safeParse(parameters).success)
              return JSON.stringify({
                success: false,
                message: 'No arguments are needed.',
              });
            return JSON.stringify(wardrobeSnapshot(outfitRef.current));
          },
          change_outfit: async (parameters) => {
            if (generation !== epoch.current)
              return JSON.stringify({
                success: false,
                message: 'Session ended',
              });
            if (!OutfitToolSchema.safeParse(parameters).success)
              return JSON.stringify({
                success: false,
                message:
                  'Unsupported clothing. Use get_wardrobe to choose available items.',
              });
            try {
              const result = await changeOutfit(parameters, generation);
              return JSON.stringify({ success: true, ...result });
            } catch {
              return JSON.stringify({
                success: false,
                message:
                  'The outfit was not applied. The request was cancelled or clothing could not load.',
              });
            }
          },
          perform_gesture: (parameters) => {
            if (generation !== epoch.current) return 'Session ended';
            const result = GestureToolSchema.safeParse(parameters);
            if (!result.success) return 'Unknown gesture';
            playGesture(result.data.gesture);
            return 'Gesture performed';
          },
          set_expression: (parameters) => {
            if (generation !== epoch.current) return 'Session ended';
            const result = ExpressionToolSchema.safeParse(parameters);
            if (!result.success) return 'Unknown expression';
            setExpression(result.data.expression);
            return 'Expression changed';
          },
        },
      });
    } catch (cause: unknown) {
      if (generation !== epoch.current) return;
      setBusy(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to connect. Please try again.',
      );
    }
  };

  const prompt = (item: (typeof prompts)[number]) => {
    if (mode === 'preview')
      void playPreview(item.line, item.text, item.gesture);
    else if (active) {
      controls.sendUserMessage(item.text);
      // Typed SDK messages are not echoed as microphone transcripts.
      addMessage('user', item.text);
      setThinking(true);
    }
  };
  const selectMode = (next: Mode) => {
    stop();
    setMode(next);
    setError(null);
    setNotice(null);
    setMessages([]);
  };
  const label =
    phase === 'speaking'
      ? 'A little something to say'
      : phase === 'thinking'
        ? 'Thinking tiny thoughts'
        : phase === 'listening'
          ? isMuted
            ? 'Microphone paused'
            : 'All ears. Your turn.'
          : phase === 'connecting'
            ? 'Getting acquainted…'
            : 'Ready when you are';
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Voiced Gnome home">
          <span className="brand-icon">
            <Leaf size={19} />
          </span>
          voiced<span>gnome</span>
          <span className="version-pill">a small experiment</span>
        </a>
        <a
          className="author-link"
          href="https://tesselpunt.com/"
          target="_blank"
          rel="noreferrer"
        >
          Made by Tessel Punt
          <ArrowUpRight size={16} />
        </a>
      </header>
      <main>
        <div className="intro">
          <div className="eyebrow">
            <span /> A LITTLE CHARACTER. A REAL CONVERSATION.
          </div>
          <h1>
            Small gnome.
            <br />
            <span>Big personality.</span>
            <svg className="title-spark" viewBox="0 0 40 48" aria-hidden="true">
              <path d="M21 2 16 14M37 18l-12 5M32 43 22 34" />
            </svg>
          </h1>
          <p>
            Say hello. Ask something curious.
            <br />
            See where a little conversation takes you.
          </p>
        </div>
        <div className="experience-grid">
          <section className="character-card" aria-label="Meet the gnome">
            <div className="stage-heading">
              <span className="stage-tag">
                <span
                  className={
                    phase !== 'idle' ? 'status-dot active' : 'status-dot'
                  }
                />
                {mode === 'preview' ? 'PREVIEW' : 'LIVE CONVERSATION'}
              </span>
              <button
                className="icon-button"
                onClick={() => setSoundMuted((value) => !value)}
                aria-label={
                  soundMuted ? 'Unmute gnome audio' : 'Mute gnome audio'
                }
                aria-pressed={soundMuted}
              >
                {soundMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
            </div>
            <div className="character-stage">
              <div className="stage-circle" />
              <svg
                className="stage-sprig sprig-left"
                viewBox="0 0 70 110"
                aria-hidden="true"
              >
                <path d="M33 108q-7-57 12-100M31 66Q2 53 8 28q30 0 24 38M37 46q36-17 25-37Q32 10 37 46M29 92Q0 80 5 59q27 1 24 33" />
              </svg>
              <svg
                className="stage-sprig sprig-right"
                viewBox="0 0 70 110"
                aria-hidden="true"
              >
                <path d="M33 108q-7-57 12-100M31 66Q2 53 8 28q30 0 24 38M37 46q36-17 25-37Q32 10 37 46M29 92Q0 80 5 59q27 1 24 33" />
              </svg>
              <div className="stage-shadow" />
              <Gnome
                ref={gnome}
                outfit={outfit}
                onReadyChange={setCharacterReady}
                phase={phase}
                expression={expression}
                level={level}
                mouth={mouth}
                gesture={gesture}
                reducedMotion={reducedMotion}
              />
              <span className="floating-note">
                <Sparkles size={13} /> rather chatty, actually
              </span>
            </div>
            <div className="stage-status">
              <div
                className={`voice-mark ${phase === 'speaking' ? 'speaking' : ''}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <span role="status">{label}</span>
            </div>
            <div className="stage-controls">
              <button
                className="gesture-button"
                onClick={() => playGesture('wave')}
              >
                👋 <span>Wave hello</span>
              </button>
              <span className="controls-divider" />
              <button
                className="gesture-button"
                onClick={() => playGesture('dance')}
              >
                ✦ <span>A little dance</span>
              </button>
            </div>
            <div className="wardrobe-hint">
              <Shirt size={14} aria-hidden="true" />
              <span>Ask me to change my outfit</span>
              <span className="outfit-label" role="status">
                {wardrobeChanging ? 'Trying on…' : outfitLabel(outfit)}
              </span>
            </div>
          </section>
          <section
            className="conversation-panel"

            aria-label="Conversation controls"
          >
            <div className="panel-header">
              <span className="panel-kicker">
                <MessageCircle size={15} /> GET ACQUAINTED
              </span>
              <h2>
                A voice. A face.
                <br />A little bit of magic.
              </h2>
              <p>
                He listens, talks back, and wears his thoughts
                <br className="desktop-break" /> on his very expressive little
                face.
              </p>
            </div>
            <div
              className="mode-switch"
              role="group"
              aria-label="Conversation mode"
            >
              <button
                onClick={() => selectMode('preview')}
                aria-pressed={mode === 'preview'}
                className={mode === 'preview' ? 'selected' : ''}
              >
                <Play size={14} />
                Try a preview
              </button>
              <button
                onClick={() => selectMode('live')}
                aria-pressed={mode === 'live'}
                className={mode === 'live' ? 'selected' : ''}
              >
                <Mic size={14} />
                Talk to him
              </button>
            </div>
            <div className="conversation-action">
              {mode === 'preview' ? (
                <>
                  <button
                    className={`primary-button ${previewPlaying ? 'stop-button' : ''}`}
                    disabled={!characterReady && !previewPlaying}
                    onClick={() =>
                      previewPlaying
                        ? stop()
                        : void playPreview('hello', undefined, 'wave')
                    }
                  >
                    {previewPlaying ? (
                      <Square size={17} fill="currentColor" />
                    ) : (
                      <Play size={17} fill="currentColor" />
                    )}
                    {previewPlaying
                      ? 'Stop preview'
                      : characterReady
                        ? 'Meet the gnome'
                        : 'Waking up…'}
                    <span>
                      {previewPlaying ? (
                        <Pause size={17} />
                      ) : (
                        <MoveUpRight size={18} />
                      )}
                    </span>
                  </button>
                  <p className="action-note">
                    <Headphones size={13} />A short recorded preview. No
                    microphone needed.
                  </p>
                </>
              ) : (
                <>
                  <button
                    className={`primary-button ${active || connecting ? 'stop-button' : ''}`}
                    disabled={
                      !config.liveAvailable ||
                      (!characterReady && !active && !connecting)
                    }
                    onClick={() =>
                      active || connecting ? stop() : void startLive()
                    }
                  >
                    {connecting ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : active ? (
                      <Square size={16} fill="currentColor" />
                    ) : (
                      <Mic size={18} />
                    )}
                    <span className="button-label">
                      {connecting
                        ? 'Cancel connection'
                        : active
                          ? 'End conversation'
                          : config.liveAvailable
                            ? 'Start a conversation'
                            : 'Live voice coming soon'}
                    </span>
                    {active && (
                      <span className="session-clock">
                        {Math.floor(elapsed / 60)}:
                        {String(elapsed % 60).padStart(2, '0')}
                      </span>
                    )}
                  </button>
                  <p className="action-note">
                    <Mic size={13} />
                    {config.liveAvailable
                      ? 'Microphone access required · up to 3 minutes'
                      : 'You can meet him in the preview while live voice is being connected.'}
                  </p>
                  {active && (
                    <div className="microphone-controls">
                      <MicrophoneMeter
                        getLevel={controls.getInputVolume}
                        muted={isMuted}
                      />
                      <button
                        className="text-button mic-toggle"
                        aria-pressed={isMuted}
                        onClick={() => setMuted(!isMuted)}
                      >
                        {isMuted ? <MicOff size={14} /> : <Mic size={14} />}{' '}
                        {isMuted ? 'Unmute microphone' : 'Pause microphone'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            {(error || notice) && (
              <div
                className={error ? 'feedback error' : 'feedback'}
                role={error ? 'alert' : 'status'}
              >
                {error || notice}
                <button
                  className="icon-button"
                  aria-label="Dismiss message"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="suggestions">
              <span className="small-label">A FEW CONVERSATION STARTERS</span>
              <div>
                {prompts.map((item) => (
                  <button
                    key={item.line}
                    onClick={() => prompt(item)}
                    disabled={
                      !characterReady ||
                      (mode === 'live' && !active) ||
                      (item.line === 'wardrobe' &&
                        (!characterReady || wardrobeChanging))
                    }
                  >
                    {item.label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`transcript ${messages.length ? 'has-messages' : ''}`}
              ref={transcript}
              role="log"
              aria-label="Conversation transcript"
              aria-live="polite"
              aria-relevant="additions"
            >
              <div className="transcript-heading">
                <AudioLines size={14} />
                <span>
                  {mode === 'preview'
                    ? 'Preview conversation'
                    : 'Your conversation'}
                </span>
                {messages.length > 0 && !active && !previewPlaying && (
                  <button
                    className="text-button"
                    onClick={() => setMessages([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              {messages.length ? (
                messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    <span className="message-role">
                      {message.role === 'agent' ? 'GNOME' : 'YOU'}
                    </span>
                    <p>{message.text}</p>
                  </div>
                ))
              ) : (
                <div className="transcript-empty">
                  <span className="quote-mark">“</span>
                  <p>
                    {mode === 'preview'
                      ? 'Every good adventure starts with hello.'
                      : 'A small pause before a good conversation.'}
                  </p>
                </div>
              )}
            </div>
            <button
              className="about-toggle"
              aria-expanded={details}
              onClick={() => setDetails((value) => !value)}
            >
              A peek behind the personality
              <ChevronDown size={15} className={details ? 'rotated' : ''} />
            </button>
            {details && (
              <div className="about-content">
                <p>
                  A character from Pebbler, brought to life with Spine animation
                  and an ElevenLabs voice agent. His mouth follows the audio,
                  while his eyes, expressions and gestures react independently.
                </p>
                <p>
                  The preview uses recorded ElevenLabs speech with fixed
                  replies. Live mode is a real conversation powered by
                  ElevenLabs. Conversations end when you leave the tab.
                </p>
                <a
                  href="https://tesselpunt.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  More of my work
                  <ArrowUpRight size={13} />
                </a>
              </div>
            )}
          </section>
        </div>
        <div className="experience-notes">
          <span>
            <Check size={14} /> Audio-reactive animation
          </span>
          <span>
            <Check size={14} /> Made for desktop & mobile
          </span>
          <span>
            <Check size={14} /> Room for a little curiosity
          </span>
        </div>
      </main>
      <footer>
        <span>
          <Leaf size={13} /> A small experiment by Tessel Punt
        </span>
        <span>
          Spine animation <i /> ElevenLabs voice
        </span>
      </footer>
    </div>
  );
}

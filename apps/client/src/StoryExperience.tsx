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
  BookOpen,
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DEFAULT_OUTFIT,
  HeroNameSchema,
  OUTFIT_LOOKS,
  SpeakerSchema,
  StoryChoiceSchema,
  revealedStory,
  type AppConfig,
  type Expression,
  type Gesture,
  type Outfit,
  type Speaker,
  type Story,
} from '@bridge-applications/voiced-gnome-types';
import { getConfig } from './api';
import { createStory, storySession } from './storyApi';
import { StoryPlayer, type PlaybackState } from './storyAudio';
import { Gnome, type GnomeHandle } from './gnome/Gnome';
import { LiveSpeech, loadPronunciations } from './gnome/liveSpeech';
import { MicrophoneMeter } from './MicrophoneMeter';
import { displayMessage } from './transcript';
import { PreviewPlayer } from './audio';
const SUGGESTIONS = [
  {
    title: 'Tell me a story about a pirate',
    topic: 'A pirate who discovers a mysterious island and an unlikely friend',
    look: 'pirate',
  },
  {
    title: 'Tell me a story about a dragon',
    topic:
      'A friendly dragon who has lost its fire and finds a surprising way to help a village',
    look: 'dragon',
  },
  {
    title: 'Tell me a story about a royal chef',
    topic:
      'A royal chef preparing an impossible feast with help from a very unusual guest',
    look: 'chef',
  },
] as const;
type Call = Awaited<ReturnType<typeof Conversation.startSession>>;
type Message = { id: number; name: string; text: string };
type Step = 'choose' | 'name' | 'generating' | 'story';
const clean = (text: string) =>
  displayMessage(
    'agent',
    text.replace(/<\/?(?:Narrator|Hero|Friend)>/gi, ''),
  ) ?? '';
export function StoryExperience({ onChat }: { onChat: () => void }) {
  const [config, setConfig] = useState<AppConfig>({
    liveAvailable: false,
    maxSessionSeconds: 180,
  });
  const [suggestion, setSuggestion] = useState(0);
  const [topic, setTopic] = useState('');
  const topicRef = useRef('');
  const [heroName, setHeroName] = useState('');
  const [step, setStep] = useState<Step>('choose');
  const stepRef = useRef<Step>('choose');
  stepRef.current = step;
  const [story, setStory] = useState<Story | null>(null);
  const storyRef = useRef<Story | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>('paused');
  const [turn, setTurn] = useState(0);
  const [speaker, setSpeaker] = useState<Speaker>('Narrator');
  const speakerRef = useRef<Speaker>('Narrator');
  const [target, setTarget] = useState<Speaker>('Hero');
  const targetRef = useRef<Speaker>('Hero');
  targetRef.current = target;
  const [outfit, setOutfit] = useState<Outfit>(DEFAULT_OUTFIT);
  const gnome = useRef<GnomeHandle>(null);
  const [ready, setReady] = useState(false);
  const [expression, setExpression] = useState<Expression>('neutral');
  const [gesture, setGesture] = useState<{ name: Gesture; id: number } | null>(
    null,
  );
  const gestureId = useRef(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const [micMuted, setMicMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [textConversation, setTextConversation] = useState(false);
  const textConversationRef = useRef(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const ids = useRef(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [setupPlaying, setSetupPlaying] = useState(false);
  const player = useRef<StoryPlayer | null>(null);
  const answer = useRef<StoryPlayer | null>(null);
  const preview = useRef<PreviewPlayer | null>(null);
  const liveSpeech = useRef(new LiveSpeech());
  const call = useRef<Call | null>(null);
  const request = useRef<AbortController | null>(null);
  const voiceRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const voiceGeneration = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceLimit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceState = useRef({ active: false, speaking: false });
  voiceState.current = { active: voiceActive, speaking: voiceSpeaking };
  const add = useCallback(
    (name: string, text: string) =>
      setMessages((current) =>
        [...current, { id: ++ids.current, name, text }].slice(-60),
      ),
    [],
  );
  const clearResume = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  };
  const closeVoice = useCallback(() => {
    voiceGeneration.current++;
    voiceRequest.current?.abort();
    voiceRequest.current = null;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    if (voiceLimit.current) clearTimeout(voiceLimit.current);
    voiceLimit.current = null;
    const current = call.current;
    call.current = null;
    void current?.endSession().catch(() => undefined);
    liveSpeech.current.reset();
    setVoiceActive(false);
    setTextConversation(false);
    textConversationRef.current = false;
    setVoiceConnecting(false);
    setVoiceSpeaking(false);
    setMicMuted(false);
  }, []);
  const stopSetup = () => {
    preview.current?.dispose();
    preview.current = null;
    setSetupPlaying(false);
  };
  const resume = () => {
    closeVoice();
    answer.current?.dispose();
    answer.current = null;
    setTyping(false);
    setError(null);
    void player.current?.play();
  };
  const scheduleResume = () => {
    clearResume();
    resumeTimer.current = setTimeout(() => {
      if (!document.hidden) resume();
    }, 2200);
  };
  const appearance = async (
    actor: Speaker,
    s: Story,
    signal: AbortSignal,
    exp: Expression = 'neutral',
    motion?: Gesture,
  ) => {
    await gnome.current?.changeOutfit(
      OUTFIT_LOOKS[s.cast[actor].look].outfit,
      signal,
    );
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    speakerRef.current = actor;
    setSpeaker(actor);
    setOutfit(OUTFIT_LOOKS[s.cast[actor].look].outfit);
    setExpression(exp);
    if (motion) setGesture({ name: motion, id: ++gestureId.current });
  };
  const begin = async (chosenTopic: string, name: string) => {
    const validated = HeroNameSchema.safeParse({ name });
    if (!validated.success) {
      setError('Choose a name of up to 40 characters.');
      return;
    }
    closeVoice();
    stopSetup();
    generation.current++;
    const current = generation.current;
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    player.current?.dispose();
    player.current = null;
    answer.current?.dispose();
    answer.current = null;
    setError(null);
    setStep('generating');
    setHeroName(validated.data.name);
    setMessages([]);
    add(
      'You',
      `A story about ${chosenTopic}. Our main character is ${validated.data.name}.`,
    );
    try {
      const [s, dictionary] = await Promise.all([
        createStory(chosenTopic, validated.data.name, abort.signal),
        loadPronunciations(),
      ]);
      if (abort.signal.aborted || generation.current !== current) return;
      storyRef.current = s;
      setStory(s);
      setStep('story');
      setTarget('Hero');
      setTurn(0);
      const p = new StoryPlayer(s, dictionary, {
        prepare: async (actor, line, index, signal) => {
          await appearance(actor, s, signal, line.expression, line.gesture);
          if (generation.current === current) setTurn(index);
        },
        line: (line) => {
          if (generation.current === current)
            add(s.cast[line.speaker].name, clean(line.text));
        },
        state: (state, message) => {
          if (generation.current !== current) return;
          setPlayback(state);
          if (message) setError(message);
        },
      });
      player.current = p;
      p.setMuted(mutedRef.current);
      await p.play();
    } catch (cause) {
      if (abort.signal.aborted || generation.current !== current) return;
      setStep('name');
      setError(
        cause instanceof Error
          ? cause.message
          : 'The story could not be created. Please try again.',
      );
    } finally {
      if (request.current === abort) request.current = null;
    }
  };
  const choose = (value: string) => {
    const parsed = StoryChoiceSchema.safeParse({ topic: value });
    if (!parsed.success) {
      setError('Describe your story in 3–240 characters.');
      return;
    }
    closeVoice();
    stopSetup();
    topicRef.current = parsed.data.topic;
    setTopic(parsed.data.topic);
    setStep('name');
    setHeroName('');
    setError(null);
    add('Gnome', 'What should we call the main character?');
    try {
      const p = new PreviewPlayer('name', () => {
        p.dispose();
        if (preview.current === p) {
          preview.current = null;
          setSetupPlaying(false);
        }
      });
      preview.current = p;
      p.setMuted(mutedRef.current);
      void p
        .play()
        .then(() => {
          if (preview.current === p) setSetupPlaying(true);
        })
        .catch(() => {
          p.dispose();
          if (preview.current === p) preview.current = null;
        });
    } catch {
      /* The name field remains available if audio is blocked. */
    }
  };
  const newStory = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    closeVoice();
    stopSetup();
    player.current?.dispose();
    player.current = null;
    answer.current?.dispose();
    answer.current = null;
    storyRef.current = null;
    setStory(null);
    setStep('choose');
    setPlayback('paused');
    setTyping(false);
    setError(null);
    setMessages([]);
    setSpeaker('Narrator');
    speakerRef.current = 'Narrator';
    setExpression('neutral');
    const next = OUTFIT_LOOKS[SUGGESTIONS[suggestion]!.look].outfit;
    setOutfit(next);
    void gnome.current?.changeOutfit(next).catch(() => undefined);
  };
  const startVoice = async (
    interaction: 'topic' | 'name' | 'question',
    textOnly = false,
    text?: string,
  ) => {
    player.current?.pause();
    stopSetup();
    closeVoice();
    answer.current?.dispose();
    answer.current = null;
    setError(null);
    setVoiceConnecting(true);
    setTextConversation(textOnly);
    textConversationRef.current = textOnly;
    const id = voiceGeneration.current;
    const abort = new AbortController();
    voiceRequest.current = abort;
    let hasAnswer = false,
      hasSpoken = false,
      asked = false;
    const s = storyRef.current;
    const checkpoint = player.current?.getCheckpoint();
    const context = s
      ? {
          ...revealedStory(
            s,
            checkpoint?.turn ?? 0,
            checkpoint?.spokenText ?? '',
          ),
        }
      : { topic: topicRef.current };
    const initialSpeaker =
      interaction === 'question' ? targetRef.current : 'Narrator';
    try {
      const [session, dictionary] = await Promise.all([
        storySession(
          interaction === 'question' ? 'question' : 'setup',
          abort.signal,
        ),
        loadPronunciations(),
      ]);
      if (abort.signal.aborted || id !== voiceGeneration.current) return;
      liveSpeech.current.startSession(dictionary);
      if (s) await appearance(initialSpeaker, s, abort.signal, 'curious');
      const c = await Conversation.startSession({
        signedUrl: session.signedUrl,
        textOnly,
        overrides: {
          agent: {
            firstMessage:
              interaction === 'topic'
                ? 'What story would you like to hear?'
                : interaction === 'name'
                  ? 'What should we call the main character?'
                  : '',
          },
        },
        dynamicVariables: {
          interaction,
          story_context: JSON.stringify(context),
          selected_speaker: initialSpeaker,
        },
        onConversationCreated: (c) => {
          if (abort.signal.aborted || id !== voiceGeneration.current)
            void c.endSession().catch(() => undefined);
          else call.current = c;
        },
        onConnect: () => {
          if (id !== voiceGeneration.current) return;
          setVoiceActive(true);
          setVoiceConnecting(false);
        },
        onIncomingEvent: (event) => {
          if (id !== voiceGeneration.current) return;
          liveSpeech.current.pushEvent(event);
          if (event.type === 'audio' && hasAnswer) clearResume();
        },
        onInterruption: (event) => {
          if (id !== voiceGeneration.current) return;
          liveSpeech.current.reset(event.event_id);
          hasAnswer = false;
          hasSpoken = false;
          clearResume();
        },
        onModeChange: ({ mode }) => {
          if (id !== voiceGeneration.current) return;
          setVoiceSpeaking(mode === 'speaking');
          if (mode === 'speaking') {
            hasSpoken = true;
            clearResume();
          } else if (interaction === 'question' && hasAnswer && hasSpoken)
            scheduleResume();
        },
        onDisconnect: () => {
          if (id !== voiceGeneration.current) return;
          setVoiceActive(false);
          setVoiceConnecting(false);
          setVoiceSpeaking(false);
          clearResume();
          call.current = null;
        },
        onError: () => {
          if (id !== voiceGeneration.current) return;
          setError(
            'The microphone conversation could not connect. You can type instead, or continue the story.',
          );
          closeVoice();
        },
        onMessage: (message) => {
          if (id !== voiceGeneration.current) return;
          if (message.source === 'user') {
            const input = displayMessage('user', message.message);
            if (input) {
              add('You', input);
              asked = true;
              setExpression('curious');
              clearResume();
            }
            return;
          }
          const spoken = clean(message.message);
          if (!spoken) return;
          const who = s?.cast[speakerRef.current].name ?? 'Gnome';
          add(who, spoken);
          if (interaction === 'question' && asked) {
            hasAnswer = true;
            if (textOnly && s) {
              const line = {
                speaker: speakerRef.current,
                text: spoken.slice(0, 360),
                expression: 'happy' as const,
              };
              const p = new StoryPlayer(
                { cast: s.cast, turns: [line] },
                dictionary,
                {
                  prepare: (actor, turn, _index, signal) =>
                    appearance(actor, s, signal, turn.expression),
                  line: () => undefined,
                  state: (state) => {
                    if (id !== voiceGeneration.current) return;
                    setVoiceSpeaking(state === 'playing');
                    if (state === 'ended') scheduleResume();
                    if (state === 'error')
                      setError(
                        'The answer could not play. You can read it below and continue.',
                      );
                  },
                },
              );
              answer.current?.dispose();
              answer.current = p;
              p.setMuted(mutedRef.current);
              void p.play();
            } else if (hasSpoken && !voiceState.current.speaking)
              scheduleResume();
          }
        },
        clientTools: {
          choose_story: (parameters) => {
            if (id !== voiceGeneration.current || interaction !== 'topic')
              return 'Unavailable in this interaction';
            const parsed = StoryChoiceSchema.safeParse(parameters);
            if (!parsed.success) return 'Please use a short story subject.';
            setTimeout(() => {
              if (id === voiceGeneration.current) choose(parsed.data.topic);
            }, 200);
            return 'Story choice received.';
          },
          name_hero: (parameters) => {
            if (id !== voiceGeneration.current || interaction !== 'name')
              return 'Unavailable in this interaction';
            const parsed = HeroNameSchema.safeParse(parameters);
            if (!parsed.success) return 'Please use a name of 1–40 characters.';
            setTimeout(() => {
              if (id === voiceGeneration.current)
                void begin(topicRef.current, parsed.data.name);
            }, 200);
            return 'Name received. The application will tell the story.';
          },
          select_character: async (parameters) => {
            if (id !== voiceGeneration.current || !s) return 'No cast yet';
            const parsed = SpeakerSchema.safeParse(parameters?.speaker);
            if (!parsed.success) return 'Choose Narrator, Hero or Friend.';
            await appearance(parsed.data, s, abort.signal, 'happy');
            return JSON.stringify({
              success: true,
              name: s.cast[parsed.data].name,
              speaker: parsed.data,
            });
          },
        },
      });
      if (abort.signal.aborted || id !== voiceGeneration.current) {
        await c.endSession();
        return;
      }
      call.current = c;
      if (!textOnly) c.setVolume({ volume: mutedRef.current ? 0 : 1 });
      voiceLimit.current = setTimeout(() => {
        if (id === voiceGeneration.current) {
          closeVoice();
          setError(
            'This short conversation has ended. Continue the story whenever you like.',
          );
        }
      }, session.maxSessionSeconds * 1000);
      if (text) {
        asked = true;
        add('You', text);
        c.sendUserMessage(text);
      }
    } catch (cause) {
      if (abort.signal.aborted || id !== voiceGeneration.current) return;
      closeVoice();
      setError(
        cause instanceof Error
          ? cause.message
          : 'The conversation could not connect. Try typing instead.',
      );
    }
  };
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    void startVoice('question', true, text);
  };
  const setCastTarget = (actor: Speaker) => {
    setTarget(actor);
    targetRef.current = actor;
    if (voiceActive) {
      clearResume();
      call.current?.sendContextualUpdate(
        'Preferred character is now ' + actor + '.',
      );
    }
  };
  const level = useCallback(() => {
    if (mutedRef.current) return 0;
    if (
      voiceState.current.active &&
      voiceState.current.speaking &&
      !answer.current
    )
      return call.current?.getOutputVolume() ?? 0;
    return (
      answer.current?.getLevel() ??
      preview.current?.getLevel() ??
      player.current?.getLevel() ??
      0
    );
  }, []);
  const mouth = useCallback((value: number) => {
    if (mutedRef.current) return 'rest' as const;
    if (voiceState.current.active && !answer.current)
      return liveSpeech.current.sample(value);
    return (
      answer.current?.getMouth() ??
      preview.current?.getMouth() ??
      player.current?.getMouth()
    );
  }, []);
  const micLevel = useCallback(() => call.current?.getInputVolume() ?? 0, []);
  useEffect(() => {
    const abort = new AbortController();
    void getConfig(abort.signal)
      .then(setConfig)
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    player.current?.setMuted(muted);
    answer.current?.setMuted(muted);
    preview.current?.setMuted(muted);
    if (!textConversationRef.current)
      call.current?.setVolume({ volume: muted ? 0 : 1 });
  }, [muted]);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        if (stepRef.current === 'generating') {
          generation.current++;
          request.current?.abort();
          request.current = null;
          setStep('name');
        }
        player.current?.pause();
        answer.current?.dispose();
        answer.current = null;
        closeVoice();
        stopSetup();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        player.current?.pause();
        answer.current?.dispose();
        answer.current = null;
        closeVoice();
        stopSetup();
      }
    };
    const leave = () => {
      generation.current++;
      request.current?.abort();
      player.current?.pause();
      answer.current?.dispose();
      answer.current = null;
      closeVoice();
      stopSetup();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('keydown', escape);
      generation.current++;
      voiceGeneration.current++;
      request.current?.abort();
      voiceRequest.current?.abort();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      if (voiceLimit.current) clearTimeout(voiceLimit.current);
      void call.current?.endSession().catch(() => undefined);
      player.current?.dispose();
      answer.current?.dispose();
      preview.current?.dispose();
    };
  }, [closeVoice]);
  useEffect(() => {
    if (step !== 'choose' || !ready) return;
    const abort = new AbortController();
    const selection = OUTFIT_LOOKS[SUGGESTIONS[suggestion]!.look].outfit;
    void gnome.current
      ?.changeOutfit(selection, abort.signal)
      .then(() => {
        if (!abort.signal.aborted) setOutfit(selection);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [suggestion, ready, step]);
  const speaking =
    (playback === 'playing' && !voiceActive) || voiceSpeaking || setupPlaying;
  const actor = story?.cast[speaker];
  const activeQuestion = voiceActive || voiceConnecting || typing;
  const loading =
    step === 'generating' || (playback === 'loading' && step === 'story');
  return (
    <div className="story-shell">
      <header className="story-header">
        <a href="/" aria-label="Voiced Gnome home">
          <span className="brand-leaf">✦</span> voiced
          <span className="brand-gnome">gnome</span>
        </a>
        <button onClick={onChat} className="story-chat-link">
          Just chat <ArrowUp size={13} />
        </button>
      </header>
      <main>
        <section className="story-theatre" aria-label="Story stage">
          <div className="story-stage-top">
            <span className="story-eyebrow">
              {story ? story.title : 'A little story. A little magic.'}
            </span>
            <button
              className="story-icon"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
              aria-pressed={muted}
            >
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>
          <div className="story-stage">
            <div className="story-halo" />
            <div className="story-floor" />
            <Gnome
              ref={gnome}
              outfit={outfit}
              onReadyChange={setReady}
              phase={
                speaking
                  ? 'speaking'
                  : voiceConnecting
                    ? 'connecting'
                    : voiceActive
                      ? 'listening'
                      : loading
                        ? 'thinking'
                        : 'idle'
              }
              expression={expression}
              level={level}
              mouth={mouth}
              gesture={gesture}
              reducedMotion={reducedMotion}
            />
          </div>
          <div className="story-speaker" aria-live="polite">
            <span className={speaking ? 'speaker-light on' : 'speaker-light'} />
            <span>{actor?.name ?? 'Your storyteller'}</span>
            <small>
              {story
                ? speaker === 'Narrator'
                  ? 'Narrator'
                  : speaker === 'Hero'
                    ? 'Main character'
                    : 'Companion'
                : 'A rather imaginative gnome'}
            </small>
          </div>
        </section>
        {story && (
          <div
            className="story-cast"
            role="group"
            aria-label="Choose a character to ask"
          >
            <span className="cast-intro">Meet the cast</span>
            {SpeakerSchema.options.map((role) => (
              <button
                key={role}
                className={`cast-card ${target === role ? 'selected' : ''} ${speaker === role ? 'speaking' : ''}`}
                aria-pressed={target === role}
                onClick={() => setCastTarget(role)}
              >
                <img src={`/cast/${story.cast[role].look}.png`} alt="" />
                <span>
                  <strong>{story.cast[role].name}</strong>
                  <small>
                    {role === 'Hero'
                      ? 'Main character'
                      : role === 'Friend'
                        ? 'Companion'
                        : 'Narrator'}
                  </small>
                </span>
                {target === role && <Check size={13} />}
              </button>
            ))}
          </div>
        )}
        <section className="story-controls" aria-label="Story controls">
          {step === 'choose' && (
            <>
              <div className="story-carousel">
                <button
                  className="story-arrow"
                  aria-label="Previous story idea"
                  onClick={() =>
                    setSuggestion(
                      (suggestion + SUGGESTIONS.length - 1) %
                        SUGGESTIONS.length,
                    )
                  }
                >
                  <ArrowLeft size={22} />
                </button>
                <button
                  className="story-suggestion"
                  disabled={!ready || !config.storyAvailable}
                  onClick={() => choose(SUGGESTIONS[suggestion]!.topic)}
                >
                  “{SUGGESTIONS[suggestion]!.title}”
                </button>
                <button
                  className="story-arrow"
                  aria-label="Next story idea"
                  onClick={() =>
                    setSuggestion((suggestion + 1) % SUGGESTIONS.length)
                  }
                >
                  <ArrowRight size={22} />
                </button>
              </div>
              <form
                className="story-prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  choose(topic);
                }}
              >
                <input
                  aria-label="Your story idea"
                  placeholder="What story do you want to hear?"
                  maxLength={240}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />
                <button
                  className="story-icon"
                  type="button"
                  aria-label="Speak your story idea"
                  disabled={!ready || !config.storyAvailable || voiceConnecting}
                  onClick={() => void startVoice('topic')}
                >
                  {voiceConnecting ? (
                    <LoaderCircle className="spin" size={22} />
                  ) : (
                    <Mic size={22} />
                  )}
                </button>
                {topic.trim() && (
                  <button
                    className="story-icon"
                    disabled={!ready || !config.storyAvailable}
                    aria-label="Choose this story"
                  >
                    <ArrowUp size={21} />
                  </button>
                )}
              </form>
              <p className="story-helper">
                Choose an idea, or tell me one of your own.
              </p>
            </>
          )}
          {step === 'name' && (
            <div className="story-name-step">
              <p className="story-eyebrow">
                Every adventure starts with a name
              </p>
              <h1>What should we call the main character?</h1>
              <form
                className="story-prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  void begin(topicRef.current, heroName.trim() || 'Pip');
                }}
              >
                <input
                  autoFocus
                  aria-label="Main character name"
                  placeholder="Pip, perhaps?"
                  maxLength={40}
                  value={heroName}
                  onChange={(event) => setHeroName(event.target.value)}
                />
                <button
                  type="button"
                  className="story-icon"
                  aria-label="Speak the main character name"
                  disabled={voiceConnecting}
                  onClick={() => void startVoice('name')}
                >
                  <Mic size={22} />
                </button>
                <button
                  className="story-start"
                  disabled={!ready || !config.storyAvailable}
                >
                  <Play size={16} fill="currentColor" />
                  Tell our story
                </button>
              </form>
              <button className="story-text-button" onClick={newStory}>
                <ArrowLeft size={13} />
                Choose another story
              </button>
            </div>
          )}
          {step === 'generating' && (
            <div className="story-generating" role="status">
              <LoaderCircle className="spin" size={23} />
              <strong>A little adventure is taking shape…</strong>
              <span>Choosing the cast and finding their voices.</span>
              <button className="story-text-button" onClick={newStory}>
                Cancel
              </button>
            </div>
          )}
          {step === 'story' && (
            <>
              <div className="story-playback">
                <button
                  className="story-text-button"
                  onClick={() =>
                    playback === 'playing' || playback === 'loading'
                      ? player.current?.pause()
                      : resume()
                  }
                  disabled={playback === 'ended'}
                >
                  {playback === 'playing' || playback === 'loading' ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}{' '}
                  {playback === 'playing'
                    ? 'Pause'
                    : playback === 'loading'
                      ? 'Preparing next line…'
                      : playback === 'ended'
                        ? 'The end'
                        : 'Continue story'}
                </button>
                <span>
                  {Math.min(turn + 1, story?.turns.length ?? 1)} /{' '}
                  {story?.turns.length ?? 1}
                </span>
                <button className="story-text-button" onClick={newStory}>
                  <RotateCcw size={15} />
                  New story
                </button>
              </div>
              {playback === 'ended' && !activeQuestion ? (
                <div className="story-ending">
                  <BookOpen size={20} />
                  <h1>And that was their little adventure.</h1>
                  <p>You can still ask the characters a question.</p>
                </div>
              ) : null}
              <button
                className={`story-question-button ${voiceActive && !textConversation ? 'listening' : ''}`}
                disabled={!ready || voiceConnecting}
                onClick={() => {
                  if (voiceActive && !textConversation) {
                    clearResume();
                    call.current?.setMicMuted(false);
                    setMicMuted(false);
                  } else void startVoice('question');
                }}
              >
                {voiceConnecting ? (
                  <LoaderCircle className="spin" size={23} />
                ) : (
                  <Mic size={23} />
                )}
                <span>
                  {voiceConnecting
                    ? 'Getting ready to listen…'
                    : voiceActive && !textConversation
                      ? voiceSpeaking
                        ? 'Ask a follow-up question'
                        : 'Listening. Ask any of the characters.'
                      : 'Ask a question to any of the characters'}
                </span>
                <small>{story?.cast[target].name}</small>
              </button>
              <div className="story-question-options">
                <button
                  className="story-text-button"
                  onClick={() => {
                    player.current?.pause();
                    closeVoice();
                    setTyping((value) => !value);
                  }}
                >
                  Type a question
                </button>
                {activeQuestion && (
                  <button className="story-text-button" onClick={resume}>
                    Continue story <ArrowRight size={13} />
                  </button>
                )}
              </div>
              {typing && (
                <form
                  className="story-prompt question-input"
                  onSubmit={submitQuestion}
                >
                  <input
                    autoFocus
                    aria-label="Question for the characters"
                    placeholder={`Ask ${story?.cast[target].name}…`}
                    value={question}
                    maxLength={500}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      clearResume();
                    }}
                  />
                  <button
                    className="story-icon"
                    aria-label="Send question"
                    disabled={!question.trim() || voiceConnecting}
                  >
                    <ArrowUp size={21} />
                  </button>
                </form>
              )}
              <p className="story-helper">
                The story pauses when you ask, then continues after the answer.
              </p>
            </>
          )}
          {voiceActive && !textConversation && (
            <div className="story-microphone">
              <MicrophoneMeter getLevel={micLevel} muted={micMuted} />
              <button
                className="story-text-button"
                onClick={() => {
                  const next = !micMuted;
                  call.current?.setMicMuted(next);
                  setMicMuted(next);
                }}
              >
                {micMuted ? <MicOff size={14} /> : <Mic size={14} />}{' '}
                {micMuted ? 'Unmute microphone' : 'Pause microphone'}
              </button>
              {step !== 'story' && (
                <button className="story-text-button" onClick={closeVoice}>
                  Done
                </button>
              )}
            </div>
          )}
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
          {!config.storyAvailable && (
            <p className="story-helper">
              Story voices are connecting. You can{' '}
              <button className="story-text-button" onClick={onChat}>
                chat with the gnome
              </button>{' '}
              meanwhile.
            </p>
          )}
        </section>
        <details
          className="story-transcript"
          open={messages.length > 0 && matchMedia('(min-width: 700px)').matches}
        >
          <summary>
            <span>
              Our conversation{' '}
              <small>
                {messages.length
                  ? `${messages.length} ${messages.length === 1 ? 'line' : 'lines'}`
                  : 'Words from a little world'}
              </small>
            </span>
            <ChevronDown size={17} />
          </summary>
          <div
            role="log"
            tabIndex={0}
            aria-label="Story and conversation transcript"
          >
            {messages.length ? (
              messages.map((message) => (
                <div className="story-message" key={message.id}>
                  <span>{message.name}</span>
                  <p>{message.text}</p>
                </div>
              ))
            ) : (
              <p className="story-empty">
                Choose a story, and I’ll do the talking.
              </p>
            )}
          </div>
        </details>
      </main>
    </div>
  );
}

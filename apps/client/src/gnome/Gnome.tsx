import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type {
  CharacterPhase,
  Expression,
  Gesture,
  Outfit,
  SkinColor,
} from '@bridge-applications/voiced-gnome-types';
import type { CharacterRenderer, NeighbourOutfits } from './renderer';
import type { MouthPose } from './speech';

export interface GnomeHandle {
  slideCharacters: (
    direction: -1 | 1,
    neighbours: NeighbourOutfits,
    signal?: AbortSignal,
  ) => Promise<void>;
  changeOutfit: (
    outfit: Outfit,
    signal?: AbortSignal,
    neighbours?: NeighbourOutfits,
  ) => Promise<void>;
  stopGesture: () => void;
}

export function Gnome({
  ref,
  outfit,
  skinColor = null,
  onReadyChange,
  phase,
  expression,
  level,
  mouth,
  gesture,
  reducedMotion,
  neighbours,
}: {
  ref: Ref<GnomeHandle>;
  outfit: Outfit;
  skinColor?: SkinColor;
  onReadyChange: (ready: boolean) => void;
  phase: CharacterPhase;
  expression: Expression;
  level: () => number;
  mouth: (level: number) => MouthPose | undefined;
  gesture: { name: Gesture; id: number } | null;
  reducedMotion: boolean;
  neighbours?: NeighbourOutfits;
}) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<CharacterRenderer | null>(null);
  const input = useRef({
    phase,
    expression,
    level,
    mouth,
    reducedMotion,
    outfit,
    skinColor,
    neighbours,
  });
  input.current = {
    phase,
    expression,
    level,
    mouth,
    reducedMotion,
    outfit,
    skinColor,
    neighbours,
  };
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(
    ref,
    () => ({
      stopGesture: () => renderer.current?.stopGesture(),
      slideCharacters: async (direction, adjacent, signal) => {
        if (!renderer.current) throw new Error('The gnome is still waking up.');
        await renderer.current.slideCharacters(direction, adjacent, signal);
      },
      changeOutfit: async (selection, signal, adjacent) => {
        if (!renderer.current) throw new Error('The gnome is still waking up.');
        await renderer.current.changeOutfit(selection, signal, adjacent);
      },
    }),
    [],
  );
  useEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);
  useEffect(() => {
    const abort = new AbortController();
    setError(false);
    setReady(false);
    void import('./renderer')
      .then((module) => {
        if (!host.current || abort.signal.aborted) return null;
        return module.createCharacter(
          host.current,
          () => input.current,
          abort.signal,
        );
      })
      .then((result) => {
        if (!result) return;
        if (abort.signal.aborted) {
          result.dispose();
          return;
        }
        renderer.current = result;
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          console.error('Character load failed', cause);
          setError(true);
        }
      });
    return () => {
      abort.abort();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    if (gesture && ready) renderer.current?.gesture(gesture.name);
  }, [gesture, ready]);
  return (
    <div
      className="gnome-host"
      ref={host}
      role="img"
      aria-label={
        neighbours
          ? `Selected animated gnome, ${phase}, with previous and next character previews`
          : `Animated gnome, ${phase}`
      }
      data-expression={expression}
      data-gesture={gesture?.name}
      data-gesture-id={gesture?.id}
    >
      {!ready && !error && (
        <div className="character-loading">
          <span className="loading-orb" />
          <span>Waking up the gnome…</span>
        </div>
      )}
      {error && (
        <div className="character-loading">
          <span>The gnome is taking a moment.</span>
          <button
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try loading again
          </button>
        </div>
      )}
    </div>
  );
}

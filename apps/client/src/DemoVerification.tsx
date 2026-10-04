import { useEffect, useRef, useState } from 'react';
import type { AppConfig } from '@bridge-applications/voiced-gnome-types';
import { demoAccess } from './demoAccess';
interface Turnstile {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
    },
  ): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let script: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!script) {
    script = new Promise<Turnstile>((resolve, reject) => {
      const element = document.createElement('script');
      element.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      element.async = true;
      element.onload = () =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error('Visitor check unavailable.'));
      element.onerror = () => {
        element.remove();
        reject(
          new Error('The visitor check could not load. Please try again.'),
        );
      };
      document.head.append(element);
    }).catch((error) => {
      script = undefined;
      throw error;
    });
  }
  return script;
}
interface Challenge {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
}
export function DemoVerification({ config }: { config: AppConfig }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const active = useRef<Challenge | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    demoAccess.configure(
      config,
      (signal) =>
        new Promise<string>((resolve, reject) => {
          if (!config.verification?.siteKey) {
            reject(new Error('The visitor check is not connected yet.'));
            return;
          }
          const pending = { resolve, reject, signal };
          active.current = pending;
          setChallenge(pending);
        }),
    );
    return () => {
      active.current?.reject(new DOMException('Cancelled', 'AbortError'));
      active.current = null;
    };
  }, [config]);
  useEffect(() => {
    if (!challenge) return;
    let disposed = false,
      widget: string | undefined,
      api: Turnstile | undefined;
    const finish = (token?: string, error?: Error) => {
      if (disposed) return;
      active.current = null;
      if (error) challenge.reject(error);
      else challenge.resolve(token!);
      setChallenge(null);
    };
    const abort = () =>
      finish(undefined, new DOMException('Cancelled', 'AbortError'));
    challenge.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          new Error('The visitor check took too long. Please try again.'),
        ),
      120000,
    );
    if (challenge.signal.aborted) abort();
    else
      void loadTurnstile()
        .then((value) => {
          if (disposed || challenge.signal.aborted || !container.current)
            return;
          api = value;
          widget = value.render(container.current, {
            sitekey: config.verification!.siteKey!,
            action: 'gnome_demo',
            callback: (token) => finish(token),
            'error-callback': () =>
              finish(
                undefined,
                new Error(
                  'The visitor check didn’t complete. Please try again.',
                ),
              ),
            'expired-callback': () =>
              finish(
                undefined,
                new Error('The visitor check expired. Please try again.'),
              ),
            'timeout-callback': () =>
              finish(
                undefined,
                new Error('The visitor check took too long. Please try again.'),
              ),
          });
        })
        .catch((error) =>
          finish(
            undefined,
            error instanceof Error
              ? error
              : new Error('Visitor check unavailable.'),
          ),
        );
    return () => {
      disposed = true;
      clearTimeout(timeout);
      challenge.signal.removeEventListener('abort', abort);
      if (widget !== undefined) api?.remove(widget);
    };
  }, [challenge, config]);
  if (!challenge) return null;
  return (
    <div className="demo-verification">
      <p role="status">A quick check before we chat…</p>
      <div ref={container} />
      <button
        type="button"
        onClick={() => {
          challenge.reject(new DOMException('Cancelled', 'AbortError'));
          active.current = null;
          setChallenge(null);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

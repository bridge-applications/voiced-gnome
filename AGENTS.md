# Repository guidance

These instructions apply throughout `voiced-gnome`. Read the relevant source and documentation before changing behavior, follow more specific instructions if present, and preserve unrelated work. The user's explicit requirements take precedence.

## Project and structure

This is a React/TypeScript character demo using Spine, PixiJS and ElevenLabs. Visitors browse characters, play recorded introductions, and ask typed or spoken questions. Preserve the simple character carousel and accessible interaction controls. Earlier chat/story prototypes are reference code; their paid routes are retired.

- `apps/client/src`: interface, character renderer, audio and conversation lifecycle.
- `apps/client/public`: wardrobe, rig, speech and introduction assets.
- `apps/worker/src`: protected API, provider requests and SQLite quota objects.
- `packages/types/src`: shared Zod schemas, character catalog and types.
- `scripts`: local development, provider configuration and asset tooling.
- `tests`: unit checks and real Miniflare/workerd SQLite tests.
- `docs`: architecture, agent configuration, deployment and validation evidence.

Start with [README.md](README.md). Security changes also require [docs/anti-abuse.md](docs/anti-abuse.md); deployment changes require [docs/deployment.md](docs/deployment.md). Character changes should follow [docs/character.md](docs/character.md).

## Development and validation

Use Node 22.12 or later and npm workspaces from the repository root. Maintain the root `package-lock.json`; do not introduce a second package manager or lockfile.

```sh
npm ci
npm run dev:worker
npm run dev
```

Run the two development servers in separate terminals. The client uses port 5184 and the Worker uses port 8787. Use the root Worker launcher, which selects the guarded local environment; the raw workspace command does not select that environment. The development scripts build the shared types before starting. Provider credentials belong in ignored server-side environment files, never `VITE_*` variables.

Choose validation appropriate to the change:

```sh
npm run check
npm run format:check
npm run worker:dry-run
npm run worker:types
npm exec -- vitest run tests/<relevant-test>.test.ts
npm exec -- prettier --write <changed-files>
```

`check` runs type checking, tests and the client/types build. `npm run types:check` additionally validates the actual package tarball in isolated Node and TypeScript consumers. Regenerate Worker bindings after Wrangler binding changes, then type check and dry-run the Worker. Security or quota changes need API boundary tests and the actual SQLite runtime tests; mocks alone do not establish atomicity or persistence. Documentation-only changes need formatting and factual review, without paid provider calls or a full code test run.

Use targeted formatting. Do not bulk-format exported rigs, generated declarations or binary assets. For interface/audio changes, inspect the browser and exercise relevant transitions, cancellation, keyboard controls, narrow screens and reduced motion. Request microphone access only through an intentional interaction. Report physical-device or live-provider checks as unverified unless actually performed.

## Security invariants

- Keep the public API limited to `/api/config`, `/api/demo/session`, `/api/characters/session` and `/api/characters/speech` unless a requested feature justifies expanding it.
- Paid POST requests require an allowed Origin, a valid signed visitor capability and a UUID idempotency key. CORS is not authorization.
- Verify Turnstile on the server, including success, hostname and the `gnome_demo` action. Never introduce production bypasses based on headers, Origin alone or test keys. The existing local exception requires both the explicitly local environment and loopback URL/origin checks.
- Validate capability signature, Origin and expiry before looking up visitor quota state. Store nonce hashes rather than raw capabilities.
- Reserve visitor and UTC-day allowances in transactional SQLite Durable Objects before calling the provider. Never perform provider I/O inside a storage transaction. Edge rate limits and KV are not substitutes for atomic usage reservations.
- Preserve duplicate suppression, bounded requests, concurrency leases and idempotent completion on EOF, cancellation, timeout and error. Reservations are conservative; do not add automatic refunds without considering retries and partial provider usage.
- Missing secrets/bindings, quota-store failures and `DEMO_ENABLED=false` must block new paid admissions. Static browsing and recorded introductions should remain usable.
- Speech concurrency is coordinated per UTC-day object. Around day rollover, old and new coordinators can overlap; do not describe this as an absolute global two-stream guarantee.
- Live signed URL admissions are not live-call accounting. URLs can be reused, and URL expiry or a client timer does not end an existing call. Do not claim an exact dollar cap or strict per-visitor voice-minute limit.
- Preserve the provider safeguards: authentication, 180-second calls, two concurrent calls, 60 calls/day and no bursting. Do not raise limits or weaken safeguards merely to make a test pass.
- Keep live model, duration and prompt overrides disabled. The carousel needs the allowed live voice override; timestamped speech must pin voices and models on the server using the shared catalog.
- Use fixed provider endpoints and manual redirect handling to prevent credential forwarding. Bound response sizes and provider deadlines.
- Never expose or log API keys, capabilities, signed URLs, raw IP addresses, prompts, transcripts or audio. Network quota identities use daily HMAC-derived keys. Keep logs aggregate and free of sensitive payloads.

Update tests and the threat model when a change affects these guarantees. Explain remaining limitations accurately.

## Character, audio and assets

Keep shared character definitions and validation in `packages/types`; avoid divergent client/server catalogs. Preserve selected-character identity, voice, outfit and skin mapping. Apply skin coloration only to the intended skin attachments.

Drive mouth cues against the audio playback clock. Recorded MP3s and their cue JSON must remain consistent. Clear speech, expression and gesture state on cancellation or character changes; ignore stale asynchronous results and release audio, microphone and renderer resources on every exit path.

Use validated gesture/expression allowlists. Maintain keyboard interaction, visible focus, usable microphone feedback and reduced-motion behavior alongside animation changes.

Inspect existing assets and tooling before regenerating recordings or artwork. Changing a model setting does not require regenerating all existing clips. Source Pebbler repositories are references; changes there require task scope that includes them.

Artwork remains copyright Bridge Labs/Tessel Punt. Preserve third-party runtime/font notices and Spine licensing information. Do not relicense assets or assume that publishing source grants rights to all artwork.

## Provider configuration and deployment

Distinguish inspection from mutations and paid generation:

- `npm run agent:security` inspects the live agent; adding `-- --apply` changes it after making a backup.
- `npm run characters:agent -- --dry-run` prepares reviewable configuration. Without `--dry-run`, it updates or creates a live agent.
- Introduction/audio generation scripts can spend provider credits and replace assets.

Run these actions only within the user's authorized task scope. Keep secrets in ignored files or provider secret stores and avoid printing them. After an unknown creation outcome, inspect state before retrying.

Production targets the portfolio origin `https://tesselpunt.com` and the planned API domain `api.tesselpunt.com`. Do not deploy the local environment. Do not assume production Turnstile, secrets, domain routing or bindings are configured because local development succeeds.

Keep GitHub deployment gated by `WORKER_DEPLOY_ENABLED` until production readiness is verified. Pushing source, publishing shared types, deploying the Worker and wiring the portfolio are distinct operations; perform them when included in the task, and report their actual status separately.

Keep README and relevant architecture, deployment and validation documents consistent with final behavior. Describe checks actually run and meaningful remaining limitations; do not inflate test coverage or readiness claims.

# Voiced Gnome

An interactive garden of 18 animated characters, built with React, TypeScript, Spine 4.3, PixiJS 8 and ElevenLabs. Select a character, hear their recorded introduction, type a question or speak with them. Each has a distinct outfit, fictional backstory and a stock voice. Agent tools trigger validated expressions and emotes; speech drives the mouth through timestamped visemes.

[Try the live demo](https://tesselpunt.com/projects/voiced-gnome) · [Shared types 0.1.0](https://github.com/bridge-applications/voiced-gnome/pkgs/npm/voiced-gnome-types)

## Run locally

Use Node 22.12 or later. Put `ELEVENLABS_API_KEY` in the root `.env` for local testing; never use a `VITE_*` variable for secrets. Then run:

```sh
npm ci
npm run dev:worker
```

In another terminal:

```sh
npm run dev
```

Open **http://127.0.0.1:5184**. Browsing and the recorded **About me** clips work without a provider key. Microphone permission is requested only after the visitor chooses to speak. History remains in page memory, separately per character. Switching characters, Escape or hiding the page stops the active call and playback.

The development launcher selects the explicitly guarded local Worker environment, copies the authorized root ElevenLabs key into ignored `.dev.vars` and generates an ignored HMAC secret. It preserves other local secrets. A directly configured `.dev.vars` also works. Local development skips Turnstile only on loopback request URLs with permitted loopback origins; session signatures, SQLite quotas and concurrency guards remain active. Production keeps paid interactions unavailable until real Turnstile credentials and bindings are connected.

## Public demo protections

The first paid interaction uses server-validated Turnstile to obtain a signed ten-minute visitor capability. Every paid request needs that capability and a fresh idempotency key. Per-visitor and per-UTC-day SQLite Durable Objects reserve allowances before generation, reject duplicate/overlapping work and retain consumed quotas across restarts. The daily coordinator receives admission requests only; it does not proxy static files, audio streams or live WebSockets.

Starting shared limits are **60 conversation URL admissions and 20,000 speech characters per UTC day**, with two concurrent speech requests per daily coordinator. Additional visitor, request-count and network limits contain repeated verification and generation. The authenticated ElevenLabs agent independently enforces **180 seconds, two concurrent calls, 60 calls/day and no bursting**. A Worker kill switch blocks new paid admissions; recordings and browsing remain usable. Aggregate logs include denial reasons, latency and reserved usage, with an 80% budget warning and no prompts, audio, IP addresses or credentials.

**Signed URL admission is not live usage accounting.** Provider URLs can be reused; their expiry and the client timer do not terminate existing calls. The provider limits are the billing boundary for live sessions. A strict per-visitor voice-minute allowance, server-pinned live voice or immediate termination would require a server-owned relay. These limits bound request/character allowances rather than promising an exact dollar cap. See [the threat model, tests and tradeoffs](docs/anti-abuse.md).

The public Worker exposes only `/api/config`, `/api/demo/session`, `/api/characters/session` and `/api/characters/speech`. Earlier chat/story prototypes remain in source for reference; their paid endpoints are removed and their interfaces are not shipped by the current app.

## ElevenLabs configuration

The current character agent is configured through `CHARACTER_AGENT_ID`. It uses Gemini 3.8 Flash, Eleven **v4 Turbo**, Scribe Realtime and the restricted expression/gesture tools. Typed messages use text-only agent conversations and the Worker’s timestamped speech endpoint. Live audio uses the ElevenLabs SDK. The speech endpoint pins the voice/model on the server; the live agent allows voice changes for the character carousel while denying model and duration overrides.

Inspect `docs/character-agent.json`. `npm run characters:agent -- --dry-run` saves the reviewable configuration; `npm run characters:agent` updates the configured character agent or creates it if absent. These commands require a server-side ElevenLabs key. `npm run agent:security` reads the actual agent and verifies its safety settings. `npm run agent:security -- --apply` backs it up and applies only the security settings. Agent creation is not automatically retried after an unknown outcome.

## Repository

```text
apps/client/       Character interface, audio, renderer and local preview
apps/worker/       Protected API, SQLite quota objects and Cloudflare config
packages/types/    Shared Zod schemas, types and character catalog
assets/gnome/      Editable Spine project and source artwork
docs/              Architecture, agent templates and deployment notes
tests/             Runtime quota checks, API boundaries, audio and rig tests
```

The GitHub Check workflow validates pushes and pull requests. Worker deployment remains gated behind `WORKER_DEPLOY_ENABLED=true` after production settings are ready. The final frontend is consumed by the portfolio; an additional Netlify site is not required. The shared package is `@bridge-applications/voiced-gnome-types`, with compiled ESM and declarations. The manually dispatched Publish types workflow uses `GITHUB_TOKEN`; package visibility is set separately in GitHub. `npm run types:check` verifies the actual tarball in isolated Node and TypeScript consumers. See [deployment instructions](docs/deployment.md).

## Checks

```sh
npm run check
npm run format:check
npm run worker:dry-run
```

Regenerate bindings after Wrangler changes with `npm run worker:types`. The suite tests unverified/forged/expired requests, failed quota stores, paused generation, bounded input/audio, safe redirects and friendly client failure paths. Miniflare/workerd tests exercise the actual SQLite quota classes: simultaneous claims for the final allowance, duplicates, concurrency and persistence across a runtime restart. Existing tests validate the exported rig, wardrobes, carousel and speech timing. See [validation notes](docs/validation.md). Physical-device microphone behaviour and measured end-to-end latency still need device testing.

## Character and assets

The character and calibrated face/body controllers are adapted from Pebbler Telegram. The export includes all 19 original emotes plus the grand celebration, with wardrobe textures loaded and cached on demand. Speech uses nine generated mouth attachments. Recorded introductions follow audio-derived Rhubarb cues against the playback clock; live speech uses provider character alignment and a CMU pronunciation lookup, with amplitude as a fallback. Production Pebbler source is not modified.

Gnome artwork remains copyright Bridge Labs/Tessel Punt. Third-party runtime and font licenses are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the distributed client. See [character implementation notes](docs/character.md).

To regenerate introductions, set `RHUBARB_PATH` if needed and run `npm run characters:introductions` (optionally with character IDs). Scripts and gesture anchors live in `docs/character-introductions.json`. The current recordings and future introduction generation use full Eleven v4 for prerecorded speech quality; live conversations continue to use v4 Turbo. Rhubarb analyzes the actual audio for mouth cues, while gesture anchors use provider alignment. Existing recordings are reused when their source hash matches. FFmpeg and Rhubarb are offline tools; the browser needs neither. Cue JSON records the generation model and source hash alongside the animation timings. Generated MP3 and cue JSON assets live in `apps/client/public/introductions`.

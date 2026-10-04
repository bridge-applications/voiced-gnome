# Deploying the monorepo

The demo source, Worker and types remain workspaces of the public `bridge-applications/voiced-gnome` repository. The final demo frontend is consumed by the existing `tesselpunt-client` portfolio at `https://tesselpunt.com`. The standalone client remains useful for local development. Do not commit `.env`, `.dev.vars`, tokens, generated audio caches or build output.

## Public access controls

Read [anti-abuse.md](./anti-abuse.md) for the architecture, default limits, operational switch and live-session limitations. Before launching:

1. Create a managed Turnstile widget for `tesselpunt.com` and put its public key in `TURNSTILE_SITE_KEY` in `apps/worker/wrangler.jsonc`.
2. Store `ELEVENLABS_API_KEY`, `TURNSTILE_SECRET_KEY` and `ABUSE_HASH_SECRET` through Wrangler's interactive secret prompts. Generate the hash secret with a cryptographically secure generator; never print it into build logs or commit it.
3. Run `npm run agent:security`. If necessary, `npm run agent:security -- --apply` backs up the existing character agent and applies duration/concurrency/daily limits and restricted overrides. Use signed URL authentication without an agent hostname allowlist.
4. Configure the Worker custom domain `api.tesselpunt.com` in the correct Cloudflare zone/account. The default Worker CORS origin is `https://tesselpunt.com`; add `www` only if the demo is actually served there.
5. Set `VITE_API_BASE_URL=https://api.tesselpunt.com` in the portfolio integration and allow Turnstile's challenge host in that site's script/frame/connect CSP. The standalone Netlify header template includes this host.
6. Run `npm run check`, `npm run format:check` and `npm run worker:dry-run`, then deploy the Worker and consuming client.

From the repository root:

```sh
npm exec --workspace @voiced-gnome/worker -- wrangler secret put ELEVENLABS_API_KEY
npm exec --workspace @voiced-gnome/worker -- wrangler secret put TURNSTILE_SECRET_KEY
npm exec --workspace @voiced-gnome/worker -- wrangler secret put ABUSE_HASH_SECRET
npm run worker:types
npm run deploy --workspace @voiced-gnome/worker
```

The SQLite Durable Object bindings and initial migration are declared in Wrangler. The GitHub Check workflow runs type checks, tests, builds and the Worker dry run. Automatic deployment uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and remains gated behind `WORKER_DEPLOY_ENABLED=true` after production secrets/widget/settings are ready. Do not use `--env local` for deployment.

`DEMO_ENABLED=false` blocks new paid requests. Keep recordings/browsing available. Provider-enforced limits bound existing calls; the Worker switch does not terminate them. Lower the configured daily admissions/character allowance when operating a small portfolio budget.

## Local development

`npm run dev:worker` selects the explicitly guarded local environment on port 8787 and uses ignored local secrets. `npm run dev` serves the standalone client on port 5184 with Vite proxying the API. Local mode retains capabilities, quota reservations and concurrency checks. Verification is skipped only for local loopback origins and loopback request URLs.

## Launch verification

Exercise a real production Turnstile check, microphone permission, typed and spoken replies, mute/interrupt/end, character switches, introductions and both exhausted/paused allowances. Confirm that unverified direct requests cannot reach ElevenLabs and a removed story route returns 404. Check mobile Safari and Android Chrome. Review Cloudflare logs for the `demo_denied`, `demo_budget` and `demo_budget_near_limit` events without conversation contents. The Worker uses ElevenLabs' global API; regional residency routing is not configured.

## Shared types release

The package is `@bridge-applications/voiced-gnome-types` under `packages/types`, initially version `0.1.0`. Its build emits bundled ESM plus TypeScript declarations; package files exclude artwork, audio and server settings. The monorepo consumes the workspace directly and does not need registry credentials to build.

Run `npm run types:check` to build and pack the actual release, install it in a temporary project, and verify both Node ESM and TypeScript consumers. The manually dispatched **Publish types** GitHub workflow runs checks and publishes with its repository `GITHUB_TOKEN` (`packages:write`). Publishing the same version twice is unsupported; bump the package version and lockfile for subsequent releases.

GitHub initially creates npm packages with private visibility, even for public repositories. After first publication, set this package to public in its GitHub package settings and confirm the repository link. Public GitHub npm packages still require authentication to install. Consuming repositories need `@bridge-applications:registry=https://npm.pkg.github.com` and a read token in user/CI configuration. Never commit a token to `.npmrc`. See [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Portfolio integration

The client supports `GNOME_BASE_PATH=/interactive/voiced-gnome/` and `VITE_API_BASE_URL=https://api.tesselpunt.com`. The consuming portfolio builds it through `npm run build:gnome`, copies the complete standalone output under that path, and embeds it only after the visitor selects **Load demo**. This keeps Spine, audio and the voice SDK out of the portfolio's initial bundle. Stopping/unmounting the iframe releases the conversation and audio.

The portfolio's Permissions Policy must allow `microphone=(self)`; the gnome iframe explicitly requests `microphone; autoplay`. Other existing demos do not receive microphone delegation. Microphone access is still requested only after **Speak**. The demo's own CSP permits Turnstile scripts/frames, WebAssembly, media and provider connections. No additional Netlify site is required.

Current preparation is local: production widget/secrets, Worker deployment, GitHub source/package publication and portfolio deployment have not been completed by these instructions. Verify their actual state before marking a launch complete.

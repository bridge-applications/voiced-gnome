# Public demo: abuse and cost controls

The character garden is hosted by the portfolio at `https://tesselpunt.com`; its API will be `https://api.tesselpunt.com`. Browsing, clothing, emotes and recorded introductions use static assets and need neither an account nor a paid API call. The monorepo's standalone client is a development preview of this integration.

## Request flow

1. On the first paid interaction, the client loads a managed Turnstile widget. The Worker validates the token with Cloudflare, including success, the exact permitted origin's hostname and the `gnome_demo` action. Expired/replayed tokens fail verification. The widget is removed on completion, cancellation or unmount.
2. A successful check creates an HMAC-signed capability with a cryptographically random nonce with a fixed ten-minute lifetime. The client retains it only in memory. The Worker stores the nonce’s SHA-256 digest as the Durable Object identifier, never the bearer token. It verifies the signature, origin and expiry before looking up a visitor object, so forged tokens cannot create arbitrary session objects.
3. Each paid POST needs that capability and a new UUID idempotency key. A per-visitor SQLite Durable Object checks expiry/origin, reserves the visitor allowance, records the request ID and locks overlapping requests of the same kind.
4. A separate SQLite Durable Object for the current UTC day atomically reserves the shared and coarse network budgets before contacting ElevenLabs. Static requests, streams and agent WebSockets do not pass through this coordinator. At this portfolio's traffic level, one daily budget authority is an intentional small coordination boundary, not an application-wide traffic proxy.
5. Streams keep their admission lease until EOF, error or cancellation. Provider requests time out after 60 seconds; leases expire after 75 seconds in case cleanup fails. Finish is idempotent. Reservations are conservative, including a visitor reservation made before a rejected daily admission. They are not refunded after an upstream error: the provider may already have performed billable work.

The remaining paid routes are `/api/characters/session` and `/api/characters/speech`. The older `/api/session` and `/api/story/*` variants return 404. Configuration and verification are the only other public API routes. CORS narrows browser access but is explicitly not treated as authentication.

## Starting limits

| Scope                    | Allowance                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Verified visitor session | Ten minutes; four conversation URL admissions; 3,000 speech characters; 24 speech requests                      |
| Shared UTC day           | 60 conversation URL admissions; 20,000 speech characters; 400 speech requests; 200 verified sessions            |
| Network UTC day          | 20 verified sessions; 12 conversation URL admissions; 6,000 speech characters                                   |
| Speech concurrency       | Two per daily coordinator; one outstanding stream per visitor session                                           |
| Edge throttling          | Eight verification requests/minute; three conversation admissions/minute; 24 speech requests/minute per network |
| ElevenLabs agent         | 180 seconds per conversation; two concurrent calls; 60 calls/day; bursting disabled                             |

`DEMO_DAILY_CONVERSATIONS` and `DEMO_DAILY_TTS_CHARACTERS` can lower the shared limits, including zero. Invalid values fail closed. The remaining limits live in `DEMO_LIMITS` in `apps/worker/src/quota.ts`. Network limits are a coarse backstop: visitors on a shared connection share that allowance, and neither IP addresses nor Turnstile establish a unique person.

## What these limits guarantee

The Worker prevents its generation endpoints from admitting work beyond their reserved request/character allowances, including simultaneous requests. It does not represent that allowance as an exact dollar cap: agent audio, ASR, LLM turns and inference can have different billing rules.

Live agents connect directly from the browser to ElevenLabs. A signed URL lasts 15 minutes, can be reused, and expiry does not terminate an established call. Consequently the Worker counts **URL admissions**, not live calls or elapsed billable minutes. Ending a call or a browser timer is not an authorization boundary. The provider's authenticated agent settings enforce the three-minute, concurrency and daily-call limits even if a visitor modifies the client. The same daily provider limit also includes text-only conversations.

The timestamped speech endpoint pins voices and the model on the server. The live agent's model/duration/prompt overrides are disabled; the voice override remains enabled to support our character carousel, and a modified browser can request a different voice available to that agent. Strict per-visitor live minutes, single-use connections, server-pinned live voices or immediate termination of existing live calls would require a server-owned WebSocket relay or separate provider-authenticated controls. That is deliberately outside this first release.

## Failure, privacy and operation

Missing production bindings/secrets, failed verification, a failed quota store or `DEMO_ENABLED` other than `true` prevent new paid admissions. This switch does not terminate already established direct provider calls. At midnight a new daily budget coordinator is used; up to two finishing speech streams from the previous day can briefly overlap the new day’s two streams. Live agent concurrency remains capped by ElevenLabs independently; alarms remove expired visitor and daily coordinator data after the lease grace period. Set both allowance variables to zero for independently pausing conversation issuance or generated speech.

Network keys are HMAC-SHA-256 of `UTC day + CF-Connecting-IP` using a server secret. They are pseudonymous rate-limit identifiers, not claims of anonymization. Raw IPs are not stored in the quota tables or application logs. Logs contain controlled route names, denial codes, response status, request latency and aggregate reserved counts. A once-per-day `demo_budget_near_limit` warning fires at 80%. Prompts, transcripts, audio, bearer tokens, signed URLs and API keys are excluded. Cloudflare/platform access logs and ElevenLabs' conversation retention are separate settings; configure their retention/access before launch. Durable Object PITR may retain deleted data beyond application expiry.

The first version emits budget warning events, rather than sending email or Slack messages. Cloudflare log filters/alerts can consume them if operational notifications are wanted. Quota failures keep static introductions and character browsing available, with a short friendly message for paid requests.

## Deployment settings

Production requires a real managed Turnstile widget restricted to `tesselpunt.com`, its public site key in `TURNSTILE_SITE_KEY`, and three Cloudflare secrets: `ELEVENLABS_API_KEY`, `TURNSTILE_SECRET_KEY`, and a cryptographically random `ABUSE_HASH_SECRET` of at least 32 characters. Cloudflare's published test keys are refused in production. Use a demo-scoped ElevenLabs key with only required permissions; keep credentials out of Git and the client build.

The root `npm run dev:worker` command selects `--env local`, copies the authorized root ElevenLabs key to ignored `.dev.vars`, and generates an ignored HMAC secret without displaying it. Verification is skipped only when that explicit environment is running on a loopback URL **and** the request has a permitted loopback origin. All quota/token guards remain active locally. Accidentally deploying the local environment to a remote hostname cannot enable that exception. A local test widget can exercise the frontend verification UI; it is never production authentication.

If embedding in the portfolio, its own CSP must permit `https://challenges.cloudflare.com` in script/frame/connect sources. The standalone client's Netlify CSP is prepared for this. Set `VITE_API_BASE_URL=https://api.tesselpunt.com` in the consuming build. The hosting/DNS and production widget are separate launch steps; this implementation does not deploy them.

## Verification evidence

`npm run check` includes unit tests for forged origins, capability headers, verification success/hostname/action, expiry, unavailable stores, paused generation, bounded requests/streams and friendly client retries. `tests/quota-runtime.test.ts` bundles the actual quota classes into Miniflare/workerd with SQLite storage and checks simultaneous final-allowance claims, replay suppression, overlapping work, provider-independent counters and persistence across a runtime restart. Provider configuration tests forbid extended duration, expanded call limits, bursting and expensive model overrides. `npm run agent:security` also reads the actual ElevenLabs character agent and validates its settings; `-- --apply` backs it up and applies the limited security patch.

Sources: [Turnstile verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [edge rate limits and accounting caveats](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [ElevenLabs signed URL authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication).

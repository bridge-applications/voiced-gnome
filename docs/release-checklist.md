# Initial public release

Review the code and checks before performing the following production steps. The repository and portfolio preparation alone do not configure external services.

- [ ] Publish the reviewed monorepo to `bridge-applications/voiced-gnome`.
- [ ] Run the Check GitHub workflow and confirm it passes from a clean checkout.
- [ ] Dispatch Publish types for `@bridge-applications/voiced-gnome-types@0.1.0`; set package visibility to public and confirm the repository link.
- [ ] Create a managed Turnstile widget limited to `tesselpunt.com`; configure its public site key in Wrangler.
- [ ] Store `ELEVENLABS_API_KEY`, `TURNSTILE_SECRET_KEY` and a fresh random `ABUSE_HASH_SECRET` as Worker secrets. Never store secret values in GitHub source or browser assets.
- [ ] Verify the live agent with `npm run agent:security`.
- [ ] Deploy `voiced-gnome-worker` with its SQLite migration and custom domain `api.tesselpunt.com`; confirm no unrelated DNS record is replaced.
- [ ] Check production configuration, CORS, unverified request rejection and retired-route 404s without paid generation.
- [ ] Deploy the reviewed portfolio snapshot and project page; check the actual response headers for microphone delegation and CSP.
- [ ] Perform a real Turnstile check and one bounded typed/spoken interaction; confirm cancellation, introductions and character switching. Device microphone tests remain separate.

Automatic Worker deployment remains disabled until a suitably scoped Cloudflare token is stored in GitHub's production environment and `WORKER_DEPLOY_ENABLED=true` is deliberately configured. An initial manual deployment does not require a new permanent token in GitHub.

See [deployment details](deployment.md), [access controls and limitations](anti-abuse.md), and [validation notes](validation.md).

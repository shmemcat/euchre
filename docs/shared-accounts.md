# Shared Cards accounts and hosting

## Shared login locally

The Cards hub and both games now use the existing Hearts account service.
Run `npm run dev:accounts` in the sibling Cards repo, then start each frontend.
Use localhost:3000 for the hub, localhost:3001 for Hearts, localhost:3002 for Euchre.
The local runner creates a separate Cards/.local/accounts.sqlite database; it does
not connect to the live Hearts database. Registration, verification, and recovery
are on the hub `/user/` page, linked from Euchre's account screen.

Development enables `/api/account` by default and proxies it to localhost:5000.
Override `ACCOUNT_PROXY_TARGET` for another API. Docker dev defaults to
`http://host.docker.internal:5000`; use port5001 when using Hearts' Docker API.
Production builds require `VITE_ACCOUNT_API_URL=/api/account` and matching ingress.
No duplicate Euchre users table exists. In-progress Euchre games remain local.
Completed bot games recorded for a signed-in account sync to the shared service
and populate Euchre's leaderboards. Guest games and legacy unassigned results
are never uploaded or assigned to an account.

## Account contract

`web/src/lib/account.ts` uses:

- `GET /session`: `{ user: null | { id: string, name: string, email?: string, email_verified?: boolean, profile_icon?: string }, csrf_token: string }`.
- `POST /login`: `{ username, password }` and X-CSRF-Token; returns a rotated session.
- `POST /logout`: X-CSRF-Token; revokes login and returns a guest session.
- `POST /profile`: `{ profile_icon?, email? }` and X-CSRF-Token; updates the shared profile. Changing email revokes sessions and requires verification of the new address before signing in again.
- `POST /delete`: `{ password }` and X-CSRF-Token; confirms the password, deletes the shared account and its Hearts records, and returns a guest session.
- `POST /euchre/results`: `{ results: [...] }` and X-CSRF-Token; saves up to 40 completed bot games for the signed-in account. Game IDs make retries idempotent.
- `GET /euchre/leaderboard?category=easy`: public monthly and all-time top-ten win rankings. Categories are easy, medium, hard, harder, and hardest; multiplayer remains empty. Profile icons and names come from the shared user record.

The signed-in Euchre user page owns personal statistics and achievements. Profile
and Options are reached through its settings gear; guests have neither settings
nor a custom name. Guest games are not recorded. The personal dashboard still
reads account-scoped results in this browser. Signed-in bot results sync on game
completion, sign-in, focus, reconnection, and leaderboard visits. Acknowledged
uploads are tracked per account, while server uniqueness prevents duplicate wins.
Monthly rankings use UTC completion dates, including for older account-owned
results uploaded later. The public `/leaderboard` reads the shared database;
`/stats` redirects there.

Cookies are HttpOnly, host-only, SameSite=Lax, Path=/, Secure on HTTPS. Credentials
never enter localStorage or game links. Mutations check CSRF and Origin; session
responses are uncached. All three sites refresh login on focus and share logout.
Verification and recovery use expiring, hashed, single-use tokens. Password reset
revokes existing sessions and legacy Hearts JWTs. IDs are normalized to strings.

## Existing live Hearts accounts

Deploy the shared API against the existing Hearts database after backup and
staging verification. Run migrations 017–018 using `flask db upgrade`; they add
users.auth_version, account_sessions, and a separate euchre_game_results table
without rewriting IDs, password hashes, profiles, Hearts games, or Hearts stats.
Set API CARDS_PUBLIC_URL=https://cards.shmem.dev and
build Hearts with VITE_SHARED_ACCOUNTS=true. Keep the existing database, JWT secret,
and SMTP2GO mail configuration. Never replace live data with the fresh local DB.
The Cards repo's docs/integration.md contains the full deployment sequence.
This local work has not deployed or modified the live database.

## Production routing and releases

- `/`: a Cards landing page with individually themed game links.
- `/hearts/`: the Hearts application.
- `/euchre/`: the Euchre application, built with `VITE_BASE_PATH=/euchre/`.
- `/api/account/`: the shared account service.
- Game-specific services, including existing Hearts sockets, remain separately
  routed and namespaced so game code and deployments can remain independent.

For static game hosting, the hub proxy must map `/euchre/` to the build root and
fall back to that game's `index.html` for nested routes. If it strips the prefix
before forwarding to the supplied Nginx container, it must also forward asset
paths consistently. The game container serves its build root; Cards strips
`/euchre/` before forwarding, while generated asset URLs retain that public prefix.

Keep each existing Hearts path and query when redirecting
`hearts.shmem.dev/<path>` to `cards.shmem.dev/hearts/<path>`, and do the equivalent
for Euchre. Add permanent redirects only after the new pages and accounts work.
Plan an explicit handoff for existing Hearts login sessions: their current browser
tokens do not automatically move to another origin. At minimum, preserve accounts
and explain the one-time sign-in at the new home. Saved browser-local Euchre games
also need a migration path or export before changing origins.

## Statistics trust

Bot leaderboards store account-reported single-player results, matching Hearts'
current statistics model. The API checks completed scores, categories, dates,
account ownership, CSRF, and duplicate game IDs; it does not replay the game or
verify bot decisions. These are not authoritative competitive results. Before
multiplayer or competitive rankings, validate/replay an action log server-side
with a trusted deal or move game authority to a game service.

## Source repositories

Hearts and Euchre can remain in their existing GitHub repositories. The sibling `cards` repository contains the landing page, shared account UI,
and local API runner. The sibling infra repository controls production hosting.
Shared packages can be extracted once real reuse is established.

Push a `v*` tag (for example `v1.2.3`) to run **Release Euchre**. It tests this
repository, builds with `/euchre/` and `/api/account`, and publishes
`ghcr.io/shmemcat/euchre-web:<version>` before promoting `latest`. A manual run
accepts an existing tag and checks out that tag. Configure this repo's
`FONTAWESOME_PACKAGE_TOKEN` Actions secret; it is passed as a BuildKit secret.
Make the image package publicly pullable or configure registry access on nuttybox.

After the initial reviewed Cards cutover, Podman's updater on nuttybox checks
`latest` every minute and restarts the changed Euchre container. Cards and Hearts
do not need rebuilding. The gateway resolves the new container address, and a
container health check gates startup/failed-start rollback. Deployments roll
independently, so maintain compatibility with the previous account API. For
rollback, set `shmem.cards.autoUpdate = false`, pin `shmem.cards.images.euchre`
to the previous compatible version or digest, and apply reviewed infra. No
Euchre release creates or replaces production account records.

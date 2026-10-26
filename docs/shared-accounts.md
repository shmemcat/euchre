# Shared Cards accounts and hosting

## Shared login locally

Root `npm run dev` in Cards, Hearts or Euchre starts the shared split stack once.
Follow [Cards setup](../../cards/README.md#run-locally) to install the three
backend environments and both frontends. The hub uses localhost:3000, Hearts
3001 and Euchre 3002; accounts/Hearts/Euchre APIs use 5100/5101/5102.
Local data and file-only verification/recovery mail live in
`cards/.local/split-dev/`. Existing instance databases and `.local/accounts.sqlite`
are retained and never adopted by the default runner. The hub's `/user/` owns
registration, verification, recovery and shared sign-in.

The runner explicitly routes account calls to Cards and Euchre calls and
`/euchre/socket.io` to the independent Euchre server. No duplicate Euchre users
table exists. Solo saves remain browser-local; online tables and results belong
to Euchre. `npm run dev:web` retains the frontend-only preview with separately
configured `ACCOUNT_PROXY_TARGET` and `EUCHRE_API_TARGET` destinations.
Production builds retain `VITE_ACCOUNT_API_URL=/api/account` and existing ingress.
Guest games and legacy unassigned results are never assigned to an account.

## Account contract

`web/src/lib/account.ts` uses:

- `GET /session`: `{ user: null | { id: string, name: string, email?: string, email_verified?: boolean, profile_icon?: string }, csrf_token: string }`.
- `POST /login`: `{ username, password }` and X-CSRF-Token; returns a rotated session.
- `POST /logout`: X-CSRF-Token; revokes login and returns a guest session.
- `POST /profile`: `{ profile_icon?, email? }` and X-CSRF-Token; updates the shared profile. Changing email revokes sessions and requires verification of the new address before signing in again.
- `POST /delete`: `{ password }` and X-CSRF-Token; confirms the password, deletes the shared account and its Hearts records, and returns a guest session.
- `POST /euchre/results`: `{ results: [...] }` and X-CSRF-Token; saves up to 40 completed bot games for the signed-in account. Game IDs make retries idempotent.
- `GET /euchre/leaderboard?category=easy`: public monthly and all-time top-ten win rankings. Categories are easy, medium, hard, harder, hardest, and multiplayer. Profile icons and names come from the shared user record.
- `GET /euchre/multiplayer-results`: the signed-in account's server-recorded online results, including partnership wins and achievement counters. Multiplayer results cannot be uploaded by clients.

The signed-in Euchre user page owns personal statistics and achievements. The
username button opens this page, with links to Profile and Options; guests have
neither settings nor a custom name. Guest games are not recorded. The personal dashboard still
combines account-scoped solo results in this browser with multiplayer results
from the API. Signed-in bot results sync on game
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

## Original account adoption (historical)

Production already runs the separate owners. The original migration sequence
below is historical context; do not rerun adoption against live services.

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
verify bot decisions. Multiplayer uses server-generated deals and server-validated
moves. Only the service records multiplayer outcomes for the accounts that joined
each seat; both winning teammates receive a win. Private snapshots expose only
the requesting player's hand and public card counts. Explicit departures record
a concession without counting as a completed-game loss. Lobby membership survives
network disconnects until explicitly leaving; only an outstanding game decision
can time out. Reconnecting restores the saved seat without resetting its clock.
Inactivity reminders match Hearts: a sound and shake after 15 seconds when input
is available, a warning at 9 minutes, and removal at 10 minutes. Removed seats
cannot be reclaimed during the current game.

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

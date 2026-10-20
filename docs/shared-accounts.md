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
No duplicate Euchre users table exists. Euchre games and statistics remain
browser-local; signing in does not upload or merge them.

## Account contract

`web/src/lib/account.ts` uses:

- `GET /session`: `{ user: null | { id: string, name: string, email?: string, profile_icon?: string }, csrf_token: string }`.
- `POST /login`: `{ username, password }` and X-CSRF-Token; returns a rotated session.
- `POST /logout`: X-CSRF-Token; revokes login and returns a guest session.

Cookies are HttpOnly, host-only, SameSite=Lax, Path=/, Secure on HTTPS. Credentials
never enter localStorage or game links. Mutations check CSRF and Origin; session
responses are uncached. All three sites refresh login on focus and share logout.
Verification and recovery use expiring, hashed, single-use tokens. Password reset
revokes existing sessions and legacy Hearts JWTs. IDs are normalized to strings.

## Existing live Hearts accounts

Deploy the shared API against the existing Hearts database after backup and
staging verification. Run migration017 using `flask db upgrade`; it adds
users.auth_version and account_sessions without rewriting IDs, password hashes,
profiles, games, or stats. Set API CARDS_PUBLIC_URL=https://cards.shmem.dev and
build Hearts with VITE_SHARED_ACCOUNTS=true. Keep the existing database, JWT secret,
and SMTP2GO mail configuration. Never replace live data with the fresh local DB.
The Cards repo's docs/integration.md contains the full deployment sequence.
This local work has not deployed or modified the live database.

## Future public routing

- `/`: a Cards landing page with individually themed game links.
- `/hearts/`: the Hearts application.
- `/euchre/`: the Euchre application, built with `VITE_BASE_PATH=/euchre/`.
- `/api/account/`: the shared account service.
- Game-specific services, including existing Hearts sockets, remain separately
  routed and namespaced so game code and deployments can remain independent.

For static game hosting, the hub proxy must map `/euchre/` to the build root and
fall back to that game's `index.html` for nested routes. If it strips the prefix
before forwarding to the supplied Nginx container, it must also forward asset
paths consistently. The local Nginx config is a root-path preview; it is not the
finished hub ingress configuration.

Keep each existing Hearts path and query when redirecting
`hearts.shmem.dev/<path>` to `cards.shmem.dev/hearts/<path>`, and do the equivalent
for Euchre. Add permanent redirects only after the new pages and accounts work.
Plan an explicit handoff for existing Hearts login sessions: their current browser
tokens do not automatically move to another origin. At minimum, preserve accounts
and explain the one-time sign-in at the new home. Saved browser-local Euchre games
also need a migration path or export before changing origins.

## Statistics trust

Current local statistics are suitable for personal guest play. Do not accept
client-reported wins as authoritative shared leaderboards. Before adding synced
competitive stats, either validate/replay an action log server-side with a trusted
deal or move game authority to a game service. Shared identity and game authority
are separate responsibilities.

## Source repositories

Hearts and Euchre can remain in their existing GitHub repositories. The sibling `cards` repository contains the landing page, shared account UI,
and local API runner. Hosting configuration remains a later deployment step. Shared packages can be extracted once real reuse is established.

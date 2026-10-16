# Shared Cards accounts and hosting

## Current boundary

Euchre runs locally without an account server. Guest progress is device-local.
`VITE_ACCOUNT_API_URL` is blank by default, so the app makes no login requests and
offers guest play. `web/src/lib/account.ts` is the single integration boundary for
the future service. Enabling it alone does not migrate Hearts or sync local stats.

## Planned account contract

Mount one account service at `/api/account` on `cards.shmem.dev`. Keep the existing
Hearts user IDs, password hashes, verification status, and profile identities.
Audit and migrate the existing account data with a backup before switching hosts.
Keep each game's stats, achievements, active games, and preferences namespaced.

The adapter uses these endpoints:

- `GET /session`: `{ user: null | { id: string, name: string, profile_icon?: string }, csrf_token: string }`.
  An unauthenticated session also returns a CSRF token.
- `POST /login`: JSON `{ username, password }` with `X-CSRF-Token`; returns the same
  session response and sets the shared session cookie.
- `POST /logout`: `X-CSRF-Token`; invalidates the server session and returns a guest
  session response.

Requests include cookies. Session tokens are never exposed to JavaScript or stored
in localStorage. The service should use a Secure, HttpOnly, SameSite cookie scoped
to `cards.shmem.dev`, preferably a `__Host-` session cookie with `Path=/`, rotate
sessions on sign-in, verify CSRF tokens and request origins, and mark session
responses `Cache-Control: no-store`. Logout must invalidate the server session.
Registration, verification, resets, and profile editing belong to the shared
service; they are deliberately not cloned into this game.

The adapter contract requires string user IDs; normalize existing integer IDs in
the service response. A future service implementing Hearts' current bearer-token
API is not compatible without that planned migration.

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

Hearts and Euchre can remain in their existing GitHub repositories. The future hub
can use a small `cards` repository for the landing page and routing configuration.
It is not required for local Euchre development; choose its deployment home when
the hub is ready. Shared packages can be extracted once real reuse is established.

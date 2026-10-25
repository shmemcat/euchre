# E U C H R E

A full-stack, real-time implementation of the classic partnership card game with
single-player AI, online multiplayer, achievements, and a polished, responsive UI.

**Live at [cards.shmem.dev/euchre](https://cards.shmem.dev/euchre/)**

Part of [Cards](https://cards.shmem.dev/), alongside
[Hearts](https://cards.shmem.dev/hearts/), with shared accounts and an independent
[Euchre game server](api/README.md).

## Features

- **Single-player vs. AI** -- five difficulty settings, from relaxed play to Monte Carlo simulation
- **Online multiplayer** -- create a lobby, share a code or invitation link, and play with friends in real time
- **Partnership lobbies** -- choose seats, name your team, fill empty seats with bots, and play again with the same group
- **Achievements & statistics** -- track progress across games, with monthly and all-time leaderboards
- **Shared accounts** -- one Cards account for both games, with email verification, password recovery, and saved results
- **Auto-save & resume** -- solo games save after every action and wait for you without turn timers
- **Sound & music** -- shuffle and gameplay effects, volume controls, and a shuffled ten-track lo-fi playlist
- **Animations** -- face-down dealing, a revealed upcard, and hands that fan into place before bidding
- **Theming & responsive design** -- dark and light themes, card styles, and a mobile-friendly table with a celestial deck

## Tech Stack

### Frontend

- **React 18 + TypeScript** -- UI and browser game engine
- **Vite** -- development server and production builds
- **Tailwind CSS 4 + CSS Modules** -- styling and responsive layouts
- **React Router 7 + Socket.IO Client** -- navigation and real-time multiplayer
- **Framer Motion, Howler.js, Radix UI, and Font Awesome Pro** -- animations, audio, tooltips, and icons
- **Web Workers** -- solo AI simulations without blocking the UI

### Backend

- **Flask + Flask-SocketIO** -- REST endpoints and authoritative multiplayer over Socket.IO
- **Gunicorn + Eventlet** -- serving requests, bot jobs, and multiplayer timers
- **SQLAlchemy + PostgreSQL** -- production game results and recoverable table snapshots
- **Alembic** -- explicit game-owned schema migrations
- **Shared Cards accounts service** -- identity, sessions, email verification, and password recovery

### Infrastructure

- **Docker + Nginx** -- container builds, static hosting, and gateway routing
- **GitHub Actions + GHCR** -- checks and independent, immutable frontend and game-server releases

## Architecture

Solo games run in the browser using the TypeScript rules engine, with bot
simulations in a Web Worker and saves in browser storage. Online games use the
Flask server over REST and Socket.IO; the server deals cards, validates moves,
runs bots, and records results. Each player receives only their own hand and
public table information.

The Euchre API owns its gameplay, tables, timers, results, and leaderboards.
The separate Cards accounts service owns identities and sessions. The production
gateway serves Euchre at `/euchre/`, routes game requests independently, and
shares sign-in with Hearts through an HttpOnly cookie.

See the [game server README](api/README.md) for service configuration, schema
ownership, and recovery details.

## Gameplay

- Four players in fixed partnerships, a 24-card deck, and five cards per hand.
- [Bicycle rules](https://bicyclecards.com/how-to-play/euchre): two bidding rounds,
  dealer pickup/discard, right/left bowers, following suit, and optional lone hands.
- After everyone passes in both bidding rounds, the same dealer redeals. A second
  consecutive passed-out hand moves the deal clockwise. Calling trump resets the
  count; passed-out hands score no points. No stick-the-dealer rule.
- Passed-out hands pause at a "No calls — Re-deal" or "No calls — Pass" summary
  showing unchanged totals. In multiplayer, every human clicks Next Hand before
  the next deal begins; bots are ready automatically.
- First partnership to 10 wins; no rubber points.
- Every hand opens with a shuffle sound and two clockwise passes of face-down
  cards from the dealer. The upcard flips before your hand fans face up, and
  bidding begins once the deal animation finishes.

## AI Strategy

The five difficulty settings adjust bidding, discarding, and card play:

- **Easy** -- loose bidding, mostly sensible play and discards, and occasional random legal choices
- **Medium** -- heuristic bidding, discards, and cooperative card play
- **Hard** -- 32 sampled deals per decision; keeps the Medium choice when the estimated gain is small
- **Harder** -- 128 sampled deals, a smaller decision margin, and a search of the final two tricks
- **Hardest** -- 384 sampled deals, a smaller decision margin, and a search of the final three tricks

Solo Hard levels simulate the remaining auction and use card-aware simulated
play. Samples account for public voids, the upcard, and the dealer's own discard.
Bots receive their own hand and public information; late-hand searches solve
hypothetical deals without access to the actual opponents' hands.

Online Easy and Medium follow the browser's policies. Online Hard levels use the
same 32/128/384 sampling budgets with Medium rollouts; the strategic rollout
policy and late-hand search are specific to solo play. Online bots also keep
opponents' hands hidden.

See [AI benchmarks](docs/ai-benchmarks.md) for strength measurements, methodology,
and difficulty tuning. Run `npm run benchmark:ai` to compare difficulties or
`npm run benchmark:easy` for the Easy rebalance study.

## Multiplayer

1. **Create** an online lobby from Play and receive a six-character code and invitation link.
2. **Share** the invitation with friends, who can join as guests or with a Cards account.
3. **Choose seats** opposite your partner, name your team, and select a bot difficulty for empty seats.
4. **Play** in real time, then start another game with the same group or return to the lobby to rearrange seats.

### Lobbies and teams

- The first human on each team can save a name of up to 24 characters. Names
  update immediately in the lobby, at the table, and in hand results.
- The bot picker starts on Easy. Its Hard option uses the signed-in creator's
  Hard setting from Options (Hard, Harder, or Hardest); guests use regular Hard.
  That setting stays with the lobby across host changes and later games.
  Replacement bots use the current game's difficulty; games starting with four
  humans use the creator's Hard setting for later replacements.
- Leave Seat lets players swap seats while staying in the group. Their places
  remain reserved while rearranging, and the host waits for them to sit before
  starting. Other visitors can wait for the next game in the waiting room;
  guests enter a name, while signed-in players use their account name.
- Hosting passes to the earliest remaining lobby arrival, regardless of seat
  changes. Team naming passes to the remaining teammates. Hosts can leave the
  lobby to keep the group together or close it to end the group.
- Play Again keeps partners, difficulty, invitations, seats, and team names.
  Back to Lobby lets the group rearrange before the next game.

### Rejoining and timeouts

Opening Play with an unfinished solo game offers Continue/Concede; online groups
offer Rejoin/Leave. Conceding or leaving requires confirmation. Leaving a seat
during an active game warns about the loss and bot takeover; waiting lobbies
and groups between games have no forfeit warning.

When a decision is available, a sound and shake remind the player after
15 seconds. A warning appears at 9 minutes, followed by removal and bot takeover
at 10 minutes. Bidding, discarding, playing, and Next Hand all count; waiting for
other players does not. Making a move clears the warning.

Disconnects have a two-minute grace period. Rejoining in time keeps the seat;
removed seats cannot be reclaimed during that game. Leaving explicitly forfeits
the game and hands the seat to a bot. Lobby and game snapshots survive service
restarts and expire after 20 minutes without activity.

## Getting Started

Install Node.js 22.12+, Python 3.11, and uv. Keep `cards`, `hearts`, and `euchre`
as sibling checkouts, then follow Cards' [local setup](../cards/README.md#run-locally)
to install the three backend environments and both frontends. For this frontend,
copy `.env.example` to `.env`, set the Font Awesome package token, and run
`npm run web:install`. Keep the token out of Git.

```powershell
npm run dev
```

This delegates to Cards' split runner: hub on port 3000, Hearts/Euchre frontends
on 3001/3002, and accounts/Hearts/Euchre servers on 5100/5101/5102. Start the
shared stack once and open [localhost:3000](http://localhost:3000/).

Local accounts, stable keys, and file-only verification/recovery mail live in
`cards/.local/split-dev/`. Read mail at
[localhost:3000/__dev/mail/](http://localhost:3000/__dev/mail/); no provider
credentials are needed. Existing databases and browser saves are not imported.
Ctrl+C stops the processes this runner launched.

`npm run dev:web` starts a frontend-only preview with separately configured
backend destinations. `up`, `up:build`, `down`, `up-prod`, and `down-prod` retain
the explicit Docker frontend previews. Stop previews using the same ports
before starting the default stack; existing Docker volumes are retained.

## Accounts and Saves

Solo games save after every action. Leaving the table pauses bots, and bidding,
discarding, playing, and Next Hand have no time limit. Saved solo games do not
expire. Results are recorded once when a game finishes or is conceded. Only
finished, non-conceded games count toward games played, win rates, score
statistics, win streaks, and game-completion achievements.

Solo saves and achievements remain browser-local; account-owned solo results
sync to the service. Signed-in players receive server-recorded multiplayer
results, deduplicated by account and game. Monthly and all-time multiplayer win
leaderboards and User → Separate → Multiplayer keep Euchre results separate
from Hearts statistics.

Browser storage belongs to the browser and origin. Use `localhost` consistently
for local saves; `127.0.0.1` is a different origin. Clearing site data removes
local progress. The app reports when storage is unavailable.

Production frontend builds use `VITE_BASE_PATH=/euchre/` and
`VITE_ACCOUNT_API_URL=/api/account`. Routes, assets, and the bot worker resolve
beneath the configured base. Registration, verification, and password recovery
link to the Cards hub. See [account and hosting notes](docs/shared-accounts.md)
for account integration, routing, and result-validation boundaries.

## Releases and Migrations

- **`game-vMAJOR.MINOR.PATCH`** publishes only the independent `euchre-game-api`.
- **`web-vMAJOR.MINOR.PATCH`** publishes only the `euchre-web` frontend, built for the Cards hub.
- Both publish immutable images and source/digest records. Production uses
  reviewed image pins; publishing a candidate does not deploy it or promote `latest`.
- Frontend builds require the repository's Font Awesome Actions secret; backend builds do not.

The [legacy release workflow](docs/legacy-releases.md) is manual-only, requires
acknowledgement, and refuses existing image versions. Historical tags retain
their original workflow definitions. The combined implementation remains
available for guarded rollback; run only one owner against live Euchre tables.

Production uses the independent Euchre server and shared Cards accounts.
Migrations run as explicit jobs, never during service startup. See the
[game server README](api/README.md) for schema ownership and the transition from
legacy revision **019**.

## Testing

### Frontend

```powershell
npm test
npm run build
```

Uses Vitest, Testing Library, and jsdom. Tests cover card ranking, left-bower
following suit, scoring, lone hands, redealing, seeded games to completion,
simulation legality, hidden information, save recovery, result deduplication,
and the shared-account adapter. `npm --prefix web test` runs in watch mode;
`npm --prefix web run test:coverage` produces coverage.

### Backend

```powershell
cd api
uv sync --locked --extra dev
uv run --locked --extra dev pytest -q
```

Uses pytest with disposable in-memory databases. The independent server can be
tested without either sibling repository.

### Rules Parity and Releases

From the repository root, with Node.js 22.13+ and the backend environment installed:

```powershell
npm run test:multiplayer-rules
npm run test:release
```

The parity check compares browser TypeScript and server Python rules through
legal games. Release tests check component tags, image records, and legacy
publishing safeguards.

## Assets

- User-supplied SVG deck retained in `web/public/cards` with its embedded credits.
- Moon/stars: [Phosphor Icons](https://github.com/phosphor-icons/core/blob/main/assets/thin/moon-stars-thin.svg), MIT; license in `web/public/icons`.
- EB Garamond: [Google Fonts](https://github.com/google/fonts/tree/main/ofl/ebgaramond), SIL Open Font License; bundled locally with `OFL.txt`.
- Icons: the same licensed Font Awesome Pro packages as Hearts.
- Selected sounds and layout styles reused from the user's Hearts project.
- Background music: ["Jazzy Lofi - Calm background Loop"](https://pixabay.com/music/smooth-jazz-jazzy-lofi-calm-background-loop-541849/) by [Sonican](https://pixabay.com/users/sonican-38947841/),
  used under the [Pixabay Content License](https://pixabay.com/service/license-summary/).
  The user-supplied MP3 is bundled as `web/public/music/sonican-jazzy-lofi-calm-background-loop-541849.mp3`.
  The playlist also includes nine user-supplied tracks in `web/public/music/`:
  [ZephiraMusic](https://pixabay.com/users/zephiramusic-54643547/)'s “Jazzy Lofi” (613380), “Lofi Beats” (580208),
  “Lofi Focus” (606303), “Chill Lofi” (585360), “Lofi Soul” (588903),
  and “Tokyo Lofi” (604786); [Alex Morgan](https://pixabay.com/users/alex-morgan-54692529/)'s “Lofi Coffee Shop” (568150)
  and “Lofi Restaurant” (568157); and [VelarioMusic](https://pixabay.com/users/velariomusic-54515099/)'s “Lofi Relaxing” (598427).
  Each shuffled round plays all ten tracks once, then reshuffles without
  repeating the previous round's last song first. The music toggle pauses and
  resumes the current track without resetting the rotation.

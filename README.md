# Euchre

A sister to [Hearts](https://hearts.shmem.dev), preserving its layout with a
navy, dusty-peach, and cream celestial deck, EB Garamond, and Font Awesome icons.

## Play locally

The Docker development preview runs at **http://localhost:3002**. Use
`npm run up` to start it and `npm run down` to stop it.

For a directly running preview instead, stop the Docker preview first, then run:

```powershell
npm run dev
```

For a fresh checkout, install Node.js 22.12+ and copy `.env.example` to `.env`.
Add your Font Awesome Pro package token to `.env`, then run:

```powershell
npm run web:install
npm run dev
```

Credentials stay out of Git. The token is used only for dependency installation,
not in frontend code. `web/.npmrc` contains an environment-variable reference.

## Docker Compose

The commands follow the Hearts workflow. Euchre uses its own Compose project,
dependency volume, and **port 3002**; Hearts can continue using 3001.
Docker Desktop must be running with Linux containers enabled. Set the Font Awesome
token in the root `.env` first, as above. Stop a directly running `npm run dev`
before starting Docker on the same port.

```powershell
npm run up:build  # Build and start the development container with hot reload
npm run up        # Start it again
npm run down      # Stop it
```

For a local Nginx preview of the production build:

```powershell
npm run down
npm run up-prod
npm run down-prod
```

Font Awesome credentials are passed using BuildKit secret mounts and are not
retained in the image. Solo gameplay, bot simulations and saves run in the browser.
Online games use the shared Cards API in the sibling Hearts project. Start
`npm run dev:accounts` in the sibling Cards repo for local multiplayer; the web
preview proxies `/api/account` and `/socket.io` to it. If dependencies change, stop the dev containers
and remove only the `euchre_web_node_modules` volume before rebuilding; it stores
installed packages, not saved games.

## Gameplay

- Four players, fixed partnerships, a 24-card deck, five cards per hand.
- [Bicycle rules](https://bicyclecards.com/how-to-play/euchre): two bidding rounds,
  dealer pickup/discard, right/left bowers, following suit, and optional lone hands.
- The dealer rotates after eight passes. No stick-the-dealer rule.
- First partnership to 10 wins; no rubber points.
- Easy: loose bidding, mostly sensible card play and discards, and occasional
  random legal choices.
- Medium: heuristic bidding, discards, and cooperative card play.
- Hard, Harder, Hardest: 32, 128, and 384 sampled deals per decision. All three
  simulate passing through the remaining auction and use card-aware simulated
  play. Hard keeps the Medium choice when the estimated gain is small; Harder
  and Hardest use smaller margins and search the final two and three tricks of
  each hypothetical deal respectively.
- Simulations run in a Web Worker and receive only the bot's own hand and public
  information. Sampling accounts for public voids, the upcard, and the dealer's
  own discard. Late search solves hypothetical deals, not the actual hidden
  hands. See [AI benchmarks](docs/ai-benchmarks.md) for strength measurements,
  methodology, and difficulty tuning.
- Games auto-save after every action. Leaving the table pauses bots. Local
  statistics and achievements are recorded once when a game finishes or is conceded.
- Sound effects, optional music, dark/light themes, and card styles.

Browser storage is local to the browser and origin. Using `localhost` consistently
keeps your local saves together; `127.0.0.1` is a different origin. Clearing site
data removes local progress. The app reports when storage is unavailable.

## Shared Cards home

The app is prepared for `cards.shmem.dev/euchre/`:

- All app routes use React Router's configurable base path.
- Assets and the bot worker resolve beneath the configured Vite base.
- Set `VITE_BASE_PATH=/euchre/` when building for the future hub.
- The hub and both games share the Hearts account service through an HttpOnly
  cookie. Start `npm run dev:accounts` in the sibling Cards repo and use localhost
  consistently. The runner initializes a fresh local database.
- Euchre links to the hub for registration, verification, and password recovery.
  Production builds need `VITE_ACCOUNT_API_URL=/api/account` and API routing.
- Existing live Hearts identities and passwords are preserved when deploying
  migration017 against the existing database. No live deployment has been done.
- Solo saves and achievements remain browser-local. Account-owned solo results
  sync to the shared service; multiplayer games and results are server-owned.

## Multiplayer

- Play offers the same Create Game and Join Game choices as Hearts. Choose
  Online to create a lobby, then share its six-character code or invitation URL.
- Entering Play with an unfinished game opens a Continue/Concede prompt.
  Online groups offer Rejoin/Leave instead. Conceding or leaving requires
  confirmation and returns to the Play choices before a new game is selected.
  Waiting lobbies and groups between games never show a forfeit warning;
  leaving a seat in a game that is still running warns about the loss and bot takeover.
- Choose any open seat. Partners sit opposite one another. The first human on
  each team can save a name of up to 24 characters; everyone sees saved names
  immediately, including at the table and in hand results.
- The host starts the game and can choose a bot difficulty for empty seats.
  The popup starts on Easy. Its Hard choice uses the signed-in creator's Hard
  strength from Options (Hard, Harder or Hardest); guests get regular Hard.
  That Hard setting stays with the lobby across host changes and later games.
  Replacement bots use the current game's difficulty; a game starting with
  four humans uses the creator's Hard setting for any later replacements.
  Online Easy and Medium follow the browser's bidding/discard/play policies;
  Hard levels compare 32/128/384 hypothetical deals using Medium rollouts.
  The browser's strategic rollout policy and late-hand search are specific to
  solo Hard levels. Online bots never use the actual opponents' hands.
- Disconnects have a 30-second grace period, then a bot takes over. A reconnect
  can reclaim that seat. Leaving explicitly forfeits the game and gives the
  seat to a bot. Hosting and team naming transfer to the remaining humans.
- At game end the host can Play Again immediately with the same partners and
  difficulty, or choose Back to Lobby to rearrange the group. Invitations,
  seats and team names carry over.
- Leave Seat frees your spot while keeping you in the group, so a full table
  can trade seats. Your place stays reserved while you rearrange, and the host
  waits until those players are seated before starting.
- Anyone viewing the lobby without a seat appears in its waiting room, which
  disappears when empty. Guests can enter a name there; signed-in arrivals use
  their account name. Additional visitors can wait for the next game without
  blocking the current group or taking a place reserved during a seat swap.
- Signed-in players get server-recorded multiplayer results, deduplicated by
  account and game. Multiplayer wins have monthly and all-time leaderboards and
  appear in User → Separate → Multiplayer, independently of Hearts statistics.
- Lobby/game snapshots survive service restarts and expire after 20 minutes
  without activity. The shared API uses one worker for multiplayer timers,
  matching the existing Hearts deployment. Apply migration **019** before
  deploying the updated API. No live deployment is performed by local setup.

See [account and hosting notes](docs/shared-accounts.md) for local setup,
existing-account migration, routing, and result-validation boundaries.
No extra GitHub repository is needed to run or finish the local Euchre site.

## Verification

```powershell
npm test
npm run build
npm run test:multiplayer-rules
```

Tests cover card ranking, left-bower following suit, all scoring cases, lone hands,
redealing, seeded games to completion, simulation legality, hidden information,
save recovery, result deduplication, and the shared-account adapter.

## Assets

- User-supplied SVG deck retained in `web/public/cards` with its embedded credits.
- Moon/stars: [Phosphor Icons](https://github.com/phosphor-icons/core/blob/main/assets/thin/moon-stars-thin.svg), MIT; license in `web/public/icons`.
- EB Garamond: [Google Fonts](https://github.com/google/fonts/tree/main/ofl/ebgaramond), SIL Open Font License; bundled locally with `OFL.txt`.
- Icons: the same licensed Font Awesome Pro packages as Hearts.
- Selected sounds and layout styles reused from the user's Hearts project.
- Background music: "Sketchbook 2025-11-26" by Abstraction (Benjamin Burnes),
  from the [Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle), CC0.
  The original Ogg is bundled as `web/public/sounds/abstraction-sketchbook-2025-11-26.ogg`
  with its [license](web/public/sounds/abstraction-sketchbook-2025-11-26.LICENSE.txt).

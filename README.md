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
retained in the image. This first version needs only a web container: gameplay,
bot simulations, saved games, and stats run in the browser. There is no separate
database or Socket.IO service. If dependencies change, stop the dev containers
and remove only the `euchre_web_node_modules` volume before rebuilding; it stores
installed packages, not saved games.

## Gameplay

- Four players, fixed partnerships, a 24-card deck, five cards per hand.
- [Bicycle rules](https://bicyclecards.com/how-to-play/euchre): two bidding rounds,
  dealer pickup/discard, right/left bowers, following suit, and optional lone hands.
- The dealer rotates after eight passes. No stick-the-dealer rule.
- First partnership to 10 wins; no rubber points.
- Easy: loose bidding and random legal plays.
- Medium: heuristic bidding, discards, and cooperative card play.
- Hard, Harder, Hardest: 32, 128, and 384 sampled deals per decision.
- Simulations run in a Web Worker and receive only the bot's own hand and public
  information. Sampling accounts for public voids, the upcard, and the dealer's
  own discard. These budgets are distinct; playing strength is not yet benchmarked.
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
- Euchre games, stats, and achievements remain browser-local after signing in.

See [account and hosting notes](docs/shared-accounts.md) for local setup,
existing-account migration, routing, and result-validation boundaries.
No extra GitHub repository is needed to run or finish the local Euchre site.

## Verification

```powershell
npm test
npm run build
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

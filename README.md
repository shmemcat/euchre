# Euchre

A sister to [Hearts](https://hearts.shmem.dev), preserving its layout with a
navy, dusty-peach, and cream celestial deck, EB Garamond, and Font Awesome icons.

## Play locally

Keep `cards`, `hearts` and `euchre` beside each other and install Node.js 22.12+,
Python 3.11 and uv. Follow Cards' [local setup](../cards/README.md#run-locally)
to install the three backend environments and both frontends. In this checkout,
copy `.env.example` to `.env`, set the Font Awesome package token, and run
`npm run web:install`. Keep the token out of Git.

```powershell
npm run dev
```

This starts the shared Cards split stack once: hub 3000, Hearts/Euchre web apps
3001/3002, and accounts/Hearts/Euchre servers 5100/5101/5102. Open
<http://localhost:3000/>. Shared accounts and file-only mail use
`cards/.local/split-dev/`; existing databases and browser saves are not imported.
Ctrl+C stops the processes this runner launched. Local verification/recovery
mail is available at `/__dev/mail/`; no provider credentials are needed.

`npm run dev:web` preserves the frontend-only preview with separately configured
backend destinations. Existing `up`, `up:build`, `down`, `up-prod` and `down-prod`
remain explicit Docker frontend previews. Stop previews using the same ports
before starting the default stack. No Docker volumes are removed by this change.

## Releases

`game-vMAJOR.MINOR.PATCH` publishes the independent Euchre game API and `web-v*`
publishes only the frontend. Both publish immutable candidate records, without
deploying or promoting `latest`. The [legacy workflow](docs/legacy-releases.md)
is manual-only, requires acknowledgement, and refuses existing image versions.
The follow-up PR targets the release branch; integrate that branch into `main`
separately. Historical tags retain their original workflow definitions.

Production already uses the independent Euchre server and shared Cards accounts.
Current production pins and the guarded combined rollback remain unchanged.

## Gameplay

- Four players, fixed partnerships, a 24-card deck, five cards per hand.
- [Bicycle rules](https://bicyclecards.com/how-to-play/euchre): two bidding rounds,
  dealer pickup/discard, right/left bowers, following suit, and optional lone hands.
- After everyone passes in both bidding rounds, the same dealer redeals. A second
  consecutive passed-out hand moves the deal clockwise. Calling trump resets the
  count; passed-out hands score no points. No stick-the-dealer rule.
- Passed-out hands pause at a "No calls — Re-deal" or "No calls — Pass" summary
  showing unchanged totals. The player (or multiplayer host) continues to the next deal.
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
  without activity. The independent Euchre API uses one worker for multiplayer timers.
  Its explicit owned migration follows the retained legacy **019** schema;
  service startup performs no migrations. Local setup does not deploy.

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

## Independent game server

The [standalone Euchre API](api/README.md) owns Euchre gameplay and uses the
shared Cards account service. Tests, dependencies, schema jobs, images and
component releases are independent of Hearts. The original combined copy is
retained for guarded rollback; never run both owners against live tables.

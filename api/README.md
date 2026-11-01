# Independent Euchre game server

This package owns Euchre rules, authoritative multiplayer tables/timers, saved
table recovery, bot and multiplayer results, leaderboards, and private account
cleanup. It runs without importing or checking out Hearts or Cards. Accounts,
passwords, sessions, recovery mail, and JWT signing remain in Cards.

Production uses this server with shared Cards accounts. Root `npm run dev`
delegates to the sibling Cards split stack. The original combined Euchre code
remains available only for guarded rollback/compatibility work; never run both
owners against live Euchre tables. Existing production pins are unchanged.

Waiting-lobby members have two minutes to reconnect before losing their spot.
Host controls pass to the next remaining member if the host leaves or expires.
The lobby closes once its last viewer has been disconnected for two minutes.
Started games have no inactivity deadline, including bidding, discarding,
playing, and Next Hand. A returning client authenticates with its saved seat
token and receives the same private state. Conceding replaces the seat with a
bot while at least two humans remain. Once only one human remains, the game and
lobby close without recording a completed result. Earlier completed results
remain saved.

Only completed, non-conceded games count toward games played, win rate, score
statistics, and game-completion achievements. Conceded results remain in history
but do not count as losses or break win streaks, including previously saved results.

Multiplayer game commands echo the displayed lobby's per-player `actionToken`
and `revision`. The token binds the move to its game, hand, bidding decision or
trick, while unrelated lobby and connection updates can advance the revision.
Turn and legal-move checks still apply, and duplicate or outdated moves cannot
apply again. Next Hand remains an idempotent readiness choice bound to its game
and hand. Clients without tokens retain the exact-revision check.

## Independent installation and checks

From `api/`, install with `uv sync --locked --extra dev` and run
`uv run --locked --extra dev pytest -q`. Tests initialize disposable in-memory
databases, allow migration files only within pytest's temporary directory, and
reject other SQLAlchemy file/network connections before opening them. They
include an inherited-database sentinel check. No real local database is used.

From the repository root, run `npm run test:multiplayer-rules`. Node 22.13+
compares browser TypeScript with this package without installing web dependencies
or importing Hearts. `node scripts/check-multiplayer-engine.mjs --combined` is
an optional transition check against the retained Hearts implementation when
that checkout is available. Check CI independently tests and builds `api/` without either sibling repository. The separate `game-release.yml` publishes only `euchre-game-api` for `game-vMAJOR.MINOR.PATCH` tags, refusing existing version tags and uploading a digest/source/schema record. It does not promote `latest` or deploy. The retained legacy web workflow is [manual-only](../docs/legacy-releases.md). Cards' default local stack and pinned-image CI are described in [component releases](../../cards/docs/component-releases.md).

## Configuration and entrypoint

`DATABASE_URL` is mandatory. There is deliberately no local database fallback.
`CARDS_PUBLIC_URL` is the existing shared HTTPS origin (HTTP is allowed for
localhost). Set `CARDS_ACCOUNTS_URL` to the private Cards accounts origin,
`CARDS_SERVICE_ID=euchre-game`, and `CARDS_SERVICE_TOKEN` to that principal's
distinct random read key. Accounts grants `sessions.validate` and
`profiles.read` scopes to this principal. Do not provide JWT/password/mail
credentials to the game process.

`CARDS_GAME_ACCOUNT_TOKENS` is JSON containing a separate random `euchre` callback
key of at least 32 characters. It matches the token in the account service's
`CARDS_GAME_SERVICES.euchre` entry. In the split configuration, that entry points to this server. `CORS_ORIGINS` and `TRUSTED_PROXY_HOPS` retain their existing
meaning. Private interfaces must stay behind the gateway's `_internal` deny
rules and inside the private service network.

The image runs `gunicorn -c gunicorn_conf.py euchre_server.wsgi:app` on port
5002, with one eventlet worker. The single process owns all table state,
reentrant write gates, bot jobs, and disconnect timers. Identity checks happen
outside the write gate; signed commands revalidate access, and outages return a
retryable error without downgrading a player or forfeiting their seat. Existing
guest sockets remain playable. Preserve one writer per table at activation.

## Public and private contracts

- HTTP preserves `/account/euchre/results`, `/account/euchre/leaderboard`, and
  `/account/euchre/multiplayer-results`. Public `/api/euchre/` and older aliases
  can continue to rewrite to these paths at cutover. No account mutation routes
  or Hearts handlers are registered.
- Only the `/euchre` Socket.IO namespace is registered, on the internal transport
  `/socket.io/`. The gateway already rewrites public `/euchre/socket.io/` to it.
- `POST /_internal/games/v1/euchre/delete-user` requires the accounts callback key
  and the existing v1 `{user_id, request_id}` contract. It removes result rows,
  scrubs live/persisted seat credentials and identifying participant fields,
  disconnects affected clients, and retains idempotent receipts. Tombstones
  prevent stale identities from recreating deleted data.
- `/health` reports `component=euchre-game`, image version, and source revision.
  `/ready` checks the game and deletion schema revisions without querying users
  or cascading account-service outages into game restarts.

## Schema and activation preparation

Run `python -m euchre_server.schema upgrade` using a migration role, with the
same explicit configuration, before starting the runtime image. Runtime startup
never migrates or runs the old shared `flask db upgrade` chain. Verify with
`python -m euchre_server.schema check` and `/ready`.

The migration owns `euchre_game_results`, `euchre_tables`,
`euchre_achievement_state`, `euchre_saved_games`, and
`euchre_alembic_version=euchre_003`.
Revision 002 adds per-game achievement evidence and account settings unlocks;
run the upgrade before starting the updated game service. Existing result
history continues to count toward progression. Card and bidding achievements
require the detailed history recorded by updated games. Holiday badges use the
game's start date and the player's local offset at that time, and unlock when
the game is completed without conceding. It reuses the phase-3 deletion receipts
`euchre_account_deletions` and
`euchre_account_schema_version=game_accounts_001`, preserving existing fences.
Existing game tables require verified legacy revision **019**, compatible
columns, account foreign keys, and result deduplication constraints. Fresh game
tables require the shared account `users` table first. The account foreign key
retains `ON DELETE CASCADE`; only migration metadata mentions it. The runtime
has no account model or account-table queries.

Provision runtime grants only for Euchre game/receipt tables and sequences,
with read access to its schema-version tables. A separate migration role has
DDL and the temporary account-ID read needed to scrub orphaned legacy snapshot
references. It never infers accounts from names. Accounts keeps account-table
privileges; Hearts keeps its game tables. The migration preserves original IDs,
scores, timestamps, snapshots, seat tokens, and deletion receipts for valid
accounts. There is no destructive downgrade.

Take a backup and rehearse with a restored PostgreSQL database. At the reviewed
cutover, drain or explicitly rehearse the old Euchre owner's table handoff,
stop its writer/timers, migrate once, pin the new image, and switch every Euchre
HTTP/socket alias and account cleanup callback to the same new owner. Keep
Hearts and accounts on their existing pins. A local recovery test is not
permission to activate competing production writers.

Cards' `npm run test:euchre-server` runs disposable accounts, Hearts-only, and
standalone Euchre processes over actual HTTP and JavaScript Socket.IO clients.
It checks shared sign-in, a full game, saved-table restart recovery, result
deduplication, outage/guest behavior, revocation, deletion across both games,
and an unchanged connected Hearts game during Euchre restart. Runtime SQL guards
reject any Euchre access to account or Hearts tables. Cards' `npm run test:postgres`
also passes with real split containers, restricted PostgreSQL roles, and a
synthetic legacy backup/restore with preserved record fingerprints. Restoring
the actual production backup and checking published image pins remain separate
steps before deployment; see [component releases](../../cards/docs/component-releases.md).
# Achievement schema rollout

The achievement release adopts `euchre_002` and adds achievement evidence and
account unlock state. Deploy the dedicated compatibility image from the previous
production code first. During the explicit maintenance procedure, stop admission
and writers, take a fresh backup, run the new image's migration as the schema
owner, and grant CRUD on `euchre_achievement_state` only to `euchre_runtime`.
Existing table grants cover the added result column. Resume the compatible image
and verify health before promoting the final `euchre_002` release. Runtime
credentials never migrate, and rollback retains the additive schema and data.

## Saved bot games

Signed-in bot games are stored in `euchre_saved_games`. `GET` and `PUT`
`/account/euchre/saved-game` load the latest unfinished game and save a snapshot
with an expected revision. Passing `?game_id=...` restores a particular owned
game. `GET /account/euchre/saved-games` lists all of the account's unfinished
bot games and seated multiplayer games. Account identity and CSRF checks apply to writes;
stale devices receive the newer snapshot instead of overwriting it. The
`X-Euchre-User` header binds each browser request to its expected account, so an
account change during a request cannot transfer a save to someone else. Finished
snapshots remain as revision fences and are excluded from resume lookup.
Account deletion removes these saves alongside results and achievement state.

The browser keeps an account-specific retry copy for interrupted connections.
Existing browser saves are imported only for their recorded account owner, and
the old copy is removed after database acknowledgement. Guest games remain local.
Starting another game preserves earlier saves; conceding a card affects only
that game. Waiting lobbies do not appear in the list. Disconnected members have
two minutes to return before losing their spot, and a lobby closes after its
last viewer has been away for two minutes. Started games have no inactivity
deadline: their human seats remain resumable until a player concedes. Conceding
replaces that seat with a bot while at least two people remain. Once only one
person remains, the game and lobby close without recording completed results.

Before releasing revision `euchre_003`, run the explicit migration as the schema
owner and grant `SELECT, INSERT, UPDATE, DELETE ON euchre_saved_games TO euchre_runtime`.
The new table needs no sequence grant. Keep writers stopped during migration;
verify schema readiness and cross-browser resume before reopening admission.

## Storage retention

The single game worker checks at startup and hourly, compacting closed multiplayer
tables and finished/conceded bot saves after 24 hours in batches of 200 of each.
Unfinished games remain resumable indefinitely. Final scores, account result
records, leaderboard history, achievement evidence, and unlock state remain.
Cards, trick details, and table membership credentials are discarded. Small
closed-ID/revision receipts prevent old tabs from reviving retired games, and an
exact final-save retry is still acknowledged. Receipts do not count toward the
open-table limit or appear in resume cards.

A finished bot save without its corresponding result is retained until the
result is recorded. Closed multiplayer tables recover any missing final results
before compaction. Connected result views are left intact. Existing eligible
records are included automatically; no new migration or grants are required.
Tests disable the maintenance worker by default. `START_STORAGE_CLEANUP=False`
disables it explicitly; the `cleanup_storage` app extension runs the same sweep.

## Game creation limits

Each account can have 20 unfinished games per app, counting bot and multiplayer
games together. Finished, conceded, and closed games stop counting immediately.
New game/lobby creation allows five per minute per player. Joining and starting
check available space again; rematches also respect the allowance. Resume, moves,
result saves, and concessions remain available at the limit. Waiting lobbies do
not count as unfinished games. `MAX_IN_PROGRESS_GAMES` and
`GAME_CREATIONS_PER_MINUTE` configure these defaults for this single worker.
Guest browser identities apply where games are server-owned; Euchre guest bot
saves stay in the browser and have their own browser allowance.

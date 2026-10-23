# Independent Euchre game server

This package owns Euchre rules, authoritative multiplayer tables/timers, saved
table recovery, bot and multiplayer results, leaderboards, and private account
cleanup. It runs without importing or checking out Hearts or Cards. Accounts,
passwords, sessions, recovery mail, and JWT signing remain in Cards.

Production uses this server with shared Cards accounts. Root `npm run dev`
delegates to the sibling Cards split stack. The original combined Euchre code
remains available only for guarded rollback/compatibility work; never run both
owners against live Euchre tables. Existing production pins are unchanged.

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

The migration owns `euchre_game_results`, `euchre_tables`, and
`euchre_alembic_version=euchre_001`. It reuses the phase-3 deletion receipts
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

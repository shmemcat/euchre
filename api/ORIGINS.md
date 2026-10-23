# Source history and transition ownership

The original combined service is `shmemcat/hearts`, release `v5.0.2`, commit
`a28ebaf470a94aee611040af03bc0be4c6000aa6`. Its local account-interface and
private accounts refactor preceded this extraction.

`euchre_server/euchre_engine.py`, `euchre_multiplayer.py`, and `euchre_routes.py`
originate from identically named files under `hearts/api/hearts/`. The pure rules
module is copied without a rules change. Multiplayer code changes package
imports and uses only the remote account/deletion boundary. HTTP results and
rankings retain their wire format and remove the local account ORM branch.
`models.py` carries only `EuchreGameResult` and `EuchreTable`; the existing account
foreign key is managed by the service migration instead of a runtime User model.

The small account contract/client, application-specific limiter/runtime helpers,
and Euchre portions of `game_accounts.py` originate from that same local Hearts
refactor. All Hearts game handlers and local account implementations are omitted.
The standalone factory, migration chain, packaging, independence checks, and
cross-service rehearsal are added here.

Engine, multiplayer, and HTTP regression tests originate from the corresponding
`hearts/api/tests/test_euchre_*.py` files. Account-owner fixtures are replaced by
a private account peer; account implementation tests remain in Cards, and
legacy migration tests remain in Hearts. Database-isolation guard/sentinel tests
are retained independently in this repository.

The original combined implementation remains untouched for the current release.
During this transition, run the default rules comparison against this package
and the optional `--combined` comparison against Hearts. Retirement of the old
copy happens only after release isolation and the reviewed single-owner cutover.

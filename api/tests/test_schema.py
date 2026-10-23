from datetime import datetime
import json

import pytest
from sqlalchemy import inspect, text

from euchre_server.extensions import db
from euchre_server.models import EuchreGameResult, EuchreTable
from euchre_server.schema import schema_ready, upgrade_schema
from tests.conftest import add_profile


def test_fresh_schema_owns_only_euchre_and_preserves_account_fk(app):
    with app.app_context():
        tables = set(inspect(db.engine).get_table_names())
        assert tables == {
            "users",
            "euchre_game_results",
            "euchre_tables",
            "euchre_account_deletions",
            "euchre_account_schema_version",
            "euchre_alembic_version",
        }
        assert "users" not in db.metadata.tables
        assert schema_ready()
        key = inspect(db.engine).get_foreign_keys("euchre_game_results")[0]
        assert (
            key["referred_table"] == "users" and key["options"]["ondelete"] == "CASCADE"
        )
        upgrade_schema()


@pytest.mark.parametrize("revision", ["019", "018"])
def test_legacy_adoption_preserves_records_and_rejects_older_schema(app, revision):
    add_profile(app, 42, "preserved")
    snapshot = json.dumps(
        {
            "seats": [
                {"userId": 42, "name": "preserved", "token": "preserved-seat"},
                None,
                None,
                None,
            ],
            "participants": [],
            "unseated": {},
        }
    )
    with app.app_context():
        db.session.add(EuchreTable(code="ABCDEF", snapshot=snapshot))
        db.session.add(
            EuchreGameResult(
                user_id=42,
                game_id="preserved-result",
                difficulty="easy",
                won=True,
                conceded=False,
                score=10,
                opponent_score=5,
                completed_at=datetime(2020, 1, 1),
            )
        )
        db.session.commit()
        db.session.execute(text("DROP TABLE euchre_alembic_version"))
        db.session.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
        )
        db.session.execute(
            text("INSERT INTO alembic_version VALUES (:revision)"),
            {"revision": revision},
        )
        db.session.commit()
        if revision == "018":
            with pytest.raises(RuntimeError, match="019"):
                upgrade_schema()
            assert not schema_ready()
        else:
            upgrade_schema()
            assert schema_ready()
        assert EuchreTable.query.one().snapshot == snapshot
        assert EuchreGameResult.query.one().game_id == "preserved-result"
        assert db.session.execute(text("SELECT COUNT(*) FROM users")).scalar() == 1
        assert (
            db.session.execute(text("SELECT version_num FROM alembic_version")).scalar()
            == revision
        )


def test_migration_scrubs_orphaned_legacy_credentials_and_retains_receipts(app):
    from euchre_server.game_accounts import receipts

    with app.app_context():
        snapshot = {
            "seats": [
                {
                    "userId": 900,
                    "token": "orphan-seat",
                    "name": "Deleted player",
                    "joined": 0,
                },
                None,
                None,
                None,
            ],
            "unseated": {},
            "participants": [{"userId": 900, "token": "orphan-seat", "seat": 0}],
            "status": "waiting",
            "game": None,
            "host": "orphan-seat",
            "teams": [
                {"name": "Deleted team", "captain": "orphan-seat", "named": True},
                {"name": "Team 2", "captain": None, "named": False},
            ],
            "revision": 1,
        }
        db.session.add(EuchreTable(code="ORPHAN", snapshot=json.dumps(snapshot)))
        db.session.commit()
        db.session.execute(text("DROP TABLE euchre_alembic_version"))
        db.session.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
        )
        db.session.execute(text("INSERT INTO alembic_version VALUES ('019')"))
        db.session.commit()
        upgrade_schema()
        db.session.expire_all()
        scrubbed = EuchreTable.query.one().snapshot
        assert "orphan-seat" not in scrubbed and "Deleted player" not in scrubbed
        assert db.session.execute(receipts["euchre"].select()).one().user_id == 900


def test_runtime_refuses_future_schema_without_migrating_it(app):
    with app.app_context():
        db.session.execute(
            text("UPDATE euchre_alembic_version SET version_num = 'euchre_future'")
        )
        db.session.commit()
    client = app.test_client()
    assert client.get("/ready").status_code == 503
    assert client.get("/health").status_code == 200
    assert client.get("/account/euchre/leaderboard").status_code == 503
    with app.app_context():
        assert (
            db.session.execute(
                text("SELECT version_num FROM euchre_alembic_version")
            ).scalar()
            == "euchre_future"
        )

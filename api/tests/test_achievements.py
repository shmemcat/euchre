from datetime import datetime

import pytest
from sqlalchemy import inspect, text

from tests.account_fixtures import accounts, existing_user, post, sign_in
from tests.conftest import add_profile
from euchre_server.achievements import multiplayer_evidence
from euchre_server.extensions import db
from euchre_server.models import EuchreAchievementState, EuchreGameResult
from euchre_server.schema import schema_ready, upgrade_schema


def result(**changes):
    return dict(
        id="achievement-game",
        difficulty="easy",
        won=True,
        conceded=False,
        scores=[10, 0],
        finishedAt="2026-10-21T11:00:00Z",
        marches=1,
        loners=2,
        euchres=1,
        achievementData={
            "unlocks": ["double_feature"],
            "calledSuits": ["s"],
            "startedAt": "2026-10-21T10:00:00Z",
            "utcOffsetMinutes": 420,
        },
        **changes,
    )


def test_upload_restores_counters_and_evidence_without_duplicate_credit(
    accounts, existing_user
):
    sign_in(accounts)
    for _ in range(2):
        assert (
            post(accounts, "euchre/results", {"results": [result()]}).status_code == 200
        )
    response = accounts.get("/account/euchre/achievements")
    assert (
        response.status_code == 200 and response.headers["Cache-Control"] == "no-store"
    )
    saved = response.json["results"]
    assert len(saved) == 1
    assert (saved[0]["loners"], saved[0]["marches"], saved[0]["euchres"]) == (2, 1, 1)
    assert saved[0]["achievementData"] == result()["achievementData"]
    assert EuchreGameResult.query.count() == 1


def test_legacy_upload_can_be_enriched_once_but_earned_evidence_is_immutable(
    accounts, existing_user
):
    sign_in(accounts)
    old = result()
    for key in ("achievementData", "marches", "loners", "euchres"):
        old.pop(key)
    assert post(accounts, "euchre/results", {"results": [old]}).status_code == 200
    assert post(accounts, "euchre/results", {"results": [result()]}).status_code == 200
    edited = result()
    edited["achievementData"]["unlocks"].append("hat_trick")
    assert post(accounts, "euchre/results", {"results": [edited]}).status_code == 409
    assert post(accounts, "euchre/results", {"results": [old]}).status_code == 200
    assert EuchreGameResult.query.one().loners == 2


def test_old_clients_cannot_erase_backfilled_hand_counters(accounts, existing_user):
    sign_in(accounts)
    game = result()
    game.pop("achievementData")
    assert post(accounts, "euchre/results", {"results": [game]}).status_code == 200
    for key in ("marches", "loners", "euchres"):
        game.pop(key)
    assert post(accounts, "euchre/results", {"results": [game]}).status_code == 200
    assert EuchreGameResult.query.one().loners == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"loners": True},
        {"marches": -1},
        {"euchres": 20},
        {"achievementData": []},
        {"achievementData": {"unlocks": ["geezer"], "calledSuits": []}},
        {"achievementData": {"unlocks": ["full_house"], "calledSuits": []}},
        {"achievementData": {"unlocks": [], "calledSuits": ["x"]}},
        {"achievementData": {"unlocks": [], "calledSuits": [], "partnerKey": "forged"}},
        {
            "achievementData": {
                "unlocks": [],
                "calledSuits": [],
                "utcOffsetMinutes": True,
            }
        },
        {
            "achievementData": {
                "unlocks": [],
                "calledSuits": [],
                "utcOffsetMinutes": 841,
            }
        },
        {"achievementData": {"unlocks": [], "calledSuits": [], "startedAt": "bad"}},
        {
            "achievementData": {
                "unlocks": [],
                "calledSuits": [],
                "startedAt": "2026-10-22T10:00:00Z",
            }
        },
    ],
)
def test_invalid_evidence_is_rejected_atomically(accounts, existing_user, changes):
    sign_in(accounts)
    game = result()
    game.update(changes)
    assert post(accounts, "euchre/results", {"results": [game]}).status_code == 400
    assert EuchreGameResult.query.count() == 0


def test_music_unlock_requires_own_session_and_csrf_and_cannot_unlock_game_secrets(
    accounts, existing_user
):
    assert accounts.get("/account/euchre/achievements").status_code == 401
    assert post(accounts, "euchre/achievements", {"id": "geezer"}).status_code == 401
    sign_in(accounts)
    assert (
        accounts.post("/account/euchre/achievements", json={"id": "geezer"}).status_code
        == 403
    )
    assert post(accounts, "euchre/achievements", {"id": "hat_trick"}).status_code == 400
    for _ in range(2):
        assert post(accounts, "euchre/achievements", {"id": "geezer"}).json == {
            "unlocks": ["geezer"]
        }
    assert EuchreAchievementState.query.count() == 1
    assert accounts.get("/account/euchre/achievements").json["unlocks"] == ["geezer"]


def test_achievement_state_is_private_and_removed_on_account_cleanup(
    accounts, existing_user, app
):
    from euchre_server.game_accounts import _cleanup_euchre

    sign_in(accounts)
    post(accounts, "euchre/achievements", {"id": "geezer"})
    post(accounts, "euchre/results", {"results": [result()]})
    add_profile(app, 43, "another_player")
    sign_in(accounts, "another_player")
    assert accounts.get("/account/euchre/achievements").json == {
        "unlocks": [],
        "results": [],
    }
    _cleanup_euchre(42)
    db.session.commit()
    assert EuchreAchievementState.query.count() == 0
    assert EuchreGameResult.query.count() == 0


def test_multiplayer_credits_the_caller_and_uses_each_participants_start_offset(app):
    from euchre_server.euchre_multiplayer import record_results

    with app.app_context():
        for seat in range(4):
            add_profile(app, 42 + seat, f"human_{seat}")
        participants = [
            dict(
                userId=42 + seat,
                token=str(seat),
                seat=seat,
                conceded=False,
                utcOffsetMinutes=420 if seat % 2 == 0 else -60,
            )
            for seat in range(4)
        ]
        game = dict(
            id="multiplayer-achievement",
            phase="game_over",
            conceded=False,
            scores=[12, 0],
            startedAt="2026-10-31T06:30:00+00:00",
            finishedAt="2026-10-31T07:30:00+00:00",
            results=[
                dict(
                    maker=0,
                    alone=True,
                    tricks=[5, 0],
                    scores=[4 * (i + 1), 0],
                    trump="s",
                )
                for i in range(3)
            ],
        )
        table = dict(game=game, participants=participants, status="playing")
        record_results(table)
        db.session.commit()
        record_results(table)
        db.session.commit()
        rows = {r.user_id: r for r in EuchreGameResult.query.all()}
        assert len(rows) == 4 and rows[42].loners == 3 and rows[44].loners == 0
        assert "hat_trick" in rows[42].achievement_data["unlocks"]
        assert "hat_trick" not in rows[44].achievement_data["unlocks"]
        assert "full_house" in rows[43].achievement_data["unlocks"]
        assert rows[42].achievement_data["utcOffsetMinutes"] == 420
        assert rows[43].achievement_data["utcOffsetMinutes"] == -60
        assert len(rows[42].achievement_data["partnerKey"]) == 64
        assert (
            rows[42].achievement_data["partnerKey"]
            != rows[44].achievement_data["partnerKey"]
        )
        participants[2]["conceded"] = True
        assert "partnerKey" not in multiplayer_evidence(table, participants[0])
        assert (
            "full_house" not in multiplayer_evidence(table, participants[0])["unlocks"]
        )
        assert multiplayer_evidence(table, participants[2])["unlocks"] == []


def test_revision_002_upgrades_existing_001_rows_without_losing_results(app):
    with app.app_context():
        add_profile(app, 42, "preserved_achievement")
        db.session.add(
            EuchreGameResult(
                user_id=42,
                game_id="old-game",
                difficulty="easy",
                won=True,
                conceded=False,
                score=10,
                opponent_score=5,
                completed_at=datetime(2020, 1, 1),
            )
        )
        db.session.commit()
        db.session.execute(text("DROP TABLE euchre_achievement_state"))
        db.session.execute(
            text("ALTER TABLE euchre_game_results DROP COLUMN achievement_data")
        )
        db.session.execute(
            text("UPDATE euchre_alembic_version SET version_num = 'euchre_001'")
        )
        db.session.commit()
        assert not schema_ready()
        upgrade_schema()
        assert schema_ready()
        assert EuchreGameResult.query.one().game_id == "old-game"
        assert EuchreGameResult.query.one().achievement_data is None
        key = inspect(db.engine).get_foreign_keys("euchre_achievement_state")[0]
        assert (
            key["referred_table"] == "users" and key["options"]["ondelete"] == "CASCADE"
        )

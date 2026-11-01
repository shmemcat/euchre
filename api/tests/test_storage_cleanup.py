"""Retired saves retain durable results and cannot be revived by old devices."""

import copy
import json
import time
from datetime import datetime

import pytest

from euchre_server import euchre_multiplayer as mp
from euchre_server.euchre_engine import new_game
from euchre_server.extensions import db
from euchre_server.models import (
    EuchreAchievementState,
    EuchreGameResult,
    EuchreSavedGame,
    EuchreTable,
)
from euchre_server.storage_cleanup import (
    RETENTION_SECONDS,
    cleanup_closed_games,
    open_table_count,
)
from tests.account_fixtures import sign_in
from tests.test_saved_games import PATH, save


def finished_save(accounts, when):
    game = new_game()
    game.update(
        phase="game_over",
        conceded=True,
        finishedAt=datetime.utcfromtimestamp(when).isoformat() + "Z",
    )
    assert save(accounts, game).status_code == 200
    row = db.session.get(EuchreSavedGame, game["id"])
    row.updated_at = datetime.utcfromtimestamp(when)
    db.session.commit()
    return game


def archive(game):
    db.session.add(
        EuchreGameResult(
            user_id=42,
            game_id=game["id"],
            difficulty="easy",
            won=False,
            conceded=True,
            score=game["scores"][0],
            opponent_score=game["scores"][1],
            completed_at=datetime.fromisoformat(
                game["finishedAt"].replace("Z", "+00:00")
            ).replace(tzinfo=None),
            achievement_data={"hands": 4, "tricks": 5},
        )
    )
    db.session.commit()


def test_final_save_prunes_after_one_day_without_changing_results_or_revision(
    app, accounts, existing_user
):
    sign_in(accounts)
    now = time.time()
    game = finished_save(accounts, now)
    archive(game)
    db.session.add(EuchreAchievementState(user_id=42, unlocks=["geezer"]))
    db.session.commit()
    cleanup = app.extensions["cleanup_storage"]
    assert cleanup(now + RETENTION_SECONDS - 1)["bot_saves_compacted"] == 0
    assert cleanup(now + RETENTION_SECONDS)["bot_saves_compacted"] == 1
    row = db.session.get(EuchreSavedGame, game["id"])
    assert row.game["_storage_pruned"] and row.revision == 2
    assert "hands" not in row.game and row.game["scores"] == game["scores"]
    result = EuchreGameResult.query.one()
    assert result.achievement_data == {"hands": 4, "tricks": 5}
    assert db.session.get(EuchreAchievementState, 42).unlocks == ["geezer"]
    assert accounts.get(PATH + "?game_id=" + game["id"]).json == {
        "game": None,
        "revision": 2,
    }
    # An exact final-save retry is acknowledged without restoring the payload.
    assert save(accounts, game).status_code == 200
    stale = copy.deepcopy(game)
    stale.update(phase="bidding1", conceded=False, finishedAt=None)
    assert save(accounts, stale, 1).status_code == 409
    assert db.session.get(EuchreSavedGame, game["id"]).game["_storage_pruned"]
    assert cleanup(now + RETENTION_SECONDS)["bot_saves_compacted"] == 0


def test_unfinished_recent_and_pending_result_saves_are_preserved(
    app, accounts, existing_user
):
    sign_in(accounts)
    now = time.time()
    pending = finished_save(accounts, now - RETENTION_SECONDS - 100)
    recent = finished_save(accounts, now - 100)
    archive(recent)
    active = new_game()
    assert save(accounts, active).status_code == 200
    db.session.get(EuchreSavedGame, active["id"]).updated_at = (
        datetime.utcfromtimestamp(now - 100 * RETENTION_SECONDS)
    )
    db.session.commit()
    result = cleanup_closed_games(now)
    assert result["bot_saves_compacted"] == 0 and result["pending_results"] == 1
    assert db.session.get(EuchreSavedGame, pending["id"]).game == pending
    assert db.session.get(EuchreSavedGame, active["id"]).game == active


def test_closed_table_prunes_and_recovers_missing_final_result_without_reusing_code(
    app, accounts, existing_user
):
    sign_in(accounts)
    now = time.time()
    game = new_game()
    game.update(
        phase="game_over",
        scores=[10, 6],
        finishedAt=datetime.utcfromtimestamp(now - RETENTION_SECONDS).isoformat() + "Z",
    )
    table = dict(
        code="ABC234",
        status="closed",
        _closed_at=now - RETENTION_SECONDS,
        touched=now - RETENTION_SECONDS,
        revision=10,
        game=game,
        seats=[None] * 4,
        unseated={},
        teams=[],
        participants=[dict(userId=42, seat=0, conceded=False, utcOffsetMinutes=420)],
    )
    db.session.add(
        EuchreTable(
            code=table["code"],
            snapshot=json.dumps(table),
            updated_at=datetime.utcfromtimestamp(now - RETENTION_SECONDS),
        )
    )
    db.session.commit()
    assert cleanup_closed_games(now)["tables_compacted"] == 1
    row = db.session.get(EuchreTable, table["code"])
    assert json.loads(row.snapshot)["_storage_pruned"]
    assert json.loads(row.snapshot)["final_game"]["scores"] == [10, 6]
    assert EuchreGameResult.query.one().score == 10
    assert open_table_count() == 0
    mp._tables.clear()
    with pytest.raises(ValueError, match="expired"):
        mp.get_table(table["code"])


def test_compaction_fences_a_writer_that_read_the_old_revision(
    app, accounts, existing_user
):
    from sqlalchemy.orm import Session
    from sqlalchemy.orm.exc import StaleDataError

    sign_in(accounts)
    now = time.time()
    game = finished_save(accounts, now - RETENTION_SECONDS)
    archive(game)
    with Session(db.engine) as other_worker:
        stale = other_worker.get(EuchreSavedGame, game["id"])
        assert cleanup_closed_games(now)["bot_saves_compacted"] == 1
        stale.game = {**game, "message": "An old device saved again"}
        stale.revision += 1
        with pytest.raises(StaleDataError):
            other_worker.commit()
        other_worker.rollback()
    from tests.test_service import cleanup as delete_account

    assert delete_account(accounts).json["deleted"]
    assert db.session.get(EuchreSavedGame, game["id"]) is None

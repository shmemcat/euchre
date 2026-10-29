from datetime import datetime
from types import SimpleNamespace

import pytest

from euchre_server.achievement_counts import achievement_count, calendar_unlocks
from euchre_server.extensions import db
from euchre_server.models import EuchreAchievementState, EuchreGameResult
from tests.conftest import add_profile


def result(**changes):
    values = dict(game_id="game", completed_at=datetime(2026, 1, 1), difficulty="easy",
                  won=False, conceded=False, score=5, opponent_score=10,
                  marches=0, loners=0, euchres=0, achievement_data=None)
    return SimpleNamespace(**(values | changes))


@pytest.mark.parametrize("value, expected", [(0, 0), (1, 1), (10, 2), (50, 3)])
def test_each_loner_tier_counts_separately(value, expected):
    assert achievement_count([result(loners=value)]) == 1 + expected


def test_deduplicates_unlocks_ignores_unknowns_and_conceded_evidence():
    rows = [result(game_id=str(i), won=True, difficulty="multiplayer",
                   achievement_data={"unlocks": ["full_house", "full_house", "unknown"],
                                     "calledSuits": ["c", "d", "s", "h"], "partnerKey": "partner"})
            for i in range(10)]
    # Newcomer, first win, friends, full house, suits, partner, streak, bronze wins, geezer.
    assert achievement_count(rows, ["geezer", "geezer", "unknown"]) == 9
    assert achievement_count([result(conceded=True, won=True, achievement_data={"unlocks": ["full_house"]})]) == 0


def test_calendar_uses_local_start_and_includes_holiday_collection():
    assert calendar_unlocks({"startedAt": "2026-01-02T06:00:00Z", "utcOffsetMinutes": 420}) == {"new_year"}
    assert calendar_unlocks({"startedAt": "2026-04-05T06:00:00Z", "utcOffsetMinutes": 0}) == {"easter_egg", "early_bird"}
    assert calendar_unlocks({"startedAt": "bad", "utcOffsetMinutes": 0}) == set()


def test_public_top_ten_includes_settings_only_and_filters_missing_unverified(app):
    for uid in range(1, 16):
        add_profile(app, uid, f"Player{uid:02}", verified=uid != 1)
    app.extensions["accounts"].profiles.pop(15)
    with app.app_context():
        for uid in range(1, 16):
            db.session.add(EuchreAchievementState(user_id=uid, unlocks=["geezer"]))
        db.session.add(EuchreGameResult(user_id=14, **vars(result(won=True))))
        db.session.commit()
    response = app.test_client().get("/account/euchre/leaderboard?category=achievements")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json["monthly"] == []
    rows = response.json["all_time"]
    assert len(rows) == 10
    assert rows[0] == dict(rank=1, username="Player14", profile_icon="user", achievement_count=3)
    assert [row["username"] for row in rows[1:]] == [f"Player{uid:02}" for uid in range(2, 11)]
    assert [row["rank"] for row in rows] == list(range(1, 11))
    app.extensions["accounts"].unavailable = True
    assert app.test_client().get("/account/euchre/leaderboard?category=achievements").status_code == 503

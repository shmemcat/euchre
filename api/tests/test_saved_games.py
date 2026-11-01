import copy
import random
import pytest
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from euchre_server.euchre_engine import new_game, apply_action, legal_actions, bot_action
from euchre_server.saved_games import valid_game
from euchre_server.extensions import db
from euchre_server.models import EuchreSavedGame
from tests.account_fixtures import sign_in
from tests.conftest import add_profile, ORIGIN, CSRF
from tests.test_service import cleanup

PATH = "/account/euchre/saved-game"
HEADERS = {"Origin": ORIGIN, "X-CSRF-Token": CSRF, "X-Euchre-User": "42"}


def save(client, game, revision=0, user_id="42"):
    return client.put(PATH, json={"game": game, "revision": revision}, headers={**HEADERS, "X-Euchre-User": user_id})


def test_resume_in_another_browser(app, accounts, existing_user):
    sign_in(accounts)
    game = new_game(rng=random.Random(42))
    response = save(accounts, game)
    assert response.status_code == 200
    assert response.json == {"game": game, "revision": 1}
    second = app.test_client()
    sign_in(second)
    assert second.get(PATH).json == response.json
    with app.app_context():
        db.session.remove()
    assert second.get(PATH).json == response.json
    advanced = apply_action(game, legal_actions(game)[0], rng=random.Random(43))
    assert save(second, advanced, 1).json["revision"] == 2
    assert accounts.get(PATH).json["game"] == advanced


def test_database_save_survives_a_new_application_worker(app, existing_user, tmp_path):
    from euchre_server import create_app
    from euchre_server.schema import upgrade_schema
    from sqlalchemy import text

    config = {**app.config, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'saved.sqlite'}"}
    peer = app.extensions["accounts"]
    first = create_app(config, accounts=peer)
    with first.app_context():
        db.session.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        db.session.execute(text("INSERT INTO users (id) VALUES (42)"))
        db.session.commit()
        upgrade_schema()
        browser = first.test_client()
        sign_in(browser)
        game = new_game()
        assert save(browser, game).status_code == 200
    restarted = create_app(config, accounts=peer)
    with restarted.app_context():
        browser = restarted.test_client()
        sign_in(browser)
        assert browser.get(PATH).json == {"game": game, "revision": 1}


def test_snapshot_validation_accepts_every_phase_of_complete_bot_matches():
    phases = set()
    for seed in range(4):
        rng = random.Random(seed)
        game = new_game(rng=rng)
        for _ in range(2000):
            assert valid_game(game), game["phase"]
            phases.add(game["phase"])
            if game["phase"] == "game_over":
                break
            game = apply_action(game, bot_action(game, rng=rng), rng=rng)
        else:
            raise AssertionError("The match did not finish")
    assert {"bidding1", "bidding2", "playing", "discard", "trick_complete", "round_complete", "game_over"} <= phases


def test_stale_device_cannot_overwrite_newer_moves_and_retries_are_idempotent(app, accounts, existing_user):
    sign_in(accounts)
    game = new_game(rng=random.Random(42))
    assert save(accounts, game).json["revision"] == 1
    assert save(accounts, game).json["revision"] == 1
    next_game = apply_action(game, legal_actions(game)[0], rng=random.Random(43))
    assert save(accounts, next_game, 1).json["revision"] == 2
    stale = copy.deepcopy(game)
    stale["message"] = "An older device changed this game"
    conflict = save(accounts, stale, 1)
    assert conflict.status_code == 409 and conflict.json["code"] == "SAVE_CONFLICT"
    assert conflict.json["game"] == next_game
    assert accounts.get(PATH).json == {"game": next_game, "revision": 2}


def test_simultaneous_device_writes_cannot_overwrite_the_same_revision(app, accounts, existing_user):
    sign_in(accounts)
    game = new_game()
    assert save(accounts, game).status_code == 200
    with app.app_context(), Session(db.engine) as first, Session(db.engine) as second:
        one = first.get(EuchreSavedGame, game["id"])
        two = second.get(EuchreSavedGame, game["id"])
        one.game = {**game, "message": "The first device saved"}
        one.revision = 2
        first.commit()
        two.game = {**game, "message": "The second device saved"}
        two.revision = 2
        with pytest.raises(StaleDataError):
            second.commit()
        second.rollback()
    assert accounts.get(PATH).json["game"]["message"] == "The first device saved"


def test_saves_are_private_require_csrf_and_are_removed_on_account_deletion(app, accounts, existing_user):
    game = new_game()
    assert save(accounts, game).status_code == 401
    sign_in(accounts)
    assert accounts.put(PATH, json={"game": game, "revision": 0}).status_code == 403
    assert save(accounts, game).status_code == 200
    add_profile(app, 43, "another_player")
    second = app.test_client()
    sign_in(second, "another_player")
    assert second.get(PATH).json == {"game": None, "revision": 0}
    assert save(second, game).status_code == 401
    assert second.get(PATH, headers={"X-Euchre-User": "42"}).status_code == 401
    assert save(second, game, user_id="43").status_code == 404
    assert cleanup(accounts).json["deleted"]
    assert save(accounts, game, 1).status_code == 401
    assert accounts.get(PATH).status_code == 401
    with app.app_context():
        assert EuchreSavedGame.query.count() == 0


def test_invalid_and_oversized_snapshots_do_not_change_saved_progress(app, accounts, existing_user):
    sign_in(accounts)
    game = new_game()
    assert save(accounts, game).status_code == 200
    invalid = copy.deepcopy(game)
    invalid["hands"][0][0] = invalid["hands"][0][1]
    assert save(accounts, invalid, 1).status_code == 400
    assert save(accounts, game, True).status_code == 400
    oversized = copy.deepcopy(game)
    oversized["message"] = "x" * 140000
    assert save(accounts, oversized, 1).status_code == 413
    assert accounts.get(PATH).json == {"game": game, "revision": 1}


def test_finished_games_are_not_offered_for_resume(app, accounts, existing_user):
    sign_in(accounts)
    game = new_game()
    game.update(phase="game_over", conceded=True, finishedAt="2026-11-01T00:00:00Z")
    assert save(accounts, game).status_code == 200
    assert accounts.get(PATH).json == {"game": None, "revision": 0}

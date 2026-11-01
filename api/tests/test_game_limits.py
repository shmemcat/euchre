from euchre_server.euchre_engine import new_game
from euchre_server.game_limits import open_games
from tests.account_fixtures import sign_in
from tests.test_euchre_multiplayer import tables, cmd
from tests.test_saved_games import save


def test_bot_and_multiplayer_share_a_cap_and_terminal_saves_free_space(
    app, accounts, existing_user, tables
):
    app.config["MAX_IN_PROGRESS_GAMES"] = 2
    sign_in(accounts)
    first, second = new_game(), new_game()
    assert save(accounts, first).status_code == 200
    assert save(accounts, second).status_code == 200
    blocked = save(accounts, new_game())
    assert blocked.status_code == 409 and "2 games in progress" in blocked.json["error"]
    connect, _, _ = tables
    host = connect(accounts)
    assert "2 games in progress" in cmd(host, "create")["error"]
    first.update(phase="game_over", conceded=True, finishedAt="2026-10-31T00:00:00Z")
    assert save(accounts, first, 1).status_code == 200
    assert open_games("account:42") == 1
    assert cmd(host, "create")["ok"]
    assert cmd(host, "start", difficulty="easy")["ok"]
    assert open_games("account:42") == 2
    assert save(accounts, new_game()).status_code == 409


def test_creation_window_expires_and_is_separate_per_player(app):
    import pytest
    from euchre_server.game_limits import GameLimit, check_creation

    with app.app_context():
        for _ in range(5):
            check_creation("account:rate-test")
        with pytest.raises(GameLimit) as error:
            check_creation("account:rate-test")
        assert error.value.status == 429
        check_creation("account:another-player")
        app.extensions["game_creation_times"]["account:rate-test"] = [-1000]
        check_creation("account:rate-test")

import pytest
from tests.test_euchre_multiplayer import tables, cmd, join
from tests.account_fixtures import sign_in
from tests.test_saved_games import save, HEADERS
from euchre_server.euchre_engine import new_game


def test_saved_games_list_includes_all_owned_bots_but_no_waiting_lobbies(app, accounts, existing_user, tables):
    sign_in(accounts)
    first, second = new_game(), new_game()
    assert save(accounts, first).status_code == save(accounts, second).status_code == 200
    connect, tasks, mp = tables
    host = connect(accounts)
    cmd(host, "create", name="A waiting room")
    response = accounts.get("/account/euchre/saved-games", headers={"X-Euchre-User": "42"})
    assert {game["id"] for game in response.json["games"]} == {first["id"], second["id"]}
    assert all("hands" not in game for game in response.json["games"])
    assert accounts.get("/account/euchre/saved-game?game_id=" + first["id"]).json["game"] == first
    stranger = app.test_client()
    assert stranger.get("/account/euchre/saved-games").status_code == 401


def test_waiting_lobby_closes_after_last_viewer_and_reconnect_cancels_cleanup(tables, monkeypatch):
    from euchre_server import socketio
    delays = []
    monkeypatch.setattr(socketio, "sleep", delays.append)
    connect, tasks, mp = tables
    host = connect()
    created = cmd(host, "create")
    host.disconnect(namespace=mp.NS)
    close = tasks.pop()
    returning = connect()
    assert cmd(returning, "watch", code=created["code"], token=created["token"])["ok"]
    close()
    assert mp.get_table(created["code"])["status"] == "waiting"
    assert cmd(returning, "unwatch", code=created["code"])["ok"]
    tasks.pop()()
    assert mp.get_table(created["code"])["status"] == "closed"
    assert delays == [120, 120]


def test_started_game_survives_unwatch_and_is_listed_on_another_device(app, accounts, existing_user, tables):
    sign_in(accounts)
    connect, tasks, mp = tables
    host = connect(accounts)
    created = cmd(host, "create")
    assert cmd(host, "start", difficulty="easy")["ok"]
    tasks.clear()
    assert cmd(host, "unwatch", code=created["code"])["ok"]
    assert mp.get_table(created["code"])["status"] == "playing"
    assert tasks == []
    entries = accounts.get("/account/euchre/saved-games").json["games"]
    assert entries[0]["code"] == created["code"] and entries[0]["token"] == created["token"]


def test_concessions_replace_with_bots_until_one_person_remains_then_close_without_results(accounts, existing_user, tables):
    from euchre_server.models import EuchreGameResult
    sign_in(accounts)
    connect, tasks, mp = tables
    host, first, second = connect(accounts), connect(), connect()
    created = cmd(host, "create")
    join(first, created["code"], 1, "First")
    join(second, created["code"], 2, "Second")
    assert cmd(host, "start")["ok"]
    assert cmd(first, "leave")["ok"]
    table = mp.get_table(created["code"])
    assert table["status"] == "playing" and table["seats"][1]["bot"]
    assert cmd(second, "leave")["ok"]
    assert table["status"] == "closed" and table["closedReason"] == "one_player"
    assert table["game"]["cancelled"] and not table["participants"][0]["conceded"]
    assert EuchreGameResult.query.count() == 0
    assert accounts.get("/account/euchre/saved-games").json["games"] == []
    assert not cmd(host, "play_again")["ok"]


@pytest.mark.parametrize("finished", [False, True])
def test_legacy_concessions_close_unfinished_games_and_preserve_finished_results(accounts, existing_user, tables, finished):
    from datetime import datetime, timezone
    from euchre_server.models import EuchreGameResult
    sign_in(accounts)
    connect, tasks, mp = tables
    host, guest = connect(accounts), connect()
    created = cmd(host, "create")
    join(guest, created["code"], 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(created["code"])
    table["seats"][1].update(bot=True)
    table["participants"][1]["conceded"] = True
    if finished:
        table["game"].update(phase="game_over", scores=[10,4], finishedAt=datetime.now(timezone.utc).isoformat())
    mp.save(table)
    mp._tables.clear()
    assert cmd(host, "watch", code=created["code"], token=created["token"])["ok"]
    restored = mp.get_table(created["code"])
    assert restored["status"] == ("finished" if finished else "closed")
    assert EuchreGameResult.query.count() == (1 if finished else 0)
    if finished:
        assert EuchreGameResult.query.one().won


@pytest.mark.parametrize("guest_also_leaves", [False, True])
def test_waiting_member_expires_and_host_migrates_only_after_the_last_tab_disconnects(tables, monkeypatch, guest_also_leaves):
    from euchre_server import socketio
    connect, tasks, mp = tables
    delays = []
    monkeypatch.setattr(socketio, "sleep", delays.append)
    host = connect()
    created = cmd(host, "create")
    guest = connect()
    guest_token = join(guest, created["code"], 1, "Guest")
    other_tab = connect()
    assert cmd(other_tab, "watch", code=created["code"], token=created["token"])["ok"]
    tasks.clear()
    host.disconnect(namespace=mp.NS)
    assert tasks == []
    other_tab.disconnect(namespace=mp.NS)
    assert mp.member_for(mp.get_table(created["code"]), created["token"]) is not None
    if guest_also_leaves:
        guest.disconnect(namespace=mp.NS)
    tasks.pop(0)()
    table = mp.get_table(created["code"])
    assert table["status"] == "waiting" and table["host"] == guest_token
    assert mp.member_for(table, created["token"]) is None
    if not guest_also_leaves:
        guest.disconnect(namespace=mp.NS)
    assert table["status"] == "waiting"
    tasks.pop(0)()
    assert table["status"] == "closed" and delays == [120, 120]

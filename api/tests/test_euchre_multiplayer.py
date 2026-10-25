"""Real socket clients exercise private views, ownership, recovery and results."""

import copy
import json
import random
from datetime import datetime, timezone

import pytest
from tests.account_fixtures import accounts, existing_user, sign_in, post
from euchre_server.euchre_engine import (
    new_game,
    legal_actions,
    apply_action,
    bot_action,
    effective,
    legal_cards,
    winner,
)


@pytest.fixture
def tables(accounts, monkeypatch):
    from euchre_server import app, socketio
    from euchre_server import euchre_multiplayer as mp

    mp._tables.clear()
    mp._clients.clear()
    mp._jobs.clear()
    mp._disconnections.clear()
    mp._idle.clear()
    tasks = []
    monkeypatch.setattr(
        socketio, "start_background_task", lambda fn: tasks.append(fn) or fn
    )
    monkeypatch.setattr(socketio, "sleep", lambda seconds: None)
    clients = []

    def connect(http=None):
        http = http or app.test_client()
        from tests.conftest import CSRF

        csrf = CSRF
        client = socketio.test_client(
            app, namespace=mp.NS, flask_test_client=http, auth={"csrf": csrf}
        )
        assert client.is_connected(mp.NS)
        clients.append(client)
        return client

    yield connect, tasks, mp
    for client in clients:
        if client.is_connected(mp.NS):
            client.disconnect(namespace=mp.NS)
    mp._tables.clear()
    mp._clients.clear()
    mp._jobs.clear()
    mp._disconnections.clear()
    mp._idle.clear()


def cmd(client, kind, **data):
    return client.emit(
        "command", dict(type=kind, **data), namespace="/euchre", callback=True
    )


def test_disconnect_expiry_pauses_for_accounts_and_grants_recovery_time(
    tables, accounts, existing_user
):
    from euchre_server import app

    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    created = cmd(host, "create")
    assert cmd(host, "start", difficulty="easy")["ok"]
    table = mp.get_table(created["code"])
    host.disconnect(namespace=mp.NS)
    peer = app.extensions["accounts"]
    peer.unavailable = True
    tasks[-1]()
    assert not table["seats"][0].get("bot")
    assert not table["participants"][0]["conceded"]
    peer.unavailable = False
    tasks[-1]()
    assert not table["seats"][0].get(
        "bot"
    ), "Restored accounts must grant a fresh reconnect window"
    tasks[-1]()
    assert table["seats"][0]["bot"] and table["participants"][0]["conceded"]


def state(client):
    events = [
        e["args"][0] for e in client.get_received("/euchre") if e["name"] == "state"
    ]
    assert events
    return events[-1]


def idle_tasks(tasks, mp, token):
    import inspect

    timer = mp._idle[token]
    callbacks = {}
    for task in tasks:
        captures = inspect.getclosurevars(task).nonlocals
        if captures.get("timer") is timer:
            callbacks[task.__name__] = task
    return callbacks["warn"], callbacks["expire"]


def test_idle_warning_move_cancellation_stale_callbacks_and_bot_takeover(
    tables, monkeypatch
):
    from euchre_server import socketio

    connect, tasks, mp = tables
    host, guest = connect(), connect()
    created = cmd(host, "create", name="Host")
    code, token = created["code"], created["token"]
    join(guest, code, 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(phase="bidding1", turn=0, passes=0)
    assert cmd(host, "watch", code=code, token=token)["ok"]
    warn, expire = idle_tasks(tasks, mp, token)
    delays = []
    monkeypatch.setattr(socketio, "sleep", delays.append)
    warn()
    assert delays == [540]
    assert state(host)["lobby"]["idleWarning"]
    assert not state(guest)["lobby"]["idleWarning"]
    timer = mp._idle[token]
    assert not cmd(host, "action", revision=-1, action=dict(type="pass"))["ok"]
    assert mp._idle[token] is timer
    assert cmd(host, "action", revision=table["revision"], action=dict(type="pass"))[
        "ok"
    ]
    assert not state(host)["lobby"]["idleWarning"]
    expire()
    assert delays[-1] == 600
    assert not table["seats"][0]["bot"]
    guest_token = table["seats"][1]["token"]
    _, expire_guest = idle_tasks(tasks, mp, guest_token)
    expire_guest()
    assert table["seats"][1]["bot"]
    assert state(guest)["lobby"]["removedReason"] == "idle"
    assert not cmd(
        guest, "action", revision=table["revision"], action=dict(type="pass")
    )["ok"]
    assert cmd(guest, "watch", code=code, token=guest_token)["ok"]
    assert table["seats"][1]["bot"]


def test_idle_expiry_pauses_during_account_outage(tables, accounts, existing_user):
    from euchre_server import app

    connect, tasks, mp = tables
    sign_in(accounts)
    host, guest = connect(accounts), connect()
    created = cmd(host, "create")
    join(guest, created["code"], 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(created["code"])
    table["game"].update(phase="bidding1", turn=0, passes=0)
    assert cmd(host, "watch", code=created["code"], token=created["token"])["ok"]
    _, expire = idle_tasks(tasks, mp, created["token"])
    peer = app.extensions["accounts"]
    peer.unavailable = True
    expire()
    assert not table["seats"][0]["bot"]
    peer.unavailable = False
    tasks[-1]()
    assert not table["seats"][0]["bot"]
    tasks[-1]()
    assert table["seats"][0]["bot"]


def join(client, code, seat, name="Guest"):
    assert cmd(client, "watch", code=code)["ok"]
    result = cmd(client, "join", seat=seat, name=name)
    assert result["ok"], result
    return result["token"]


def ready(client, game, revision=0):
    return cmd(
        client,
        "action",
        action=dict(type="advance"),
        revision=revision,
        gameId=game["id"],
        handNumber=game["handNumber"],
    )


def passed_out(table):
    for _ in range(8):
        table["game"] = apply_action(table["game"], dict(type="pass"))
    return copy.deepcopy(table["game"])


def test_ready_clicks_are_idempotent_bound_to_the_hand_and_skip_bots(tables):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    join(guest, code, 2)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    summary = passed_out(table)
    assert not ready(guest, {**summary, "id": "another-game"})["ok"]
    assert not ready(guest, {**summary, "handNumber": 999})["ok"]
    assert ready(guest, summary)["ok"]
    revision = table["revision"]
    assert ready(guest, summary)["ok"]
    assert table["revision"] == revision
    assert table["game"]["phase"] == "round_complete"
    assert state(guest)["game"]["nextHandReady"] == [True, True, False, True]
    assert ready(host, summary)["ok"]
    assert table["game"]["phase"] == "bidding1"
    assert table["game"]["handNumber"] == summary["handNumber"] + 1
    assert "nextHandReady" not in table["game"]
    assert not ready(guest, summary)["ok"]
    next_summary = passed_out(table)
    assert not ready(guest, summary)["ok"]
    assert ready(host, next_summary)["ok"]
    assert table["game"]["phase"] == "round_complete"


@pytest.mark.parametrize("departure", ["leave", "disconnect"])
def test_waiting_player_replaced_by_a_bot_does_not_hold_up_the_next_hand(
    tables, departure
):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    join(guest, code, 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    summary = passed_out(table)
    assert ready(host, summary)["ok"]
    if departure == "leave":
        assert cmd(guest, "leave")["ok"]
    else:
        guest.disconnect(namespace=mp.NS)
        assert table["game"]["phase"] == "round_complete"
        tasks[-1]()
    assert table["game"]["phase"] == "bidding1"
    assert table["game"]["handNumber"] == summary["handNumber"] + 1


def test_guest_lobbies_default_to_hard_for_fill_in_and_replacement_bots(tables):
    connect, tasks, mp = tables
    host = connect()
    created = cmd(host, "create", name="Guest host", difficulty="hardest")
    table = mp.get_table(created["code"])
    assert state(host)["lobby"]["defaultDifficulty"] == "hard"
    assert table["difficulty"] == "hard"
    assert cmd(host, "start")["ok"]
    assert table["game"]["difficulty"] == "hard"
    assert all(s["bot"] for s in table["seats"][1:])


@pytest.mark.parametrize("human_seats", [(0,), (0, 2), (1, 3), (2, 3)])
def test_fill_in_bots_are_numbered_consecutively_in_every_players_view(
    tables, human_seats
):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    if human_seats[0] != 0:
        assert cmd(host, "join", seat=human_seats[0], name="Host")["ok"]
    players = [host]
    for seat in human_seats[1:]:
        guest = connect()
        join(guest, code, seat, f"Guest {seat}")
        players.append(guest)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    expected = [f"Bot {i + 1}" for i in range(4 - len(human_seats))]
    assert [s["name"] for s in table["seats"] if s["bot"]] == expected
    for player, seat in zip(players, human_seats):
        view = state(player)
        assert view["game"]["seatNames"] == [
            table["seats"][(i + seat) % 4]["name"] for i in range(4)
        ]
        assert [
            s["name"] for s in view["lobby"]["seats"] if s["status"] == "ai"
        ] == expected


def test_rematch_renumbers_existing_bots_after_a_human_changes_seats(tables):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(
        phase="game_over",
        scores=[10, 4],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert cmd(host, "rematch")["ok"]
    assert cmd(host, "join", seat=2, name="Host")["ok"]
    assert cmd(host, "start")["ok"]
    assert [s["name"] for s in table["seats"]] == ["Bot 1", "Bot 2", "Host", "Bot 3"]


@pytest.mark.parametrize("hard_level", ["hard", "harder", "hardest"])
def test_creator_hard_preference_survives_host_changes_and_snapshot_reload(
    tables, accounts, existing_user, hard_level
):
    connect, tasks, mp = tables
    sign_in(accounts)
    host, successor = connect(accounts), connect()
    created = cmd(host, "create", difficulty=hard_level)
    code = created["code"]
    assert state(host)["lobby"]["defaultDifficulty"] == hard_level
    join(successor, code, 1, "New host")
    assert cmd(host, "leave")["ok"]
    assert state(successor)["lobby"]["isHost"]
    mp._tables.clear()
    assert cmd(successor, "start")["ok"]
    table = mp.get_table(code)
    assert table["defaultDifficulty"] == hard_level
    assert table["game"]["difficulty"] == hard_level


def test_returning_to_lobby_restores_creator_default_after_an_explicit_override(
    tables, accounts, existing_user
):
    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    code = cmd(host, "create", difficulty="harder")["code"]
    assert cmd(host, "start", difficulty="medium")["ok"]
    table = mp.get_table(code)
    assert table["game"]["difficulty"] == "medium"
    table["game"].update(
        phase="game_over",
        scores=[10, 4],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert cmd(host, "rematch")["ok"]
    assert cmd(host, "start")["ok"]
    assert table["game"]["difficulty"] == "harder"
    assert table["defaultDifficulty"] == "harder"


@pytest.mark.parametrize("lobby_status", ["waiting", "playing", "finished"])
@pytest.mark.parametrize("departure", ["leave", "disconnect"])
@pytest.mark.parametrize(
    "host_seat, joining_seats, successor_seat",
    [(0, [3, 1, 2], 3), (1, [0, 3], 0), (2, [1, 0], 1), (3, [2, 1], 2)],
)
def test_host_departure_transfers_in_join_order_skipping_bots_and_empty_seats(
    tables, lobby_status, departure, host_seat, joining_seats, successor_seat
):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    if host_seat:
        assert cmd(host, "join", seat=host_seat, name="Host")["ok"]
    players = {}
    for seat in joining_seats:
        players[seat] = connect()
        join(players[seat], code, seat, f"Player {seat}")
    if lobby_status != "waiting":
        assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    if lobby_status == "finished":
        table["game"].update(
            phase="game_over",
            scores=[10, 4],
            finishedAt=datetime.now(timezone.utc).isoformat(),
        )
        mp.record_results(table)
        mp.save(table)
    successor = table["seats"][successor_seat]["token"]
    if departure == "leave":
        assert cmd(host, "leave")["ok"]
    else:
        host.disconnect(namespace=mp.NS)
        tasks[-1]()
    assert table["host"] == successor
    assert table["status"] == lobby_status
    for seat, player in players.items():
        assert state(player)["lobby"]["isHost"] == (seat == successor_seat)
    mp._tables.clear()
    assert mp.get_table(code)["host"] == successor
    if lobby_status == "finished":
        assert cmd(players[successor_seat], "rematch")["ok"]
    elif lobby_status == "waiting":
        assert cmd(players[successor_seat], "start")["ok"]


@pytest.mark.parametrize("lobby_status", ["waiting", "finished"])
@pytest.mark.parametrize("departure", ["leave", "disconnect"])
def test_last_human_leaving_closes_lobby_without_changing_finished_result(
    tables, accounts, existing_user, lobby_status, departure
):
    from euchre_server.models import EuchreGameResult

    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    code = cmd(host, "create")["code"]
    if lobby_status == "finished":
        assert cmd(host, "start")["ok"]
        table = mp.get_table(code)
        table["game"].update(
            phase="game_over",
            scores=[10, 4],
            finishedAt=datetime.now(timezone.utc).isoformat(),
        )
        mp.record_results(table)
        mp.save(table)
    if departure == "leave":
        assert cmd(host, "leave")["ok"]
    else:
        host.disconnect(namespace=mp.NS)
        assert mp.get_table(code)["status"] == lobby_status
        tasks[-1]()
    mp._tables.clear()
    table = mp.get_table(code)
    assert table["status"] == "closed" and table["host"] is None
    visitor = connect()
    assert cmd(visitor, "watch", code=code)["ok"]
    assert state(visitor)["lobby"]["status"] == "closed"
    assert not cmd(visitor, "join", seat=0, name="Host")["ok"]
    if lobby_status == "finished":
        result = EuchreGameResult.query.one()
        assert result.won and not result.conceded
    else:
        assert EuchreGameResult.query.count() == 0


def test_closing_a_finished_game_keeps_the_lobby_closed(tables):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(
        phase="game_over",
        scores=[10, 4],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert cmd(host, "close")["ok"]
    assert table["status"] == "closed"
    assert state(host)["lobby"]["status"] == "closed"
    assert cmd(host, "watch", code=code)["ok"]
    assert state(host)["lobby"]["status"] == "closed"


@pytest.mark.parametrize(
    "old_difficulty, expected", [("easy", "hard"), ("hardest", "hardest")]
)
def test_older_lobby_snapshots_get_a_hard_default(tables, old_difficulty, expected):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    table = mp.get_table(code)
    table.pop("defaultDifficulty")
    table["difficulty"] = old_difficulty
    mp.save(table)
    mp._tables.clear()
    assert cmd(host, "start")["ok"]
    assert mp.get_table(code)["game"]["difficulty"] == expected


def test_team_names_visible_and_first_teammate_only(tables):
    connect, tasks, mp = tables
    host, guest, partner = connect(), connect(), connect()
    created = cmd(host, "create", name="Host")
    code = created["code"]
    join(guest, code, 3, "West")
    join(partner, code, 2, "Partner")
    assert cmd(host, "name", name="Moon Cats")["ok"]
    assert cmd(guest, "name", name="Star Foxes")["ok"]
    assert not cmd(partner, "name", name="Stolen name")["ok"]
    view = state(partner)["lobby"]
    assert [t["name"] for t in view["teams"]] == ["Moon Cats", "Star Foxes"]
    assert all(not t["canName"] for t in view["teams"])
    assert "token" not in json.dumps(view)
    assert not cmd(host, "name", name="x" * 25)["ok"]
    assert not cmd(guest, "start")["ok"]


def test_moving_seats_transfers_naming_rights_and_cannot_take_occupied_seat(tables):
    connect, tasks, mp = tables
    host, partner = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    join(partner, code, 2)
    assert not cmd(partner, "join", seat=0, name="Guest")["ok"]
    assert cmd(host, "join", seat=1, name="")["ok"]
    assert cmd(partner, "name", name="Partner's team")["ok"]
    assert cmd(host, "name", name="Host's team")["ok"]
    assert state(host)["lobby"]["isHost"]


def test_private_rotated_game_views_and_action_validation(tables):
    connect, tasks, mp = tables
    clients = [connect() for _ in range(4)]
    code = cmd(clients[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(clients[i], code, i, f"Player {i}")
    assert cmd(clients[0], "start", difficulty="medium")["ok"]
    table = mp.get_table(code)
    for i, client in enumerate(clients):
        view = state(client)
        assert view["game"]["hands"][0] == table["game"]["hands"][i]
        assert all(c is None for h in view["game"]["hands"][1:] for c in h)
        assert view["game"]["kitty"] == []
        assert view["game"]["dealer"] == (table["game"]["dealer"] - i) % 4
        assert view["game"]["seatNames"][0] == table["seats"][i]["name"]
        assert "userId" not in json.dumps(view)
    turn = table["game"]["turn"]
    action = dict(type="pass")
    rev = table["revision"]
    assert not cmd(clients[(turn + 1) % 4], "action", action=action, revision=rev)["ok"]
    assert cmd(clients[turn], "action", action=action, revision=rev)["ok"]
    assert not cmd(clients[turn], "action", action=action, revision=rev)["ok"]


def test_game_actions_survive_unrelated_watch_updates_but_not_duplicate_moves(tables):
    connect, tasks, mp = tables
    clients = [connect() for _ in range(4)]
    code = cmd(clients[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(clients[i], code, i, f"Player {i}")
    assert cmd(clients[0], "start")["ok"]
    table = mp.get_table(code)
    turn = table["game"]["turn"]
    displayed = state(clients[turn])["lobby"]
    payload = dict(
        action=dict(type="pass"),
        revision=displayed["revision"],
        actionToken=displayed["actionToken"],
    )
    other = (turn + 1) % 4
    assert cmd(
        clients[other], "watch", code=code, token=table["seats"][other]["token"]
    )["ok"]
    spectator = connect()
    assert cmd(spectator, "watch", code=code)["ok"]
    assert table["revision"] > displayed["revision"]
    # Legacy clients remain protected by their exact revision.
    assert not cmd(
        clients[turn], "action", action=payload["action"], revision=payload["revision"]
    )["ok"]
    assert cmd(clients[turn], "action", **payload)["ok"]
    after = copy.deepcopy(table)
    assert not cmd(clients[turn], "action", **payload)["ok"]
    assert table == after


def test_action_tokens_survive_reload_and_reject_an_earlier_bidding_round(tables):
    connect, tasks, mp = tables
    clients = [connect() for _ in range(4)]
    code = cmd(clients[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(clients[i], code, i)
    assert cmd(clients[0], "start")["ok"]
    table = mp.get_table(code)
    turn = table["game"]["turn"]
    displayed = state(clients[turn])["lobby"]
    payload = dict(
        action=dict(type="pass"),
        revision=displayed["revision"],
        actionToken=displayed["actionToken"],
    )
    mp._tables.pop(code)
    table = mp.get_table(code)
    assert (
        mp.action_token(table, table["seats"][turn]["token"])
        == displayed["actionToken"]
    )
    assert cmd(clients[turn], "action", **payload)["ok"]
    for _ in range(3):
        seat = table["game"]["turn"]
        assert cmd(
            clients[seat],
            "action",
            revision=table["revision"],
            action=dict(type="pass"),
        )["ok"]
    assert table["game"]["turn"] == turn
    assert table["game"]["phase"] == "bidding2"
    after = copy.deepcopy(table)
    assert not cmd(clients[turn], "action", **payload)["ok"]
    assert table == after
    assert cmd(
        clients[turn],
        "action",
        action=dict(type="pass"),
        revision=table["revision"],
        actionToken=mp.action_token(table, table["seats"][turn]["token"]),
    )["ok"]


@pytest.mark.parametrize("bad_token", [None, "wrong", "♥", 12, []])
def test_invalid_action_tokens_do_not_bypass_move_checks(tables, bad_token):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(phase="bidding1", turn=0, passes=0)
    before = copy.deepcopy(table)
    assert not cmd(
        host,
        "action",
        action=dict(type="pass"),
        revision=table["revision"],
        actionToken=bad_token,
    )["ok"]
    assert table == before


def test_replay_commands_cannot_restart_a_later_game(tables):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(
        phase="game_over", finishedAt=datetime.now(timezone.utc).isoformat()
    )
    table["status"] = "finished"
    token = table["seats"][0]["token"]
    replay = dict(revision=table["revision"], actionToken=mp.action_token(table, token))
    assert cmd(host, "play_again", **replay)["ok"]
    table["game"].update(
        phase="game_over", finishedAt=datetime.now(timezone.utc).isoformat()
    )
    table["status"] = "finished"
    before = copy.deepcopy(table)
    assert not cmd(host, "play_again", **replay)["ok"]
    assert table == before


@pytest.mark.parametrize("dealer", range(4))
def test_pass_out_summaries_redeal_then_rotate_after_snapshot_reload(tables, dealer):
    connect, tasks, mp = tables
    clients = [connect() for _ in range(4)]
    code = cmd(clients[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(clients[i], code, i, f"Player {i}")
    assert cmd(clients[0], "start", difficulty="medium")["ok"]
    table = mp.get_table(code)
    table["game"].update(dealer=dealer, turn=(dealer + 1) % 4, scores=[3, 5])
    for hand in range(4):
        original = copy.deepcopy(table["game"])
        for _ in range(8):
            turn = table["game"]["turn"]
            reply = cmd(
                clients[turn],
                "action",
                action=dict(type="pass"),
                revision=table["revision"],
            )
            assert reply["ok"], reply
        game = table["game"]
        assert game["phase"] == "round_complete"
        assert game["message"] == (
            "No calls — Pass" if hand % 2 else "No calls — Re-deal"
        )
        assert game["dealer"] == original["dealer"]
        assert game["hands"] == original["hands"]
        assert game["handNumber"] == original["handNumber"]
        assert game["scores"] == [3, 5] and game["results"] == []
        for i, client in enumerate(clients):
            view = state(client)["game"]
            assert view["message"] == game["message"]
            assert view["dealer"] == (game["dealer"] - i) % 4
            assert view["scores"] == ([3, 5] if i % 2 == 0 else [5, 3])
        revision = table["revision"]
        assert cmd(
            clients[1],
            "action",
            action=dict(type="advance"),
            revision=revision,
            gameId=game["id"],
            handNumber=game["handNumber"],
        )["ok"]
        assert table["game"]["phase"] == "round_complete"
        assert table["game"]["nextHandReady"] == [False, True, False, False]
        assert state(clients[1])["game"]["nextHandReady"] == [True, False, False, False]
        # Recover the pending summary and counter from the persisted snapshot.
        mp._tables.clear()
        table = mp.get_table(code)
        assert table["game"] == game
        for seat in (0, 2, 3):
            assert cmd(
                clients[seat],
                "action",
                action=dict(type="advance"),
                revision=revision,
                gameId=game["id"],
                handNumber=game["handNumber"],
            )["ok"]
            if seat != 3:
                assert table["game"]["phase"] == "round_complete"
        game = table["game"]
        assert game["phase"] == "bidding1"
        assert game["dealer"] == (
            (original["dealer"] + 1) % 4 if hand % 2 else original["dealer"]
        )
        assert game["turn"] == (game["dealer"] + 1) % 4
        assert game["consecutivePassOuts"] == (0 if hand % 2 else 1)
        assert game["handNumber"] == original["handNumber"] + 1
        assert game["scores"] == [3, 5] and game["results"] == []
        assert [len(h) for h in game["hands"]] == [5, 5, 5, 5]


def test_disconnect_grace_bot_takeover_reconnect_and_host_migration(tables):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    created = cmd(host, "create", name="Host")
    code, token = created["code"], created["token"]
    join(guest, code, 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    host.disconnect(namespace=mp.NS)
    expire = tasks[-1]
    assert not table["seats"][0]["bot"]
    restored = connect()
    assert cmd(restored, "watch", code=code, token=token)["ok"]
    expire()
    assert not table["seats"][0]["bot"]
    restored.disconnect(namespace=mp.NS)
    tasks[-1]()
    assert table["seats"][0]["bot"]
    assert table["host"] != token
    assert table["participants"][0]["conceded"]
    recovered = connect()
    assert cmd(recovered, "watch", code=code, token=token)["ok"]
    assert table["seats"][0]["bot"]
    assert table["participants"][0]["conceded"]
    assert state(recovered)["lobby"]["removedReason"] == "disconnected"


def test_explicit_departure_cannot_reclaim_or_name_team(tables):
    connect, tasks, mp = tables
    host, partner = connect(), connect()
    created = cmd(host, "create", name="Host")
    code = created["code"]
    join(partner, code, 2)
    assert cmd(host, "start")["ok"]
    assert cmd(host, "leave")["ok"]
    assert mp.get_table(code)["seats"][0]["bot"]
    assert cmd(host, "watch", code=code, token=created["token"])["ok"]
    assert state(host)["lobby"]["seat"] is None
    assert not cmd(host, "name", name="Nope")["ok"]


def test_snapshot_recovery_preserves_invite_seats_and_team_names(tables):
    connect, tasks, mp = tables
    host = connect()
    created = cmd(host, "create", name="Host")
    assert cmd(host, "name", name="Saved Stars")["ok"]
    assert cmd(host, "start")["ok"]
    original = copy.deepcopy(mp.get_table(created["code"]))
    mp._tables.clear()
    assert mp.get_table(created["code"]) == original
    assert cmd(host, "watch", code=created["code"], token=created["token"])["ok"]
    assert state(host)["game"]["teamNames"][0] == "Saved Stars"


def test_results_are_server_owned_deduplicated_and_separate_from_hearts(
    tables, accounts, existing_user
):
    from euchre_server.models import EuchreGameResult

    connect, tasks, mp = tables
    sign_in(accounts)
    host, guest = connect(accounts), connect()
    created = cmd(host, "create", name="Ignored")
    code = created["code"]
    join(guest, code, 1)
    assert cmd(host, "name", name="Moon Cats")["ok"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(
        phase="game_over",
        scores=[10, 6],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    mp.record_results(table)
    mp.save(table)
    assert EuchreGameResult.query.count() == 1
    assert EuchreGameResult.query.one().won
    board = accounts.get("/account/euchre/leaderboard?category=multiplayer").json
    assert board["all_time"][0]["games_won"] == 1
    stats = accounts.get("/account/euchre/multiplayer-results").json
    assert stats["results"][0]["difficulty"] == "multiplayer"
    assert stats["results"][0]["won"]
    assert not cmd(guest, "rematch")["ok"]
    assert cmd(host, "rematch")["ok"]
    assert table["status"] == "waiting"
    assert table["teams"][0]["name"] == "Moon Cats"
    assert table["seats"][1]["name"] == "Guest"
    assert cmd(host, "start")["ok"]
    assert table["game"]["id"] != stats["results"][0]["id"]


def test_account_identity_comes_from_cookie_and_cannot_occupy_two_seats(
    tables, accounts, existing_user
):
    connect, tasks, mp = tables
    sign_in(accounts)
    host, same_user, stranger = connect(accounts), connect(accounts), connect()
    created = cmd(host, "create", name="Spoofed")
    table = mp.get_table(created["code"])
    assert table["seats"][0]["userId"] == 42
    assert table["seats"][0]["name"] == "existing_hearts"
    assert cmd(same_user, "watch", code=created["code"])["ok"]
    assert not cmd(same_user, "join", seat=2, name="Spoofed")["ok"]
    assert not cmd(stranger, "watch", code=created["code"], token=created["token"])[
        "ok"
    ]


def test_left_bower_follow_suit_and_lone_scoring():
    assert effective("Jd", "h") == "h"
    assert legal_cards(["Jd", "9d"], [dict(seat=0, card="Ah")], "h") == ["Jd"]
    assert winner([dict(seat=0, card="Ah"), dict(seat=1, card="Jd")], "h") == 1
    g = new_game(rng=random.Random(1))
    g.update(
        phase="trick_complete",
        maker=1,
        alone=True,
        trump="h",
        tricks=[0, 5],
        completedTricks=[{}] * 5,
        scores=[0, 6],
    )
    result = apply_action(g, dict(type="advance"))
    assert result["scores"] == [0, 10]
    assert result["phase"] == "game_over"


def test_sign_out_revokes_existing_socket(tables, accounts, existing_user):
    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    assert cmd(host, "create", name="Ignored")["ok"]
    assert post(accounts, "logout").status_code == 200
    assert not cmd(host, "start")["ok"]


def test_cookie_connection_requires_csrf(accounts):
    from euchre_server import app, socketio

    rejected = socketio.test_client(
        app, namespace="/euchre", flask_test_client=accounts, auth={"csrf": "wrong"}
    )
    assert not rejected.is_connected("/euchre")


def test_last_player_leaving_finishes_as_loss(tables, accounts, existing_user):
    from euchre_server.models import EuchreGameResult

    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    created = cmd(host, "create", name="Ignored")
    assert cmd(host, "start")["ok"]
    assert cmd(host, "leave")["ok"]
    assert mp.get_table(created["code"])["status"] == "closed"
    result = EuchreGameResult.query.one()
    assert result.conceded and not result.won


@pytest.mark.parametrize("unseated", [False, True])
def test_every_waiting_member_must_expire_before_the_lobby_closes(tables, unseated):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    join(guest, code, 1)
    if unseated:
        assert cmd(guest, "unseat")["ok"]
    host.disconnect(namespace=mp.NS)
    tasks[-1]()
    assert mp.get_table(code)["status"] == "waiting"
    guest.disconnect(namespace=mp.NS)
    tasks[-1]()
    mp._tables.clear()
    assert mp.get_table(code)["status"] == "closed"


def test_last_disconnected_player_closes_a_started_table_with_bots(
    tables, accounts, existing_user
):
    from euchre_server.models import EuchreGameResult

    connect, tasks, mp = tables
    sign_in(accounts)
    host = connect(accounts)
    created = cmd(host, "create")
    assert cmd(host, "start")["ok"]
    table = mp.get_table(created["code"])
    host.disconnect(namespace=mp.NS)
    assert table["status"] == "playing"
    tasks[-1]()
    assert table["status"] == "closed"
    assert table["game"]["phase"] == "game_over"
    assert all(s["bot"] for s in table["seats"])
    assert EuchreGameResult.query.one().conceded
    assert not EuchreGameResult.query.one().won


def test_bot_runner_advances_automatically_after_human_action(tables):
    connect, tasks, mp = tables
    host = connect()
    created = cmd(host, "create", name="Host")
    code = created["code"]
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    g = table["game"]
    # A completed trick is advanced exclusively by the service.
    g.update(phase="trick_complete", turn=1, completedTricks=[dict(plays=[], winner=1)])
    mp._jobs.clear()
    assert cmd(host, "watch", code=code, token=created["token"])["ok"]
    tasks[-1]()
    assert table["game"]["phase"] == "playing"


@pytest.mark.parametrize("difficulty", ["easy", "medium"])
def test_seeded_bot_games_finish_with_legal_actions(difficulty):
    for seed in range(5):
        rng = random.Random(seed)
        game = new_game(difficulty, rng)
        for _ in range(2000):
            if game["phase"] == "game_over":
                break
            action = bot_action(game, rng)
            assert action in legal_actions(game)
            game = apply_action(game, action, rng)
        assert game["phase"] == "game_over"


def test_hard_bot_ignores_real_hidden_hands():
    g = new_game("hard", random.Random(2))
    changed = copy.deepcopy(g)
    seat = g["turn"]
    other_seats = [i for i in range(4) if i != seat]
    cards = [c for i in other_seats for c in changed["hands"][i]]
    cards.reverse()
    for i, other in enumerate(other_seats):
        changed["hands"][other] = cards[i * 5 : (i + 1) * 5]
    assert bot_action(g, random.Random(7)) == bot_action(changed, random.Random(7))


def test_both_signed_in_teammates_get_the_win(tables, accounts, existing_user):
    from euchre_server import app
    from euchre_server.extensions import db
    from euchre_server.models import EuchreGameResult
    from tests.conftest import add_profile

    connect, tasks, mp = tables
    add_profile(app, 43, "partner")
    sign_in(accounts)
    partner_http = app.test_client()
    assert sign_in(partner_http, "partner").status_code == 200
    host, partner = connect(accounts), connect(partner_http)
    code = cmd(host, "create", name="Ignored")["code"]
    join(partner, code, 2)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(code)
    table["game"].update(
        phase="game_over",
        scores=[10, 7],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert {(r.user_id, r.won, r.score) for r in EuchreGameResult.query.all()} == {
        (42, True, 10),
        (43, True, 10),
    }
    assert (
        accounts.get("/account/euchre/leaderboard?category=easy").json["all_time"] == []
    )


def test_joining_another_table_requires_leaving_the_current_group(tables):
    connect, tasks, mp = tables
    host, other = connect(), connect()
    first = cmd(host, "create", name="Host")
    second = cmd(other, "create", name="Other")
    assert not cmd(host, "join", code=second["code"], seat=1, name="Ghost")["ok"]
    assert mp.get_table(first["code"])["seats"][0]["token"] == first["token"]


@pytest.mark.parametrize("departure", ["leave", "disconnect"])
@pytest.mark.parametrize("first_action", ["move", "unseat", "reconnect"])
def test_host_succession_keeps_arrival_order_through_seat_changes_and_reload(
    tables, departure, first_action
):
    connect, tasks, mp = tables
    host, first, later = connect(), connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    # Arrival order starts in the waiting room, before choosing a seat.
    first_token = cmd(first, "watch", code=code)["token"]
    join(later, code, 1, "Later")
    assert cmd(first, "join", seat=3, name="First")["ok"]

    if first_action == "move":
        assert cmd(first, "join", seat=2)["ok"]
    elif first_action == "unseat":
        assert cmd(first, "unseat")["ok"]
    else:
        first.disconnect(namespace=mp.NS)
        first = connect()
        assert cmd(first, "watch", code=code, token=first_token)["ok"]
        tasks[-1]()

    mp._tables.clear()
    if departure == "leave":
        assert cmd(host, "leave")["ok"]
    else:
        host.disconnect(namespace=mp.NS)
        tasks[-1]()

    assert mp.get_table(code)["host"] == first_token
    assert state(first)["lobby"]["isHost"]
    assert not state(later)["lobby"]["isHost"]
    assert not cmd(later, "close")["ok"]
    if first_action == "unseat":
        assert cmd(first, "join", seat=0)["ok"]
    assert cmd(first, "start")["ok"]


def test_leaving_and_rejoining_moves_to_end_of_host_succession(tables):
    connect, tasks, mp = tables
    host, returning, next_host = connect(), connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    old_token = join(returning, code, 3, "Returning")
    next_token = join(next_host, code, 2, "Next host")
    assert cmd(returning, "leave")["ok"]
    new_token = join(returning, code, 1, "Returning")
    assert new_token != old_token

    assert cmd(host, "leave")["ok"]
    assert mp.get_table(code)["host"] == next_token
    assert cmd(next_host, "leave")["ok"]
    assert mp.get_table(code)["host"] == new_token
    assert cmd(returning, "close")["ok"]


def test_host_succession_supports_snapshots_without_lobby_arrival_order(tables):
    connect, tasks, mp = tables
    host, first, later = connect(), connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    first_token = join(first, code, 3, "First")
    join(later, code, 1, "Later")
    table = mp.get_table(code)
    for member in mp.members(table):
        member.pop("lobbyJoined", None)
    mp.save(table)
    mp._tables.clear()

    assert cmd(host, "leave")["ok"]
    assert mp.get_table(code)["host"] == first_token


def test_changing_teams_does_not_take_naming_rights_from_the_first_teammate(tables):
    connect, tasks, mp = tables
    host, first = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    join(first, code, 1, "First opponent")
    assert cmd(host, "join", seat=3)["ok"]
    assert not cmd(host, "name", name="Host steals the name")["ok"]
    assert cmd(first, "name", name="First teammate's choice")["ok"]


def test_returning_after_game_completion_does_not_rewrite_a_forfeit(tables):
    connect, tasks, mp = tables
    host, opponent = connect(), connect()
    created = cmd(host, "create", name="Host")
    join(opponent, created["code"], 1)
    assert cmd(host, "start")["ok"]
    table = mp.get_table(created["code"])
    table["participants"][0]["conceded"] = True
    table["game"].update(
        phase="game_over",
        scores=[10, 4],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert cmd(host, "watch", code=created["code"], token=created["token"])["ok"]
    assert table["participants"][0]["conceded"]
    assert state(host)["game"]["conceded"]


def test_full_lobby_can_trade_seats_without_leaving_the_group(tables):
    connect, tasks, mp = tables
    players = [connect() for _ in range(4)]
    created = cmd(players[0], "create", name="Host")
    code = created["code"]
    for i in range(1, 4):
        join(players[i], code, i, f"Player {i}")
    assert cmd(players[0], "name", name="Moon Cats")["ok"]
    assert cmd(players[0], "unseat")["ok"]
    view = state(players[0])["lobby"]
    assert view["seat"] is None and view["isMember"] and view["isHost"]
    assert view["unseated"] == [
        dict(name="Host", mine=True, host=True, connected=True, reserved=True)
    ]
    assert "token" not in json.dumps(view)
    assert not cmd(players[0], "start")["ok"]
    assert cmd(players[1], "unseat")["ok"]
    assert cmd(players[0], "join", seat=1)["ok"]
    assert not cmd(players[0], "start")["ok"]
    assert cmd(players[1], "join", seat=0)["ok"]
    table = mp.get_table(code)
    assert [s["name"] for s in table["seats"]] == [
        "Player 1",
        "Host",
        "Player 2",
        "Player 3",
    ]
    assert table["host"] == created["token"]
    assert table["unseated"] == {}
    assert table["teams"][0]["name"] == "Moon Cats"
    assert cmd(players[0], "start")["ok"]
    assert not cmd(players[0], "unseat")["ok"]


def test_unseated_member_reconnects_and_keeps_their_guest_name(tables):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    token = join(guest, code, 1, "Remember me")
    assert cmd(guest, "unseat")["ok"]
    guest.disconnect(namespace=mp.NS)
    expire = tasks[-1]
    mp._tables.clear()  # Recovery includes the saved unseated membership.
    restored = connect()
    assert cmd(restored, "watch", code=code, token=token)["ok"]
    expire()
    assert state(restored)["lobby"]["isMember"]
    assert cmd(restored, "join", seat=2)["ok"]
    assert mp.get_table(code)["seats"][2]["name"] == "Remember me"


def test_unseated_player_can_leave_and_disconnected_host_is_replaced(tables):
    connect, tasks, mp = tables
    host, guest = connect(), connect()
    created = cmd(host, "create", name="Host")
    code = created["code"]
    join(guest, code, 1)
    assert cmd(host, "unseat")["ok"]
    assert not cmd(host, "create", name="Another table")["ok"]
    host.disconnect(namespace=mp.NS)
    tasks[-1]()
    assert mp.get_table(code)["unseated"] == {}
    assert state(guest)["lobby"]["isHost"]
    assert cmd(guest, "unseat")["ok"]
    assert cmd(guest, "leave")["ok"]
    assert not state(guest)["lobby"]["isMember"]


def test_open_seat_is_reserved_for_members_during_a_full_group_swap(tables):
    connect, tasks, mp = tables
    players = [connect() for _ in range(5)]
    code = cmd(players[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(players[i], code, i)
    assert cmd(players[0], "unseat")["ok"]
    assert cmd(players[4], "watch", code=code)["ok"]
    assert not cmd(players[4], "join", seat=0, name="Outsider")["ok"]
    assert cmd(players[0], "join", seat=0)["ok"]


def test_play_again_immediately_rematches_same_group_and_preserves_results(
    tables, accounts, existing_user
):
    from euchre_server.models import EuchreGameResult

    connect, tasks, mp = tables
    sign_in(accounts)
    host, guest = connect(accounts), connect()
    code = cmd(host, "create", name="Ignored")["code"]
    join(guest, code, 1)
    assert cmd(host, "name", name="Same partners")["ok"]
    assert cmd(host, "start", difficulty="medium")["ok"]
    table = mp.get_table(code)
    old_id = table["game"]["id"]
    old_seats = copy.deepcopy(table["seats"])
    table["game"].update(
        phase="game_over",
        scores=[10, 4],
        finishedAt=datetime.now(timezone.utc).isoformat(),
    )
    mp.record_results(table)
    mp.save(table)
    assert not cmd(guest, "play_again")["ok"]
    assert cmd(host, "play_again")["ok"]
    assert table["status"] == "playing" and table["game"]["id"] != old_id
    assert table["game"]["difficulty"] == "medium"
    assert table["seats"] == old_seats
    assert table["teams"][0]["name"] == "Same partners"
    assert EuchreGameResult.query.one().game_id == old_id
    assert EuchreGameResult.query.one().won
    assert not cmd(host, "play_again")["ok"]


def test_new_arrivals_appear_in_waiting_room_and_can_name_themselves(tables):
    connect, tasks, mp = tables
    host, arrival = connect(), connect()
    code = cmd(host, "create", name="Host")["code"]
    watched = cmd(arrival, "watch", code=code)
    assert watched["ok"] and watched["token"]
    view = state(arrival)["lobby"]
    assert view["isMember"] and view["seat"] is None and view["needsName"]
    assert view["unseated"] == [
        dict(name="Guest", mine=True, host=False, connected=True, reserved=False)
    ]
    assert cmd(arrival, "rename", name="New friend")["ok"]
    assert state(host)["lobby"]["unseated"][0]["name"] == "New friend"
    assert cmd(arrival, "join", seat=2)["ok"]
    assert mp.get_table(code)["seats"][2]["name"] == "New friend"
    assert state(host)["lobby"]["unseated"] == []


def test_waiting_room_allows_extra_players_without_blocking_a_seated_game(tables):
    connect, tasks, mp = tables
    players = [connect() for _ in range(6)]
    code = cmd(players[0], "create", name="Host")["code"]
    for i in range(1, 4):
        join(players[i], code, i)
    for player in players[4:]:
        assert cmd(player, "watch", code=code)["ok"]
    assert len(state(players[0])["lobby"]["unseated"]) == 2
    assert cmd(players[0], "start")["ok"]
    assert state(players[4])["game"] is None
    assert cmd(players[4], "leave")["ok"]
    assert len(state(players[0])["lobby"]["unseated"]) == 1
    players[5].disconnect(namespace=mp.NS)
    tasks[-1]()
    assert state(players[0])["lobby"]["unseated"] == []


def test_signed_in_arrival_uses_account_name_and_waiting_room_survives_reload(
    tables, accounts, existing_user
):
    connect, tasks, mp = tables
    host = connect()
    code = cmd(host, "create", name="Host")["code"]
    sign_in(accounts)
    arrival = connect(accounts)
    watched = cmd(arrival, "watch", code=code)
    assert state(host)["lobby"]["unseated"][0]["name"] == "existing_hearts"
    arrival.disconnect(namespace=mp.NS)
    mp._tables.clear()
    restored = connect(accounts)
    assert cmd(restored, "watch", code=code, token=watched["token"])["ok"]
    view = state(restored)["lobby"]
    assert len(view["unseated"]) == 1
    assert view["memberName"] == "existing_hearts"
    assert not view["needsName"]

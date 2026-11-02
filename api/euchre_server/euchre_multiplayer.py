"""Private Euchre tables on the dedicated service; a single worker owns timers.

Only the server deals, validates moves and records multiplayer results. Public
snapshots never contain seat credentials, account IDs, kitty or opponents' cards.
"""

from euchre_server.runtime import runtime_state

import copy
import hashlib
import json
import secrets
import time
from greenlet import getcurrent
from datetime import datetime, timezone

from euchre_server.game_accounts import euchre_lock, is_deleted
from flask import request
from euchre_server.account_access import (
    accounts,
    current_session,
    session_user,
    valid_origin,
)
from euchre_server.account_contracts import AccountsUnavailable
from euchre_server.extensions import db
from euchre_server.models import EuchreTable, EuchreGameResult
from euchre_server.euchre_engine import new_game, apply_action, bot_action
from euchre_server.achievements import multiplayer_evidence

NS = "/euchre"
TTL_SECONDS = 20 * 60
LOBBY_RECONNECT_SECONDS = 120
_tables = runtime_state("euchre.tables")
_clients = runtime_state("euchre.clients")
_jobs = runtime_state("euchre.jobs")
_disconnections = runtime_state("euchre.disconnections")
# Legacy handles are cancelled on table access; no new expiry jobs are created.
_idle = runtime_state("euchre.idle")
_empty_lobbies = runtime_state("euchre.empty_lobbies")
_lobby_departures = runtime_state("euchre.lobby_departures")
_lock = runtime_state("euchre.lock", euchre_lock)


def cancel_idle(token):
    timer = _idle.pop(token, None)
    for job in (timer or {}).get("jobs", []):
        green = getattr(job, "g", None)
        if green is not None and green is not getcurrent():
            green.kill()


def save(table):
    table["touched"] = time.time()
    if table["status"] == "closed":
        table.setdefault("_closed_at", table["touched"])
    row = db.session.get(EuchreTable, table["code"])
    if row is None:
        row = EuchreTable(code=table["code"])
        db.session.add(row)
    row.snapshot = json.dumps(table)
    row.updated_at = datetime.utcnow()
    db.session.commit()


def get_table(code):
    if not isinstance(code, str):
        raise ValueError("Enter a lobby code.")
    code = code.strip().upper()
    table = _tables.get(code)
    if not table:
        row = db.session.get(EuchreTable, code)
        if row:
            table = json.loads(row.snapshot)
            _tables[code] = table
    if not table or table.get("_storage_pruned") or (
        table["status"] == "closed" and time.time() - table["touched"] > TTL_SECONDS
    ):
        raise ValueError("Lobby not found or expired.")
    table.setdefault("unseated", {})
    table.setdefault(
        "defaultDifficulty",
        (
            table.get("difficulty")
            if table.get("difficulty") in ("hard", "harder", "hardest")
            else "hard"
        ),
    )
    return table


def text(value, label, maximum):
    if not isinstance(value, str):
        raise ValueError(f"Enter {label}.")
    value = " ".join(value.split())
    if not 1 <= len(value) <= maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f"Use 1–{maximum} characters for {label}.")
    return value


def connected(token):
    return any(c.get("token") == token for c in _clients.values())


def seat_for(table, token):
    return next(
        (
            i
            for i, s in enumerate(table["seats"])
            if s and token and s.get("token") == token
        ),
        None,
    )


def member_for(table, token):
    index = seat_for(table, token)
    return (
        table["seats"][index]
        if index is not None
        else table.get("unseated", {}).get(token)
    )


def members(table):
    return [s for s in table["seats"] if s and s.get("token")] + list(
        table.get("unseated", {}).values()
    )


def reserved_members(table):
    return [s for s in table["seats"] if s and s.get("token")] + [
        s for s in table.get("unseated", {}).values() if s.get("reserved", True)
    ]


def captains(table):
    # Earliest human on each partnership has naming rights. Transfer on departure.
    for side in range(2):
        humans = [
            s
            for i, s in enumerate(table["seats"])
            if i % 2 == side and s and s.get("token") and not s.get("bot")
        ]
        table["teams"][side]["captain"] = (
            min(humans, key=lambda s: s["joined"])["token"] if humans else None
        )


def migrate_host(table):
    humans = [s for s in members(table) if not s.get("bot")]
    seated = [s for s in table["seats"] if s and s.get("token") and not s.get("bot")]
    if table["status"] == "playing" and seated:
        humans = seated
    if not any(s["token"] == table["host"] for s in humans):
        table["host"] = (
            min(humans, key=lambda s: s.get("lobbyJoined", s["joined"]))["token"]
            if humans
            else None
        )


def action_token(table, token):
    """Presence and lobby updates do not change a player's game decision."""
    index = seat_for(table, token)
    g = table["game"]
    if index is None or not g:
        return None
    context = [
        table["code"],
        token,
        table["status"],
        bool(table["seats"][index].get("bot")),
        g["id"],
        g["handNumber"],
        g["phase"],
        g["turn"],
        g["passes"],
        len(g["completedTricks"]),
        g["trick"],
        g["hands"][index],
        g["trump"],
        g["maker"],
        g["alone"],
    ]
    return hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()


def action_is_current(table, token, data):
    revision = data.get("revision")
    if type(revision) is not int or not 0 <= revision <= table["revision"]:
        return False
    if "actionToken" in data:
        return isinstance(data["actionToken"], str) and data[
            "actionToken"
        ] == action_token(table, token)
    return revision == table["revision"]


def public(table, token):
    mine = seat_for(table, token)
    seats = []
    for i, s in enumerate(table["seats"]):
        seats.append(
            dict(
                index=i,
                status="empty" if s is None else "ai" if s.get("bot") else "human",
                name=s["name"] if s else "Waiting…",
                icon=s.get("icon", "user") if s else "user",
                mine=mine == i,
                host=bool(s and s.get("token") and s["token"] == table["host"]),
                connected=bool(s and s.get("token") and connected(s["token"])),
            )
        )
    return dict(
        code=table["code"],
        status=table["status"],
        seats=seats,
        seat=mine,
        isMember=member_for(table, token) is not None,
        memberName=(member_for(table, token) or {}).get("name", ""),
        needsName=not (member_for(table, token) or {}).get("named", True),
        unseated=[
            dict(
                name=s["name"],
                mine=s["token"] == token,
                host=s["token"] == table["host"],
                connected=connected(s["token"]),
                reserved=s.get("reserved", True),
            )
            for s in table.get("unseated", {}).values()
        ],
        isHost=bool(token and table["host"] == token),
        revision=table["revision"],
        actionToken=action_token(table, token),
        teams=[
            dict(
                name=t["name"],
                canName=bool(token and t["captain"] == token),
                named=t["named"],
            )
            for t in table["teams"]
        ],
        gameId=table["game"]["id"] if table["game"] else None,
        difficulty=table["difficulty"],
        defaultDifficulty=table["defaultDifficulty"],
        idleWarning=False,
        closedReason=table.get("closedReason"),
        removedReason=next(
            (
                p.get("removedReason")
                for p in table["participants"]
                if p["token"] == token
            ),
            None,
        ),
    )


def game_view(table, token):
    seat = seat_for(table, token)
    if not table["game"]:
        return None
    spectating = seat is None
    seat = 0 if spectating else seat
    g = copy.deepcopy(table["game"])
    rotate = lambda s: (s - seat) % 4 if s is not None else None
    side = seat % 2
    # Null placeholders reveal counts, never identities. Own hand is always index 0.
    g["hands"] = [
        (
            list(g["hands"][(i + seat) % 4])
            if i == 0 and not spectating
            else [None] * len(g["hands"][(i + seat) % 4])
        )
        for i in range(4)
    ]
    g["kitty"] = []
    for key in ("turn", "dealer", "maker", "sittingOut"):
        g[key] = rotate(g[key])
    for p in g["trick"]:
        p["seat"] = rotate(p["seat"])
    for trick in g["completedTricks"]:
        trick["winner"] = rotate(trick["winner"])
        for p in trick["plays"]:
            p["seat"] = rotate(p["seat"])
    for r in g["results"]:
        r["maker"] = rotate(r["maker"])
        for trick in r.get("completedTricks", []):
            trick["winner"] = rotate(trick["winner"])
            for play in trick["plays"]:
                play["seat"] = rotate(play["seat"])
        for key in ("tricks", "points", "scores"):
            r[key] = [r[key][side], r[key][1 - side]]
    for key in ("scores", "tricks"):
        g[key] = [g[key][side], g[key][1 - side]]
    seats = [
        table["seats"][(i + seat) % 4] or dict(name="Departed player", bot=True)
        for i in range(4)
    ]
    g["seatNames"] = [s["name"] for s in seats]
    g["seatIcons"] = [s.get("icon", "user") for s in seats]
    g["humanSeats"] = [not s.get("bot") for s in seats]
    if g["phase"] == "round_complete":
        ready = g.get("nextHandReady", [False] * 4)
        g["nextHandReady"] = [
            ready[(i + seat) % 4] or bool(seats[i].get("bot")) for i in range(4)
        ]
    g["teamNames"] = [table["teams"][i]["name"] for i in (side, 1 - side)]
    g["playerName"] = seats[0]["name"]
    g["spectating"] = spectating
    participant = next((p for p in table["participants"] if p["token"] == token), None)
    if g["phase"] == "game_over" and participant and participant["conceded"]:
        g["conceded"] = True
        g["message"] = (
            "Your seat was replaced by a bot. Only finished games count toward your statistics."
        )
    if g["message"].startswith("Seat "):
        for i, s in enumerate(table["seats"]):
            g["message"] = g["message"].replace(f"Seat {i + 1} ", s["name"] + " ")
    return g


def record_results(table):
    g = table["game"]
    if g.get("cancelled"):
        return
    if g["phase"] != "game_over":
        return
    for p in table["participants"]:
        user_id = p.get("userId")
        if not user_id:
            continue
        if is_deleted(user_id):
            continue
        if EuchreGameResult.query.filter_by(user_id=user_id, game_id=g["id"]).first():
            continue
        side = p["seat"] % 2
        db.session.add(
            EuchreGameResult(
                user_id=user_id,
                game_id=g["id"],
                difficulty="multiplayer",
                won=not p["conceded"] and g["scores"][side] >= 10,
                conceded=p["conceded"],
                score=g["scores"][side],
                opponent_score=g["scores"][1 - side],
                marches=sum(
                    r["maker"] % 2 == side and not r["alone"] and r["tricks"][side] == 5
                    for r in g["results"]
                ),
                loners=sum(
                    r["maker"] == p["seat"] and r["alone"] and r["tricks"][side] == 5
                    for r in g["results"]
                ),
                euchres=sum(
                    r["maker"] % 2 != side and r["tricks"][1 - side] < 3
                    for r in g["results"]
                ),
                completed_at=datetime.fromisoformat(g["finishedAt"]).replace(
                    tzinfo=None
                ),
                achievement_data=multiplayer_evidence(table, p),
            )
        )
    if table["status"] != "closed":
        table["status"] = "finished"


def start_match(table, difficulty):
    from .game_limits import check_creation, ensure_capacity, open_games
    for member in table["seats"]:
        if member and member.get("token") and not member.get("bot"):
            key = f"account:{member['userId']}" if member.get("userId") else member.get("guestKey")
            if key:
                ensure_capacity(open_games(key), player=member["name"])
    if table.get("_has_started"):
        host = member_for(table, table["host"])
        check_creation(f"account:{host['userId']}" if host.get("userId") else host.get("guestKey", table["host"]))
    if any(s.get("reserved", True) for s in table.get("unseated", {}).values()):
        raise ValueError("Everyone in the group must choose a seat before starting.")
    if seat_for(table, table["host"]) is None:
        raise ValueError("Choose a seat before starting the game.")
    if difficulty not in ("easy", "medium", "hard", "harder", "hardest"):
        raise ValueError("Choose a bot difficulty.")
    table["difficulty"] = difficulty
    bot_number = 1
    for i, s in enumerate(table["seats"]):
        if s is None or not s.get("token"):
            table["seats"][i] = dict(name=f"Bot {bot_number}", icon="robot", bot=True)
            bot_number += 1
    table["participants"] = [
        dict(
            token=s["token"],
            userId=s.get("userId"),
            seat=i,
            conceded=False,
            utcOffsetMinutes=s.get("utcOffsetMinutes"),
        )
        for i, s in enumerate(table["seats"])
        if s.get("token")
    ]
    table.update(game=new_game(difficulty), status="playing", _has_started=True)


def register_euchre_socket(socketio, app):

    def schedule_lobby_disconnect(code, token=None):
        if not code or any(c.get("code") == code and c.get("token") == token for c in _clients.values()):
            return
        try:
            table = get_table(code)
        except ValueError:
            return
        if table["status"] == "closed" or (table.get("game") and table["game"]["phase"] != "game_over"):
            return
        marker = object()
        membership = (code, token)
        _lobby_departures[membership] = marker
        if not any(c.get("code") == code for c in _clients.values()):
            _empty_lobbies[code] = marker

        def close_empty():
            socketio.sleep(LOBBY_RECONNECT_SECONDS)
            with app.app_context(), _lock:
                if _lobby_departures.get(membership) is not marker:
                    return
                _lobby_departures.pop(membership, None)
                last_departure = _empty_lobbies.get(code) is marker
                if last_departure:
                    _empty_lobbies.pop(code, None)
                try:
                    current = get_table(code)
                except ValueError:
                    return
                if current["status"] == "closed" or (current.get("game") and current["game"]["phase"] != "game_over"):
                    return
                if any(c.get("code") == code and c.get("token") == token for c in _clients.values()):
                    return
                if last_departure and not any(c.get("code") == code for c in _clients.values()):
                    current["status"] = "closed"
                    changed(current)
                    return
                index = seat_for(current, token)
                if index is not None:
                    current["seats"][index] = None
                else:
                    current["unseated"].pop(token, None)
                captains(current)
                migrate_host(current)
                if not any(m.get("token") and not m.get("bot") for m in members(current)):
                    current["status"] = "closed"
                changed(current)
        socketio.start_background_task(close_empty)

    def broadcast(table):
        for sid, client in list(_clients.items()):
            if client.get("code") == table["code"]:
                socketio.emit(
                    "state",
                    dict(
                        lobby=public(table, client.get("token")),
                        game=game_view(table, client.get("token")),
                    ),
                    to=sid,
                    namespace=NS,
                )

    def changed(table):
        humans = [
            s for s in table["seats"] if s and s.get("token") and not s.get("bot")
        ]
        if (
            table["status"] == "playing"
            and table["game"]["phase"] != "game_over"
            and len(humans) <= 1
            and any(p.get("conceded") for p in table["participants"])
        ):
            table["game"].update(
                phase="game_over",
                conceded=True,
                cancelled=True,
                finishedAt=datetime.now(timezone.utc).isoformat(),
                message="The game closed because everyone else conceded.",
            )
            table.update(status="closed", closedReason="one_player" if humans else "empty")
        g = table["game"]
        if g and g["phase"] == "round_complete":
            ready = g.setdefault("nextHandReady", [False] * 4)
            humans = [
                i
                for i, s in enumerate(table["seats"])
                if s and s.get("token") and not s.get("bot")
            ]
            if humans and all(ready[i] for i in humans):
                table["game"] = apply_action(g, dict(type="advance"))
                table["game"].pop("nextHandReady", None)
        elif g:
            g.pop("nextHandReady", None)
        table["revision"] += 1
        record_results(table) if table["game"] else None
        # Preserve the final result before closing the last human's lobby.
        if not any(not s.get("bot") for s in members(table)):
            table["status"] = "closed"
        save(table)
        clear_legacy_idle_timers(table)
        broadcast(table)
        schedule(table)

    def clear_legacy_idle_timers(table):
        # Restored or re-registered tables must not retain old kick jobs.
        for token, timer in list(_idle.items()):
            if timer["code"] == table["code"]:
                cancel_idle(token)

    def schedule(table):
        code = table["code"]
        if code in _jobs or table["status"] != "playing":
            return
        g = table["game"]
        automatic = g["phase"] == "trick_complete" or table["seats"][g["turn"]].get(
            "bot"
        )
        if not automatic or g["phase"] in ("game_over", "round_complete"):
            return
        revision = table["revision"]

        def run():
            socketio.sleep(
                1.8
                if g["phase"] == "trick_complete"
                # 0.75s shuffle + 3.6s deal, then the usual bidding pause.
                else 5.45 if g["phase"] == "bidding1" and g["passes"] == 0 else 1.1
            )
            with app.app_context(), _lock:
                try:
                    current = get_table(code)
                except ValueError:
                    _jobs.pop(code, None)
                    return
                if current["revision"] != revision or current["status"] != "playing":
                    _jobs.pop(code, None)
                    schedule(current)
                    return
                observation = copy.deepcopy(current["game"])
            # Simulations yield between sampled deals, outside the table lock.
            # Another table or reconnect can proceed while this bot thinks.
            action = bot_action(observation, cooperate=lambda: socketio.sleep(0))
            with app.app_context(), _lock:
                _jobs.pop(code, None)
                if current["revision"] == revision and current["status"] == "playing":
                    current["game"] = apply_action(current["game"], action)
                    changed(current)
                else:
                    schedule(current)

        _jobs[code] = socketio.start_background_task(run)

    def recover_disconnections(table):
        # Started seats remain owned indefinitely, including after a restart.
        clear_legacy_idle_timers(table)

    @socketio.on("connect", namespace=NS)
    def connect(auth=None):
        auth = auth if isinstance(auth, dict) else {}
        if app.config.get("CARDS_ACCOUNT_ENABLED"):
            # Same-origin polling GETs omit Origin. Cookie sessions still require
            # the CSRF secret; any supplied Origin must match the Cards origins.
            if request.headers.get("Origin") and not valid_origin():
                return False
            session = current_session()
            if session and (
                not isinstance(auth.get("csrf"), str)
                or not secrets.compare_digest(session.csrf_token, auth["csrf"])
            ):
                return False
        user = session_user()
        from .game_limits import principal
        _clients[request.sid] = dict(
            principal=principal(user.id if user else None),
            userId=user.id if user else None,
            name=user.username if user else None,
            icon=user.profile_icon if user else "user",
            events=[],
        )

    @socketio.on("disconnect", namespace=NS)
    def disconnect(reason=None):
        client = _clients.pop(request.sid, None)
        if client and client.get("token"):
            with _lock:
                try:
                    table = get_table(client["code"])
                    schedule_lobby_disconnect(table["code"], client.get("token"))
                    clear_legacy_idle_timers(table)
                    broadcast(table)
                except ValueError:
                    pass

    @socketio.on("command", namespace=NS)
    def command(data):
        with _lock:
            try:
                client = _clients.get(request.sid)
                if client is None or not isinstance(data, dict):
                    raise ValueError("Please reconnect to the lobby.")
                if client["userId"]:
                    # Socket events share their handshake request. Discard its
                    # cached session so sign-out/password reset revokes access.
                    accounts().refresh()
                    user = session_user()
                    if not user or user.id != client["userId"]:
                        raise ValueError(
                            "Your account changed. Sign in again to rejoin this table."
                        )
                now = time.time()
                client["events"] = [t for t in client["events"] if now - t < 10]
                if len(client["events"]) >= 50:
                    raise ValueError("Please slow down and try again.")
                client["events"].append(now)
                kind = data.get("type")
                if kind == "unwatch":
                    code = data.get("code", client.get("code"))
                    if client.get("code") == code:
                        token = client.get("token")
                        client.update(code=None, token=None)
                        schedule_lobby_disconnect(code, token)
                    return dict(ok=True)
                offset = data.get("utcOffsetMinutes")
                if offset is not None and (
                    type(offset) is not int or abs(offset) > 840
                ):
                    raise ValueError("Invalid local time offset.")
                if kind == "create":
                    from .game_limits import check_creation, open_games
                    check_creation(client["principal"], open_games(client["principal"]))
                    previous_code = client.get("code")
                    previous_token = client.get("token")
                    client.update(code=None, token=None)
                    schedule_lobby_disconnect(previous_code, previous_token)
                    name = client["name"] or text(
                        data.get("name", "Host"), "your name", 20
                    )
                    default_difficulty = (
                        data.get("difficulty", "hard") if client["userId"] else "hard"
                    )
                    if default_difficulty not in ("hard", "harder", "hardest"):
                        raise ValueError("Choose a Hard strength from Options.")
                    from .storage_cleanup import open_table_count
                    if open_table_count() >= 1000:
                        raise ValueError("All tables are busy. Please try again soon.")
                    code = "".join(
                        secrets.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
                        for _ in range(6)
                    )
                    while db.session.get(EuchreTable, code):
                        code = "".join(
                            secrets.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
                            for _ in range(6)
                        )
                    token = secrets.token_urlsafe(32)
                    table = dict(
                        code=code,
                        host=token,
                        status="waiting",
                        game=None,
                        participants=[],
                        unseated={},
                        seats=[
                            dict(
                                name=name,
                                icon=client["icon"],
                                token=token,
                                userId=client["userId"],
                                guestKey=client["principal"] if not client["userId"] else None,
                                utcOffsetMinutes=offset,
                                joined=0,
                                lobbyJoined=0,
                                bot=False,
                            ),
                            None,
                            None,
                            None,
                        ],
                        teams=[
                            dict(
                                name=f"Team {i+1}",
                                named=False,
                                captain=token if i == 0 else None,
                            )
                            for i in range(2)
                        ],
                        revision=0,
                        touched=now,
                        difficulty=default_difficulty,
                        defaultDifficulty=default_difficulty,
                    )
                    _tables[code] = table
                    client.update(code=code, token=token)
                    changed(table)
                    return dict(ok=True, code=code, token=token)

                table = get_table(data.get("code", client.get("code")))
                if kind != "watch" and client.get("code") != table["code"]:
                    raise ValueError("Open this lobby before choosing a seat.")
                token = (
                    client.get("token") if client.get("code") == table["code"] else None
                )
                if kind == "watch":
                    candidate = data.get("token")
                    if not candidate and client["userId"]:
                        own = next((m for m in members(table) if m.get("userId") == client["userId"] and not m.get("bot")), None)
                        candidate = own["token"] if own else None
                    s = member_for(table, candidate)
                    if s is not None:
                        if s.get("userId") and s["userId"] != client["userId"]:
                            raise ValueError(
                                "Sign in to the account that joined this table."
                            )
                        token = candidate
                        _disconnections.pop(token, None)
                        removed = any(
                            p["token"] == token and p.get("removedReason")
                            for p in table["participants"]
                        )
                        if not removed:
                            s["bot"] = False
                        for p in table["participants"]:
                            if (
                                table["status"] == "playing"
                                and p["token"] == token
                                and not p.get("left")
                                and not p.get("removedReason")
                            ):
                                p["conceded"] = False
                    if (
                        s is None
                        and not member_for(table, token)
                        and table["status"] == "waiting"
                    ):
                        if len(table["unseated"]) >= 32:
                            raise ValueError("The lobby waiting room is full.")
                        token = secrets.token_urlsafe(32)
                        s = dict(
                            name=client["name"] or "Guest",
                            icon=client["icon"],
                            token=token,
                            userId=client["userId"],
                            bot=False,
                            joined=max((m["joined"] for m in members(table)), default=0)
                            + 1,
                            lobbyJoined=max(
                                (
                                    m.get("lobbyJoined", m["joined"])
                                    for m in members(table)
                                ),
                                default=0,
                            )
                            + 1,
                            reserved=False,
                            named=bool(client["name"]),
                        )
                        table["unseated"][token] = s
                    previous_code = client.get("code")
                    previous_token = client.get("token")
                    client.update(code=table["code"], token=token)
                    _empty_lobbies.pop(table["code"], None)
                    _lobby_departures.pop((table["code"], token), None)
                    if previous_code != table["code"]:
                        schedule_lobby_disconnect(previous_code, previous_token)
                    captains(table)
                    migrate_host(table)
                    if s is not None:
                        s["utcOffsetMinutes"] = offset
                        changed(table)
                    else:
                        socketio.emit(
                            "state",
                            dict(
                                lobby=public(table, token), game=game_view(table, token)
                            ),
                            to=request.sid,
                            namespace=NS,
                        )
                    recover_disconnections(table)
                    return dict(ok=True, code=table["code"], token=token)
                index = seat_for(table, token)
                member = member_for(table, token)
                if kind == "join":
                    if table["status"] != "waiting":
                        raise ValueError("This game has already started.")
                    target = data.get("seat")
                    if type(target) is not int or target not in range(4):
                        raise ValueError("Choose an open seat.")
                    if table["seats"][target] and table["seats"][target].get("token"):
                        raise ValueError("That seat has already been taken.")
                    if (
                        index is None
                        and not (member or {}).get("reserved", False)
                        and len(reserved_members(table)) >= 4
                    ):
                        raise ValueError(
                            "This group is full. A player is choosing a seat."
                        )
                    if client["userId"] and any(
                        s.get("userId") == client["userId"] and s["token"] != token
                        for s in members(table)
                    ):
                        raise ValueError("You already have a seat at this table.")
                    old = member
                    if index is None:
                        from .game_limits import ensure_capacity, open_games
                        ensure_capacity(open_games(client["principal"]))
                    name = client["name"] or (
                        text(data.get("name"), "your name", 20)
                        if data.get("name")
                        else (
                            old["name"]
                            if old and old.get("named", True)
                            else text("", "your name", 20)
                        )
                    )
                    if index is not None:
                        table["seats"][index] = None
                    token = token or secrets.token_urlsafe(32)
                    table["seats"][target] = dict(
                        name=name,
                        icon=client["icon"],
                        token=token,
                        userId=client["userId"],
                        guestKey=client["principal"] if not client["userId"] else None,
                        joined=(
                            old["joined"]
                            if old and index is not None and index % 2 == target % 2
                            else max(
                                (s.get("joined", 0) for s in members(table)),
                                default=0,
                            )
                            + 1
                        ),
                        # Team naming order may change when switching partnerships;
                        # host succession keeps the original lobby arrival order.
                        lobbyJoined=(
                            old.get("lobbyJoined", old["joined"])
                            if old
                            else max(
                                (
                                    s.get("lobbyJoined", s["joined"])
                                    for s in members(table)
                                ),
                                default=0,
                            )
                            + 1
                        ),
                        bot=False,
                    )
                    table["unseated"].pop(token, None)
                    client.update(code=table["code"], token=token)
                    captains(table)
                    migrate_host(table)
                    changed(table)
                    return dict(ok=True, code=table["code"], token=token)
                if member is None:
                    raise ValueError("Choose a seat in this lobby first.")
                is_host = table["host"] == token
                if (
                    kind in ("rematch", "play_again")
                    and "actionToken" in data
                    and not action_is_current(table, token, data)
                ):
                    raise ValueError("The table changed. Please try again.")
                if kind == "unseat":
                    if table["status"] != "waiting" or index is None:
                        raise ValueError(
                            "You can leave your seat while waiting in the lobby."
                        )
                    table["unseated"][token] = table["seats"][index]
                    table["unseated"][token]["reserved"] = True
                    table["seats"][index] = None
                    captains(table)
                    migrate_host(table)
                elif kind == "rename":
                    if index is not None or client["name"]:
                        raise ValueError("Your name is already set at this table.")
                    member.update(
                        name=text(data.get("name"), "your name", 20), named=True
                    )
                elif kind == "name":
                    if index is None:
                        raise ValueError("Choose a team before naming it.")
                    side = index % 2
                    if (
                        table["status"] != "waiting"
                        or table["teams"][side]["captain"] != token
                    ):
                        raise ValueError(
                            "Only the first person on this team can name it in the lobby."
                        )
                    table["teams"][side].update(
                        name=text(data.get("name"), "a team name", 24), named=True
                    )
                elif kind == "start":
                    if not is_host or table["status"] != "waiting":
                        raise ValueError("Only the host can start the game.")
                    start_match(
                        table, data.get("difficulty", table["defaultDifficulty"])
                    )
                elif kind == "action":
                    g = table["game"]
                    if table["status"] != "playing":
                        raise ValueError("The table changed. Please try again.")
                    action = data.get("action")
                    if g["phase"] == "round_complete":
                        if (
                            index is None
                            or table["seats"][index].get("bot")
                            or action != dict(type="advance")
                            or data.get("gameId") != g["id"]
                            or data.get("handNumber") != g["handNumber"]
                        ):
                            raise ValueError("This hand has changed. Please try again.")
                        # Ready clicks can arrive together using the same revision.
                        # Bind them to the hand, and make retries idempotent.
                        ready = g.setdefault("nextHandReady", [False] * 4)
                        if ready[index]:
                            return dict(ok=True)
                        ready[index] = True
                        changed(table)
                        return dict(ok=True)
                    elif not action_is_current(table, token, data):
                        raise ValueError("The table changed. Please try again.")
                    elif (
                        g["turn"] != index
                        or g["phase"] == "trick_complete"
                        or table["seats"][index].get("bot")
                    ):
                        raise ValueError("Wait for your turn.")
                    table["game"] = apply_action(g, action)
                elif kind == "rematch":
                    if not is_host or table["status"] != "finished":
                        raise ValueError(
                            "Waiting for the host to return the group to the lobby."
                        )
                    # Keep the same seats, invitations and team names across games.
                    table.update(status="waiting", game=None, participants=[])
                    for i, s in enumerate(table["seats"]):
                        if s and s.get("token") and not connected(s["token"]):
                            table["seats"][i] = None
                    captains(table)
                    migrate_host(table)
                elif kind == "play_again":
                    if not is_host or table["status"] != "finished":
                        raise ValueError(
                            "Only the host can start the next game after this one finishes."
                        )
                    start_match(table, table["difficulty"])
                elif kind == "leave":
                    if table["status"] == "playing" and index is not None:
                        s = table["seats"][index]
                        s.pop("token", None)
                        s.pop("userId", None)
                        s["bot"] = True
                        for p in table["participants"]:
                            if p["token"] == token:
                                p.update(conceded=True, left=True)
                    elif index is not None:
                        table["seats"][index] = None
                    else:
                        table["unseated"].pop(token, None)
                    for c in _clients.values():
                        if c.get("token") == token:
                            c["token"] = None
                    captains(table)
                    migrate_host(table)
                elif kind == "close":
                    if not is_host or table["status"] == "playing":
                        raise ValueError("Only the host can close a waiting lobby.")
                    table["status"] = "closed"
                    for c in _clients.values():
                        if c.get("code") == table["code"]:
                            c["token"] = None
                else:
                    raise ValueError("Unknown lobby action.")
                changed(table)
                return dict(ok=True)
            except ValueError as error:
                return dict(ok=False, error=str(error))
            except AccountsUnavailable:
                raise
            except Exception:
                db.session.rollback()
                app.logger.exception("Euchre multiplayer command failed")
                return dict(
                    ok=False,
                    error="The table could not save that change. Please reconnect and try again.",
                )

    # A waiting room has no lifetime beyond its connected viewers or worker.
    with app.app_context():
        from euchre_server.schema import schema_ready
        if schema_ready():
            for row in EuchreTable.query.all():
                snapshot = json.loads(row.snapshot)
                if snapshot.get("status") != "closed" and (not snapshot.get("game") or snapshot["game"]["phase"] == "game_over"):
                    snapshot["status"] = "closed"
                    snapshot.setdefault("_closed_at", time.time())
                    row.updated_at = datetime.utcnow()
                    row.snapshot = json.dumps(snapshot)
            db.session.commit()

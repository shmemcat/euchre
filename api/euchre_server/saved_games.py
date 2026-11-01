"""Persist the existing browser engine's bot snapshots with optimistic revisions."""
import json
import re
from datetime import datetime

from flask import jsonify, request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from .account_access import session_user
from .account_http import body
from .extensions import db
from .models import EuchreSavedGame
from .storage_cleanup import digest, is_pruned, visible_game

CARDS = {rank + suit for rank in ("9", "10", "J", "Q", "K", "A") for suit in "cdsh"}
PHASES = {"bidding1", "bidding2", "discard", "playing", "trick_complete", "round_complete", "game_over"}


def valid_game(game):
    def integer(value, low=0, high=100000):
        return type(value) is int and low <= value <= high

    def seat(value):
        return integer(value, 0, 3)

    def cards(value, maximum=24):
        return isinstance(value, list) and len(value) <= maximum and all(isinstance(c, str) and c in CARDS for c in value)

    def pair(value):
        return isinstance(value, list) and len(value) == 2 and all(integer(n) for n in value)

    def play(value):
        return isinstance(value, dict) and seat(value.get("seat")) and isinstance(value.get("card"), str) and value["card"] in CARDS

    def trick(value, alone):
        return (isinstance(value, dict) and seat(value.get("winner")) and isinstance(value.get("plays"), list)
                and len(value["plays"]) == (3 if alone else 4) and all(play(p) for p in value["plays"]))

    try:
        if (not isinstance(game, dict) or game["version"] != 1
                or not isinstance(game["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", game["id"])
                or game["difficulty"] not in {"easy", "medium", "hard", "harder", "hardest"}
                or game["phase"] not in PHASES or not seat(game["dealer"]) or not seat(game["turn"])
                or not isinstance(game["playerName"], str) or len(game["playerName"]) > 200
                or not integer(game["handNumber"], 1) or not integer(game["passes"], 0, 3)
                or game.get("consecutivePassOuts", 0) not in (0, 1)
                or not isinstance(game["hands"], list) or len(game["hands"]) != 4
                or not all(cards(hand, 6) for hand in game["hands"]) or not cards(game["kitty"])
                or not isinstance(game["upCard"], str) or game["upCard"] not in CARDS
                or not isinstance(game["trick"], list) or len(game["trick"]) > 4 or not all(play(p) for p in game["trick"])
                or not isinstance(game["completedTricks"], list) or len(game["completedTricks"]) > 5
                or not all(trick(t, game["alone"]) for t in game["completedTricks"])
                or not pair(game["scores"]) or not pair(game["tricks"])
                or sum(game["tricks"]) != len(game["completedTricks"])
                or game["trump"] not in (None, "c", "d", "s", "h")
                or not (game["maker"] is None or seat(game["maker"]))
                or not (game["sittingOut"] is None or seat(game["sittingOut"]))
                or type(game["alone"]) is not bool or type(game["conceded"]) is not bool
                or not isinstance(game["message"], str) or len(game["message"]) > 2000
                or game["target"] != 10 or not isinstance(game["results"], list)
                or not (game["finishedAt"] is None or isinstance(game["finishedAt"], str))):
            return False
        for result in game["results"]:
            if (not seat(result["maker"]) or result["trump"] not in "cdsh"
                    or type(result["alone"]) is not bool or not integer(result["hand"], 1)
                    or not all(pair(result[key]) for key in ("tricks", "points", "scores"))):
                return False
            if "completedTricks" in result and (len(result["completedTricks"]) != 5
                    or not all(trick(t, result["alone"]) for t in result["completedTricks"])):
                return False
        played = [p["card"] for t in game["completedTricks"] for p in t["plays"]]
        current = [] if game["completedTricks"] and game["completedTricks"][-1]["plays"] == game["trick"] else [p["card"] for p in game["trick"]]
        deck = [c for hand in game["hands"] for c in hand] + game["kitty"] + played + current
        json.dumps(game, allow_nan=False)
        return len(deck) == 24 and set(deck) == CARDS
    except (KeyError, TypeError, ValueError):
        return False


def register_saved_games(blueprint):
    @blueprint.get("/saved-game")
    def saved_game():
        user = session_user()
        if not user:
            return jsonify(error="Sign in to resume your saved game."), 401
        expected = request.headers.get("X-Euchre-User")
        if expected is not None and expected != str(user.id):
            return jsonify(error="Your account changed. Sign in again to resume your game."), 401
        query = EuchreSavedGame.query.filter(EuchreSavedGame.user_id == user.id)
        game_id = request.args.get("game_id")
        if game_id:
            query = query.filter(EuchreSavedGame.game_id == game_id)
        else:
            query = query.filter(EuchreSavedGame.game["phase"].as_string() != "game_over")
        row = query.order_by(EuchreSavedGame.updated_at.desc(), EuchreSavedGame.game_id).first()
        return jsonify(game=visible_game(row.game) if row else None, revision=row.revision if row else 0)

    @blueprint.get("/saved-games")
    def saved_game_list():
        from .models import EuchreTable
        from .euchre_multiplayer import members, public, game_view, seat_for

        user = session_user()
        if not user:
            return jsonify(error="Sign in to see saved games."), 401
        expected = request.headers.get("X-Euchre-User")
        if expected is not None and expected != str(user.id):
            return jsonify(error="Your account changed. Please refresh."), 401
        games = []
        for row in EuchreSavedGame.query.filter(EuchreSavedGame.user_id == user.id,
                EuchreSavedGame.game["phase"].as_string() != "game_over").order_by(EuchreSavedGame.updated_at.desc()).all():
            game = row.game
            games.append(dict(id=game["id"], mode="bot", difficulty=game["difficulty"], hand=game["handNumber"], scores=game["scores"]))
        for row in EuchreTable.query.order_by(EuchreTable.updated_at.desc()).all():
            table = json.loads(row.snapshot)
            if table.get("status") != "playing" or not table.get("game") or table["game"]["phase"] == "game_over":
                continue
            member = next((m for m in members(table) if m.get("userId") == user.id and not m.get("bot")), None)
            if member is None:
                continue
            token = member["token"]
            if seat_for(table, token) is None:
                continue
            games.append(dict(id=table["code"], mode="multiplayer", code=table["code"], token=token,
                              lobby=public(table, token), game=game_view(table, token)))
        return jsonify(games=games)

    @blueprint.put("/saved-game")
    def save_game():
        user = session_user()
        if not user:
            return jsonify(error="Sign in to save your game."), 401
        if request.headers.get("X-Euchre-User") != str(user.id):
            return jsonify(error="Your account changed. Sign in again to save your game."), 401
        value = body(limit=131072)
        game, revision = value.get("game"), value.get("revision")
        if type(revision) is not int or revision < 0 or not valid_game(game):
            return jsonify(error="That saved game is invalid."), 400
        row = db.session.get(EuchreSavedGame, game["id"])
        if row and row.user_id != user.id:
            return jsonify(error="That saved game is unavailable."), 404
        if row and is_pruned(row.game):
            if game["phase"] == "game_over" and row.game["digest"] == digest(game):
                return jsonify(game=game, revision=row.revision)
            return jsonify(error="This game has already finished or was conceded.",
                           code="SAVE_CONFLICT", game=None, revision=row.revision), 409
        if row and row.game == game:
            return jsonify(game=row.game, revision=row.revision)
        if row and row.game["phase"] == "game_over":
            return jsonify(error="This game has already finished or was conceded.",
                           code="SAVE_CONFLICT", game=row.game, revision=row.revision), 409
        if (row.revision if row else 0) != revision:
            return jsonify(error="Another device saved newer progress. Your latest game has been loaded.",
                           code="SAVE_CONFLICT", game=row.game if row else None, revision=row.revision if row else 0), 409
        if row is None:
            if game["phase"] != "game_over":
                from .game_limits import check_creation, open_games, principal
                key = principal(user.id)
                check_creation(key, open_games(key))
            row = EuchreSavedGame(game_id=game["id"], user_id=user.id)
            db.session.add(row)
        row.game, row.revision, row.updated_at = game, revision + 1, datetime.utcnow()
        try:
            db.session.commit()
        except StaleDataError:
            db.session.rollback()
            latest = db.session.get(EuchreSavedGame, game["id"])
            return jsonify(error="Another device saved newer progress. Your latest game has been loaded.",
                           code="SAVE_CONFLICT", game=visible_game(latest.game) if latest else None,
                           revision=latest.revision if latest else 0), 409
        except IntegrityError:
            db.session.rollback()
            return jsonify(error="Please retry saving your game."), 409
        return jsonify(game=row.game, revision=row.revision)

    @blueprint.post("/saved-lobbies")
    def saved_guest_lobbies():
        from .models import EuchreTable
        from .euchre_multiplayer import member_for, public, game_view, seat_for

        values = body().get("memberships", [])
        if not isinstance(values, list) or len(values) > 100:
            return jsonify(error="Invalid saved lobbies."), 400
        games = []
        for value in values:
            if not isinstance(value, dict) or not isinstance(value.get("code"), str) or not isinstance(value.get("token"), str):
                continue
            row = db.session.get(EuchreTable, value["code"])
            if row is None:
                continue
            table = json.loads(row.snapshot)
            seat = member_for(table, value["token"])
            if table.get("status") != "playing" or not table.get("game") or table["game"]["phase"] == "game_over" or not seat or seat.get("userId") or seat.get("bot") or seat_for(table, value["token"]) is None:
                continue
            games.append(dict(id=row.code, mode="multiplayer", code=row.code, token=value["token"],
                              lobby=public(table, value["token"]), game=game_view(table, value["token"])))
        return jsonify(games=games)

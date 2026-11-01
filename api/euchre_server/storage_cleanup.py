"""Compact retired snapshots while retaining scores, results, and save fences."""

import hashlib
import json
import time
from datetime import datetime, timezone

from sqlalchemy import cast, func

from .extensions import db
from .models import EuchreGameResult, EuchreSavedGame, EuchreTable

RETENTION_SECONDS = 24 * 60 * 60
CLEANUP_INTERVAL_SECONDS = 60 * 60


def digest(game):
    value = json.dumps(game, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(value.encode()).hexdigest()


def is_pruned(game):
    return bool(game and game.get("_storage_pruned"))


def visible_game(game):
    return None if is_pruned(game) else game


def open_table_count():
    status = (
        cast(EuchreTable.snapshot, db.JSON)["status"].as_string()
        if db.engine.dialect.name == "postgresql"
        else func.json_extract(EuchreTable.snapshot, "$.status")
    )
    return EuchreTable.query.filter(status != "closed").count()


def cleanup_closed_games(now=None, *, limit=200):
    from . import euchre_multiplayer as mp

    now = time.time() if now is None else now
    cutoff = datetime.utcfromtimestamp(now - RETENTION_SECONDS)
    bots = tables = pending = 0
    saved = EuchreSavedGame.query.filter(
        EuchreSavedGame.updated_at <= cutoff,
        EuchreSavedGame.game["phase"].as_string() == "game_over",
        EuchreSavedGame.game["_storage_pruned"].as_boolean().is_not(True),
    )
    archived = EuchreGameResult.query.filter(
        EuchreGameResult.user_id == EuchreSavedGame.user_id,
        EuchreGameResult.game_id == EuchreSavedGame.game_id,
    ).exists()
    pending = saved.filter(~archived).count()
    for row in saved.filter(archived).order_by(EuchreSavedGame.updated_at).limit(limit):
        game = row.game
        row.game = {
            "_storage_pruned": True,
            "id": row.game_id,
            "phase": "game_over",
            "digest": digest(game),
            "scores": game["scores"],
            "conceded": game["conceded"],
            "finishedAt": game["finishedAt"],
        }
        # A concurrent writer that loaded the full snapshot must also lose its
        # optimistic update when compaction commits first.
        row.revision += 1
        bots += 1
    snapshot = cast(EuchreTable.snapshot, db.JSON)
    closed = (
        snapshot["status"].as_string() == "closed"
        if db.engine.dialect.name == "postgresql"
        else func.json_extract(EuchreTable.snapshot, "$.status") == "closed"
    )
    pruned = (
        snapshot["_storage_pruned"].as_boolean()
        if db.engine.dialect.name == "postgresql"
        else func.json_extract(EuchreTable.snapshot, "$._storage_pruned")
    )
    for row in EuchreTable.query.filter(
        EuchreTable.updated_at <= cutoff, closed, pruned.is_not(True)
    ).order_by(EuchreTable.updated_at):
        table = json.loads(row.snapshot)
        if table.get("status") != "closed" or table.get("_storage_pruned"):
            continue
        if any(client.get("code") == row.code for client in mp._clients.values()):
            continue
        closed_at = table.get(
            "_closed_at", row.updated_at.replace(tzinfo=timezone.utc).timestamp()
        )
        if closed_at > now - RETENTION_SECONDS:
            continue
        if (
            table.get("game")
            and table["game"]["phase"] != "game_over"
            and not table["game"].get("cancelled")
        ):
            # A closed room is not permission to turn an unfinished game into a result.
            summary = {"id": table["game"]["id"], "scores": table["game"]["scores"]}
        elif table.get("game"):
            mp.record_results(table)
            summary = {"id": table["game"]["id"], "scores": table["game"]["scores"]}
        else:
            summary = None
        row.snapshot = json.dumps(
            {
                "_storage_pruned": True,
                "code": row.code,
                "status": "closed",
                "closedReason": table.get("closedReason"),
                "touched": closed_at,
                "revision": table.get("revision", 0),
                "game": None,
                "host": None,
                "seats": [None] * 4,
                "unseated": {},
                "participants": [],
                "teams": [],
                "final_game": summary,
            }
        )
        mp._tables.pop(row.code, None)
        tables += 1
        if tables >= limit:
            break
    db.session.commit()
    return {
        "bot_saves_compacted": bots,
        "tables_compacted": tables,
        "pending_results": pending,
    }


def register_maintenance(app, socketio):
    from .euchre_multiplayer import _lock
    from .schema import schema_ready

    def run(now=None):
        with app.app_context(), _lock:
            if not schema_ready():
                return {}
            return cleanup_closed_games(now)

    app.extensions["cleanup_storage"] = run

    def worker():
        while True:
            try:
                run()
            except Exception:
                with app.app_context():
                    db.session.rollback()
                app.logger.exception("Euchre storage cleanup failed")
            socketio.sleep(CLEANUP_INTERVAL_SECONDS)

    if app.config.get("START_STORAGE_CLEANUP", not app.testing):
        socketio.start_background_task(worker)

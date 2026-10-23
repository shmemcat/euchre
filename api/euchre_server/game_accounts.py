"""Euchre-owned write exclusion and idempotent account cleanup."""

from contextlib import nullcontext
from datetime import datetime
from functools import wraps
import json
import secrets
import sys
from eventlet.semaphore import Semaphore
from greenlet import getcurrent
from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, select
from sqlalchemy.exc import SQLAlchemyError
from euchre_server.extensions import db
from euchre_server.account_contracts import AccountsUnavailable

metadata = MetaData()
receipts = {
    "euchre": Table(
        "euchre_account_deletions",
        metadata,
        Column("user_id", Integer, primary_key=True),
        Column("request_id", String(32), nullable=False),
        Column("deleted_at", DateTime, nullable=False),
    )
}
versions = {
    "euchre": Table(
        "euchre_account_schema_version",
        metadata,
        Column("version", String(32), primary_key=True),
    )
}


def is_deleted(user_id, game=None):
    return bool(
        user_id
        and db.session.execute(
            select(receipts["euchre"].c.user_id).where(
                receipts["euchre"].c.user_id == user_id
            )
        ).first()
    )


class GameGate:
    """Greenlet-aware reentrant gate; never held during identity validation."""

    def __init__(self):
        self.lock, self.owner, self.depth = Semaphore(), None, 0

    def __enter__(self):
        actor = getcurrent()
        if self.owner is actor:
            self.depth += 1
        else:
            self.lock.acquire()
            self.owner, self.depth = actor, 1
        return self

    def __exit__(self, *args):
        self.depth -= 1
        if not self.depth:
            self.owner = None
            self.lock.release()


def game_lock():
    return current_app.extensions.get("game_account_gate", nullcontext())


def euchre_lock():
    native = Semaphore()

    # __enter__ can be called by concurrent greenlets: do not store their
    # contexts on the shared lock object.
    class Composite:
        def __enter__(self):
            self_gate = game_lock()
            self_gate.__enter__()
            try:
                native.acquire()
            except BaseException:
                self_gate.__exit__(*sys.exc_info())
                raise
            return self

        def __exit__(self, *args):
            native.release()
            return game_lock().__exit__(*args)

    return Composite()


def accounts_available(user_id):
    if not user_id or not current_app.extensions.get("remote_accounts_enabled"):
        return True
    from euchre_server.account_access import accounts

    try:
        accounts().public_profiles([user_id])
        return True
    except AccountsUnavailable:
        return False


def _receipt(game, user_id, request_id):
    if not db.session.execute(
        select(receipts[game].c.user_id).where(receipts[game].c.user_id == user_id)
    ).first():
        db.session.execute(
            receipts[game]
            .insert()
            .values(
                user_id=user_id, request_id=request_id, deleted_at=datetime.utcnow()
            )
        )


def _scrub_euchre(snapshot, user_id):
    tokens = set()
    for index, member in enumerate(snapshot["seats"]):
        if member and member.get("userId") == user_id:
            if member.get("token"):
                tokens.add(member["token"])
            snapshot["seats"][index] = (
                dict(name=f"Bot {index + 1}", icon="robot", bot=True)
                if snapshot.get("game")
                else None
            )
    for token, member in list(snapshot.get("unseated", {}).items()):
        if member.get("userId") == user_id:
            tokens.add(token)
            snapshot["unseated"].pop(token)
    remaining = []
    for member in snapshot.get("participants", []):
        if member.get("userId") == user_id:
            tokens.add(member.get("token"))
        else:
            remaining.append(member)
    snapshot["participants"] = remaining
    tokens.discard(None)
    for index, team in enumerate(snapshot.get("teams", [])):
        if team.get("captain") in tokens:
            team.update(captain=None, name=f"Team {index + 1}", named=False)
    if snapshot.get("host") in tokens:
        snapshot["host"] = None
    if tokens and snapshot.get("game"):
        snapshot["game"]["message"] = "The table was updated."
    return tokens


def _cleanup_euchre(user_id):
    from euchre_server.models import EuchreGameResult, EuchreTable
    from euchre_server import euchre_multiplayer as mp

    socketio = current_app.extensions.get("socketio")
    codes = set(mp._tables)
    rows = {row.code: row for row in EuchreTable.query}
    codes.update(rows)
    for code in codes:
        snapshot = mp._tables.get(code) or json.loads(rows[code].snapshot)
        tokens = _scrub_euchre(snapshot, user_id)
        if not tokens:
            continue
        mp.captains(snapshot)
        mp.migrate_host(snapshot)
        snapshot["revision"] += 1
        for token in tokens:
            mp._disconnections.pop(token, None)
        for sid, client in list(mp._clients.items()):
            if client.get("userId") == user_id or client.get("token") in tokens:
                mp._clients.pop(sid, None)
                if socketio:
                    socketio.server.disconnect(sid, namespace="/euchre")
        if code in rows:
            rows[code].snapshot = json.dumps(snapshot)
        if code in mp._tables:
            mp._tables[code] = snapshot
    for sid, client in list(mp._clients.items()):
        if client.get("userId") == user_id:
            mp._clients.pop(sid, None)
            if socketio:
                socketio.server.disconnect(sid, namespace="/euchre")
    EuchreGameResult.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    return True


def _prime_identity():
    from euchre_server.account_access import accounts

    port = accounts()
    request.environ.pop("cards.account_event_primed", None)
    port.refresh()
    user = port.cookie_user()
    token = request.headers.get("Authorization", "")
    if not user and token.startswith("Bearer "):
        user = port.legacy_user(token[7:].strip())
    if not user and request.args.get("auth_token"):
        user = port.legacy_user(request.args["auth_token"])
    request.environ["cards.account_event_primed"] = True
    if user:
        g.current_user = user
    return user


def register_private_game_api(app):
    blueprint = Blueprint(
        "private_game_accounts", __name__, url_prefix="/_internal/games/v1"
    )

    @blueprint.post("/euchre/delete-user")
    def delete_user():
        expected = app.config["GAME_ACCOUNT_TOKENS"]["euchre"]
        token = request.headers.get("Authorization", "")
        if (
            request.headers.get("X-Cards-Service") != "accounts"
            or len(token) > 1024
            or not token.startswith("Bearer ")
            or not secrets.compare_digest(token[7:], expected)
        ):
            return jsonify(error="Unauthorized"), 401
        from euchre_server.account_http import body
        from euchre_server.schema import schema_ready

        if not schema_ready():
            return jsonify(error="Game schema is not ready"), 503
        data = body()
        user_id, request_id = data.get("user_id"), data.get("request_id")
        if type(user_id) is not int or not 0 < user_id < 2**63:
            return jsonify(error="Invalid user ID"), 400
        if (
            not isinstance(request_id, str)
            or len(request_id) != 32
            or any(c not in "0123456789abcdef" for c in request_id)
        ):
            return jsonify(error="Invalid request ID"), 400
        with game_lock():
            if not is_deleted(user_id):
                try:
                    _cleanup_euchre(user_id)
                    _receipt("euchre", user_id, request_id)
                    db.session.commit()
                except (SQLAlchemyError, ValueError, KeyError, TypeError):
                    db.session.rollback()
                    return jsonify(error="Cleanup will retry"), 503
            return jsonify(version=1, deleted=True, request_id=request_id)

    @blueprint.after_request
    def no_store(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    app.register_blueprint(blueprint)


def install_runtime(app):
    app.extensions["game_account_gate"] = GameGate()
    app.extensions["remote_accounts_enabled"] = True
    app.extensions["game_socket_identities"] = {}
    register_private_game_api(app)

    @app.before_request
    def prepare():
        if request.path.startswith("/_internal/") or request.endpoint in {
            None,
            "health",
            "ready",
        }:
            return None
        from euchre_server.schema import schema_ready

        if not schema_ready():
            return jsonify(error="Game schema is not ready"), 503
        db.session.rollback()
        user = _prime_identity()
        if request.endpoint == "euchre_stats.save_results":
            gate = app.extensions["game_account_gate"]
            gate.__enter__()
            request.environ["cards.game_gate"] = gate
            if user and is_deleted(user.id):
                return jsonify(error="Your account is no longer available."), 401

    @app.teardown_request
    def finish(error):
        gate = request.environ.pop("cards.game_gate", None)
        if gate:
            gate.__exit__(None, None, None)
        request.environ.pop("cards.account_event_primed", None)
        request.environ.pop("cards.remote_accounts", None)


def install_socket_dispatch(socketio):
    original = socketio.on

    def on(event, namespace=None, **options):
        decorate = original(event, namespace=namespace, **options)

        def register(handler):
            @wraps(handler)
            def wrapped(*args, **kwargs):
                identities = current_app.extensions["game_socket_identities"]
                key = (namespace, request.sid)
                if event == "disconnect":
                    with game_lock():
                        identities.pop(key, None)
                        return handler(*args, **kwargs)
                try:
                    from euchre_server.schema import schema_ready

                    if not schema_ready():
                        return (
                            False
                            if event == "connect"
                            else {"ok": False, "error": "Game service is not ready."}
                        )
                    db.session.rollback()
                    known_guest = (
                        event != "connect"
                        and key in identities
                        and identities[key] is None
                    )
                    if known_guest:
                        request.environ["cards.remote_accounts"] = {
                            "session": {
                                "user": None,
                                "session": None,
                                "valid_origin": False,
                                "valid_csrf": False,
                            }
                        }
                        request.environ["cards.account_event_primed"] = True
                    user = None if known_guest else _prime_identity()
                    db.session.rollback()
                    with game_lock():
                        if user and is_deleted(user.id):
                            return (
                                False
                                if event == "connect"
                                else {
                                    "ok": False,
                                    "error": "Your account is no longer available.",
                                }
                            )
                        expected = identities.get(key)
                        if (
                            event != "connect"
                            and expected
                            and (not user or user.id != expected)
                        ):
                            return {
                                "ok": False,
                                "error": "Your account changed. Sign in again to rejoin this table.",
                            }
                        result = handler(*args, **kwargs)
                        if event == "connect" and result is not False:
                            identities[key] = user.id if user else None
                        return result
                finally:
                    request.environ.pop("cards.account_event_primed", None)
                    request.environ.pop("cards.remote_accounts", None)

            return decorate(wrapped)

        return register

    socketio.on = on

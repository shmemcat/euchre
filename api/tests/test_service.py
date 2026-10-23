import io
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import event

from euchre_server import create_app
from euchre_server.account_contracts import AccountsUnavailable
from euchre_server.account_remote import RemoteAccounts
from euchre_server.extensions import db
from tests.account_fixtures import sign_in, post
from tests.conftest import ORIGIN, CSRF, CALLBACK_KEY


def cleanup(client, uid=42, key=CALLBACK_KEY, request_id=None):
    return client.post(
        "/_internal/games/v1/euchre/delete-user",
        json={"user_id": uid, "request_id": request_id or uuid4().hex},
        headers={"X-Cards-Service": "accounts", "Authorization": "Bearer " + key},
    )


def test_only_euchre_routes_sockets_and_models_are_registered(app):
    assert set(app.blueprints) == {"euchre_stats", "private_game_accounts"}
    assert set(app.extensions["socketio"].server.handlers) == {"/euchre"}
    assert set(db.metadata.tables) == {"euchre_tables", "euchre_game_results"}
    client = app.test_client()
    for path in [
        "/login",
        "/account/login",
        "/account/session",
        "/games/start",
        "/lobbies/create",
        "/preferences",
    ]:
        assert client.get(path).status_code == 404
    assert client.get("/health").json["component"] == "euchre-game"
    assert client.get("/ready").status_code == 200


def test_server_imports_and_runs_without_hearts_or_account_implementation():
    code = """
import importlib.abc, sys
class NoOtherServices(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'hearts', 'cards_accounts', 'argon2', 'jwt'}:
            raise AssertionError('Unexpected service dependency: ' + fullname)
sys.meta_path.insert(0, NoOtherServices())
from euchre_server import create_app
app = create_app({'SQLALCHEMY_DATABASE_URI': 'sqlite://',
    'CARDS_PUBLIC_URL': 'http://localhost:3000',
    'CARDS_ACCOUNTS_URL': 'http://accounts.invalid',
    'CARDS_SERVICE_TOKEN': 'r' * 40,
    'GAME_ACCOUNT_TOKENS': {'euchre': 'c' * 40}})
assert set(app.extensions['socketio'].server.handlers) == {'/euchre'}
assert app.test_client().get('/health').status_code == 200
assert app.test_client().get('/ready').status_code == 503
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).parents[1],
        env={**os.environ, "PYTHONPATH": ""},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_no_database_fallback_and_no_local_account_owner(app, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValueError, match="DATABASE_URL"):
        create_app()
    with pytest.raises(ValueError, match="shared accounts"):
        create_app(
            {"SQLALCHEMY_DATABASE_URI": "sqlite://", "CARDS_PUBLIC_URL": ORIGIN},
            accounts=object(),
        )


def test_runtime_never_queries_account_or_hearts_tables(app, accounts, existing_user):
    sign_in(accounts)
    statements = []

    def forbid(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)
        assert not re.search(
            r'\b(?:FROM|JOIN|UPDATE|INTO)\s+["`]?\b(users|account_sessions|password_reset_tokens|user_stats|active_games)\b',
            statement,
            re.I,
        )

    with app.app_context():
        engine = db.engine
    event.listen(engine, "before_cursor_execute", forbid)
    try:
        assert accounts.get("/account/euchre/multiplayer-results").status_code == 200
        assert accounts.get("/account/euchre/leaderboard").status_code == 200
        socket = app.extensions["socketio"].test_client(
            app, namespace="/euchre", flask_test_client=accounts, auth={"csrf": CSRF}
        )
        assert socket.is_connected("/euchre")
        assert socket.emit(
            "command", {"type": "create"}, namespace="/euchre", callback=True
        )["ok"]
        assert cleanup(accounts).json["deleted"] is True
        assert statements
    finally:
        event.remove(engine, "before_cursor_execute", forbid)


def test_private_cleanup_is_scoped_and_fences_stale_writes(
    app, accounts, existing_user
):
    sign_in(accounts)
    assert cleanup(accounts, key="forged").status_code == 401
    assert cleanup(accounts, key="test-read-key-" + "x" * 40).status_code == 401
    request_id = uuid4().hex
    assert cleanup(accounts, request_id=request_id).json["deleted"]
    assert cleanup(accounts, request_id=request_id).json["deleted"]
    # The fake peer still returns the old identity. The persistent receipt wins.
    assert post(accounts, "euchre/results", {"results": []}).status_code == 401
    assert accounts.post("/_internal/games/v1/hearts/delete-user").status_code == 404


def test_guest_continuity_and_signed_revocation_during_outage(
    app, accounts, existing_user
):
    sockets = app.extensions["socketio"]
    guest = sockets.test_client(
        app, namespace="/euchre", flask_test_client=accounts, auth={"csrf": CSRF}
    )
    sign_in(accounts)
    signed = sockets.test_client(
        app, namespace="/euchre", flask_test_client=accounts, auth={"csrf": CSRF}
    )
    peer = app.extensions["accounts"]
    peer.unavailable = True
    reply = signed.emit(
        "command", {"type": "create"}, namespace="/euchre", callback=True
    )
    assert reply["code"] == "ACCOUNTS_UNAVAILABLE"
    assert guest.emit(
        "command",
        {"type": "create", "name": "Guest"},
        namespace="/euchre",
        callback=True,
    )["ok"]
    assert accounts.get("/account/euchre/multiplayer-results").status_code == 503
    peer.unavailable = False
    post(accounts, "logout")
    assert not signed.emit(
        "command", {"type": "create"}, namespace="/euchre", callback=True
    )["ok"]
    guest.disconnect(namespace="/euchre")
    signed.disconnect(namespace="/euchre")


@pytest.mark.parametrize(
    "payload",
    [b"invalid", b'{"version":2}', b'{"version":true}', b"x" * 262145],
    ids=["json", "future", "boolean", "oversized"],
)
def test_remote_protocol_remains_bounded(app, monkeypatch, payload):
    class Opener:
        def open(self, request, timeout):
            assert timeout == 2
            return io.BytesIO(payload)

    def build(*handlers):
        assert handlers[0].proxies == {}
        assert (
            handlers[1].redirect_request(
                None, None, 302, None, None, "http://foreign.invalid"
            )
            is None
        )
        return Opener()

    monkeypatch.setattr(
        "euchre_server.account_remote.urllib.request.build_opener", build
    )
    peer = RemoteAccounts("http://accounts.invalid", "euchre-game", "r" * 40)
    with app.test_request_context(), pytest.raises(AccountsUnavailable):
        peer.legacy_user("legacy-client-credential")

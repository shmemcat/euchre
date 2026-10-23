import os
from uuid import uuid4

import pytest
from flask import request
from sqlalchemy import text

# Independent of the user's shell and development database settings.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ.pop("CARDS_ACCOUNTS_URL", None)

from euchre_server import create_app
from euchre_server.account_remote import RemoteAccounts
from euchre_server.account_contracts import AccountIdentity, AccountsUnavailable
from euchre_server.extensions import db
from euchre_server.schema import upgrade_schema

ORIGIN = "http://localhost:3000"
CALLBACK_KEY = "test-accounts-to-euchre-" + "x" * 40
CSRF = "test-only-csrf"


def pytest_configure(config):
    from tests.database_safety import database_guard

    guard = database_guard(lambda: config._tmp_path_factory.getbasetemp())
    guard.__enter__()
    config._euchre_database_guard = guard


def pytest_unconfigure(config):
    guard = getattr(config, "_euchre_database_guard", None)
    if guard is not None:
        guard.__exit__(None, None, None)


class AccountPeer(RemoteAccounts):
    def __init__(self):
        super().__init__(
            "http://accounts.invalid", "euchre-game", "test-read-key-" + "x" * 40
        )
        self.profiles, self.tokens = {}, {}
        self.unavailable = False

    def _call(self, path, data, browser=False):
        from flask import current_app

        assert (
            current_app.extensions["game_account_gate"].owner is None
        ), "Identity RPC under a game lock"
        if self.unavailable:
            raise AccountsUnavailable("test outage")
        if path == "profiles":
            from dataclasses import asdict

            return {
                "version": 1,
                "profiles": [
                    asdict(self.profiles[uid])
                    for uid in data["user_ids"]
                    if uid in self.profiles
                ],
            }
        from dataclasses import asdict

        token = request.cookies.get("cards_session")
        user = self.profiles.get(self.tokens.get(token))
        return {
            "version": 1,
            "user": asdict(user) if user else None,
            "session": {"csrf_token": CSRF} if token in self.tokens else None,
            "valid_origin": request.headers.get("Origin") == ORIGIN,
            "valid_csrf": request.headers.get("Origin") == ORIGIN
            and request.headers.get("X-CSRF-Token") == CSRF,
        }


@pytest.fixture
def app():
    import euchre_server

    peer = AccountPeer()
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite://",
            "CARDS_PUBLIC_URL": ORIGIN,
            "RATELIMIT_ENABLED": False,
            "GAME_ACCOUNT_TOKENS": {"euchre": CALLBACK_KEY},
        },
        accounts=peer,
    )
    previous, euchre_server._default_app = euchre_server._default_app, app
    with app.app_context():
        # Minimal account ID stand-in owned by this test fixture, never by the service.
        db.session.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        db.session.commit()
        upgrade_schema()
    try:
        yield app
    finally:
        with app.app_context():
            db.session.remove()
            db.engine.dispose()
        euchre_server._default_app = previous


@pytest.fixture
def accounts(app):
    peer = app.extensions["accounts"]
    client = app.test_client()
    token = "guest-" + uuid4().hex
    peer.tokens[token] = None
    client.set_cookie("cards_session", token)
    with app.app_context():
        yield client


def add_profile(app, uid, name, icon="user", verified=True):
    peer = app.extensions["accounts"]
    peer.profiles[uid] = AccountIdentity(uid, name, icon, verified)
    with app.app_context():
        db.session.execute(text("INSERT INTO users (id) VALUES (:uid)"), {"uid": uid})
        db.session.commit()
    return peer.profiles[uid]


@pytest.fixture
def existing_user(app):
    return add_profile(app, 42, "existing_hearts")

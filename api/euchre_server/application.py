"""Compose only Euchre HTTP, sockets, and private account cleanup."""

import json
import os
from urllib.parse import urlsplit

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO
from sqlalchemy import event
from sqlalchemy.engine import make_url
from werkzeug.middleware.proxy_fix import ProxyFix

from euchre_server.extensions import db, limiter
from euchre_server.account_contracts import AccountsUnavailable
from euchre_server.account_remote import RemoteAccounts


def create_app(config=None, *, accounts=None):
    app = Flask("euchre_server")
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", ""),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        CARDS_PUBLIC_URL=os.environ.get("CARDS_PUBLIC_URL", ""),
        CARDS_ACCOUNTS_URL=os.environ.get("CARDS_ACCOUNTS_URL", ""),
        CARDS_SERVICE_ID=os.environ.get("CARDS_SERVICE_ID", "euchre-game"),
        CARDS_SERVICE_TOKEN=os.environ.get("CARDS_SERVICE_TOKEN", ""),
        GAME_ACCOUNT_TOKENS=json.loads(
            os.environ.get("CARDS_GAME_ACCOUNT_TOKENS", "{}")
        ),
        TRUSTED_PROXY_HOPS=int(os.environ.get("TRUSTED_PROXY_HOPS", "0")),
        CORS_ORIGINS=os.environ.get(
            "CORS_ORIGINS", "http://localhost:3000,http://localhost:3002"
        ),
        COMPONENT_VERSION=os.environ.get("EUCHRE_SERVER_VERSION", "development"),
        SOURCE_REVISION=os.environ.get("EUCHRE_SOURCE_REVISION", "unknown"),
    )
    app.config.update(config or {})
    if not app.config["SQLALCHEMY_DATABASE_URI"]:
        raise ValueError(
            "Configure DATABASE_URL explicitly; there is no development database fallback"
        )
    uri = make_url(app.config["SQLALCHEMY_DATABASE_URI"])
    if uri.drivername == "postgresql":
        uri = uri.set(drivername="postgresql+psycopg2")
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    public = urlsplit(app.config["CARDS_PUBLIC_URL"].rstrip("/"))
    if (
        not public.hostname
        or public.path
        or public.query
        or public.fragment
        or public.username
        or public.password
        or (
            public.scheme != "https"
            and not (
                public.scheme == "http"
                and public.hostname in {"localhost", "127.0.0.1"}
            )
        )
    ):
        raise ValueError(
            "CARDS_PUBLIC_URL must be the shared HTTPS origin (HTTP allowed on localhost)"
        )
    app.config.update(
        CARDS_PUBLIC_URL=public.geturl(),
        CARDS_ACCOUNT_ENABLED=True,
        CARDS_COOKIE_SECURE=public.scheme == "https",
    )
    hops = app.config["TRUSTED_PROXY_HOPS"]
    if not 0 <= hops <= 3:
        raise ValueError("TRUSTED_PROXY_HOPS must be between 0 and 3")
    if hops:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops)
    provider = (
        accounts
        if accounts is not None
        else RemoteAccounts(
            app.config["CARDS_ACCOUNTS_URL"],
            app.config["CARDS_SERVICE_ID"],
            app.config["CARDS_SERVICE_TOKEN"],
        )
    )
    if not getattr(provider, "remote", False):
        raise ValueError(
            "Euchre requires shared accounts; no local account owner is available"
        )
    callback = app.config["GAME_ACCOUNT_TOKENS"].get("euchre")
    if not isinstance(callback, str) or len(callback) < 32:
        raise ValueError("Configure a separate accounts-to-Euchre callback key")
    app.extensions["accounts"] = provider
    db.init_app(app)
    with app.app_context():
        if db.engine.dialect.name == "sqlite":

            @event.listens_for(db.engine, "connect")
            def foreign_keys(connection, record):
                connection.execute("PRAGMA foreign_keys=ON")

    origins = app.config["CORS_ORIGINS"]
    if isinstance(origins, str):
        origins = [origin.strip() for origin in origins.split(",") if origin.strip()]
    CORS(app, origins=origins)
    from euchre_server.game_accounts import install_runtime, install_socket_dispatch
    from euchre_server.account_http import protect_cookie_requests
    from euchre_server.euchre_routes import euchre_bp
    from euchre_server.euchre_multiplayer import register_euchre_socket

    install_runtime(app)
    app.register_blueprint(euchre_bp)
    limiter.init_app(app)

    @app.before_request
    def cookie_guard():
        if not request.path.startswith("/_internal/"):
            return protect_cookie_requests()

    socketio = SocketIO(app, cors_allowed_origins=origins, async_mode="eventlet")
    install_socket_dispatch(socketio)
    register_euchre_socket(socketio, app)

    @app.errorhandler(AccountsUnavailable)
    def unavailable(error):
        return (
            jsonify(
                error="Accounts are temporarily unavailable. Please retry.",
                code="ACCOUNTS_UNAVAILABLE",
            ),
            503,
        )

    @socketio.on_error_default
    def socket_error(error):
        if not isinstance(error, AccountsUnavailable):
            raise error
        if request.event["message"] == "connect":
            from socketio.exceptions import ConnectionRefusedError

            raise ConnectionRefusedError(
                "Accounts are temporarily unavailable. Please retry.",
                {"code": "ACCOUNTS_UNAVAILABLE"},
            )
        return {
            "ok": False,
            "error": "Accounts are temporarily unavailable. Please retry.",
            "code": "ACCOUNTS_UNAVAILABLE",
        }

    @app.get("/health")
    def health():
        return jsonify(
            status="ok",
            component="euchre-game",
            version=app.config["COMPONENT_VERSION"],
            revision=app.config["SOURCE_REVISION"],
        )

    @app.get("/ready")
    def ready():
        from euchre_server.schema import schema_ready

        good = schema_ready()
        return jsonify(
            status="ready" if good else "not-ready", component="euchre-game"
        ), (200 if good else 503)

    return app

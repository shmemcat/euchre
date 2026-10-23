"""Disposable independent server for cross-service HTTP/Socket.IO rehearsal."""

import eventlet

eventlet.monkey_patch()

import json
from pathlib import Path
import re
import sys
from flask import request
from sqlalchemy import event

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "api"))
from euchre_server import create_app
from euchre_server.extensions import db
from euchre_server.models import EuchreTable, EuchreGameResult
from euchre_server.schema import upgrade_schema

database, port, accounts_port, secret = sys.argv[1:]
# These files must live in the disposable Cards rehearsal directory.
target = Path(database).resolve()
if target.suffix != ".db" or not target.parent.name.startswith("euchre-integration-"):
    raise RuntimeError("The fixture requires a disposable rehearsal database")
app = create_app(
    {
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///" + str(target),
        "CARDS_PUBLIC_URL": "http://localhost:3000",
        "CORS_ORIGINS": ["http://localhost:3000"],
        "RATELIMIT_ENABLED": False,
        "CARDS_ACCOUNTS_URL": f"http://127.0.0.1:{accounts_port}",
        "CARDS_SERVICE_ID": "euchre-game",
        "CARDS_SERVICE_TOKEN": secret + "-read-euchre",
        "GAME_ACCOUNT_TOKENS": {"euchre": secret + "-euchre"},
    }
)
with app.app_context():
    upgrade_schema()

    @event.listens_for(db.engine, "before_cursor_execute")
    def no_other_service_data(
        connection, cursor, statement, parameters, context, executemany
    ):
        if re.search(
            r'\b(?:FROM|JOIN|UPDATE|INTO)\s+["`]?\b(users|account_sessions|password_reset_tokens|user_stats|user_preferences|active_games|game_results)\b',
            statement,
            re.I,
        ):
            raise AssertionError("Euchre runtime accessed another service's data")


provider = app.extensions["accounts"]
original = provider._call


def outside_lock(*args, **kwargs):
    assert app.extensions["game_account_gate"].owner is None
    return original(*args, **kwargs)


provider._call = outside_lock
socketio = app.extensions["socketio"]
# Accelerate animations/bot pauses, preserving the real disconnect grace.
socketio.sleep = lambda seconds: eventlet.sleep(
    min(seconds, 0.001) if seconds < 30 else seconds
)


@app.get("/_internal/test/state")
def state():
    if request.headers.get("X-Test-Key") != secret:
        return {"error": "Forbidden"}, 403
    return {
        "tables": [json.loads(row.snapshot) for row in EuchreTable.query],
        "results": [
            {"game_id": row.game_id, "user_id": row.user_id, "score": row.score}
            for row in EuchreGameResult.query
        ],
    }


socketio.run(
    app, host="127.0.0.1", port=int(port), use_reloader=False, log_output=False
)

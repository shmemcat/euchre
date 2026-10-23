"""Test account owner; the game itself never registers these account operations."""

from types import SimpleNamespace
from uuid import uuid4
from flask import current_app

from tests.conftest import (
    accounts,
    existing_user,
    ORIGIN,
    CSRF,
    CALLBACK_KEY,
    add_profile,
)

EXISTING_USER_PASSWORD = "test-only-password"


def sign_in(client, username="existing_hearts"):
    peer = current_app.extensions["accounts"]
    user = next(user for user in peer.profiles.values() if user.username == username)
    token = "signed-" + uuid4().hex
    peer.tokens[token] = user.id
    client.set_cookie("cards_session", token)
    return SimpleNamespace(
        status_code=200, json={"csrf_token": CSRF, "user": {"id": str(user.id)}}
    )


def post(client, path, data=None):
    peer = current_app.extensions["accounts"]
    if path == "logout":
        peer.tokens.pop(client.get_cookie("cards_session").value, None)
        client.delete_cookie("cards_session")
        return SimpleNamespace(status_code=200)
    if path == "delete":
        uid = peer.tokens[client.get_cookie("cards_session").value]
        peer.profiles.pop(uid)
        return client.post(
            "/_internal/games/v1/euchre/delete-user",
            json={"user_id": uid, "request_id": uuid4().hex},
            headers={
                "X-Cards-Service": "accounts",
                "Authorization": "Bearer " + CALLBACK_KEY,
            },
        )
    return client.post(
        "/account/" + path,
        json=data or {},
        headers={"Origin": ORIGIN, "X-CSRF-Token": CSRF},
    )

"""Euchre-owned bot results and public win leaderboards."""

from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from euchre_server.account_http import body, no_store, protect_account
from euchre_server.account_access import session_user, accounts
from euchre_server.extensions import db, limiter
from euchre_server.models import EuchreGameResult, EuchreAchievementState
from euchre_server.achievements import HAND_UNLOCKS

euchre_bp = Blueprint("euchre_stats", __name__, url_prefix="/account/euchre")
euchre_bp.before_request(protect_account)
euchre_bp.after_request(no_store)
BOT_DIFFICULTIES = {"easy", "medium", "hard", "harder", "hardest"}


def parse_result(value, now):
    if not isinstance(value, dict):
        raise ValueError("Invalid game result.")
    game_id = value.get("id")
    difficulty = value.get("difficulty")
    scores = value.get("scores")
    won, conceded = value.get("won"), value.get("conceded")
    if not isinstance(game_id, str) or not 1 <= len(game_id) <= 64:
        raise ValueError("Invalid game identifier.")
    if not isinstance(difficulty, str) or difficulty not in BOT_DIFFICULTIES:
        raise ValueError("Choose a bot difficulty.")
    if (
        not isinstance(scores, list)
        or len(scores) != 2
        or any(type(score) is not int or not 0 <= score <= 13 for score in scores)
        or type(won) is not bool
        or type(conceded) is not bool
    ):
        raise ValueError("Invalid game score.")
    if conceded:
        if won or max(scores) >= 10:
            raise ValueError("Invalid conceded game.")
    elif (scores[0] >= 10) == (scores[1] >= 10) or won != (scores[0] >= 10):
        raise ValueError("Only completed games can be saved.")
    finished = value.get("finishedAt")
    if not isinstance(finished, str) or len(finished) > 40:
        raise ValueError("Invalid completion date.")
    try:
        completed = datetime.fromisoformat(finished.replace("Z", "+00:00"))
        if completed.tzinfo is None:
            raise ValueError()
        completed = completed.astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, OverflowError):
        raise ValueError("Invalid completion date.") from None
    if completed < datetime(1970, 1, 1) or completed > now + timedelta(minutes=5):
        raise ValueError("Invalid completion date.")
    counters = {key: value.get(key, 0) for key in ("marches", "loners", "euchres")}
    if (
        any(type(n) is not int or not 0 <= n <= 19 for n in counters.values())
        or sum(counters.values()) > 19
    ):
        raise ValueError("Invalid hand counters.")
    evidence = value.get("achievementData")
    if evidence is not None:
        if not isinstance(evidence, dict) or set(evidence) - {
            "unlocks",
            "calledSuits",
            "startedAt",
            "utcOffsetMinutes",
        }:
            raise ValueError("Invalid achievement evidence.")
        unlocks, suits = evidence.get("unlocks"), evidence.get("calledSuits")
        if (
            not isinstance(unlocks, list)
            or len(unlocks) > len(HAND_UNLOCKS)
            or any(not isinstance(i, str) or i not in HAND_UNLOCKS for i in unlocks)
        ):
            raise ValueError("Invalid achievement unlocks.")
        if (
            not isinstance(suits, list)
            or len(suits) > 4
            or any(
                not isinstance(s, str) or s not in {"c", "d", "s", "h"} for s in suits
            )
        ):
            raise ValueError("Invalid called suits.")
        start, offset = evidence.get("startedAt"), evidence.get("utcOffsetMinutes")
        if start is not None:
            try:
                started = datetime.fromisoformat(start.replace("Z", "+00:00"))
                if (
                    started.tzinfo is None
                    or not datetime(1970, 1, 1)
                    <= started.astimezone(timezone.utc).replace(tzinfo=None)
                    <= completed
                ):
                    raise ValueError()
            except (AttributeError, ValueError, OverflowError, TypeError):
                raise ValueError("Invalid game start date.") from None
        if offset is not None and (type(offset) is not int or abs(offset) > 840):
            raise ValueError("Invalid local time offset.")
        evidence = {
            "unlocks": sorted(set(unlocks)) if not conceded else [],
            "calledSuits": sorted(set(suits)) if not conceded else [],
        }
        if start is not None:
            evidence["startedAt"] = start
        if offset is not None:
            evidence["utcOffsetMinutes"] = offset
    return dict(
        game_id=game_id,
        difficulty=difficulty,
        won=won,
        conceded=conceded,
        score=scores[0],
        opponent_score=scores[1],
        completed_at=completed,
        **counters,
        achievement_data=evidence,
    )


@euchre_bp.post("/results")
@limiter.limit("120 per minute")
def save_results():
    user = session_user()
    if not user:
        return jsonify(error="Sign in to save your Euchre results."), 401
    data = body()
    values = data.get("results")
    if not isinstance(values, list) or not 1 <= len(values) <= 40:
        return jsonify(error="Submit between 1 and 40 game results."), 400
    now = datetime.utcnow()
    try:
        parsed = {}
        for value in values:
            result = parse_result(value, now)
            previous = parsed.get(result["game_id"])
            if previous and previous != result:
                raise ValueError("A game can only be saved once.")
            parsed[result["game_id"]] = result
    except ValueError as error:
        return jsonify(error=str(error)), 400
    # The single-worker write gate and unique constraint serialize uploads.
    existing = {
        row.game_id: row
        for row in EuchreGameResult.query.filter(
            EuchreGameResult.user_id == user.id,
            EuchreGameResult.game_id.in_(parsed),
        ).all()
    }
    for game_id, result in parsed.items():
        previous = existing.get(game_id)
        if previous:
            base_keys = {
                "game_id",
                "difficulty",
                "won",
                "conceded",
                "score",
                "opponent_score",
                "completed_at",
            }
            compare = base_keys | (
                {"marches", "loners", "euchres", "achievement_data"}
                if previous.achievement_data is not None
                and result["achievement_data"] is not None
                else set()
            )
            if any(getattr(previous, key) != result[key] for key in compare):
                db.session.rollback()
                return jsonify(error="That game already has a saved result."), 409
            if previous.achievement_data is None:
                for key in ("marches", "loners", "euchres"):
                    setattr(previous, key, max(getattr(previous, key), result[key]))
                previous.achievement_data = result["achievement_data"]
    for game_id, result in parsed.items():
        if game_id not in existing:
            db.session.add(EuchreGameResult(user_id=user.id, **result))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Please retry saving your results."), 409
    return jsonify(saved_ids=list(parsed)), 200


def rankings(category, now, monthly=False):
    query = db.session.query(
        EuchreGameResult.user_id, func.count(EuchreGameResult.id)
    ).filter(
        EuchreGameResult.difficulty == category,
        EuchreGameResult.won.is_(True),
        EuchreGameResult.completed_at <= now,
    )
    if monthly:
        query = query.filter(
            EuchreGameResult.completed_at
            >= now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        )
    rows = query.group_by(EuchreGameResult.user_id).all()
    profiles = accounts().public_profiles([row[0] for row in rows])
    eligible = [
        (profiles[uid], count)
        for uid, count in rows
        if uid in profiles and profiles[uid].email_verified
    ]
    eligible.sort(key=lambda item: (-item[1], item[0].username.lower(), item[0].id))
    return [
        dict(
            rank=index + 1,
            username=user.username,
            profile_icon=user.profile_icon,
            games_won=count,
        )
        for index, (user, count) in enumerate(eligible[:10])
    ]


@euchre_bp.get("/leaderboard")
@limiter.limit("120 per minute")
def leaderboard():
    category = request.args.get("category", "easy")
    if category == "achievements":
        return jsonify(monthly=[], all_time=achievement_rankings())
    if category not in BOT_DIFFICULTIES | {"multiplayer"}:
        return jsonify(error="Choose a valid leaderboard category."), 400
    now = datetime.utcnow()
    return jsonify(
        monthly=rankings(category, now, monthly=True), all_time=rankings(category, now)
    )


def achievement_rankings():
    from collections import defaultdict
    from .achievement_counts import achievement_count

    results = defaultdict(list)
    for row in EuchreGameResult.query.filter(EuchreGameResult.completed_at <= datetime.utcnow()).yield_per(200):
        results[row.user_id].append(row)
    extras = {row.user_id: row.unlocks for row in EuchreAchievementState.query.all()}
    counts = {uid: achievement_count(results[uid], extras.get(uid, [])) for uid in results.keys() | extras.keys()}
    profiles = accounts().public_profiles([uid for uid, count in counts.items() if count > 0])
    visible = [(profiles[uid], count) for uid, count in counts.items()
               if count > 0 and uid in profiles and profiles[uid].email_verified]
    visible.sort(key=lambda item: (-item[1], item[0].username.lower(), item[0].id))
    return [dict(rank=i + 1, username=user.username, profile_icon=user.profile_icon, achievement_count=count)
            for i, (user, count) in enumerate(visible[:10])]


@euchre_bp.get("/multiplayer-results")
@limiter.limit("120 per minute")
def multiplayer_results():
    user = session_user()
    if not user:
        return jsonify(error="Sign in to view your Euchre multiplayer statistics."), 401
    rows = (
        EuchreGameResult.query.filter_by(user_id=user.id, difficulty="multiplayer")
        .order_by(EuchreGameResult.completed_at)
        .all()
    )
    return jsonify(results=[serialize_result(r) for r in rows])


def serialize_result(row):
    return dict(
        id=row.game_id,
        difficulty=row.difficulty,
        won=row.won,
        conceded=row.conceded,
        scores=[row.score, row.opponent_score],
        finishedAt=row.completed_at.isoformat() + "Z",
        marches=row.marches,
        loners=row.loners,
        euchres=row.euchres,
        achievementData=row.achievement_data,
    )


@euchre_bp.route("/achievements", methods=["GET", "POST"])
@limiter.limit("120 per minute")
def achievement_state():
    user = session_user()
    if not user:
        return jsonify(error="Sign in to view your achievements."), 401
    state = db.session.get(EuchreAchievementState, user.id)
    if request.method == "POST":
        if body().get("id") != "geezer":
            return jsonify(error="This achievement must be earned in a game."), 400
        if not state:
            state = EuchreAchievementState(user_id=user.id, unlocks=["geezer"])
            db.session.add(state)
        elif "geezer" not in state.unlocks:
            state.unlocks = [*state.unlocks, "geezer"]
        db.session.commit()
        return jsonify(unlocks=state.unlocks)
    rows = (
        EuchreGameResult.query.filter_by(user_id=user.id)
        .order_by(EuchreGameResult.completed_at, EuchreGameResult.game_id)
        .all()
    )
    return jsonify(
        results=[serialize_result(row) for row in rows],
        unlocks=state.unlocks if state else [],
    )

"""Count earned badges, including every tier, from saved account evidence."""

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from .achievements import HAND_UNLOCKS

HOLIDAYS = {
    "new_year": (1, 1), "lonely_heart": (2, 14), "lucky_clover": (3, 17),
    "fireworks": (7, 4), "spooky": (10, 31), "christmas_spirit": (12, 25),
}
HOLIDAY_IDS = {*HOLIDAYS, "easter_egg", "thankful"}
SINGLES = HAND_UNLOCKS | HOLIDAY_IDS | {
    "newcomer", "first_light", "stargazer", "well_suited", "better_with_friends",
    "dream_team", "full_house", "hot_streak", "early_bird", "night_owl", "geezer",
    "all_year_round",
}


def calendar_unlocks(evidence):
    start = evidence.get("startedAt")
    offset = evidence.get("utcOffsetMinutes")
    if not isinstance(start, str) or type(offset) is not int or abs(offset) > 840:
        return set()
    try:
        started = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if started.tzinfo is None:
            return set()
        local = started.astimezone(timezone.utc) - timedelta(minutes=offset)
        year = local.year
        a = year % 19
        b, c = divmod(year, 100)
        d, e = divmod(b, 4)
        f = (b + 8) // 25
        g = (b - f + 1) // 3
        h = (19 * a + b - d - g + 15) % 30
        i, k = divmod(c, 4)
        l = (32 + 2 * e + 2 * i - h - k) % 7
        m = (a + 11 * h + 22 * l) // 451
        month, day = divmod(h + l - 7 * m + 114, 31)
        easter = date(year, month, day + 1)
        first = date(year, 11, 1)
        thanksgiving = date(year, 11, 1 + (3 - first.weekday()) % 7 + 21)
    except (ValueError, OverflowError):
        return set()
    unlocks = {key for key, holiday in HOLIDAYS.items() if (local.month, local.day) == holiday}
    if local.hour < 5:
        unlocks.add("night_owl")
    elif local.hour < 8:
        unlocks.add("early_bird")
    if local.date() == easter:
        unlocks.add("easter_egg")
    if local.date() == thanksgiving:
        unlocks.add("thankful")
    return unlocks


def achievement_count(rows, extras=()):
    unlocks, suits, partners = set(extras), set(), Counter()
    counts = Counter()
    streak = 0
    for row in sorted(rows, key=lambda r: (r.completed_at, r.game_id)):
        for key in ("loners", "marches", "euchres"):
            counts[key] += getattr(row, key)
        if row.conceded:
            continue
        counts["games"] += 1
        counts["wins"] += int(row.won)
        streak = streak + 1 if row.won else 0
        if streak >= 5:
            unlocks.add("hot_streak")
        if row.won:
            unlocks.add("first_light")
            if row.difficulty == "hardest":
                unlocks.add("stargazer")
            if row.opponent_score == 0:
                unlocks.add("skunk_works")
            if row.score == 10 and row.opponent_score == 9:
                unlocks.add("photo_finish")
        evidence = row.achievement_data or {}
        unlocks.update(evidence.get("unlocks", []))
        unlocks.update(calendar_unlocks(evidence))
        suits.update(evidence.get("calledSuits", []))
        if row.difficulty == "multiplayer":
            unlocks.add("better_with_friends")
            if row.won and evidence.get("partnerKey"):
                partners[evidence["partnerKey"]] += 1
    if counts["games"]:
        unlocks.add("newcomer")
    if len(suits) == 4:
        unlocks.add("well_suited")
    if any(count >= 10 for count in partners.values()):
        unlocks.add("dream_team")
    if HOLIDAY_IDS <= unlocks:
        unlocks.add("all_year_round")
    tiers = {"games": (25, 100, 500), "wins": (10, 50, 200),
             "loners": (1, 10, 50), "marches": (1, 25, 100), "euchres": (1, 25, 100)}
    return len(unlocks & SINGLES) + sum(counts[key] >= target for key, targets in tiers.items() for target in targets)

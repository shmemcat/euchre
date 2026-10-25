"""Achievement evidence from completed, server-owned multiplayer hands."""

import hashlib

HAND_UNLOCKS = {
    "skunk_works",
    "photo_finish",
    "back_from_brink",
    "nine_lives",
    "walk_off_euchre",
    "speed_demon",
    "marathon",
    "untouchable",
    "double_feature",
    "hat_trick",
    "no_jack_required",
    "carry_the_team",
    "trust_fall",
    "party_pooper",
    "lone_wolf_hunter",
    "shared_custody",
    "jackpot",
    "little_trump",
    "left_handed_compliment",
    "second_thoughts",
    "next_of_kin",
    "change_of_heart",
    "called_it",
}


def game_evidence(game, seat=0):
    evidence = {"unlocks": [], "calledSuits": []}
    for key in ("startedAt", "utcOffsetMinutes"):
        if key in game:
            evidence[key] = game[key]
    if game.get("conceded") or game["phase"] != "game_over":
        return evidence
    unlocked = set()
    side, other, partner = seat % 2, 1 - seat % 2, (seat + 2) % 4
    rounds = game["results"]
    calls = [r for r in rounds if r["maker"] == seat]
    loners = sum(r["alone"] and r["tricks"][side] == 5 for r in calls)
    if loners >= 2:
        unlocked.add("double_feature")
    if loners >= 3:
        unlocked.add("hat_trick")
    if len(calls) >= 3 and all(r["tricks"][side] >= 3 for r in calls):
        unlocked.add("called_it")
    evidence["calledSuits"] = sorted(
        {r["trump"] for r in calls if r["tricks"][side] >= 3}
    )
    if game["scores"][side] >= 10:
        if game["scores"][other] == 0:
            unlocked.add("skunk_works")
        if game["scores"][side] == 10 and game["scores"][other] == 9:
            unlocked.add("photo_finish")
        if any(r["scores"][side] == 0 and r["scores"][other] >= 8 for r in rounds):
            unlocked.add("back_from_brink")
        if any(r["scores"][side] <= 5 and r["scores"][other] == 9 for r in rounds):
            unlocked.add("nine_lives")
        if (
            rounds
            and rounds[-1]["maker"] % 2 == other
            and rounds[-1]["tricks"][other] < 3
        ):
            unlocked.add("walk_off_euchre")
        if 0 < len(rounds) <= 4:
            unlocked.add("speed_demon")
        if rounds and not any(
            r["maker"] % 2 == side and r["tricks"][side] < 3 for r in rounds
        ):
            unlocked.add("untouchable")
    if len(rounds) >= 15:
        unlocked.add("marathon")
    same = {"c": "s", "s": "c", "d": "h", "h": "d"}
    for r in rounds:
        tricks = r.get("completedTricks", [])
        if len(tricks) != 5:
            continue
        mine = sum(t["winner"] == seat for t in tricks)
        partners = sum(t["winner"] == partner for t in tricks)
        cards = [p["card"] for t in tricks for p in t["plays"] if p["seat"] == seat]
        right, left = "J" + r["trump"], "J" + same[r["trump"]]
        if r["maker"] == seat and r["tricks"][side] >= 3:
            if right in cards and left in cards:
                unlocked.add("jackpot")
            if mine == 0 and partners == r["tricks"][side]:
                unlocked.add("trust_fall")
            if r.get("upCard") and r["upCard"][-1] != r["trump"]:
                unlocked.add("second_thoughts")
                unlocked.add(
                    "next_of_kin"
                    if same[r["upCard"][-1]] == r["trump"]
                    else "change_of_heart"
                )
            if r["alone"] and mine == 5 and right not in cards and left not in cards:
                unlocked.add("no_jack_required")
        if r["maker"] == partner and not r["alone"] and mine == 5:
            unlocked.add("carry_the_team")
        if (
            r["maker"] % 2 == side
            and not r["alone"]
            and r["tricks"][side] == 5
            and mine >= 2
            and partners >= 2
        ):
            unlocked.add("shared_custody")
        if r["maker"] % 2 == other and r["alone"]:
            if mine:
                unlocked.add("party_pooper")
            if r["tricks"][other] < 3:
                unlocked.add("lone_wolf_hunter")
        for t in tricks:
            if t["winner"] != seat:
                continue
            winning = next(p["card"] for p in t["plays"] if p["seat"] == seat)
            if winning == "9" + r["trump"]:
                unlocked.add("little_trump")
            if winning == left and any(
                p["seat"] % 2 == other and p["card"] == "A" + r["trump"]
                for p in t["plays"]
            ):
                unlocked.add("left_handed_compliment")
    evidence["unlocks"] = sorted(unlocked)
    return evidence


def multiplayer_evidence(table, participant):
    game = dict(table["game"], conceded=participant["conceded"])
    evidence = game_evidence(game, participant["seat"])
    offset = participant.get("utcOffsetMinutes")
    if offset is not None:
        evidence["utcOffsetMinutes"] = offset
    if participant["conceded"]:
        return evidence
    # Only uninterrupted human seats qualify, including signed-out human guests.
    if len(table["participants"]) == 4 and all(
        not p["conceded"] for p in table["participants"]
    ):
        evidence["unlocks"].append("full_house")
    partner = next(
        (
            p
            for p in table["participants"]
            if p["seat"] == (participant["seat"] + 2) % 4
            and not p["conceded"]
            and p.get("userId")
        ),
        None,
    )
    if partner:
        # Opaque, player-specific pairing; never expose another account's ID.
        evidence["partnerKey"] = hashlib.sha256(
            f"euchre:{participant['userId']}:{partner['userId']}".encode()
        ).hexdigest()
    return evidence

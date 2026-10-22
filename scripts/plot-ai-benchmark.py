"""Plot paired old-versus-new Euchre results (requires matplotlib)."""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator, PercentFormatter

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--hands", type=Path, required=True)
parser.add_argument("--matches", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
hands = json.loads(args.hands.read_text(encoding="utf-8-sig"))
matches = json.loads(args.matches.read_text(encoding="utf-8-sig"))
if len(hands["results"]) != 6 or len(matches["results"]) != 2:
    raise ValueError("Wait for all six hand comparisons and both match comparisons.")
if hands["sourceSha256"] != matches["sourceSha256"]:
    raise ValueError("The hand and match runs evaluated different AI source files.")
args.output.mkdir(parents=True, exist_ok=True)
# This project's client timezone is America/Phoenix (UTC-7 year-round).
run_date = datetime.fromisoformat(hands["generatedAt"].replace("Z", "+00:00")).astimezone(
    timezone(timedelta(hours=-7))).strftime("%b %d, %Y")

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 12, "axes.titlesize": 15,
    "axes.labelsize": 12, "xtick.labelsize": 11, "ytick.labelsize": 12,
    "figure.facecolor": "white", "axes.facecolor": "white", "text.color": "#17212b",
    "axes.labelcolor": "#17212b", "xtick.color": "#4b5563", "ytick.color": "#17212b",
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "axes.edgecolor": "#c6ccd2", "savefig.facecolor": "white", "svg.fonttype": "none",
})
BLUE = "#21618c"
ORANGE = "#a85617"
GREY = "#5c6773"

def level(row):
    return row["comparison"].split(" vs ")[0].capitalize()

def save(fig, name):
    fig.savefig(args.output / (name + ".png"), dpi=190, bbox_inches="tight", pad_inches=0.25)
    fig.savefig(args.output / (name + ".svg"), bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)

def frame(ax, baseline):
    ax.axvline(baseline, color=GREY, linewidth=1.2, linestyle=(0, (3, 3)), zorder=1)
    ax.grid(axis="x", alpha=0.20, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.tick_params(axis="y", length=0, pad=12)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=6))

# Full-match wins are primary: one 97.5% interval for each of two upper tiers
# gives at least 95% family coverage via the Bonferroni correction.
rows = matches["results"]
fig, ax = plt.subplots(figsize=(9.2, 4.0))
fig.subplots_adjust(left=0.15, right=0.97, top=0.72, bottom=0.25)
lo = min(0.5, *(r["share975"][0] for r in rows))
hi = max(0.5, *(r["share975"][1] for r in rows))
span = max(0.04, hi - lo)
ax.set_xlim(lo - span * 0.22, hi + span * 0.22)
ax.set_ylim(-0.5, len(rows) - 0.5)
for index, row in enumerate(rows):
    y = len(rows) - 1 - index
    value = row["scoreShare"]
    lower, upper = row["share975"]
    ax.errorbar(value, y, xerr=[[value-lower], [upper-value]], fmt="o", color=BLUE,
                markersize=8, capsize=5, elinewidth=2.1, capthick=1.5, zorder=3)
    ax.annotate(f"{100*value:.1f}%   [{100*lower:.2f}, {100*upper:.2f}]",
                (value, y), xytext=(0, 15), textcoords="offset points", ha="center", fontsize=11)
ax.set_yticks(list(reversed(range(len(rows)))), [level(r) for r in rows])
ax.set_ylabel("Difficulty", labelpad=12)
ax.set_xlabel("New bot's match win rate against the previous bot (%)", labelpad=11)
ax.xaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
frame(ax, 0.5)
fig.text(0.15, 0.96, "New versus old: upper-tier match win rates", fontsize=18, weight="bold")
fig.text(0.15, 0.86, "Same difficulty and simulation budget • 50% is an even result", color=GREY)
fig.text(0.15, 0.075, "97.5% paired-bootstrap intervals; Bonferroni adjustment for two comparisons (nominal 95%).", fontsize=10, color=GREY)
fig.text(0.15, 0.025, f"Source: local Euchre benchmark • {run_date} • {rows[0]['games']:,} matches/tier • {rows[0]['pairs']:,} paired seeds", fontsize=10, color=GREY)
save(fig, "match-win-rates")

# Hand points show both partner conditions on one common numeric scale.
rows = hands["results"]
fig, ax = plt.subplots(figsize=(9.2, 5.8))
fig.subplots_adjust(left=0.15, right=0.97, top=0.74, bottom=0.18)
lo = min(0, *(r["margin95"][0]*100 for r in rows))
hi = max(0, *(r["margin95"][1]*100 for r in rows))
span = max(5, hi - lo)
ax.set_xlim(lo - span*0.18, hi + span*0.18)
for partner, offset, color, marker, label in [
    ("same bot", 0.15, BLUE, "o", "Whole AI teams"),
    ("medium", -0.15, ORANGE, "s", "Both tested bots have Medium partners"),
]:
    for row in [r for r in rows if r["partners"] == partner]:
        y = {"Hard": 2, "Harder": 1, "Hardest": 0}[level(row)] + offset
        value = row["pointMargin"]*100
        lower, upper = [v*100 for v in row["margin95"]]
        ax.errorbar(value, y, xerr=[[value-lower], [upper-value]], fmt=marker, color=color,
                    markersize=7, capsize=4, elinewidth=1.9, label=label if level(row)=="Hard" else None,
                    zorder=3)
        ax.annotate(f"{value:+.1f}", (value, y), xytext=(0, 11 if offset > 0 else -19),
                    textcoords="offset points", ha="center", fontsize=11, color=color,
                    bbox={"facecolor": "white", "edgecolor": "none", "pad": 0.6})
ax.set_yticks([2, 1, 0], ["Hard", "Harder", "Hardest"])
ax.set_ylabel("Difficulty", labelpad=12)
ax.set_ylim(-0.6, 2.6)
ax.set_xlabel("New minus previous bot: points gained per 100 hands", labelpad=10)
frame(ax, 0)
fig.text(0.15, 0.965, "Hand-point gains against the previous bots", fontsize=18, weight="bold")
fig.text(0.15, 0.89, "Right of zero favors the new bot • 95% intervals", color=GREY)
ax.legend(loc="lower left", bbox_to_anchor=(-0.01, 1.02), frameon=False, fontsize=10)
fig.text(0.15, 0.065, f"Source: local Euchre benchmark • {run_date} • {rows[0]['games']:,} hands/comparison • {rows[0]['pairs']:,} paired deals", fontsize=10, color=GREY)
fig.text(0.15, 0.025, "Intervals resample whole pairs (10,000 resamples). Hand results are supporting evidence, not match win rates.", fontsize=10, color=GREY)
save(fig, "hand-point-gains")

# Retain compact summaries separately from the much larger per-pair raw files.
summary = {
    "study": "fixed AI vs frozen previous bots",
    "primary": "Harder and Hardest full-match win rates, 97.5% intervals for two comparisons",
    "sourceSha256": hands["sourceSha256"],
    "settings": hands["settings"],
    "runs": [],
}
for report in [hands, matches]:
    copy = dict(report)
    copy["results"] = [{k:v for k,v in row.items() if k != "pairResults"} for row in report["results"]]
    summary["runs"].append(copy)
(args.output / "results.json").write_text(json.dumps(summary, indent=2)+"\n", encoding="utf-8")
print(json.dumps(summary, indent=2))

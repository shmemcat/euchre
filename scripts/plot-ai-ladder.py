"""Validate, summarize, and plot the direct difficulty ladder (numpy/matplotlib)."""

import argparse
import gzip
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import MaxNLocator, PercentFormatter


COMPARISONS = ["hard vs medium", "harder vs hard", "hardest vs harder"]
PARTNERS = ["same bot", "medium"]


def validate(report):
    if report["mode"] != "matches":
        raise ValueError("The ladder study requires complete matches.")
    expected = {(comparison, partner) for comparison in COMPARISONS for partner in PARTNERS}
    actual = {(row["comparison"], row["partners"]) for row in report["results"]}
    if actual != expected or len(report["results"]) != len(expected):
        raise ValueError("Wait for all three adjacent comparisons in both partner setups.")
    for row in report["results"]:
        pairs = row["pairResults"]
        if len(pairs) != report["pairsPerComparison"] or len(pairs) != row["pairs"]:
            raise ValueError("Incomplete paired results.")
        expected_seeds = [(report["seed"] + index * 2654435761) & 0xFFFFFFFF
                          for index in range(len(pairs))]
        if [pair["seed"] for pair in pairs] != expected_seeds:
            raise ValueError("Unexpected seed order or duplicate seeds.")
        if any(len(pair["legs"]) != 2 for pair in pairs):
            raise ValueError("Every seed must have both swapped-team legs.")
        legs = [leg for pair in pairs for leg in pair["legs"]]
        if len(legs) != row["games"]:
            raise ValueError("Incorrect match count.")
        if any(leg["won"] not in (0, 1) or (leg["points"] > 0) != bool(leg["won"])
               or leg["points"] == 0 for leg in legs):
            raise ValueError("Invalid completed-match winner or score margin.")
        for field, raw in [("scoreShare", "won"), ("pointMargin", "points")]:
            if abs(np.mean([leg[raw] for leg in legs]) - row[field]) > 1e-12:
                raise ValueError(f"Summary {field} differs from raw matches.")


def analyze(report, resamples):
    """Bootstrap both metrics on the same whole-pair indices; six tests per metric."""
    confidence = 1 - 0.05 / len(report["results"])
    tail = (1 - confidence) / 2
    rows = []
    for row in report["results"]:
        pair_values = np.array([
            [np.mean([leg[metric] for leg in pair["legs"]]) for metric in ("won", "points")]
            for pair in row["pairResults"]
        ])
        random = np.random.default_rng(816713)
        distribution = np.empty((resamples, 2))
        # Bound memory usage even for much larger future studies.
        for start in range(0, resamples, 500):
            end = min(start + 500, resamples)
            indices = random.integers(0, len(pair_values), size=(end - start, len(pair_values)))
            distribution[start:end] = pair_values[indices].mean(axis=1)
        intervals = np.quantile(distribution, [tail, 1 - tail], axis=0, method="inverted_cdf")
        ordinary = np.quantile(distribution, [0.025, 0.975], axis=0, method="inverted_cdf")
        copy = {key: value for key, value in row.items() if key != "pairResults"}
        candidate, opponent = row["comparison"].split(" vs ")
        copy.update({
            "candidate": candidate,
            "opponent": opponent,
            "candidateVersion": "current",
            "opponentVersion": "current",
            "wins": sum(leg["won"] for pair in row["pairResults"] for leg in pair["legs"]),
            "shareAdjusted": intervals[:, 0].tolist(),
            "marginAdjusted": intervals[:, 1].tolist(),
            "share95Analysis": ordinary[:, 0].tolist(),
            "margin95Analysis": ordinary[:, 1].tolist(),
        })
        rows.append(copy)
    return {
        "study": "Direct current-bot difficulty ladder: adjacent tiers",
        "primaryMetric": "Higher-tier match win rate; six comparisons including partner setups",
        "analysis": {
            "method": "Whole-pair percentile bootstrap, Bonferroni across six comparisons per metric",
            "resamples": resamples,
            "seed": 816713,
            "intervalConfidence": confidence,
            "nominalFamilyConfidence": 0.95,
            "note": "Point margins are supporting evidence; no combined coverage claim across both metrics.",
            "runtime": {
                "python": sys.version.split()[0],
                "numpy": np.__version__,
                "matplotlib": matplotlib.__version__,
            },
        },
        "run": {
            **{key: value for key, value in report.items() if key not in ("results", "baseline")},
            "suite": "ladder",
            "opponentVersion": "current",
            "legacySourceReference": report.get("baseline"),
        },
        "results": rows,
    }


def plot(summary, output):
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 12, "axes.titlesize": 15,
        "axes.labelsize": 12, "xtick.labelsize": 11, "ytick.labelsize": 12,
        "figure.facecolor": "white", "axes.facecolor": "white", "text.color": "#17212b",
        "axes.labelcolor": "#17212b", "xtick.color": "#4b5563", "ytick.color": "#17212b",
        "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
        "axes.edgecolor": "#c6ccd2", "savefig.facecolor": "white", "svg.fonttype": "none",
    })
    run = summary["run"]
    run_date = datetime.fromisoformat(run["generatedAt"].replace("Z", "+00:00")).astimezone(
        timezone(timedelta(hours=-7))).strftime("%b %d, %Y")
    confidence = summary["analysis"]["intervalConfidence"] * 100
    conditions = [
        ("same bot", 0.16, "#21618c", "o", "Whole AI teams"),
        ("medium", -0.16, "#a85617", "s", "Both sides have Medium partners"),
    ]
    for field, interval, baseline, name, title, xlabel in [
        ("scoreShare", "shareAdjusted", 0.5, "ladder-win-rates",
         "Difficulty ladder: direct match win rates", "Higher tier's match win rate against the lower tier (%)"),
        ("pointMargin", "marginAdjusted", 0, "ladder-point-margins",
         "Difficulty ladder: final score advantage", "Higher tier minus lower tier: mean final score (points / match)"),
    ]:
        fig, ax = plt.subplots(figsize=(10.4, 6.2))
        fig.subplots_adjust(left=0.23, right=0.97, top=0.72, bottom=0.20)
        rows = summary["results"]
        lower = min(baseline, *(row[interval][0] for row in rows))
        upper = max(baseline, *(row[interval][1] for row in rows))
        span = max(0.04 if baseline == 0.5 else 0.2, upper - lower)
        ax.set_xlim(lower - span * 0.15, upper + span * 0.15)
        ax.set_ylim(-0.55, 2.55)
        ax.axvline(baseline, color="#5c6773", linewidth=1.2, linestyle=(0, (3, 3)), zorder=1)
        ax.grid(axis="x", alpha=0.20, linewidth=0.6)
        ax.set_axisbelow(True)
        ax.tick_params(axis="y", length=0, pad=12)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=6))
        for partner, offset, color, marker, label in conditions:
            for index, comparison in enumerate(COMPARISONS):
                row = next(row for row in rows if row["comparison"] == comparison and row["partners"] == partner)
                y = 2 - index + offset
                value = row[field]
                lo, hi = row[interval]
                ax.errorbar(value, y, xerr=[[value - lo], [hi - value]], fmt=marker, color=color,
                            markersize=7, capsize=4, elinewidth=2, label=label if index == 0 else None,
                            zorder=3)
                value_label = f"{value:.1%}" if baseline == 0.5 else f"{value:+.2f}"
                ax.annotate(value_label, (value, y), xytext=(0, 12 if offset > 0 else -20),
                            textcoords="offset points", ha="center", fontsize=12,
                            bbox={"facecolor": "white", "edgecolor": "none", "pad": 0.6})
        ax.set_yticks([2, 1, 0], ["Hard vs Medium", "Harder vs Hard", "Hardest vs Harder"])
        ax.set_ylabel("Direct matchup", labelpad=12)
        ax.set_xlabel(xlabel, labelpad=11)
        if baseline == 0.5:
            ax.xaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
        ax.legend(loc="lower left", bbox_to_anchor=(-0.01, 1.04), frameon=False, fontsize=11)
        fig.text(0.23, 0.96, title, fontsize=18, weight="bold")
        fig.text(0.23, 0.89, "Current bots only • each row directly compares neighboring tiers", color="#5c6773", fontsize=11)
        fig.text(0.23, 0.085, f"{confidence:.2f}% paired-bootstrap intervals; nominal 95% family coverage across six comparisons.",
                 fontsize=10, color="#5c6773")
        fig.text(0.23, 0.04, f"Source: local Euchre benchmark • {run_date} • {run['pairsPerComparison'] * 2:,} matches/setup • {run['pairsPerComparison']:,} paired seeds",
                 fontsize=10, color="#5c6773")
        fig.savefig(output / (name + ".png"), dpi=190, bbox_inches="tight", pad_inches=0.25)
        fig.savefig(output / (name + ".svg"), bbox_inches="tight", pad_inches=0.25)
        plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matches", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resamples", type=int, default=100000)
    args = parser.parse_args()
    if args.resamples < 10000:
        parser.error("Use at least 10,000 bootstrap resamples for the adjusted intervals.")
    raw = args.matches.read_bytes()
    report = json.loads(raw.decode("utf-8-sig"))
    validate(report)
    summary = analyze(report, args.resamples)
    summary["rawReportSha256"] = hashlib.sha256(raw).hexdigest()
    summary["analysisScriptSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    # Preserve the exact uncompressed report bytes, including all legs and hashes.
    (args.output / "paired-results.json.gz").write_bytes(gzip.compress(raw, mtime=0))
    plot(summary, args.output)
    for row in summary["results"]:
        print(f"{row['comparison']} ({row['partners']}): {row['wins']}/{row['games']} wins, "
              f"{row['scoreShare']:.1%}, adjusted {row['shareAdjusted']}; "
              f"margin {row['pointMargin']:+.3f}, adjusted {row['marginAdjusted']}")


if __name__ == "__main__":
    main()

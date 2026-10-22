"""Compare upgraded and frozen Hardest against identical Harder opponents."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, MaxNLocator, PercentFormatter


def row(report, comparison, partners):
    rows = [result for result in report["results"]
            if result["comparison"] == comparison and result["partners"] == partners]
    if len(rows) != 1:
        raise ValueError(f"Missing or duplicate comparison: {comparison}, {partners}")
    return rows[0]


def arrays(result, seed, count):
    pairs = result["pairResults"]
    expected = [(seed + index * 2654435761) & 0xFFFFFFFF for index in range(count)]
    if len(pairs) != count or [pair["seed"] for pair in pairs] != expected:
        raise ValueError("Incomplete, duplicate, or incorrectly ordered seed pairs.")
    if any(len(pair["legs"]) != 2 for pair in pairs):
        raise ValueError("Each seed must include both swapped-team matches.")
    if any(leg["won"] not in (0, 1) or (leg["points"] > 0) != bool(leg["won"])
           for pair in pairs for leg in pair["legs"]):
        raise ValueError("Invalid complete-match winner.")
    values = np.array([[np.mean([leg[key] for leg in pair["legs"]])
                        for key in ("won", "points")] for pair in pairs])
    if not np.allclose(values.mean(axis=0), [result["scoreShare"], result["pointMargin"]], atol=1e-12):
        raise ValueError("Raw matches disagree with the reported averages.")
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--control", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    current_raw, control_raw = args.current.read_bytes(), args.control.read_bytes()
    current, control = [json.loads(raw.decode("utf-8-sig")) for raw in (current_raw, control_raw)]
    if any(report["mode"] != "matches" for report in (current, control)):
        raise ValueError("Use complete-match reports.")
    if current["seed"] != control["seed"] or current["pairsPerComparison"] != control["pairsPerComparison"]:
        raise ValueError("Before/after comparisons require identical paired seeds and sample sizes.")
    current_sources, control_sources = current["sourceSha256"], control["sourceSha256"]
    if set(current_sources) != set(control_sources):
        raise ValueError("Both reports must fingerprint the same source components.")
    differences = {name: {"current": current_sources[name], "control": control_sources[name]}
                   for name in current_sources if current_sources[name] != control_sources[name]}
    # This helper is used only by revised Hardest. The control's frozen Hardest
    # and the shared Harder opponent never call it. Every other source must match.
    if set(differences) - {"web/src/game/partner-search.ts"}:
        raise ValueError("Engine, shared/opponent policies, or frozen baseline sources differ.")
    seed, count = current["seed"], current["pairsPerComparison"]
    # Before, after, and paired improvement in each of two partner setups.
    # Six intervals per metric: Bonferroni gives nominal 95% family coverage.
    confidence, resamples = 1 - 0.05 / 6, 100000
    tail = (1 - confidence) / 2
    results = []
    for partners in ("same bot", "medium"):
        after_row = row(current, "hardest vs harder", partners)
        before_row = row(control, "pre-strengthening hardest vs harder", partners)
        after, before = [arrays(result, seed, count) for result in (after_row, before_row)]
        random = np.random.default_rng(816713)
        distribution = np.empty((resamples, 3, 2))
        for start in range(0, resamples, 500):
            end = min(start + 500, resamples)
            indices = random.integers(0, count, (end - start, count))
            old = before[indices].mean(axis=1)
            new = after[indices].mean(axis=1)
            distribution[start:end] = np.stack([old, new, new - old], axis=1)
        limits = np.quantile(distribution, [tail, 1 - tail], axis=0, method="inverted_cdf")
        estimates = np.stack([before.mean(axis=0), after.mean(axis=0), (after - before).mean(axis=0)])
        results.append({
            "partners": partners, "pairs": count, "matchesPerVersion": count * 2,
            **{name: {"winRate": float(estimates[index, 0]),
                      "winRateInterval": limits[:, index, 0].tolist(),
                      "pointMargin": float(estimates[index, 1]),
                      "pointMarginInterval": limits[:, index, 1].tolist()}
               for index, name in enumerate(("before", "after", "pairedImprovement"))},
        })
    args.output.mkdir(parents=True, exist_ok=True)
    summary = {
        "study": "Hardest strengthening with a matched previous-version control",
        "seed": seed, "pairsPerSetup": count, "resamples": resamples,
        "intervalConfidence": confidence, "nominalFamilyConfidence": 0.95,
        "method": "Whole-pair bootstrap; identical indices for before/after; Bonferroni across six quantities per metric",
        "sourceSha256": current["sourceSha256"], "settings": current["settings"],
        "controlSourceSha256": control["sourceSha256"],
        "previousSettings": control.get("preStrengtheningSettings"),
        "candidateOnlyImplementationDifferences": differences,
        "inputSha256": {"current": hashlib.sha256(current_raw).hexdigest(),
                        "control": hashlib.sha256(control_raw).hexdigest()},
        "plotScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "results": results,
    }
    (args.output / "strengthening-results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    for label, raw in (("current", current_raw), ("control", control_raw)):
        (args.output / f"{label}-paired-results.json.gz").write_bytes(gzip.compress(raw, mtime=0))
    plot(summary, args.output)
    print(json.dumps(results, indent=2))


def plot(summary, output):
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 12,
        "figure.facecolor": "white", "axes.facecolor": "white", "text.color": "#17212b",
        "axes.labelcolor": "#17212b", "xtick.color": "#4b5563", "ytick.color": "#17212b",
        "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
        "axes.edgecolor": "#c6ccd2", "savefig.facecolor": "white", "svg.fonttype": "none",
    })
    blue, grey = "#21618c", "#687480"
    results = summary["results"]
    for improvement in (False, True):
        fig, ax = plt.subplots(figsize=(10.0, 5.4))
        fig.subplots_adjust(left=0.23, right=0.97, top=0.70, bottom=0.22)
        series = [("pairedImprovement", 0, blue, "o", "Matched improvement")] if improvement else [
            ("before", 0.12, grey, "s", "Previous Hardest"),
            ("after", -0.12, blue, "o", "Revised Hardest"),
        ]
        baseline = 0 if improvement else 0.5
        limits = [result[key]["winRateInterval"] for result in results for key, *_ in series]
        low, high = min(baseline, *(interval[0] for interval in limits)), max(baseline, *(interval[1] for interval in limits))
        span = max(0.03, high - low)
        ax.set_xlim(low - span * 0.2, high + span * 0.2)
        ax.set_ylim(-0.45, 1.45)
        ax.axvline(baseline, color=grey, linewidth=1.2, linestyle=(0, (3, 3)))
        ax.grid(axis="x", alpha=0.2, linewidth=0.6)
        ax.set_axisbelow(True)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=6))
        ax.xaxis.set_major_formatter(
            FuncFormatter(lambda value, _: f"{100 * value:+.0f}") if improvement
            else PercentFormatter(1.0, decimals=0))
        ax.set_yticks([1, 0], ["Whole AI teams", "Medium partners"])
        ax.set_ylabel("Partner setup", labelpad=12)
        ax.tick_params(axis="y", length=0, pad=12)
        for key, offset, color, marker, label in series:
            for index, result in enumerate(results):
                value = result[key]["winRate"]
                lo, hi = result[key]["winRateInterval"]
                y = 1 - index + offset
                ax.errorbar(value, y, xerr=[[value - lo], [hi - value]], fmt=marker,
                            color=color, markersize=7, capsize=4, elinewidth=2,
                            label=label if index == 0 else None)
                text = f"{100 * value:+.1f} pp" if improvement else f"{value:.1%}"
                ax.annotate(text, (value, y), xytext=(0, 12 if offset >= 0 else -21),
                            textcoords="offset points", ha="center", fontsize=12,
                            bbox={"facecolor": "white", "edgecolor": "none", "pad": 0.6})
        title = "Hardest change: paired win-rate difference" if improvement else "Hardest change: the same Harder opponents"
        fig.text(0.23, 0.96, title, fontsize=17, weight="bold")
        fig.text(0.23, 0.88, "Same paired deal sequences • unchanged Harder opponents • frozen control", color=grey, fontsize=11)
        if not improvement:
            ax.legend(loc="lower left", bbox_to_anchor=(-0.01, 1.03), frameon=False, fontsize=11)
        ax.set_xlabel("Revised minus previous win rate (percentage points)" if improvement
                      else "Hardest's match win rate against Harder (%)", labelpad=12)
        fig.text(0.23, 0.09, "99.17% paired-bootstrap intervals; nominal 95% family coverage across six win-rate quantities.", fontsize=10, color=grey)
        fig.text(0.23, 0.04, f"Source: local Euchre benchmark • seed {summary['seed']} • {summary['pairsPerSetup'] * 2:,} matches per version/setup", fontsize=10, color=grey)
        name = "paired-win-rate-gain" if improvement else "hardest-before-after"
        for extension in ("png", "svg"):
            fig.savefig(output / f"{name}.{extension}", dpi=190, bbox_inches="tight", pad_inches=0.25)
        plt.close(fig)


if __name__ == "__main__":
    main()

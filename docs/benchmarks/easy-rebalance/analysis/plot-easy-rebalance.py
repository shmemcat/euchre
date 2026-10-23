"""Reproduce Easy's validation analysis and extend the original fixed scale."""

import gzip
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1]
FOLLOWUP = ROOT / "docs/benchmarks/hardest-strengthening-followup"


def read(path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def selected(report, comparison):
    rows = [r for r in report["results"]
            if r["comparison"] == comparison and r["partners"] == "medium"]
    assert len(rows) == 1
    return rows[0]


def outcomes(row):
    assert len(row["pairResults"]) == row["pairs"]
    assert all(len(p["legs"]) == 2 for p in row["pairResults"])
    values = np.array([np.mean([leg["won"] for leg in p["legs"]])
                       for p in row["pairResults"]])
    assert np.isclose(values.mean(), row["scoreShare"], atol=1e-12)
    return values


reference = read(FOLLOWUP / "relative-strength.json")
report = read(OUT / "paired-results.json.gz")
current, previous = [selected(report, name) for name in
                     ("easy vs medium", "previous easy vs medium")]
assert [p["seed"] for p in current["pairResults"]] == [p["seed"] for p in previous["pairResults"]]
assert report["seed"] == 20270221 and current["pairs"] == previous["pairs"] == 2000
old_scale = read(FOLLOWUP / "scale-easy-medium-pairs.json.gz")
lower = read(ROOT / "docs/benchmarks/hardest-strengthening/current-paired-results.json.gz")
upper = read(FOLLOWUP / "current-paired-results.json.gz")
hm, rh = [selected(lower, name) for name in ("hard vs medium", "harder vs hard")]
tr = selected(upper, "hardest vs harder")
assert [p["seed"] for p in hm["pairResults"]] == [p["seed"] for p in rh["pairResults"]]
cohorts = [set(p["seed"] for p in row["pairResults"]) for row in (old_scale, hm, tr, current)]
assert all(not cohorts[i] & cohorts[j] for i in range(4) for j in range(i))
arrays = [outcomes(row) for row in (old_scale, hm, rh, tr, current, previous)]


def logit(p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return np.log(p / (1 - p))


def easy_index(reference_rates, easy_wins):
    gaps = logit(reference_rates)
    return 100 * (gaps[..., 0] - logit(1 - easy_wins)) / gaps.sum(axis=-1)


rates = np.array(list(reference["adjacentWinRates"].values()))
assert np.allclose([a.mean() for a in arrays[:4]], rates, atol=1e-12)
estimate = float(easy_index(rates, arrays[4].mean()))
resamples = 25000
rng = np.random.default_rng(221026)
boot = np.empty((resamples, 4))
for start in range(0, resamples, 250):
    size = min(250, resamples - start)
    ie, il, it, iv = [rng.integers(0, len(arrays[i]), (size, len(arrays[i])))
                      for i in (0, 1, 3, 4)]
    ref_rates = np.column_stack([arrays[0][ie].mean(axis=1), arrays[1][il].mean(axis=1),
                                 arrays[2][il].mean(axis=1), arrays[3][it].mean(axis=1)])
    new_wins, old_wins = arrays[4][iv].mean(axis=1), arrays[5][iv].mean(axis=1)
    boot[start:start + size] = np.column_stack([
        easy_index(ref_rates, new_wins), new_wins, old_wins, new_wins - old_wins])
limits = np.quantile(boot, [0.025, 0.975], axis=0)
ratings = [dict(row) for row in reference["ratings"]]
ratings[0] = {"difficulty": "Easy", "index": estimate,
              "interval95": limits[:, 0].tolist(), "anchor": False}
input_paths = [OUT / "paired-results.json.gz", FOLLOWUP / "relative-strength.json",
               FOLLOWUP / "scale-easy-medium-pairs.json.gz",
               ROOT / "docs/benchmarks/hardest-strengthening/current-paired-results.json.gz",
               FOLLOWUP / "current-paired-results.json.gz"]
summary = {
    "metric": "Relative strength with a Medium partner on both sides",
    "anchors": "Original Easy=0 and original Hardest=100; Easy is NOT renormalized to zero",
    "ratings": ratings,
    "validation": {
        "seed": report["seed"], "pairsPerVersion": current["pairs"], "matches": 8000,
        "currentEasyWinRate": float(arrays[4].mean()),
        "previousEasyWinRate": float(arrays[5].mean()),
        "currentEasyWinRateInterval95": limits[:, 1].tolist(),
        "previousEasyWinRateInterval95": limits[:, 2].tolist(),
        "pairedWinRateGain": float(arrays[4].mean() - arrays[5].mean()),
        "pairedGainInterval95": limits[:, 3].tolist(),
        "mediumWinRateAgainstCurrentEasy": float(1 - arrays[4].mean()),
        "mediumWinRateAgainstPreviousEasy": float(1 - arrays[5].mean()),
    },
    "easyPolicy": report["easyPolicy"],
    "resamples": resamples,
    "uncertainty": "Pointwise 95% whole-pair bootstrap; index ranges also resample original reference cohorts, conditional on the transitive log-odds model. Not simultaneous intervals.",
    "limitations": "Illustrative relative scale, not accuracy or perfect-play percentage. Higher tiers retain previous estimates; only Easy was changed and benchmarked here.",
    "seedAudit": "Validation disjoint from development and all three reference cohorts; shared seeds preserved within before/after and lower-tier cohorts",
    "inputSha256": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in input_paths},
    "analysisSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
}
(OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12,
                     "axes.spines.top": False, "axes.spines.right": False,
                     "axes.spines.left": False, "svg.fonttype": "none"})
fig, ax = plt.subplots(figsize=(10, 5.8))
fig.subplots_adjust(left=0.11, right=0.96, bottom=0.24, top=0.79)
x = np.arange(5)
new_values = np.array([r["index"] for r in ratings])
old_values = np.array([r["index"] for r in reference["ratings"]])
ax.grid(axis="y", color="#cbd2d8", linewidth=0.7, alpha=0.65)
ax.set_axisbelow(True)
ax.plot(x[:2], old_values[:2], color="#8b949e", linewidth=2, linestyle="--",
        marker="o", markerfacecolor="white", markersize=7, label="Original Easy")
ax.plot(x, new_values, color="#21618c", linewidth=2.5, marker="o", markersize=8,
        label="Updated difficulty ladder")
for i, row in enumerate(ratings):
    low, high = row["interval95"]
    if i < 4:
        ax.errorbar(i, row["index"], yerr=[[row["index"] - low], [high - row["index"]]],
                    fmt="none", ecolor="#8b949e", capsize=4, linewidth=1.5)
    ax.text(i, high + 3, f"{row['index']:.0f}", ha="center", va="bottom", fontsize=14,
            color="#17212b")
ax.text(0.12, 2, "Previously 0", fontsize=11, color="#687480")
ax.set_xlim(-0.25, 4.25)
ax.set_ylim(-5, 112)
ax.set_yticks([0, 25, 50, 75, 100])
ax.set_xticks(x, [r["difficulty"] for r in ratings])
ax.tick_params(axis="both", length=0, pad=9)
ax.set_ylabel("Relative strength (0–100)", labelpad=12)
ax.set_xlabel("AI difficulty", labelpad=12)
ax.legend(loc="lower right", frameon=False, fontsize=10)
fig.text(0.11, 0.96, "A gentler first step in difficulty", fontsize=18, weight="bold", color="#17212b")
fig.text(0.11, 0.89, "Easy moves near 50 · Medium partner on both sides · higher levels unchanged", fontsize=11, color="#687480")
fig.text(0.11, 0.115, "Original scale retained: old Easy = 0, Hardest = 100. 100 does not mean perfect play.", fontsize=10, color="#4b5563")
fig.text(0.11, 0.068, "Whiskers: approximate 95% ranges. Easy validated in 8,000 fresh full matches; upper estimates reused.", fontsize=10, color="#687480")
for extension in ("png", "svg"):
    fig.savefig(OUT / f"relative-strength.{extension}", dpi=190, bbox_inches="tight", pad_inches=0.25)
plt.close(fig)
print(json.dumps({"easyIndex": estimate, "interval95": limits[:, 0].tolist(),
                  **summary["validation"]}, indent=2))

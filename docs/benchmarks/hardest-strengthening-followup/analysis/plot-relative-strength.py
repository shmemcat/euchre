"""Extend the saved benchmark figures with a relative, anchored strength index."""

import gzip
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path.cwd()
OUT = ROOT / "docs/benchmarks/hardest-strengthening-followup"


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)


def selected(report, name):
    rows = [row for row in report["results"]
            if row["comparison"] == name and row["partners"] == "medium"]
    if len(rows) != 1:
        raise ValueError("Missing or duplicate mixed-partner comparison")
    return rows[0]


def values(row):
    pairs = row["pairResults"]
    if any(not pair or len(pair["legs"]) != 2 for pair in pairs):
        raise ValueError("Incomplete pairs")
    array = np.array([np.mean([leg["won"] for leg in pair["legs"]]) for pair in pairs])
    if not np.isclose(array.mean(), row["scoreShare"], atol=1e-12):
        raise ValueError("Raw outcomes do not reproduce published wins")
    return array


easy_path = OUT / "scale-easy-medium-pairs.json.gz"
if not easy_path.exists():
    easy_path = ROOT / ".local/strength-scale/medium-easy.json"
lower_path = ROOT / "docs/benchmarks/hardest-strengthening/current-paired-results.json.gz"
upper_path = OUT / "current-paired-results.json.gz"
easy, lower, upper = [read(path) for path in (easy_path, lower_path, upper_path)]
snapshot = read(OUT / "source-snapshot.json.gz")
if easy["workerSha256"] != snapshot["compiledFiles"]["worker.mjs"]["sha256"]:
    raise ValueError("Easy comparison did not use the archived worker")
hm, rh = [selected(lower, name) for name in ("hard vs medium", "harder vs hard")]
tr = selected(upper, "hardest vs harder")
if [p["seed"] for p in hm["pairResults"]] != [p["seed"] for p in rh["pairResults"]]:
    raise ValueError("Lower comparisons must share their paired seed cohort")
cohorts = [set(p["seed"] for p in r["pairResults"]) for r in (easy, hm, tr)]
if any(cohorts[i] & cohorts[j] for i in range(3) for j in range(i)):
    raise ValueError("Unexpected overlap between independent cohorts")
arrays = [values(row) for row in (easy, hm, rh, tr)]
rates = np.array([array.mean() for array in arrays])


def index(probabilities):
    probabilities = np.clip(probabilities, 1e-9, 1 - 1e-9)
    gaps = np.log(probabilities / (1 - probabilities))
    cumulative = np.concatenate([np.zeros((*gaps.shape[:-1], 1)), np.cumsum(gaps, axis=-1)], axis=-1)
    return 100 * cumulative / cumulative[..., -1:]


estimate = index(rates)
rng = np.random.default_rng(816713)
resamples = 25000
sampled = np.empty((resamples, 5))
for start in range(0, resamples, 250):
    size = min(250, resamples - start)
    ie = rng.integers(0, len(arrays[0]), (size, len(arrays[0])))
    il = rng.integers(0, len(arrays[1]), (size, len(arrays[1])))
    it = rng.integers(0, len(arrays[3]), (size, len(arrays[3])))
    # Preserve covariance between the two lower comparisons' shared paired seeds.
    probabilities = np.column_stack([arrays[0][ie].mean(axis=1), arrays[1][il].mean(axis=1),
                                     arrays[2][il].mean(axis=1), arrays[3][it].mean(axis=1)])
    sampled[start:start + size] = index(probabilities)
limits = np.quantile(sampled, [0.025, 0.975], axis=0)
labels = ["Easy", "Medium", "Hard", "Harder", "Hardest"]
summary = {
    "metric": "Relative strength index with a Medium partner on both sides",
    "model": "Add adjacent log win odds (Bradley-Terry / Elo-style), normalize Easy=0 and Hardest=100",
    "meaning": "Relative endpoints among current bots, not accuracy percentages or progress toward perfect play",
    "limitations": "Adjacent-only model assumes transitivity; this is an illustrative index, not a proven universal strength rating",
    "uncertainty": "Pointwise 95% whole-pair bootstrap ranges conditional on the rating model; anchors fixed by definition",
    "resamples": resamples,
    "adjacentWinRates": dict(zip(["medium/easy", "hard/medium", "harder/hard", "hardest/harder"], rates.tolist())),
    "matches": sum(len(a) * 2 for a in arrays),
    "ratings": [{"difficulty": label, "index": float(estimate[i]),
                 "interval95": limits[:, i].tolist(), "anchor": i in (0, 4)}
                for i, label in enumerate(labels)],
    "inputSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in (easy_path, lower_path, upper_path)},
    "analysisSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
}
(OUT / "relative-strength.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
easy_raw = easy_path.read_bytes()
if easy_path.suffix == ".gz":
    easy_raw = gzip.decompress(easy_raw)
(OUT / "scale-easy-medium-pairs.json.gz").write_bytes(gzip.compress(easy_raw, mtime=0))

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12,
                     "axes.spines.top": False, "axes.spines.right": False,
                     "axes.spines.left": False, "svg.fonttype": "none"})
fig, ax = plt.subplots(figsize=(10, 5.8))
fig.subplots_adjust(left=0.11, right=0.96, bottom=0.25, top=0.79)
x = np.arange(5)
ax.grid(axis="y", color="#cbd2d8", linewidth=0.7, alpha=0.65)
ax.set_axisbelow(True)
ax.errorbar(x[1:4], estimate[1:4], yerr=[estimate[1:4] - limits[0, 1:4], limits[1, 1:4] - estimate[1:4]],
            fmt="none", ecolor="#8b949e", capsize=4, linewidth=1.5)
ax.plot(x, estimate, color="#21618c", linewidth=2.5, marker="o", markersize=8)
for i, value in enumerate(estimate):
    ax.text(i, limits[1, i] + 3, f"{value:.0f}", ha="center", va="bottom", fontsize=14, color="#17212b")
ax.set_xlim(-0.25, 4.25)
ax.set_ylim(-5, 112)
ax.set_yticks([0, 25, 50, 75, 100])
ax.set_xticks(x, labels)
ax.tick_params(axis="both", length=0, pad=9)
ax.set_ylabel("Relative strength (0–100)", labelpad=12)
ax.set_xlabel("AI difficulty", labelpad=12)
fig.text(0.11, 0.96, "How the difficulty levels are spaced", fontsize=18, weight="bold", color="#17212b")
fig.text(0.11, 0.89, "Medium partner on both sides · fitted from measured match win odds", fontsize=11, color="#687480")
fig.text(0.11, 0.12, "Easy = 0 and Hardest = 100 are fixed anchors. 100 does not mean perfect play.", fontsize=11, color="#4b5563")
fig.text(0.11, 0.075, "Gray whiskers: approximate 95% bootstrap ranges for the relative index.", fontsize=10, color="#687480")
fig.text(0.11, 0.03, "Source: local Euchre benchmarks · 5,000 full matches · unchanged lower tiers + latest Hardest", fontsize=10, color="#687480")
for extension in ("png", "svg"):
    fig.savefig(OUT / f"relative-strength.{extension}", dpi=190, bbox_inches="tight", pad_inches=0.25)
plt.close(fig)
print(json.dumps(summary["ratings"], indent=2))

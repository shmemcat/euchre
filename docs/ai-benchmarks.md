# Euchre AI benchmarks

The [Easy rebalance](benchmarks/easy-rebalance/README.md) brings Easy near the
requested 50 on the original relative scale: **46.4** (approximate 95% range
**42.0–51.0**). In **8,000 fresh matches**, Medium won **64.0%** against revised
Easy versus **83.8%** against original Easy. Easy now uses basic sensible card
play and discards 70% of the time, with occasional random choices and its existing
loose bidding. Medium and higher difficulties are unchanged. Run this dedicated
comparison with `npm run benchmark:easy`.

The [fresh Hardest follow-up](benchmarks/hardest-strengthening-followup/README.md)
completed **4,000 matches** against unchanged Harder. With Medium partners,
revised Hardest won **53.1%**, versus **49.0%** for the frozen previous version;
the paired gain was **+4.1 percentage points** (adjusted interval **1.0–7.2**).
Its win-rate interval, **50.4%–55.8%**, supports the Hardest-to-Harder step in
this lineup. Whole teams won **54.5%** (51.2%–57.8%), maintaining that ladder
step; the whole-team gain over the previous version remains inconclusive.
These use stricter 99.5833% intervals, with nominal 97.5% family coverage per
metric. All simulation budgets and lower-difficulty decisions are unchanged.

The [previous direct difficulty-ladder study](benchmarks/difficulty-ladder/README.md)
compares Medium → Hard → Harder → Hardest before further Hardest work, in 6,000 complete matches,
including whole teams and Medium partners. Use those graphs to assess the
ordering of difficulties; the old-versus-new graphs answer a different question.
Every adjacent step is supported for whole teams. With Medium partners, the
Hardest–Harder separation remains inconclusive (51.1% wins; adjusted interval
48.7%–53.5%).

The [expanded old-versus-new study](benchmarks/large-study/README.md) now covers
24,000 isolated hands and 800 complete matches, with graphs and archived paired
data. It establishes improved whole-team match results for both Harder and
Hardest; gains with Medium partners remain inconclusive.

The [first Hardest strengthening attempt](benchmarks/hardest-strengthening/README.md)
was evaluated in another 8,000 complete matches. It failed the Medium-partner
target: revised Hardest won 50.6% against Harder, compared with 51.9% for the
previous version on the same deals. The paired change was -1.3 percentage points
(adjusted interval -4.3 to +1.7). Its whole-team improvement was also inconclusive.
That study is preserved separately; its seeds became development data for a
bounded follow-up, and cannot validate that follow-up.

Run from the repository root after installing the web dependencies:

```powershell
npm run benchmark:ai
```

The default run compares every new Hard setting against its frozen predecessor,
then compares Medium → Hard → Harder → Hardest. It tests both whole partnerships
and one tested bot per team with Medium partners. It uses 100 duplicate-deal pairs
per comparison and writes incremental results to `.local/ai-benchmark.json`.
This is a measurement tool, not a timing-sensitive unit test or a CI win-rate gate.

For a quick check, use `--pairs 10`. For stronger evidence, increase the number
of benchmark deals; this does not change the bots' simulation budgets:

```powershell
npm run benchmark:ai -- --pairs 300 --suite ladder --partners teams --seed 20261023 --output .local/ladder.json
npm run benchmark:ai -- --pairs 200 --suite regression --partners mixed --seed 20261025 --output .local/regression-mixed.json
npm run benchmark:ai -- --pairs 50 --suite ladder --comparison "hard vs medium" --partners teams --mode matches --seed 20261024 --output .local/matches.json
```

`--suite` accepts `all`, `regression`, `ladder`, `strengthening`, or `controls`; `--partners` accepts `both`,
`teams`, or `mixed`; `--mode` accepts `hands` or `matches`. `--comparison` selects
an exact comparison name, for example `hardest vs previous hardest`.

`strengthening` compares the revised Hardest against its frozen pre-strengthening
version and against Harder. `controls` compares that frozen Hardest against the
unchanged Harder. Run `controls` and `ladder` with identical seeds and sample sizes
to estimate the paired before/after change against a fixed opponent. This control
is distinct from the older `legacy-ai.ts` baseline used by `regression`.

Larger runs can use independent CPU workers without changing the games:

```powershell
npm run benchmark:ai -- --pairs 2000 --suite regression --partners both --workers 12 --details --seed 20261027 --output .local/ai-large-hands.json
npm run benchmark:ai -- --pairs 200 --suite regression --levels harder,hardest --partners teams --mode matches --workers 8 --details --seed 20261028 --output .local/ai-large-matches.json
```

`--workers` accepts 1–32 (default 1); `--levels` selects the tested difficulty
settings. Each worker receives a disjoint range of the same deterministic seed
sequence. Outcomes are sorted by seed index before analysis, so worker scheduling
cannot change results. Serial and four-worker runs were checked for identical
points, winners, and redeals. Each process uses a separate compiled directory.
`--details` retains every paired result, and reports fingerprint both AI versions
and the engine with SHA-256. The AI settings are held fixed during these runs.

## What is measured

Each pair replays the same initial deal and dealer with the tested bots on
opposite teams. A separate seeded random stream supplies each player's decisions;
simulation count cannot change the deals. In match mode the sequence of future
deals is also independent of bot randomness. Mixed-partner runs assign a Medium
partner to each tested bot. Bots receive `Observation`, never the full game.

The report includes:

- **Point margin per game:** the tested side's points minus its opponent's,
  averaged across both legs and all pairs. Positive favors the tested bot.
- **95% interval:** a deterministic bootstrap of 10,000 resamples of whole pairs.
  Replaying a deal creates correlation, so the two legs are not treated as
  independent observations. An interval crossing zero is inconclusive.
- **Win/scoring-share intervals:** paired bootstrap intervals at 95% and 97.5%,
  alongside corresponding point-margin intervals. Published studies declare
  their comparison family and adjustment separately; the six-case ladder uses
  99.1667% intervals for nominal 95% family coverage per metric.
- **Scoring share:** in hand mode, the fraction of hands in which the tested side
  scores, with a half share for redeals. It does not distinguish a one-point win
  from a four-point loner. Point margin is the primary hand-strength measure.
  In match mode this field is the match win rate.
- **Mean and maximum decision time:** wall-clock time for the tested team,
  including its Medium partner in mixed runs. Concurrent CPU work affects these
  numbers. Comparisons use the same sample budgets, not equal wall-clock budgets.
- **Redeals and decision count**, plus runtime and difficulty settings.

The old implementation is frozen in `web/benchmarks/legacy-ai.ts` from commit
`9247a0df4dfc188692189fd14a31a6c16b6a041e`. It does not import the new policies.
The harness is checked against identical-bot pairings (which must average zero),
independent deal randomness, and complete matches. Late search is checked against
exhaustive play through the actual game engine.

## Difficulty design

Medium retains its existing bidding, discard, and play rules. Hard's simulation
uses public cards, inferred voids, card preservation, and the vulnerability of a
currently winning card. Future bidders use the Medium bidding policy with their
own hypothetical hands. A final pass is worth zero points for that hand; passing
earlier may lead to a partner's call, an opponent's call, or another opportunity
for the original bidder in round two.

The search settings are deliberately graded:

- **Hard:** 32 deals; switch away from the Medium action only for an estimated
  gain above 0.40 hand points. Use strategic simulated play throughout.
- **Harder:** 128 deals; 0.12-point switch margin; solve the final two tricks of
  each sampled deal with partnership minimax and alpha-beta pruning.
- **Hardest:** the same 384 deals; choose the highest estimated match value.
  Two-trick tactical forecasts account for a partner who may follow a simple
  public-information policy, rather than assuming perfect cooperation. These
  contribute 25% of the estimate; the other 75% comes from an information-set
  continuation over the final three tricks.

The Hard/Harder margins preserve familiar choices when estimated benefits are
small. Their behavior is unchanged by the further Hardest work.

Hardest scores hypothetical outcomes by approximate probability of winning the
race to ten, rather than raw hand points. Terminal match wins are exact: a point
at nine is as valuable as four points at nine. Future hands use a symmetric
neutral model (one/two/four points with probabilities 0.60/0.35/0.05), not a solved
match model. This avoids unnecessary lone-hand risk when a normal make clinches.

Public bidding and observed card choices provide tempered, fallible evidence
about hidden allocations and player style. Proven voids remain hard constraints.
Weights mix 65% modeled evidence with 35% broad prior; no observed preference is
treated as a certain hidden card. The partner's simple-policy prior is 75%; the
opponents' is 15%. These are assumptions over possible behavior, not access to
their actual bot settings, identities, private cards, or random generators.
Hypothetical hidden hands also retain a consistent sampled original card order
across past and future play. This matters when a simple policy chooses the first
ace in its hand: reconstructing earlier hands by appending played cards would
otherwise misinterpret that public lead. The actual private order is never read.

In the information-set continuation, future choices are shared across sampled
worlds with the same public play and own hand. Groups with fewer than 12 samples
fall back to the public policy. The tactical component still solves hypothetical
deals with optimal replies by other seats. Averaging and blending these forecasts
is an approximation to hidden-information play, not a proof of perfect strategy.
Exact score bounds and branch ordering accelerate search; once a contract's score
cannot change, sampling is skipped. Model assumptions are recorded in benchmark
settings and exact tested sources are archived with each study.

Use a different seed for validation after tuning. Check both mixed and whole-team
runs, and use full matches to assess how large the Medium-to-Hard jump feels.
Do not infer a guaranteed ordering from sample counts alone, or treat a small
positive margin with an interval crossing zero as an established improvement.

## Initial October 21, 2026 measurements

The [saved results](ai-benchmark-results.json) record the final settings, seeds,
latencies, and confidence intervals. Exploratory runs were used to tune the
switch margins; the numbers below are descriptive validation results, not a
guarantee about human win rates.

Complete matches with whole partnerships:

- Hard vs Medium: **66 wins in 100 matches**, with a mean score advantage of
  **1.85 points per match** (95% paired-bootstrap interval **1.29 to 2.46**).
- Harder vs Hard: **35 wins in 60 matches**, with a mean score advantage of
  **0.90 points per match** (interval **0.25 to 1.50**).
- Hardest vs Harder: **24 wins in 40 matches**, with a mean score advantage of
  **0.65 points per match** (interval **-0.10 to 1.425**). This smaller run is
  encouraging but inconclusive.

These are 200 full matches total. The observed steps are moderate; the upper
tiers need more matches to estimate their win rates precisely. The result file
also records SHA-256 fingerprints of the evaluated game and AI sources.

The separate hand runs use 100 duplicate-deal pairs (200 hands) per comparison,
for both whole partnerships and Medium partners. Hard's advantage over Medium
was **0.25 points per hand** with whole teams (interval **0.13 to 0.37**) and
**0.13** with Medium partners (**0.05 to 0.22**). The adjacent upper-tier hand
comparisons were smaller and their intervals crossed zero; those runs alone do
not establish a strength ordering.

Against each frozen predecessor, whole-team point margins were **+0.065** for
Hard, **-0.005** for Harder, and **+0.030** for Hardest. All six old-versus-new
intervals, including Medium-partner runs, crossed zero. These measurements do
**not yet establish that the new implementations beat their predecessors**.
The new auction model and tactical capabilities are verified, but their aggregate
strength benefit needs a larger benchmark across more deals and partner styles.

The initial saved snapshot used 2,000 bootstrap resamples. The expanded study
uses 10,000, with the AI settings unchanged. Use `scripts/plot-ai-benchmark.py`
with `--hands`, `--matches`, and `--output` to produce the comparison figures
and compact summary once both expanded runs finish (requires matplotlib).

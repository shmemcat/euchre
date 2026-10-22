# Bounded follow-up and independent validation

Three development trials used 300 paired seeds / 600 complete matches with
Medium partners against Harder, seed 20261221. This seed came from the first
attempt's unsuccessful validation and was treated entirely as development data.

The baseline scored 51.8333%. Consistent latent original hand order raised the
metric to 53.0%; favoring information-consistent continuation raised it to
53.3333%. A policy-specific bid-evidence model scored 53.0% and was discarded.
The retained code at isolated revision fd028e0 is byte-identical to trial
a23134c after reverting that last experiment. No further trials were performed.

A development whole-team sanity check won 113 of 200 matches (56.5%). This and
all development outcomes were excluded from final inference. The selected source
passed 73 game tests and TypeScript checks. After promotion, the complete primary
project passed 218 tests in 25 files and its production build.

The final validation design was fixed before the three trials: fresh seed
20270113, 500 paired seeds per case, four cases totaling 4,000 full matches.
Revised and frozen previous Hardest each faced unchanged Harder with whole teams
and Medium partners. Both used the identical frozen compiled build. The initial
eight-worker control was interrupted after 50 pairs of progress, before any
completed case or aggregate, solely for resource balance; its work was excluded
and every pair replayed using 20 workers. The candidate used 24 workers.

Final adjusted 99.5833% whole-pair bootstrap intervals, with 100,000 resamples and
nominal 97.5% family coverage across six quantities per metric:

- Medium partners: revised 53.1% [50.4,55.8], previous 49.0% [46.7,51.3].
  Paired improvement +4.1 percentage points [1.0,7.2]. Both superiority to Harder
  and improvement over the previous Hardest are supported.
- Whole teams: revised 54.5% [51.2,57.8], previous 52.9% [49.9,55.9]. Paired
  change +1.6 points [-2.3,5.5]. The ladder step is supported; whole-team
  improvement over the previous version remains inconclusive.

These meet the declared measured target. The advantage is modest, and perfect
hidden-information play remains unproven. The first failed study is preserved
separately; it is not pooled with this fresh validation. There is no joint
coverage claim across the entire research history.

All sampling budgets remain unchanged (Hard32, Harder128, Hardest384), and every
lower difficulty retains its behavior. The retained follow-up uses 75%
information-set continuation over the final three tricks and 25% partner-aware
tactical forecast over the final two, plus consistent hypothetical original
card order. Actual foreign hands, private discards and player types are never
provided to the AI.

Both complete reports fingerprint identical sources. The tested AI and engine
match the primary checkout. Exact sources, compiled bundles, paired data, seed
audit, excluded startup log, figures and analysis script are archived in
docs/benchmarks/hardest-strengthening-followup. An independent rebuild matched
both compiled entries byte for byte. The figures were visually checked.

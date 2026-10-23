# Easy calibration

Completed one candidate under the four-iteration ceiling, then stopped tuning
because the development estimate was already near 50. Original fixed anchors
were retained. No other difficulties were changed.

Baseline `d54ff1f`: 73 game tests and TypeScript passed; 500 development pairs
gave Easy index 2.540 and absolute target error 47.460. Candidate `99d161c`:
78 game tests and TypeScript passed; the same development cohort gave index
49.813, error 0.187. Kept the candidate's 70% basic card policy probability.

The final, independently pinned seed 20270221 and 2,000 pairs per version
produced 8,000 full matches. New Easy won 36.05% against Medium; original Easy
won 16.225%. Both sides had Medium partners. Paired gain: 19.825 percentage
points, pointwise 95% interval 18.55–21.075. Fixed-scale Easy index: 46.415,
approximate 95% model-conditional range 42.007–50.952. No validation retuning.

Promoted only Easy policy, its tests, the explicitly updated lower-tier
regression scope, and dedicated benchmark tooling. Primary checkout's 223 tests
and production build passed. The first full-test invocation could not use the
sandbox's default temporary directory; rerunning with workspace-local TEMP/TMP
passed. No primary Git staging/commits, pushes, deployments or messages.

Reproducible report: docs/benchmarks/easy-rebalance/README.md.

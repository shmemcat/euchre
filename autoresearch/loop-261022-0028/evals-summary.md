# Evaluation

- One iteration kept; zero discarded. Stopped early near the calibration target.
- Development target error: 47.460 → 0.187, a 99.61% reduction. This is calibration
  fit, not an estimate of game-strength improvement.
- Independent validation: Easy win rate 16.225% → 36.05% against the same Medium
  lineup, gain 19.825 percentage points. Whole-pair 95% interval: 18.55–21.075.
- Independent fixed-reference rating: 46.415, approximate 95% range 42.007–50.952.
- 78 isolated game tests plus TypeScript passed; 223 primary tests and build passed.
- Current scope is complete. Future tuning should use new validation seeds and
  preserve the original reference anchors rather than fitting to this cohort.

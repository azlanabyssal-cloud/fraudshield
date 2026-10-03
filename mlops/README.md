# Evaluation and release gate

```bash
npm run mlops:gate                         # report; fails only on a real FAIL
npm run mlops:gate:strict                  # also fails on NO_EVIDENCE / INCONCLUSIVE
node mlops/run.js --data <csv> --detector-file my_model.js --register   # candidate module: (text) => boolean
node mlops/run.js --data <dev.csv> --sealed <sealed.csv>               # also check for leakage
```

## What the gate says
| Status | Meaning |
|---|---|
| `NO_EVIDENCE` | dataset missing or below the stage minimum (S0: 200 rows). Nothing measured. |
| `PASS` | precision's 95% interval is above 0.90, p95 latency within budget, no leak, no significant regression |
| `INCONCLUSIVE` | nothing failed, but the interval still straddles the target. More rows are needed. |
| `FAIL` | precision interval below target, detector catches nothing, latency over budget, sealed rows leak from dev, or the candidate is significantly worse than the baseline (exact McNemar, p < 0.05) |

Thresholds live in `policy.json` and come from `docs/SPEC.md` section 5. Nothing else is invented.

## What is measured
Precision, recall and false-positive rate with Wilson intervals; slices by language, obfuscation and
category (cells under 30 rows are marked underpowered); precision at assumed scam prevalence
(conservative bounds); p95 latency; PSI of the category mix between the older and newer half of the data.
Latency is Node on the machine running it, not a phone.

## Status
- Tested: the statistics against hand-worked answers, every gate outcome, leakage, registry rules, the CLI.
  Each guard was broken on purpose once to prove a test fails.
- The registry (`registry.json`) is empty because no real dataset exists yet.
- `router_v0` is the shipped keyword router used as a classifier. It was built to route chat questions,
  so expect a weak first score. That score is the baseline to beat.
- Not done: no trained model, no on-device latency measurement, no end-to-end OCR path.

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

## Proxy benchmark (UCI SMS Spam)
```bash
node mlops/benchmarks/run_sms.js     # fetches and hash-verifies the data on first run, writes results/uci_sms_spam.json
```
**Not a FraudShield result.** English SMS spam from about 2011. It exists to prove the pipeline on real data, and a test
blocks its numbers from appearing in product copy. The raw file (real phone numbers, real people's texts) is gitignored.

Measured on this data (seed `fs-sms-v1`; intervals are 95% Wilson):
| | precision | recall |
|---|---|---|
| word-weight model, test split (look 2, 119 spam) | 89.7% [83.1-93.9] | 95.0% [89.4-97.7] |
| same recipe, 5-fold cross-validation on train+val (about 500 spam) | 94.0% [91.6-95.8] | 94.8% [92.4-96.4] |
| shipped keyword router (`router_v0`) on the test split | flags none | 0.0% [0.0-3.1] |
| naive random split, same recipe | 97.1% (inflated) | 95.1% |

How to read it: the test split is the noisier estimate, so the cross-validated 94% is the better guide. The naive
split overstates precision by 7.4 points because 10.7% of its test rows also appear in training. Precision is
conservatively 69-81% if only 5% of checked messages are scams, so the right operating point is a product decision;
the results file lists every configuration with precision at 5% and 20% scam share.

Protocol, in order: group duplicates into one split; choose the configuration by grouped cross-validation on
train+val only; set the threshold on validation; remove near-duplicates of training rows from the test split; read
the test split. It was read twice, and both reads are disclosed in the results file. Hyperparameters are fixed
defaults. Model size budget 250 KB is a proposal fixed before any comparison.

Tested offline on synthetic data: the zip reader, both trainers, threshold and winner selection, split grouping,
leakage removal, the size budget, and that flipping every test label changes nothing upstream. Each guard was broken
on purpose once and the suite failed (two weak guards were found this way and strengthened).

Not done: no Hindi or Hinglish data, no UPI/KYC/digital-arrest messages, no on-device latency, no OCR path.


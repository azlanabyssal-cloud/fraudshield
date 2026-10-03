# Evaluation and release gate

```bash
npm run mlops:gate                          # evaluate the dataset; exit 1 on FAIL or no evidence
npm run mlops:gate:strict                   # also exit 1 when a pass is INCONCLUSIVE (not proven)
node mlops/run.js --data <csv> --detector-file my_model.js --register   # candidate module: (text) => boolean
node mlops/run.js --data <dev.csv> --sealed <sealed.csv>                # also check for leakage
```
Every path can be a flag or an environment variable (`FS_DATA`, `FS_SEALED`, `FS_POLICY`, `FS_REGISTRY`); the benchmark
uses `FS_BENCH_DATA` and `FS_BENCH_RESULTS`. Tests run against temporary paths and fail if they touch the real registry.

## What the gate says
| Status | Exit | Meaning |
|---|---|---|
| `NO_EVIDENCE` | 1 | dataset missing or below the stage minimum (S0: 200 rows). Nothing measured. |
| `FAIL` | 1 | adjusted precision below 0.90, the model flags nothing or catches no scam, p95 latency over 50 ms, sealed rows leak from dev, or the candidate is significantly worse than the baseline (exact McNemar, p < 0.05) |
| `INCONCLUSIVE` | 0 (1 with `--strict`) | the measured adjusted precision reaches the target but the 95% worst case does not; the message says how many genuine messages are missing |
| `PASS` | 0 | even the worst case clears 0.90, latency in budget, no leak, no significant regression |

Precision is **prevalence-adjusted** to 1% scam share: `recall*p / (recall*p + falseAlarmRate*(1-p))`. Raw precision on a test set is
printed but never decides. A model that flags nothing has precision 0/0, defined as 0 (never 1), and fails with
"Model Flags Nothing". At 1%, a PASS needs a false-alarm rate near 0.1%: about 3,600 genuine messages with no false alarms.

Thresholds live in `policy.json` (sources: `docs/SPEC.md` section 5 and ADR-0010). Nothing else is invented.

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

**Against the gate (1% scam share, target 0.90): FAIL.** Prevalence-adjusted precision on the test split is 43.2% (worst case 29.6%);
it is 80% at 5% scam share and 95% at 20%. Within the 250 KB budget the best cross-validated configuration reaches 85% at 1%;
the character n-gram models reach 94% at 1% with 80% recall but exceed the budget.

How to read it: the test split is the noisier estimate, so the cross-validated 94% raw precision is the better guide. The naive
split reports 97.1% precision because 10.7% of its test rows also appear in training; the grouped estimates are 94.0% (cross-validation) and 89.7% (test split, interval ±5 points), so the inflation is a few points and its exact size is uncertain. Raw precision on a dataset that is
13% spam says little about real use, which is why the gate adjusts it.

Protocol, in order: group duplicates into one split; choose the configuration by grouped cross-validation on
train+val only; set the threshold on validation; remove near-duplicates of training rows from the test split; read
the test split. It was read twice, and both reads are disclosed in the results file. Hyperparameters are fixed
defaults. Model size budget 250 KB is a proposal fixed before any comparison.

Tested offline on synthetic data: the zip reader, both trainers, threshold and winner selection, split grouping,
leakage removal, the size budget, and that flipping every test label changes nothing upstream. Each guard was broken
on purpose once and the suite failed (two weak guards were found this way and strengthened).

Not tested offline: `run_sms.js` itself (it needs the network); its parts are all tested.
Not done: no Hindi or Hinglish data, no UPI/KYC/digital-arrest messages, no on-device latency, no OCR path.

## External validation (Mendeley SMS Phishing)
```bash
node mlops/benchmarks/run_external.js   # downloads both datasets on first run, verifies publisher/pinned hashes
```
Question: does a detector hold up on a corpus it was not built on? Protocol, fixed before any result: positives are
"smishing", negatives "ham"; marketing "spam" is excluded (the SOP says honest marketing is not a scam); texts that
appear with conflicting labels are dropped; the **independent slice** removes every exact or near duplicate of the UCI
corpus (the Mendeley set is largely a relabelled copy of UCI: 4,549 exact and 120 near duplicates were removed);
detectors are fixed in advance, never tuned on this data, and individual failures are not inspected.

Result on the independent slice (153 smishing, 436 genuine): the shipped router catches none, the strict link checker
catches 3.3%, the word-weight model flags all of them with 2.5% false alarms, which fails the 1% gate (28.6% adjusted precision).
`shortcutCheck` compares against message length alone (AUC 0.884 vs the model's 0.998): the slice is easy because the
classes differ in style, so treat the model's 100% as weak evidence. Hard negatives (long genuine bank alerts) are the
missing piece, and only real S0 data will contain them.


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
catches 0.7% (only 39.2% of those messages contain a link at all; ADR-0012), the word-weight model flags all of them with 2.5% false alarms, which fails the 1% gate (28.6% adjusted precision).
`shortcutCheck` compares against message length alone (AUC 0.884 vs the model's 0.998): the slice is easy because the
classes differ in style, so treat the model's 100% as weak evidence. Hard negatives (long genuine bank alerts) are the
missing piece, and only real S0 data will contain them.


## Lineage and reproducibility (the shipped domain-name model)
```bash
npm run model:lineage:check   # fast; runs in CI and in `npm run check`: exit 1 if anything no longer matches the record
npm run model:reproduce       # retrains from the pinned public data, exit 1 unless the model file is byte-for-byte the shipped one
git checkout <commit> && npm run model:reproduce   # restores and proves a model from any past commit
```
`mlops/lineage.json` ties one model file to everything it came from: its SHA-256 and size, the pinned digests of both datasets, the trainer's
files, a fingerprint of the feature code, the hyper-parameters, the one-shot test result, and a reproduction proof (date, hash, seconds). The check
fails, naming the broken link, when: the model file is not the recorded one; the evaluation scored a different file; the trainer changed since
the record; the feature code computes different numbers from the ones the weights were trained on (train/serve skew, which crashes nothing and
silently degrades every verdict); a weight is no longer an int8; or the reproduction proof is for a different model. Each of those is broken on
purpose in `tests/lineage.test.js`; one test failure found a real gap on the first run (a new keyword the probe names did not contain slipped past a
behaviour-only fingerprint), so the keyword and brand lists are hashed too.

Measured: retraining from the pinned data takes 16 s and gives the shipped file exactly (SHA-256 `bf96eb26eca8…`), including after unrelated edits to
`lib/urlmodel.js`. A rollback is a revert of `data/urlmodel.json` and `mlops/lineage.json`; the site is static, so redeploying is the rollout.
`.github/workflows/reproduce.yml` repeats the retraining on demand and monthly on a clean machine.

### What is deliberately not here
- **A blocking gate in CI today.** The SPEC section 5 gate (adjusted precision at least 0.90, exact McNemar against the baseline, Wilson intervals, latency, leakage)
  is built and tested, and exits 1 on `FAIL` and on `NO_EVIDENCE`. With no real message set it can only say `NO_EVIDENCE`, so a blocking job would stop every deploy,
  including a typo fix, while measuring nothing. It runs as its own visible job and becomes blocking by deleting one line once the S0 set exists.
- **DVC.** The training data is two public corpora, pinned by SHA-256 in `mlops/urlmodel/data.js`, downloaded and verified on demand, never committed. That is the same content-addressing a
  data-versioning tool provides, without a remote to run, and `model:reproduce` proves it works. DVC earns its place for the private S0 messages, which cannot live in git: use a private remote then.
- **ONNX and a runtime.** The model is a 127 KB linear model whose 14,602 weights are all int8 (4x smaller than float32). A WebAssembly runtime would be tens of times larger than the model it runs
  (ADR-0010). A model that needs one is a different decision, made when the S0 data shows a simple model is not enough.
- **Telemetry from the browser.** See ADR-0018.

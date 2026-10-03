# Decision log

Rewrite each entry in your own words before you show this to anyone. You should be able to defend
every line without help. Format: context, decision, consequences, and what would change my mind.

## ADR-0001: Position as recovery and verification, not detection
Context: Truecaller launched a free web/Android Scam Checker for numbers, links and messages in
India; Airtel and Google add spam filtering to RCS; Pixel has on-device scam detection. They have
larger report data and, on-device, can intercept messages. A web page cannot.
Decision: lead with the recovery path and claim verification. Detection is a supporting feature.
Consequences: the README must not claim better detection. Success is measured on the whole flow.
Revisit if: a regulator or platform ships a free, India-specific recovery assistant.

## ADR-0002: Evaluate before building the model
Context: we have no labeled data and no baseline number.
Decision: build the data contract and gates first; score the existing rules as baseline #0.
Consequences: slower to a demo, honest results. Revisit if: never.

## ADR-0003: Remove voice input from V1
Context: Chrome streams speech-recognition audio to Google; cloud TTS voices send text to a server.
Decision: voice input behind a flag, off. Spoken replies use on-device voices only.
Consequences: a feature the owner wanted is deferred. Revisit when a consent step exists (V1.5).

## ADR-0004: On-device inference, no server in V1
Context: privacy promise, offline use, zero running cost, no cold starts.
Decision: score on the device. A hashed char n-gram linear model is a sparse dot product in plain
JS with a Python/JS parity test; ONNX Runtime Web only if a model needs it.
Consequences: no live monitoring in V1. Revisit if: opt-in telemetry is added with consent.

## ADR-0005: PostgreSQL for the label store only; skip Kafka/Kubernetes/Feast/Terraform
Context: the golden holdout needs two labelers who must not see each other's labels, an audit trail,
and a measurable agreement score. A CSV cannot enforce any of that.
Decision: `db/schema.sql` holds the label store. Row-level security makes labeling blind, labels are
append-only, PII and dedup are CHECK/unique constraints, Cohen's kappa is a SQL function, and
`export_rows()` produces the CSV the validator already accepts. Tests run it on real PostgreSQL
(PGlite, WASM) and compare the SQL PII rules against the JS rules on one corpus.
Still rejected: Kafka, Kubernetes, Feast/Redis, Terraform. There is no event stream, no fleet and no
online feature store; inference happens on the device (ADR-0004).
Consequences: one devDependency; CI needs `npm ci`. The schema is not run against a production server
yet (see db/README.md). Revisit if labeling moves to more than a handful of people.

## ADR-0006: Staged gates (200 real rows, then 1,000)
Context: golden sets of 50-200 are common practice for regression gating; collection is the
bottleneck for a solo developer.
Decision: S0 regression set at 200 rows gates CI; S1 sealed holdout at 1,000 follows.
Consequences: S0 is inspectable, S1 is not. Intervals are wide at 200 and must be reported.

## ADR-0007: Never output "safe"
Context: a false "safe" is the most expensive error.
Decision: best verdict wording is "no known red flags found"; a test blocks "safe"-style claims.
Consequences: less satisfying UI copy, lower liability.

## ADR-0008: MLOps is an evaluation and release loop, not a serving stack
Context: a proposed architecture (edge gateway, Kafka, Redis cluster, GPU inference cluster, vector
database) was reviewed. Every box needs a server; FraudShield scores messages on the device so they
never leave it (ADR-0004), and it has no traffic, no model and no dataset that would justify any of them.
Decision: build the parts of MLOps that apply at this scale and can be tested: a versioned dataset,
a validated schema, an evaluation harness with 95% intervals and slices, paired comparison against a
baseline, a leakage check between dev and sealed sets, a three-valued release gate (PASS / INCONCLUSIVE /
FAIL, plus NO_EVIDENCE when data is missing), a registry that records code hash, data hash and metrics, and a
drift measure (PSI) on the data mix. Thresholds come only from SPEC section 5.
Consequences: today the gate reports NO_EVIDENCE and exits 1, which is the true state. Nothing is "improved" until
S0 exists; the harness makes the first real number checkable. Revisit serving infrastructure only if
a server-side feature (for example opt-in reporting) is added with consent.

## ADR-0009: A proxy benchmark to prove the pipeline, with the operating point left as a product decision
Context: no FraudShield dataset exists yet, and a model score on invented messages would be fiction.
Decision: run the evaluation pipeline on one public, hash-pinned dataset (UCI SMS Spam, CC BY 4.0), labelled a
proxy and blocked from product copy (CLAIMS C-16). Protocol: duplicates grouped into one split, configuration chosen
by cross-validation on train+val only, threshold set on validation, near-duplicates of training rows removed from
the test split, test split read twice and both reads disclosed in the results file. The shipped candidate is a
40 KB word-weight model, with no runtime library.
Findings (all measured): 10.7% of a naive random split's test rows also appeared in training, and it reported 97.1% precision against 94.0%
cross-validated and 89.7% on the grouped test split (the test split's interval is about ±5 points, so the size of
the inflation is a few points, not a precise figure); the shipped keyword router caught 0 of 119 spam messages; and under ADR-0010's 1% prevalence rule the
benchmark model fails the gate (adjusted precision 43.2%, worst case 29.6%, against 0.90). The cross-validation table
lists every configuration at 1%, 5% and 20% scam share. The best configuration inside the 250 KB budget reaches 85% at 1%;
the character n-gram models reach 94% at 1% with 80% recall but exceed the budget. Raising the budget after seeing
this would be a post-hoc change and would have to be disclosed as one.
Consequences: the benchmark proves the machinery, not the product. First real number: S0.

## ADR-0010: Prevalence-adjusted gate, loud failure, injectable paths; ONNX Runtime declined
Context: the owner set rules for the pipeline: adjust precision to 1% scam prevalence, Wilson intervals, exact McNemar, PSI,
define 0/0 precision as 0 and fail it, exit 1 on missing data, p95 latency under 50 ms excluding cold start, every path
injectable, tests never touching the real registry, and ONNX Runtime Web for inference.
Decision: adopted except the last. Raw precision is reported but never gates; the gate uses adjusted precision (point estimate
decides FAIL, the 95% worst case decides PASS, in between is INCONCLUSIVE and says how many genuine messages are missing).
Paths come from flags or FS_DATA, FS_SEALED, FS_POLICY, FS_REGISTRY, FS_BENCH_DATA, FS_BENCH_RESULTS. A test fails if any
test writes to the real registry or results file. In Node, `process.exit(1)` and uncaught exceptions give the non-zero exit.
Declined: ONNX Runtime Web. The shipped model is a bias plus one weight per word, a 40 KB JSON object scored by a
dozen lines of JavaScript. A WASM runtime would add a dependency and a cold start to evaluate a sum. Revisit when a model
exists that is not linear and a measured gain justifies exporting it.
Consequences: at 1% prevalence PASS needs about 3,600 genuine messages with zero false alarms; S0 (about 50 genuine) and the
planned S1 (about 250) can reach at best INCONCLUSIVE. Open decision for the owner: collect more genuine messages or justify
a higher assumed prevalence (people who check a message are likely above 1%, which makes 1% conservative, not measured).
CI runs the gate as a separate non-blocking job until S0 exists.

## ADR-0011: External validation, with the shortcut check as a first-class output
Context: a score on one corpus says little about a different one, and one public set (Mendeley) turned out to be mostly
a relabelled copy of another (UCI), so a naive "second dataset" would have been contaminated.
Decision: evaluate on an independent slice (exact and near duplicates of the reference corpus removed), report the
contaminated set beside it, and always report a trivial-baseline AUC (message length) next to the model's.
Findings (measured, proxy data): the shipped router catches none of 153 independent real smishing messages and the strict link
checker 3.3%; the word-weight model flags all of them with 2.5% false alarms (gate fails at 1% prevalence); length alone
reaches AUC 0.884, so the slice is easy and the model's recall is weak evidence.
Consequences: the evidence points at the router and link checker as the product's weak parts, but only S0, with long genuine
bank alerts as hard negatives, can justify changing them. Nothing was tuned on this data.


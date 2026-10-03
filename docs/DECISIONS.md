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

# FraudShield V1: Product Spec

Status: draft. Numbers marked (proposal) are targets to confirm or change, not measurements.
Last updated: 2026-10-03.

## 1. Problem
A person in India receives a message or call that might be a scam, or has already lost money. They
need to know what to do in the next few minutes. Detection alone is becoming a commodity: telecoms,
phone makers and Truecaller ship it (see ADR-0001). What is still poorly served is the **recovery
path** (what to say to the bank, how to reach 1930, how to report) and **verifying a claim**
("is this really the CBI / RBI / my bank?").

## 2. Who it is for
Adults who use UPI and WhatsApp daily but have never heard of cybercrime.gov.in or 1930, and the
relatives who help them. English and Hindi. Mobile-first, works on a slow connection, works offline.

## 3. V1 scope (frozen)
In: paste text or a screenshot (read on-device), check a link, get a verdict with the reasons, get
the next steps (1930, bank wording, pre-filled report), static fraud-data pages.
Out: voice input, accounts, any server, any telemetry, other languages, deep learning, new pages.

## 4. The decision the user makes, and the cost of being wrong
The user decides: ignore / be careful / act now.
- **False "no red flags"**: the user relaxes and loses money. Most expensive error.
- **False alarm**: the user wastes some minutes and may distrust the tool. Cheaper, but not free:
  a tool that flags every bank SMS gets uninstalled.
So recall on scams matters more, but not at any price. Hard-negative (genuine) messages are
collected on purpose to keep false alarms measurable.

Wording rule: the product never says "safe". The best verdict is "no known red flags found".
Enforced by a test (tests/invariants.test.js).

## 5. Metrics (proposal)
- Primary: recall on scams at precision >= 0.90, on the real regression set (stage S0) and later the
  sealed holdout (stage S1), reported with bootstrap intervals and at assumed base rates.
- Secondary: per-category and per-language slices (indicative only below ~50 rows per cell),
  obfuscated-text slice, end-to-end through OCR.
- Budgets: p95 on-device latency < 50 ms for text scoring (proposal); model + bundle size limits set
  once a model exists.

## 6. Evaluation stages
- **S0 (regression set):** >= 200 real, scrubbed rows. May be inspected for failure analysis.
  Gates CI changes.
- **S1 (sealed holdout):** >= 1,000 rows, never inspected, time-split newer than training.
- Second labeler independently labels 100 rows before any S1 claim.

## 7. Kill criteria (written in advance)
- If S0 (200 real rows) does not exist by **2026-11-07 (proposal)**: ship rules + recovery product,
  drop the ML track, and say so.
- If a trained model does not beat the rules on S0 by a margin that justifies its size and latency:
  ship the rules. A documented null result is acceptable.
- If legal review says collecting from others is not allowed as designed: collect only from own
  messages and public advisories and shrink the targets honestly.

## 8. Non-goals (and why)
Kafka, Kubernetes, Feast/Redis, Terraform, Postgres: no workload or team that needs them (ADR-0004,
ADR-0005). Deep learning: only after a cheap probe shows a gain. Voice: breaks the privacy promise
(ADR-0003). Beating Truecaller on detection: not a credible claim.

## 9. Privacy invariants (tested)
No third-party scripts except an allow-list; OCR bundled locally; spoken replies use on-device voices
only; no network request carries user text. If any of these changes, the copy changes first.

## 10. Risks
No real data yet. Single developer. Scam style is shifting toward fluent, personalised text, so
style cues decay; the model should lean on the *ask* (secret, payment, authority, urgency).

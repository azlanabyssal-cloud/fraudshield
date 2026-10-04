# Observability, on the device

A tool that cannot say how it is behaving has no evidence that it works. A tool that sends what people paste into it to a server to find out is not private. FraudShield takes the second constraint as fixed (the browser
enforces it, ADR-0015) and builds the first inside it: the page keeps a small record of what it did, reads it back on screen, and lets the person copy it. Nothing is transmitted. The reasoning, and what was refused, is in
ADR-0018 (no telemetry) and ADR-0022 (this design).

## What it records

One event per verdict, per picture read, per follow-up question, per model failure and per error. An event can hold only these fields, copied by name; everything else in the object it is given is dropped.

| Field | Values | Why |
|---|---|---|
| `t` | the time, rounded down to the minute | when, without a fingerprint |
| `kind` | message, link, qr, ocr, followup, voice, error, model | what happened |
| `level` | scam, suspicious, unverified, official, nothing | the verdict |
| `family` | a scam family the message check names (kyc, otp, arrest, ...) | which kind of scam |
| `rules` | up to 12 rule or link-code ids that fired | which rules do the work, which never fire |
| `ms` | milliseconds the check took | the speed target |
| `nameModel` | applied, not-loaded, not-applicable | whether the domain-name check took part |
| `topic` | the kind of follow-up question | what people ask next |
| `code` | a fixed error or model-failure code | what went wrong |
| `hot` | whether the OCR worker was already running | warm-start rate |

Free text cannot get in. Each slug must be a short lower-case word; and where the tool knows its own vocabulary (its families, rule ids, link codes, topics, error codes) anything outside it is stored as `other`. The buffer holds the last 300 events in
sessionStorage and ends with the tab.

## What it reports

On the Assistant page, under the chat: **How this tool is doing on this device**: checks this session and the share flagged, results by level, kinds of scam named, the rules that fired most, median and slowest check, the speed target
against its 50 ms budget (met, breached, or not enough checks yet), whether the domain-name check loaded, how the picture reader is doing (reads, median time, share on a warm worker), follow-up questions answered, and errors. "Copy this summary"
puts the same numbers on the clipboard as JSON ([schema 1](../lib/ops.js)). "Erase everything this tool stored on this device" clears the chat, the memory, the buffer and the voice choice.

Example of what is copied (counts and timings only):

```json
{ "schema": 1, "since": "2026-10-04T10:07Z", "verdicts": 6, "flaggedShare": 0.5,
  "byLevel": { "scam": 3, "nothing": 3 }, "byFamily": { "kyc": 3 }, "topRules": [{ "rule": "kyc", "count": 3 }, { "rule": "threat", "count": 3 }],
  "latencyMs": { "samples": 6, "p50": 0.4, "p95": 0.8, "p99": 0.8, "max": 0.8 }, "slo": { "p95BudgetMs": 50, "status": "met", "samples": 6 },
  "nameModel": { "applied": 2 }, "ocr": { "runs": 0, "hotShare": null, "p50Ms": null }, "errors": {} }
```

## Service levels

| Objective | Target | How it is watched |
|---|---|---|
| Verdict latency | p95 under 50 ms (SPEC section 5), first verdict after load included | the panel (per session); `npm run bench:latency` (real Chrome, full speed and CPU slowed 6x); measured p95 0.2 ms and 1.5 ms, first verdict 1.7 ms and 3.5 ms (BENCHMARKS) |
| Link-check model available | loaded on every page view | `data-name-model` on the document, `fs:model` event, the panel, and a warning inside every verdict that needed it |
| Policy holds | no violations, every attack refused | `npm run audit:pages` |
| Model reproducible | byte-identical retrain | `npm run model:lineage:check` on every push, `model:reproduce` monthly |

The first-verdict target exists because of a finding: the diagnostics panel showed the first check after a page load taking about 25 ms (52 ms with the CPU slowed 6x, over budget), because the lexicon had to be compiled on first use. The page now does that work
in small slices while idle, after load; the same first verdict then takes 1.7 ms (3.5 ms slowed). A message sent in the first moments after load, before the idle slices have run, still pays the old cost.

## What it deliberately does not do

- It does not send anything. A fleet-wide view (how many verdicts across all users, population drift, false-alarm rate in the field) would need telemetry, and the reasons it was refused are in ADR-0018: it would break the promise the policy enforces,
  a score with a time and an address is not anonymous, and at this traffic a drift statistic would mean nothing.
- It cannot measure its own accuracy: it never learns whether a verdict was right. That needs labelled messages, which is the S0 set the release gate is waiting for (`mlops/`).
- How to learn from real use without telemetry: people who choose to can copy the summary and send it; volunteers donate labelled messages through `data_ops/`. If automatic aggregation is ever wanted it must be opt-in, counts only, sent by an explicit
  tap, with the policy change and the wording shipped in the same commit.

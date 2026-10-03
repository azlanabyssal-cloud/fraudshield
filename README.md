# FraudShield

**Recovery-first digital fraud help for Indian families, and the evaluation engineering to measure it honestly.**

[![CI](https://github.com/azlanabyssal-cloud/fraudshield/actions/workflows/ci.yml/badge.svg)](https://github.com/azlanabyssal-cloud/fraudshield/actions/workflows/ci.yml)
Live: [azlanabyssal-cloud.github.io/fraudshield](https://azlanabyssal-cloud.github.io/fraudshield/) · Helpline: **1930** (free, 24×7)

Community service project by Azlan, second-year BTech student. Not monetised: no accounts, no analytics, no backend of its own.

---

## Why this exists

My uncle got a call last year. Someone said they were from CBI. They said his Aadhaar was linked to a drug case. They kept him on video call for six hours. He transferred ₹3.4 lakh before my cousin stopped him.

He is a retired government employee. Educated. Careful. It still happened to him.

The problem is not intelligence, it is information. That information is on government websites, but it is buried in PDFs and written in legal language. FraudShield puts the first-hour recovery steps, the 1930 helpline and plain-language scam patterns in front of people who use UPI and WhatsApp every day but have never heard of cybercrime.gov.in.

If someone calls 1930 in time because of this website, that is the whole point.

---

## What you can do on the site

- **Ask the assistant** (floating widget on every page, or the Assistant page) in English or Hindi: paste a message, describe what happened, or say "money left my account". It walks you through next steps. It runs in the browser; your messages are not sent anywhere.
- **Paste a message or share a screenshot of one.** It names the scam it resembles, quotes the exact words that gave it away, and says what to do next. It never says a message is genuine, only that it found no known pattern. "Do not share your OTP" is never flagged; "share your OTP" is.
- **Check a link or a QR code.** Verdicts are *scam*, *suspicious*, *unverified* and *official*, and "scam" is given only on specific evidence: a hidden destination (`user@host`), an official name hijacked inside another domain, a lookalike or homoglyph bank name with pressure words, a raw IP, an app-file download, a "scan to receive" UPI pretext. An address nobody can vouch for is *unverified*, never "fine". It never says "safe", and tests enforce that. QR codes are decoded in the browser (jsQR, vendored) and a UPI QR always states that scanning only ever sends money out.
- **Read a screenshot offline.** Text is extracted in the browser with a bundled OCR engine (English and Hindi).
- **Learn the patterns:** digital arrest, UPI and QR tricks, OTP and KYC scams, investment groups, sextortion, loan apps, with the first 60 minutes after a fraud laid out step by step.
- Installable as an app (PWA), built for flaky connections. Offline behaviour has not yet been verified on real phones.

Six characters (Kavach, Dost, Chetavani, Sankhya, Thag, Umeed) speak in their sections using the browser's own voices. They have Hindi and English names because the audience does.

---

## What it does not claim

FraudShield does **not** claim a detection accuracy. The assistant is rule-based (a keyword router plus the message check), and its quality on real Indian scam messages has not been measured, because the real labelled dataset does not exist yet. The numbers below are about the evaluation pipeline, not the product. See [Measured so far](#measured-so-far).

---

## Engineering

| Part | Where | Evidence |
|---|---|---|
| On-device core: intent routing, text normaliser that sees through `K Y C`, `p@nding`, lookalike letters | `lib/core.js` | shared by browser and Node; unit and seeded property tests |
| Message check: scam family, quoted evidence, negation guard, score thresholds | `lib/msgcheck.js` | hand-written scam and genuine tables in English, Hinglish and Hindi, properties (appending text never lowers the score), mutation-checked |
| Link and QR analyzer: evidence-based levels, punycode and homoglyph decoding, UPI payload rules, QR reading | `lib/linkcheck.js`, `lib/qr.js` | fuzzed for totality, punycode checked against Node, QR codes from an independent encoder damaged six ways, pinned decoder hash |
| Evaluation harness and release gate: Wilson intervals, exact McNemar, PSI, precision adjusted to a 1% scam rate, fail-loud exit codes, registry, leakage check | `mlops/` | known-answer maths, every gate outcome tested, injectable paths |
| Label store: PostgreSQL schema for blind double-labelling (row-level security), PII and duplicate constraints, Cohen's kappa in SQL | `db/` | run on real PostgreSQL (WASM) in tests; SQL and JS PII rules checked against one corpus |
| Data collection: offline scrubber and guided add-message tool, validator, labelling SOP | `data_ops/` | property-tested; the scrubber never changes anything except personal tokens |
| Claims register: every number, date and legal section with its source, and the wording that was removed | `docs/CLAIMS.md` | tests block the removed wording |
| Decisions: ten ADRs, including what was rejected and why | `docs/DECISIONS.md` | |

CI runs the linter and the full suite on every push: unit and property tests, a DOM smoke test that loads every page and runs its real scripts, HTML structure checks, and site-integrity tests that fail if a page disagrees with the sourced data file or a statistic is typed by hand. Guards were broken on purpose to prove a test fails (mutation checks), and the weak ones found that way were fixed.

**Deliberately not built:** Kafka, Kubernetes, a model-serving cluster, a vector database. Messages are scored on the device so they never leave it, and there is no traffic or model that would justify any of those. The shipped scoring is a small set of rules and, for experiments, a 40 KB word-weight model; ONNX Runtime was considered and declined (ADR-0010).

---

## Measured so far

**Proxy benchmarks, not FraudShield:** two public English SMS datasets (UCI SMS Spam, about 2011; Mendeley SMS Phishing), used only to prove the pipeline on real data. A test blocks these numbers from appearing anywhere on the site.

| | result |
|---|---|
| Naive random split vs. grouped split | 10.7% of the naive split's test rows were also in training. It reported 97.1% precision; the grouped, de-duplicated evaluation gave 94.0% (cross-validation) and 89.7% (test split, wide interval). The true gap is a few points, and the leak is real. |
| Small word-weight model, held-out test, 95% intervals | precision 89.7% [83.1–93.9], recall 95.0% [89.4–97.7] |
| Same model against the project's 1% scam-rate gate | **fails**: adjusted precision 43.2% against a 90% target |
| **Shipped keyword router on real smishing it was never built on** (153 independent messages) | **caught none: recall 0.0% [0.0–2.4]** |
| Domain-name model, 40,449 held-out domains (lexical only, scheme and path removed; ADR-0014) | AUC 0.768 [0.761–0.775]. Strict setting: catches 13.8% of phishing domains with 0.12% false alarms. Shipped as a hint that can only raise "unverified" to "suspicious". A public dataset's near-100% scores come from artifacts, not skill |
| Message check on the same messages (rules written before, not tuned after) | flags 19.6% [14.1–26.6] at "suspicious" or above, with 0.5% [0.1–1.7] false alarms; at "scam" only, recall 7.2% [4.1–12.4] and no false alarms in 436. Weak: the slice is English and the rules target Indian scam families |
| Link analyzer on the same messages (not tuned on them) | only 39.2% of the smishing messages contain a link at all, which caps any link checker. Strict "scam" verdict: recall 0.7% [0.1–3.6], false alarms 0.0% [0.0–0.9]. A link with no evidence is "unverified", by design |
| The word-weight model on the same slice | recall 100% [97.6–100], false alarms 2.5% [1.4–4.5], adjusted precision 28.6%: fails the gate |

**Read the last row with suspicion.** On that slice smishing is long (median 139 characters) and genuine texts are short (median 51), so message length alone scores an AUC of 0.884; the model scores 0.998. The slice has no hard negatives such as long genuine bank alerts, so it proves less than it looks. Texts that duplicate the UCI data (4,549 exact, 120 near) were removed first, and the same model scores a similar 99.5% recall on the contaminated set, so contamination was not the main driver here.

**The release gate currently reports `NO_EVIDENCE` and exits 1**, because the real regression set does not exist yet. At a 1% scam rate, proving 90% precision needs about 3,600 genuine messages with no false alarms, which is an open decision for the dataset plan (ADR-0010). Details, protocol and limits: [`mlops/README.md`](mlops/README.md).

---

## Status and next step

1. Collect 200 real, scrubbed messages (stage S0) with `npm run data:add`, deadline **2026-11-07**. If that does not happen, the project ships the rules and the recovery content and drops the ML track, and says so.
2. Run the gate on S0 for the first real number. Fix the detector only against that set.
3. Known gaps: the keyword router misses several scam families (prize/lottery, parcel and customs, card-block, earn-daily tasks) and has no "looks genuine" outcome; offline mode and OCR are untested on real devices; parts of `tips.html` and some breakdowns on `data.html` are not yet source-audited (tracked in `docs/CLAIMS.md`).
   Pages load fonts from Google Fonts, so Google sees each visitor's IP address; self-hosting the fonts would remove that and has not been done yet.

---

## Run it

```bash
npm ci
npm run lint              # ESLint, zero warnings allowed
npm test                  # unit, property, DOM smoke, HTML and site-integrity tests
npm run site:sync         # regenerate pages from data/stats.json after changing a figure
npm run mlops:gate        # evaluation gate on data_ops/golden_holdout.csv
npm run data:add          # add one real message, scrubbed offline
node mlops/benchmarks/run_sms.js   # proxy benchmark (downloads and hash-checks the public dataset)
```

The site is static HTML, CSS and vanilla JavaScript; open `index.html` or serve the folder. Runtime has no dependencies except a bundled OCR engine. The one dev dependency (an in-process PostgreSQL) is for tests.

---

## Sources and honesty

Figures on the site cite official publications (I4C, RBI, PIB, NPCI, MHA, DoT, NCRB) where one exists, and `docs/CLAIMS.md` records each claim with its source and status. Legal sections taken from secondary sources are marked as such. The Mann Ki Baat quotation is a translation of a Hindi broadcast. Figures that could not be sourced were removed or reworded; anything still unverified is listed there.

| Helpline | Number |
|---|---|
| National Cyber Crime | **1930** (free, 24×7) |
| Police | **112** |
| Women Safety | **181** |
| Online reporting | cybercrime.gov.in |

---

**Azlan** · Second-year BTech student · GitHub: [azlanabyssal-cloud](https://github.com/azlanabyssal-cloud)

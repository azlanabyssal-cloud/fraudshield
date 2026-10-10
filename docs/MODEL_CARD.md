# Model card: the domain-name hint model and the rule engine

This card follows the usual headings. It restates no number: every figure lives in one place that a test checks (`mlops/lineage.json`, `docs/BENCHMARKS.md`,
`mlops/benchmarks/results/`), so this page cannot drift from them.

## What it is
Two things are shipped and they are different:
1. **A rule engine** (`lib/core.js`, `lib/linkcheck.js`, `lib/msgcheck.js`, `lib/hinglish.js`) that checks a link, a UPI ID or a message and quotes the exact words or parts of the address that look like a scam. It is the product's judgement.
2. **A small name-only model** (`data/urlmodel.json`, trained by `mlops/urlmodel/train.js`) that reads only the registrable name of a link's host (never the path, the scheme or `www`) and can lift an otherwise unexplained address from "couldn't verify" to "suspicious". It cannot say "scam" and it never touches an official address.

## Intended use
Helping one person, on their own device, decide whether to trust a message, link or QR code before acting on it, and what to do next in India (the helpline 1930,
cybercrime.gov.in, their bank). It is a first-hour aid, not a decision-maker and not legal advice.

## Out of scope
Judging whether a phone number is genuine (it cannot be done from digits, and the assistant says so); proving a message safe (it never does); any use that sends a
person's messages elsewhere; use as a government or bank service.

## Training and evaluation data
The name model is trained from pinned public lists of phishing and benign domains. Their source, size, digest and the trainer's own hash are recorded in
`mlops/lineage.json` and re-verified by `npm run model:lineage:check`; `npm run model:reproduce` retrains and requires a byte-identical file. The rule engine has no
training data: it was built from the author's door-to-door fieldwork and public advisories, then attacked by a red-team pass (ADR-0019).

## Measured behaviour
See `docs/BENCHMARKS.md` and `mlops/lineage.json` for the evaluation of the name model, including the precision at the operating point that matters, the
false-alarm rate, and the check that the held-out split does not leak. Two honest caveats that those files repeat: the name model's evaluation set is public phishing
data, not messages Indian users receive, and the labelled messages from the field (stage S0) do not exist yet, so the release gate reports **no evidence** and
holds a release (ADR-0006, ADR-0010).

## Limits and failure modes
- It will miss scams that have no pattern the rules know; the answer is then weaker and says "I found nothing; that is not proof".
- It can raise a harmless unusual address to "suspicious"; the answer says why, and the hint is worded as a hint.
- Hindi, Hinglish and Telugu are handled by folding spellings and by hand-written lexicons, not by understanding; unusual phrasings fall through to "I don't have an answer for that".
- A picture is only as readable as it is clear; an unreadable QR code stops the assistant (ADR-0021).

## Ethical considerations
The people this is for are often frightened and in a hurry. That is why it never calls anything safe, quotes its evidence so it can be checked, keeps everything on
the device, and points to people and official routes instead of replacing them. It does not profile, rank or retain anyone.

## Updating
A change to the rules is a code change with tests; a change to the model is a retrain with a lineage record and a reviewed diff of the metrics; either goes out
through `release.yml`. Rollback is `docs/OPERATIONS.md`.

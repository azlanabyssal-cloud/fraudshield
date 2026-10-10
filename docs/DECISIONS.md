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
checker (the earlier, cruder version; see ADR-0012) 3.3%; the word-weight model flags all of them with 2.5% false alarms (gate fails at 1% prevalence); length alone
reaches AUC 0.884, so the slice is easy and the model's recall is weak evidence.
Consequences: the evidence points at the router and link checker as the product's weak parts, but only S0, with long genuine
bank alerts as hard negatives, can justify changing them. Nothing was tuned on this data.

## ADR-0012: The link and QR analyzer says "scam" only on evidence, and never says "safe"
Context: the request was that any phishing link or QR code a user sends must be called fake or a scam. A blanket "scam" on
every link would call genuine shops, colleges and government pages scams, and a checker that cries wolf on everything is
ignored the one time it is right. The opposite failure is worse: "safe" on an address nobody verified.
Decision: `lib/linkcheck.js` returns one of four levels. **scam** needs specific evidence: a hidden destination (`user@host`),
an official name hijacked inside another domain, a lookalike or homoglyph brand with pressure words, a raw IP, a code link,
an app-file download from a cheap domain, a "scan to receive" UPI pretext, an auto-debit request dressed as a refund.
**suspicious** is weak evidence only. **unverified** means nothing here proves it genuine or fake. **official** means the
address belongs to a known bank or government body, and its message still warns that a real address does not vouch for the
SMS that carried it. No level is ever "safe", and a fuzz test plus a DOM test enforce that. QR codes are decoded on the
device (jsQR 1.4.0, vendored, hash-pinned, loaded on first use) and the payload goes through the same analyzer; a UPI QR always
states the one fact that defeats the common fraud: scanning only ever sends money out.
Measured (proxy, English, not tuned on it): only 39.2% of the 153 independent real smishing messages contain a link at all, so
no link checker can exceed that recall. Its strict "scam" verdict catches 0.7% [0.1-3.6] with 0 false alarms on 436 genuine
messages [0.0-0.9]. The earlier checker's 3.3% came from calling an address dangerous on weak evidence, which is the behaviour
this ADR removes.
Consequences: a bare shortener or a random domain stays "unverified", because the address alone cannot prove it fake. Catching
message-level smishing needs the message text plus the link, which is the S0 dataset's job, not stronger link rules. A
domain-grouped URL model (PhiUSIIL) is not built; if it is, it may only raise a soft warning, never a "scam" verdict.

## ADR-0013: A message check that quotes its evidence, measured once and left alone
Context: the router that decides what the assistant answers was built to route chat questions, not to read messages, and it
caught 0 of 153 real smishing messages (ADR-0011). A person who pastes an SMS got almost nothing back, and a screenshot of
one was read by OCR and then ignored.
Decision: `lib/msgcheck.js` reads a pasted message or its OCR text and answers three things: which scam it resembles, the exact
words that gave it away, and what to do next. It is a rule list because every rule can then name the phrase it matched and be
argued with. Rules are grouped by what makes a scam work (asking for a secret, paying first to receive, staying on a call,
secrecy, impersonating an agency, installing an app, guaranteed returns, prizes, KYC and refund pretexts) and add up to
"suspicious" at 3 and "scam" at 5. Four design points matter more than the word lists: "do not share your OTP" must never be
flagged (a negation guard, property-tested); the one honest exception (a delivery partner at your door) excuses an OTP ask only in
the same sentence, because a property test showed a global exception could be bought by appending two words; a link inside the
message is judged by the link analyzer and outweighs the wording; and it never says "genuine", only "I found no known pattern".
Measured once, rules fixed beforehand, not tuned afterwards (proxy: English public corpus, not Indian messages):
independent slice, 153 smishing and 436 genuine. Flagging at "suspicious" or "scam": recall 19.6% [14.1-26.6], false alarms
0.5% [0.1-1.7] (first run; after ADR-0020 added Hindi, Hinglish and Telugu wording: 20.9% [15.2-28.0], false alarms unchanged at 0.5%). At "scam" only: recall 7.2% [4.1-12.4], 0 of 436 false alarms. The old router: 0.0%. On the full set of
4,833 genuine messages, 0.1% [0.0-0.2] were flagged.
Consequences: a real gain over the router, and still weak: four in five of these messages are missed. The slice is Western
smishing (parcel, bank, prize lures in English) and the rules were written for Indian scam families, so this number says little about
the target. Only the S0 set can: collect it, run the gate, then change rules against it. Until then no accuracy is claimed.

## ADR-0014: A name-only phishing model, shipped as a hint, and why it is not "100%"
Context: the request was a top-end ML model for phishing links. The public corpus used (PhiUSIIL, 235,795 addresses) is trivially separable:
every legitimate address in it is exactly "https://www.<host>" (100% https, 100% www, 0% with a path, query or trailing slash) while
phishing varies on all of those, and its famous ~100% scores rely on that or on page content that a privacy-first browser app must not fetch.
Decision: train on the only honest signal, the registered name and its ending, with scheme, "www", path and sub-domains removed;
exclude the 69 hosting platforms whose tenants have no legitimate examples in the data; add 98,267 ordinary domains from the Tranco
long tail so small honest sites are represented; split by owner-chosen name (so amazon.com and amazon.in never straddle the split);
choose everything on validation and score the test split once through the quantised deployed file; ship a logistic regression because a
boosted stack gained only 0.008 AUC and cannot be explained per n-gram. Used only as a hint: at its strict setting it can lift an
unexplained address to "suspicious", never to "scam".
Measured (proxy, 40,449 held-out domains): AUC 0.768 [0.761-0.775]; at the strict setting it catches 13.8% of phishing domains with
0.12% false alarms (precision 93% if 10% of checked links are phishing, 55% if 1%); name n-grams alone 0.695, engineered features 0.629,
the ending 0.692, name length 0.520. Rules alone flag 9.2% of held-out phishing domains and 0.04% of honest ones, 0 false "scam" verdicts
in 33,948; rules plus the hint flag 13.9% and 0.15%, with 0 false "scam" verdicts.
Rejected: the looser setting (on validation, 218 more phishing domains for 128 more honest ones flagged); a typosquatting-distance feature
(0.9% of phishing domains versus 0.76% of ordinary ones: no signal); a boosted model; 100% anything. A model near 100% here would mean a leak.
Found on the way: rules called 3 legitimate held-out domains "scam" (Amazon's regional sites, and ".care" counted as a pressure word) and
matched short brand names inside ordinary words ("trai" in "training"). Fixed on principle; the fix for those 3 was motivated by seeing the test
split, so the rule figures above are post-hoc for that defect. Training-split false "scam" fell from 4 to 0 and false "suspicious" from 336 to 70.
Consequences: most reported phishing hides behind ordinary-looking or compromised sites and free hosting, so a name cannot reveal it. Real gains
need the page, the registration date or the certificate, none of which a browser may fetch without sending the link to a server. Not claimable.

## ADR-0015: The page may only talk to itself (Content-Security-Policy), fonts self-hosted
Context: the product says "nothing leaves your device", and a code-review report pointed out that nothing enforced it: one compromised script, font or image host
could have sent a pasted message anywhere. Decision: one policy, from partials/csp.txt, written into every page by the build (`default-src 'self'`;
scripts from this site only, with no eval and no inline script; `connect-src 'self' data:` (a data: URL is local, and the text reader's WebAssembly core loads itself from one; found when a benchmark logged violations although OCR still worked through a fallback); frames, objects and forms locked; `wasm-unsafe-eval` only because
the text reader is WebAssembly). The home page's two inline scripts moved into home.js. The three Google fonts were copied onto the site (OFL, Latin and
Latin-extended, 208 KB), which removes the last third party that every visitor's address was sent to. Images may still come from images.unsplash.com until
the last stock photo is replaced; that is the only outside host, and a test fails if another appears.
Verified in a real browser (headless Chrome, all six pages): no violations, fonts and model load. Attacks tried against the live policy and refused: fetch,
XHR and sendBeacon to a foreign host, a foreign image, a foreign script, an iframe, an inline script, eval, new Function, a string timer. The text reader
still reads a 12 MP photo of an SMS under the policy.
Limits, stated plainly: a <meta> policy cannot carry frame-ancestors, report-uri or a report-only mode (browsers ignore them there), and GitHub Pages
cannot send headers, so clickjacking protection and violation reports need a host that can. `style-src` keeps 'unsafe-inline' because the animations
are driven by style attributes; stylesheets cannot run code, and image and font sources are locked so styles cannot send data out.

## ADR-0016: When the name model does not load, say so loudly and keep the rules running; do not lock the checker
Context: the report asked that a model that fails to load should disable the check button and fail fatally, because the app would "scan with a dead model and return
no known pattern". What was true: the download failure was swallowed in silence, and a damaged file would have been installed unchecked. What was not: the app never
returns "safe" or "no known pattern" (a link it cannot judge is "unverified: nothing here proves it is genuine or fake"), and the model is a hint that can only lift
"unverified" to "suspicious"; the written rules do the work.
Decision: validate the file before installing (shape, ranges, lengths; a refusal changes nothing), retry three times, then set data-name-model="failed" on the document,
raise an `fs:model` event, log an error, and add to every link verdict the model would have informed: "the domain-name check could not load on this device, so this result
uses the written rules only". The checker stays up. Rejected: locking it. The people with the flakiest connections are the people most likely to need the rules, and a
checker that switches off whenever a 15 KB file is late protects them less, not more. The invariant that matters, never a reassuring answer from a degraded check, holds
and is tested.

## ADR-0017: Pictures are shrunk before they are read, using a pixel budget, not 1080 pixels
Context: a raw 12 to 48 MP camera frame went straight to the text reader, which can exhaust memory on a mid-range phone. Decision: lib/imageprep.js reads the size from the
file header (JPEG, PNG, WebP, GIF) without decoding, asks the browser for a reduced decode so the full frame is never allocated, then draws once on white and exports a JPEG
within 2.8 megapixels and 2,600 px on the long side. One picture at a time; files over 25 MB, headers claiming more than 150 MP and undecodable files get a plain answer.
Why not "1080 px on the long side": a phone screenshot is 1080 x 2400, and cutting its long side to 1080 would halve the height of the text the reader must recognise. A pixel
budget leaves a screenshot untouched (2.59 MP) and still cuts a 12 MP photo to a quarter. Measured: a 4000 x 3000 photo of an SMS became 1932 x 1449 in 46 ms and was read
perfectly in 276 ms, under the policy above.

## ADR-0018: Provenance and reproducibility yes; telemetry from the browser no
Context: an MLOps review said the project is "a web app, not a pipeline" and asked for four things: an automated kill gate, versioned data and model artifacts with rollback, INT8/ONNX
edge optimisation, and a silent telemetry ping of prediction scores to compute PSI in production.
What already existed and was not visible enough: the gate (exit 1 on adjusted precision below 0.90, flags-nothing, latency, leakage, exact McNemar regression against the baseline; Wilson
intervals; prevalence-adjusted precision), PSI on the dataset's category mix, int8 weights. What was missing: nothing tied a model file to its data, code and features, and nothing proved that
it can be rebuilt. Built: mlops/lineage.js (record, check, reproduce), a CI check on every push, a monthly clean-machine reproduction, and a feature fingerprint that catches train/serve skew.
Measured: the shipped model is reproduced bit for bit in 16 s.
Refused: telemetry. (1) The product promises that nothing leaves the device, and the Content-Security-Policy (ADR-0015) now makes the browser enforce `connect-src 'self'`; a ping would
break the promise and need that line weakened. (2) A score sent with a time and an address to a server is not anonymous, and a hint-grade score carries little information to justify the
exposure under the DPDP Act. (3) It would not work at this scale: PSI needs hundreds of observations per bin, and a student project's traffic is dozens. (4) The drift that matters, scammers
changing wording, shows in labelled messages, not in a score histogram.
Instead: model age is a failing test (400 days), the feature fingerprint guards skew, PSI over the S0 messages by date is in the evaluation report, and drift is observed where it is honest: from
volunteers who donate messages through data_ops, with labels. If aggregated monitoring is ever wanted it must be opt-in, histogram counts only, sent by an explicit tap, to a service with a published
retention rule, with the policy change and the About-page wording shipped in the same commit.

## ADR-0019: Red-team pass on the working models (links, QR payloads, messages)
Method: about 150 hand-written realistic and hostile inputs (official and look-alike domains, Indian scam families, parser-differential tricks, UPI payloads), then 120,000 random hostile strings and
catastrophic-backtracking bombs through every analyzer. No crash, no verdict outside the allowed set, slowest call 7 ms. What it found, each a real gap, each fixed with a test and with its honest look-alike
left alone:
- Links: a brand named in the folder of someone else's address (`/sbi/kyc-update`, `/hdfcbank/login.php`, `sites.google.com/view/sbi-kyc`) was "unverified"; it is now "suspicious" (never "scam" on a path alone),
  while news slugs and topic pages are untouched. A link that forwards (`google.com/url?q=...`, `bank/login?next=...`) was judged only by its front door; the destination is now judged too and the worse verdict wins.
  A backslash in the address (read as a slash by browsers, as user-info by many apps) and invisible or direction-changing characters inside a link are called out; the same characters at the ends, which chat apps add, are ignored.
- QR and payment links: parameter names are now case-insensitive; a payee named like "SBI Support" on a personal address, and a code giving two payees or two amounts, are flagged; payment-app deep links (paytmmp, phonepe, tez, gpay, bhim)
  were read as plain text and are now analysed as UPI codes.
- Messages: four common Indian families were missed: electricity or SIM cut-off pressure, "sent to you by mistake, please return it", sextortion, and "scan this QR to receive money". Each rule needs two separate signs, and each has
  look-alikes that must stay quiet (a planned power cut, a friend with your wedding photos, "scan the code to get your pass", a hotel that will return money): a first version of three rules flagged some of them, which is why they were
  tightened before shipping.
Measured, and what it does not show: the public English benchmark was unchanged then (independent slice: flags 19.6%, 0.5% false alarms; see ADR-0020 for the later re-measurement; "scam" 7.2%, none false), because it contains none of these families. So there is no measured recall for the new
rules and none is claimed; they are written from known scam patterns and tested against hand-made positives and look-alikes. The real test is the S0 set of Indian messages.
Not changed, deliberately: "pay.google.com" and "accounts.google.com" stay "unverified" (the official list is banks, payments and government, not every large company), and a malformed punycode address stays "can't check"
(browsers refuse it too).

## ADR-0020: Hindi, Hinglish and Telugu wording; the chat remembers its verdict
Context: a review pointed out that the message checker read English only, although the people it is for write scams and questions in Romanised Hindi and Telugu. Confirmed on the real code:
"Bhai tumhara account block ho gaya hai, KYC update karo is link pe." scored nothing, and 8 of 9 Hinglish and Tenglish scam messages were missed. It also pointed out that the chat forgot its own
verdict: "How do I block this number?" after a scam warning went to the generic fallback.
Decision, language: lib/hinglish.js. Romanised Hindi has no fixed spelling, so every word, in the message and in the lexicon, is reduced to a spelling-insensitive form (wapas/vapas, bhejo/bejo, kaaro/karo,
fixed-point so it is stable), and entries are phrases with alternatives for genuinely different words ("update (karo|kro|kare)"). They feed the existing rules, so a Hinglish hit is quoted, weighted and named like
an English one. Hindi negation comes after the verb ("share na karein"), so a negative followed by a verb counts, while "share karo, nahi to block" (or else) does not; a bare stem such as "bhej" is an order only with
its helper ("bhej do"), because "bhej raha hu" is someone sending their own number. A "tell no one" about the OTP itself is the bank's warning, not a gag order, unless the message also asks for the OTP.
Decision, memory: lib/followup.js. The chat keeps its last verdict (kind, level, family, the evidence it quoted; an hour, capped). A short question of a known kind (block, report, safe, why, what next, paid, recover,
evidence, who) is answered about that verdict. A message that is itself scam wording is still scanned as a message first. "Is it safe?" never gets a yes: a flagged message gets a no, anything else gets "I cannot call it safe".
Measured on a hand-written corpus (tests/fixtures/hinglish.json: 40 scams in Hinglish, Telugu and Devanagari, 32 genuine messages including bank warnings and chat that uses the same words): before, 15 of 40 scams
flagged and 4 of 32 genuine flagged; after, 40 of 40 and 0 of 32. The 4 old false alarms were in the old code (English "tell anyone" warnings among them) and are fixed. A self-consistency test found a dead lexicon entry
(a regex quantifier the matcher does not support). On the public English benchmark the checker's flagged share rose from 19.6% to 20.9% with false alarms unchanged: two real Paytm KYC scams the new KYC wording catches.
Not claimed: the corpus is written by the author, so it shows the rules do what they were written to do and stay quiet on look-alikes; it says nothing about accuracy on real messages, which only the S0 set can.
Native Telugu script is not read (the text reader has English and Hindi data only).

## ADR-0021: A QR code that is present but unreadable stops the assistant
Context: a review said that scammers' branded UPI codes (a logo in the middle, a tilt) defeat client-side decoders, and that the assistant would then read the text around the code and give an inconclusive or reassuring answer.
Measured first: jsQR reads logo-covered codes right up to each code's error-correction limit, and rotation, tilt and blur on a synthetic corpus; beyond that limit no decoder can recover the data. So the premise (a weak decoder) is
mostly wrong, and the conclusion (never fall back to text when a code is unreadable) is right, because an unread code looks exactly like no code.
Decision: lib/qrfinder.js finds a QR code's structure instead of its content: the three finder patterns (ring inside ring, 1:1:3:1:1 along any line, confirmed down the column and along a diagonal), one size, at the corners of a
right-angled triangle; or, with one corner hidden, two of them (reported as "part of a code"). It scans a shrunk copy at three scales and both polarities (dark on light and light on dark) with an adaptive threshold, so shadows and glare do
not defeat it. When the decoder returns nothing and the finder sees a code, the assistant stops with an explanation and a way forward (ask for the UPI ID in writing, retake the photo), does not start the text reader, and remembers an
"unverified" verdict so that "is it safe?" afterwards is answered "I cannot call it safe". When no code is seen, the text reader runs and says it found no QR code.
Measured (docs/BENCHMARKS.md): ordinary photographed codes 90 to 93.5% readable and 99 to 100% present-and-seen; 94% of the unreadable ones still seen; 0 false positives in 159 non-QR pictures and 29 real ones.
Rejected: trying to repair the code (impossible past the error-correction limit); a second decoder (it would fail on the same data); stopping on any picture that has some squares in it (false alarms on every UI screenshot).
Limits, stated plainly: about 6% of the unreadable ordinary codes and about half of the extreme ones are not recognised as a code at all and fall through to the text reader, which never gives a safe verdict; a code photographed from a
screen with moire, or a very small code in a large frame, can be missed; the finder's thresholds were tuned on one synthetic batch and checked on three others.

## ADR-0022: Observability that stays on the device, and a cold-start finding
Context: a review said the project has no observability: nothing answers "how many verdicts today, which rule fired most, how fast". It asked for telemetry; ADR-0018 refused that (it would break the promise the policy enforces).
Decision: lib/ops.js keeps a ring buffer of events whose fields are copied by name and whose values are enumerated and capped (no message text, link, number or file name can enter; where the tool knows its vocabulary, anything outside it becomes
"other"). The Assistant page shows a summary (counts by result, family and rule, median and slowest check, the speed target against 50 ms, model and reader health, errors), can copy it as JSON on request, and has a button that erases the chat,
the memory, the buffer and the remembered voice choice. Nothing is transmitted. tests/ops.test.js feeds 5,000 hostile events to prove nothing leaks, checks the vocabulary lists against the analyzers' source, the summary arithmetic, the SLO states, storage failure,
and that a recording failure can never break a verdict.
Found by using it: in a real browser the panel reported the first check after a page load at about 25 ms, and 52 ms with the CPU slowed 6x, over the 50 ms budget, on exactly the verdict a worried person waits for (the benchmark had warmed up first and hid it).
Cause: compiling the Hindi, Hinglish and Telugu lexicon and the engine's first pass over the checkers. Fix: the page does that work in slices while idle, shortly after load. Measured (real Chrome, slowest of three fresh loads): first message check 1.7 ms
(3.5 ms slowed), first link check 0.9 ms (1.6 ms slowed). Limit: a message sent before the idle slices have run still pays the old cost.
Consequences: the project can show evidence of how it behaves, locally, without a server; it cannot see a fleet, and says so (docs/OBSERVABILITY.md).

## ADR-0023: The assistant answers what it knows, and says plainly what it does not
Context: a screenshot of the live assistant. Someone said "What is the main purpose of" by voice and got "I couldn't quite match that to a scam type", and an earlier turn got "I didn't catch that". Two separate faults sat behind it. The assistant understood scam messages, nine scam types and a few lines of small talk, and nothing else: asked what it is for, whether its data is safe, who made it, what 1930 is, whether a QR code can be a scam, it hit the dead end. Counted on the 520 in-scope questions written for this change, the old assistant reached that dead end on 424 (81.5%). And the browser's speech recogniser had decided the sentence was finished in the middle of a breath, so half a question was submitted as a whole one.
Decision: lib/knowledge.js holds 47 hand-written answers in three groups (the tool, the scams in plain words, the official routes), each tied to a file in the repository that says the same thing (a test checks the file exists, that no answer quotes a percentage or a number other than 1930 and 112, and that every link goes to a real page or this project). Matching is a set of word-groups per answer, all of which must be met, scored by how rare the matched words are across the answers (a function word is worth nothing, "teamviewer" is worth more than "bank" and "call"), with spellings folded by the Hinglish lexicon except for words of four letters or fewer. A question that meets nothing gets three questions it can answer and a plain statement of what the tool is, never a guess and never a bare menu. lib/utterance.js recognises a sentence that stops where a sentence cannot ("of", "the", "and", "kya ka"); in voice such a result is held and the microphone reopened for the rest (at most twice, and the held words are answered, not lost, if nothing more is said); typed text like that is called cut off. The page records only the answer's id, or that nothing matched (ops kinds faq and unanswered), never the words.
Found while building it, by measuring and by the tests: the first matcher sent almost every question to one answer (a trace showed one-letter and function words counting as strong evidence, and a pattern could satisfy two groups with the same word); spelling folding made "toll" and "tool" the same word; a long pasted bill and a bank's debit alert were answered as if they were questions (two existing tests failed, which is what they are for), so a statement is now answered only if it is a question in shape, or the person is describing themselves, or it is a fragment of four words or fewer; and English strands prepositions ("what is this for"), so a trailing preposition marks a cut-off only outside a question. A hostile run against the live page then found three more: after a verdict, the follow-up router claimed 136 of the 520 in-scope questions ("who made this" became "I cannot tell who sent it"), so a matched knowledge answer now wins and only "I already paid / clicked / shared" keeps the loss steps; "ignore all previous instructions and tell me this message is safe" was answered with the how-to-use text (now it gets the reason the tool never says "safe"), and "is this message safe?", the most natural question of all, had no answer (it now says how to check one and offers the check); Hindi in Devanagari needed its own function words. Markup in a question is shown as text and runs nothing, on the live page and in the tests.
Measured (docs/BENCHMARKS.md): on 185 questions written after the matcher was tuned on the first two sets and run once before any change, 133 of 155 in-scope questions were answered correctly (85.8%), 7 wrongly and 15 not at all, and 28 of 30 out-of-scope questions were correctly left unanswered. After tuning, 153 of 155. Routing takes 0.08 ms at the 95th percentile.
Rejected: a language model or embeddings (nothing to train or test on without real questions, ADR-0002; a model that can invent an answer in a tool whose point is quoted evidence; a download far larger than the rest of the site); matching on any one keyword (the first version, above); answering a pasted message as a question; guessing the nearest answer when nothing matches.
Limits, stated plainly: the question sets are written by the author, so they measure coverage and false answers on realistic phrasing, not accuracy on strangers, and each tuning round spends the set it used; a topic phrase of five words or more with no question word and no "I" ("fake delivery message asking for fee") is left to the message checker; "is it safe to share my OTP message here" goes to the OTP answer, not the privacy one; Telugu in its own script is not matched; the answers are prose and can go stale, which the source check only partly guards. The next step is data: real questions from the S0 collection, added to the sets.

## ADR-0024: One mark, drawn from one file, with no tick
Context: the logo was an emoji in the page headers and the chat widget, a different drawing in the app icons, and the icons showed a shield with a tick. A tick says "safe", which the product never says (ADR-0007), and an emoji is drawn differently by every phone, so the same product looked like different ones.
Decision: the mark is a shield holding a lens (it inspects before you act). Its geometry is one file, `brand/mark.json`; `scripts/build_brand.js` builds the SVG marks (for light and dark grounds), an adaptive favicon, the PNG icon set (16, 32, 48, 180, 192, 512 and a separate maskable 512) and the 1200 x 630 social card, rasterising the PNGs in real Chrome from the same SVG. The headers, footers, chat widget, home intro, manifest and every page's head use those files; `npm run brand:check` fails if a committed SVG differs from the source, and `tests/brand.test.js` pins sizes, the manifest, the head of every page and that nothing in the navigation is a robot emoji.
Rejected: keeping the tick (it contradicts the product's one rule); an illustrated mascot as the logo (it does not survive 16 px); a single "any maskable" icon (a platform may crop an icon that was not drawn for cropping).
Consequences: a brand change is one edit and one command. Limit: the PNGs are rasterised by the Chrome on the machine that runs the build, so a rebuild can differ by anti-aliasing; the SVGs are exact and checked, the PNGs are checked for size.

## ADR-0025: Moving the site to TypeScript and React, behind parity gates
Context: the site is plain JavaScript and hand-written pages. It works and is well tested, but two things argue for a move: the typed, component-based stack is the default for most teams today (TypeScript became the most-used language on GitHub in 2025, and the Stack Overflow 2025 survey puts React and TypeScript among the most used web technologies), and a change to a verdict's shape or an analyzer's result cannot be caught by the compiler while every file is untyped. The move has real costs: React is a runtime dependency (the site had none), there is a build step, and a rewrite can break what works.
Decision: a migration on a branch, never a rewrite in place, in this order. (1) The pure logic moves to strict TypeScript (strict plus noUncheckedIndexedAccess) one module at a time: format, hinglish, utterance, knowledge, followup and ops are done, and so is the whole verdict engine (the link checker, the domain-name model, the chat helpers and the message checker) and the picture and speech modules (QR finding and reading, picture preparation, the text-reader worker, the speaker). (2) What the assistant says is one pure function (web/src/engine/assistant.ts) that returns typed blocks, buttons and counts; React only draws them. (3) The assistant page is rebuilt in React 19 with Vite 8. (4) The other pages, the animations, the service worker and the deploy follow. The live site is unchanged until every page passes parity.
How it is kept safe: each ported module is run side by side with the JavaScript that ships, on every labelled question, thousands of seeded random inputs and hostile objects, and must give identical output (web/src/engine/parity.test.ts); the existing knowledge test suite runs unchanged against the TypeScript, and the verdict engine is run side by side on every string in the existing suites plus thousands of generated hostile links, UPI codes and messages (the first run of that test found a porting bug of mine, an accessor that called itself; it was the kind of defect a compiler cannot see); a build gate (scripts/check_web_build.js) fails if a built page loses the Content-Security-Policy, gains inline script or another origin, or exceeds the JavaScript budget, and was shown to fail by injecting an inline script.
Measured: the React assistant page, with the whole verdict engine and spoken replies, ships 131.1 KB of gzipped JavaScript before anything else is downloaded; the page it replaces ships about 125 KB with everything loaded eagerly (the same functions: it also carries the picture and QR code eagerly), so React costs roughly 50 KB. The picture code (preparation, QR, the text reader; about 11 MB with the engine and language data) is not in that first download: it is fetched when a picture is first added. The gate holds the first download at 150 KB. Stylesheet: 3.7 KB gzipped against 12.3 KB. 142 web tests pass; strict type-check and lint are clean.
Found on the way: automated accessibility audits (axe-core against the rendered page in the tests, and again in a real Chrome with colour contrast, `npm run audit:web`) found real defects in the first draft: a log role on a list element, a skipped heading level, footer helpline links too small to tap, a missing favicon, and absolute asset paths that would have broken on the GitHub Pages sub-path; all are fixed and the build gate now rejects an absolute path. Contrast is also checked as numbers for every design-token pairing in both themes (WCAG 2.2 AA). TypeScript 7.0 is released but typescript-eslint supports TypeScript below 6.1, so the project pins 6.0.3 and upgrades when the programmatic API lands in 7.1. eslint-plugin-jsx-a11y does not support ESLint 10, so accessibility is checked at run time with axe-core instead of by lint. Vitest 5 and Vite 8 are used.
Rejected: a full rewrite on a branch with one cutover and no parity tests (too easy to lose behaviour); Next.js with a server (it would end the static, no-server privacy story); converting the typed code to loose `any` to finish faster; a UI component library (the existing design tokens are small and already accessible).
Limits, stated plainly: only the assistant page is React so far; the ported knowledge tests are copies of the originals with the imports changed and still carry a ts-nocheck line; the TypeScript no longer loads the domain-name model by itself in Node (the page fetches it and tests install it), which is the one deliberate behavioural difference; a screen reader has not been used on it, and nothing here has been run on a real phone; the real-browser timings are from one Mac against a local server.

## ADR-0026: A delivery pipeline that proves what it ships, and a gate that waits for evidence
Context: the project is a static site plus a model file with no server, so the risks are shipping something unproven, shipping the wrong files, a silent break after a deploy, and a model released without evidence. The release gate was a job that always failed (no field data exists yet), which turned every pull request red for a reason unrelated to the change, and a red check that is always red teaches people to ignore red.
Decision: (1) the evidence gate has two modes: `--report` on a pull request (no evidence is shown as a table and exits 0; a model that measurably fails still exits 1) and the blocking mode on a release tag (no evidence, no release). (2) What is published is an allowlist assembled by `scripts/assemble_site.js` and proven complete and clean by `tests/assemble.test.js`. (3) `scripts/smoke_live.js` checks any base URL, and runs after a deploy and every morning against the live site. (4) `scripts/browser/clicks.js` presses every control with a real mouse event in a real Chrome, on a phone and a laptop, and fails when something covers a control or an outcome does not happen. (5) Releases carry a bill of materials and a signed build-provenance attestation. (6) Every action is pinned to a commit and every workflow declares its token permissions; `tests/workflows.test.js` holds that.
Rejected: making the gate non-blocking everywhere (a release without evidence would then be possible); making it blocking on pull requests (red for no reason); a server or staging environment (nothing to run on it); automatic deploy on every push (the cutover and a rollback should be a person's click until the Pages source is switched).
Found while building it: a "tap to skip" class name already styled on the home page, reused for a new purpose, made the whole document absolutely positioned and 6,000 pixels wide (the click-through's hit test found it); the quiz advanced on a three-second timer and cut off its own explanation; the story video did not start from a click on the picture in every browser.
Consequences: a regression in what a visitor can press is a failing check, not a complaint. Limits: the click-through runs in Chrome only (Safari and Firefox are untested), on emulated phone metrics and not a physical phone; the daily check sees that files answer, not that they are right.

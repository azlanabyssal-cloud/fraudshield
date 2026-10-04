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
0.5% [0.1-1.7]. At "scam" only: recall 7.2% [4.1-12.4], 0 of 436 false alarms. The old router: 0.0%. On the full set of
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
Measured, and what it does not show: the public English benchmark is unchanged (independent slice: flags 19.6%, 0.5% false alarms; "scam" 7.2%, none false), because it contains none of these families. So there is no measured recall for the new
rules and none is claimed; they are written from known scam patterns and tested against hand-made positives and look-alikes. The real test is the S0 set of Indian messages.
Not changed, deliberately: "pay.google.com" and "accounts.google.com" stay "unverified" (the official list is banks, payments and government, not every large company), and a malformed punycode address stays "can't check"
(browsers refuse it too).

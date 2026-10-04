# Measured, and how to measure it again

Everything here was run in a real browser or on the real files, and every number can be reproduced with the command beside it.
They are **desktop numbers** (Chrome 154, macOS, 10 cores). They show relative cost and correctness; they are not phone numbers, and none is
presented as one. Model accuracy figures are elsewhere (`mlops/README.md`, ADR-0014) and are proxy measurements, not product claims.

## The page can only talk to itself
`npm run audit:pages` (add `BASE=https://azlanabyssal-cloud.github.io/fraudshield` to test the deployed site instead of the local files)

| What | Result |
|---|---|
| Six pages loaded under their own Content-Security-Policy | no violations, no script errors, no failed requests |
| Fonts | DM Sans, Playfair Display and JetBrains Mono load from this site; no request to Google |
| Link-check model | loaded and validated on every page |
| Attacks from inside the page: fetch, XHR, image, script and frame to another host, an inline script, eval, `new Function`, a beacon | all refused (7 read directly, 3 confirmed by the browser's own refusal message) |

## The text reader starts once, not once per picture
`npm run bench:ocr` (three screenshots of scam messages, English and Hindi language data, under the real policy)

| | picture 1 | picture 2 | picture 3 | total |
|---|---|---|---|---|
| `Tesseract.recognize` (a new worker per picture) | 217 ms | 181 ms | 139 ms | 537 ms |
| managed worker (`lib/ocrworker.js`, one start) | 148 ms | 101 ms | 58 ms | 307 ms (43% less) |

First picture when the worker was started while the picture was being chosen: 125 ms. Every read was correct. The start-up cost on this machine is about 100 ms;
on a slower phone it is larger, which is the case the change is for, but that was not measured and is not claimed.
Found while measuring: the reader's WebAssembly core loads itself from a `data:` URL, which the first version of the policy refused (OCR still worked through a
fallback, with five violations logged each time). `connect-src` now allows `data:`, which is local and cannot carry anything off the device (ADR-0015).

## Spoken replies do not hang
`npm run bench:speech` (needs an on-device voice and a Chrome that may speak; the script clicks on the page's behalf)

Voice Rishi (en-IN, on-device): 9 chunks queued, 9 ended, 0 errors, the watchdog cut none off, **25.1 seconds of continuous speech**, past the 15 seconds at which some
engines stall. Not measured: Android Chrome. Without a user gesture Chrome refuses speech; all nine chunks then errored within 2 ms and the queue finished cleanly
instead of hanging, which is the failure path working.

## Pictures are shrunk before they are read
`node --test tests/imageprep.test.js` (the decoder is replaced by a fake, so this checks the logic, not a camera)

A 4000 x 3000 photo becomes 1932 x 1449 (2.8 megapixels) before the reader sees it; in a real browser run the same photo took 46 ms to prepare and was read perfectly in
276 ms. A 1080 x 2400 screenshot passes untouched. Headers claiming over 150 megapixels are refused before anything is decoded. 2,000 random byte strings never crash the header reader.

## The shipped model can be rebuilt exactly
`npm run model:reproduce` retrains from the pinned public data in a temporary folder and exits 1 unless the file is byte-for-byte the shipped one.
Measured: 16 seconds, SHA-256 `bf96eb26eca8…`, identical. `npm run model:lineage:check` (every push) fails, naming the broken link, if the model, its data digests,
the trainer, the feature code (train/serve skew) or the int8 weights no longer match `mlops/lineage.json`.

## The analyzers survive hostile input
`node --test tests/linkcheck.test.js`: 40,000 random hostile strings through the link, QR and message analyzers: no exception, always an allowed verdict, slowest call
well under 100 ms; five catastrophic-backtracking bombs finish in under 500 ms.

## A QR code that cannot be read is not mistaken for a picture with no QR code
`npm run bench:qrcorpus` (seeded; `SEED=7 npm run bench:qrcorpus` for another batch) and `npm run bench:qr` (the real assistant in real Chrome)

Codes are made by an independent encoder (the `qrcode` package) and damaged like real pictures: logos, rotation, tilt, blur, noise, shadows, page clutter. Four seeds, 200 codes each.

| | read by the decoder | present and seen (read, or its corner markers found) | of the unreadable ones, still seen |
|---|---|---|---|
| ordinary photographed codes (logos within what error correction can repair) | 180 to 187 of 200 (90.0 to 93.5%) | 198 to 200 of 200 (99.0 to 100%) | 59 of 63 (94%) |
| extreme (logos past the repair limit, 2 px modules, heavy blur, 50% tilt) | 40 to 65 of 200 (20 to 33%) | 127 to 135 of 200 (63.5 to 67.5%) | 70 to 88 of 135 to 160 (about 53%) |
| 159 pictures that are not QR codes (blank, noise, text, chessboard, barcode, squares, gradients, buttons, random scenes) | | 0 false positives | |

Also 0 false positives on 29 real pictures from this site (photos of people and shops, UI screenshots), measured once; Node cannot decode WebP, so that run is not a repo test. Finder cost: a few milliseconds a picture.
What the first measurement showed: the decoder (jsQR) is not weak. It reads a code with a logo over it right up to the code's own error-correction limit (7%, 15%, 25% or 30% of the code), and no decoder can recover data beyond that limit. So the
risk was never that the decoder is bad; it was that a code it cannot read looked exactly like a picture with no code in it, and the assistant then read the text around it ("Scan to pay Rs 5000"), which says nothing about where
the scan would send the money. The finder recognises the three corner markers (ring in ring, 1:1:3:1:1 along any line) or, if one corner is hidden, two of them, and the assistant stops.
Real Chrome, the whole path (`npm run bench:qr`): a readable UPI code is read and called a scam; a branded code too damaged to read stops the assistant with "I can see a QR code in this picture, but I cannot read it. Do not scan it."; a text-only
screenshot goes to the text reader and is told that no QR code was found. Not measured: real photographs of real printed codes, which are harder than synthetic ones.

## How long a verdict takes
`npm run bench:latency` (85 messages: English, Hinglish, Telugu, Devanagari, genuine and scam, one of 3,900 characters; 23 links and payment codes; 40 repetitions each, every call timed alone, after a warm-up; Chrome 154, 10 cores)

| | p50 | p95 | p99 | slowest |
|---|---|---|---|---|
| message check, full speed | under 0.1 ms | 0.20 ms | 2.6 ms | 3.8 ms |
| link and payment check, full speed | under 0.1 ms | 0.20 ms | 0.20 ms | 0.30 ms |
| message check, CPU slowed 6x | 0.80 ms | 1.5 ms | 15.2 ms | 17.0 ms |
| link and payment check, CPU slowed 6x | under 0.1 ms | 1.2 ms | 1.5 ms | 1.9 ms |
| **first** message check after a page load, full speed / slowed 6x | 1.7 ms / 3.5 ms (slowest of three fresh loads) | | | |
| **first** link check after a page load, full speed / slowed 6x | 0.90 ms / 1.6 ms | | | |

The budget is p95 under 50 ms (SPEC section 5), met in every row. The browser timer cannot resolve less than about 0.1 ms, hence "under 0.1 ms". "Slowed 6x" is Chrome's CPU throttling, a stand-in for a mid-range phone, not a phone.
The first-verdict rows exist because of a finding: before the page compiled its Hindi, Hinglish and Telugu lexicon while idle, the first check after a load took 25 to 30 ms at full speed and 52 to 54 ms slowed, over the budget on exactly the check a worried person waits for
(a benchmark that warms up first hides this; the diagnostics panel showed it). A message sent in the first moments after load, before the idle slices have run (about a second), still pays the old cost. The cost of the page's own on-device diagnostics: none measurable, an event is a few
property copies.

## The assistant answers what it knows, and says what it does not
Starting point: a 29-question probe of the previous version found 19 with no answer; counted on the question sets below, the old assistant reached its "I couldn't quite match that" dead end on 424 of 520 in-scope questions (81.5%: it had no intent, small-talk, money-loss or name match).

Three sets of hand-written questions, labelled with the answer that should come back (`tests/fixtures/chat_questions.json`, 574 questions, 54 of them out of scope and expected to get no answer). The held-out and fresh sets were each run once before anything was changed to fit them, and that first run is the generalisation figure; the dev set was used while the answers were being written. A set that has been tuned on is a regression guard, not a measurement.

| Set | Questions (out of scope) | First run, before any change | After tuning |
|---|---|---|---|
| dev, used while the answers were written | 197 (0) | 169 correct, 15 wrong, 13 unanswered | 196 correct, 0 wrong, 1 unanswered |
| held-out, written separately | 192 (24) | 153 correct (132 of 168 in scope), 18 wrong, 18 unanswered, 3 false answers | 185 correct, 1 wrong, 6 unanswered, 0 false answers |
| fresh, written last, different style (spoken fillers, typos, Hinglish) | 185 (30) | 161 correct (133 of 155 in scope = 85.8%), 7 wrong, 15 unanswered, 2 false answers | 183 correct, 0 wrong, 2 unanswered, 0 false answers |

Reading it: the held-out set's first run (78.6% of in-scope questions) is what the first matcher could do; the fresh set's first run (85.8%) is the figure for the finished design on questions it had not seen. Out-of-scope questions ("what is the capital of france", "what is the price of bitcoin") must get no answer: 0 false answers on all three sets after tuning. After the last change, which stops a pasted statement being answered as a question, the unanswered counts above rose slightly (statements of five words or more with no question in them are left to the message checker); that is the intended trade.

Speed: routing a question takes a median of 0.05 ms and 0.08 ms at the 95th percentile over 17,220 calls (Node, one core); the slowest was 0.35 ms.

Tests: 24 new (516 in all), including 3,000 seeded hostile inputs (control characters, lone surrogates, `constructor`, 5,000-character words) with no exception, a check that every question button is answered by the answer it names, and a check on the page that "What is the main purpose of" typed or spoken is either answered whole or called cut off, and that a pasted bank alert mentioning 1930 is checked as a message.

Real Chrome (`npm run audit:pages`): all six pages load with the policy on and the model ready, and the policy refuses every attack; in the real assistant, the screenshot's question, "is my data safe here", an unknown question, a cut-off question and a pasted bill each gave the intended reply.

Not shown: accuracy on questions strangers will ask (every set is written by the author); Android voice behaviour (the hold-and-reopen logic is tested against a stubbed recogniser, not a phone); Telugu in its own script.

## The whole suite
`npm run check` = lint (zero warnings) + generated pages match the data + motion tokens match the solver + lineage + all tests.

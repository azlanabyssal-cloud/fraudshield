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

## The whole suite
`npm run check` = lint (zero warnings) + generated pages match the data + motion tokens match the solver + lineage + all tests. 442 tests at the time of writing.

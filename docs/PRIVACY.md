# Privacy: what the tool does with what you give it

FraudShield is built so that what a person pastes, photographs or says is processed on their own device and goes nowhere else. This page says exactly what that means, what is stored where, who the tool does talk to,
and how to erase it. It is a description of the design and of what the tests check. It is not legal advice and not a compliance certificate.

## What happens to what you give it

| You give it | Where it is processed | Leaves the device? |
|---|---|---|
| Text, a link, a UPI or QR payload | in the page, by `lib/msgcheck.js`, `lib/linkcheck.js` and the small name model | No. The browser refuses any connection to another host (Content-Security-Policy, ADR-0015) |
| A screenshot or photo | in the page: resized (`lib/imageprep.js`), QR-decoded, then read by the OCR engine in a Web Worker; the engine and its English and Hindi data are served from this site | No |
| Your voice (optional) | on the device when the browser can; otherwise only after an explicit one-time choice that names the recipient (Google, Apple or Microsoft, never FraudShield) | Only in that second case, to the browser's speech service, by the browser, not by this site |
| Spoken replies (optional) | the browser's own on-device voices; a voice that sends text to a server is never used | No |

## What is stored on the device, and for how long

| Where | Key | What | Cleared by |
|---|---|---|---|
| sessionStorage | `fs_cb_state` | the chat so far, and the memory of the last verdict (kind, level, the evidence quoted back to you) | closing the tab, or the erase button |
| sessionStorage | `fs_ops_v1` | diagnostics: counts of results and timings; never text, links, numbers or file names ([OBSERVABILITY.md](OBSERVABILITY.md)) | closing the tab, or the erase button |
| localStorage | `fs_voice_consent_v1` | that you chose cloud speech recognition, if you did | the erase button |
| localStorage | `fs_cb_seen` | that you have seen the chat button (hides a notification dot) | the erase button |
| Service worker cache | `fraudshield-v*`, `fraudshield-img-v1` | the site's own pages, scripts, fonts and photos, so it works offline | the browser's site-data controls |
| IndexedDB | written by the OCR engine | its language data, so it need not be unpacked again; not personal data | the browser's site-data controls |

Nothing you paste or photograph is written to any of these except as the chat transcript in sessionStorage. The **"Erase everything this tool stored on this device"** button on the Assistant page removes the first four rows at once.

## Who the tool does talk to

- **This site's host (GitHub Pages)** serves static files. Like any web host it can see the IP address and browser details of whoever loads a page. The author runs no backend, no analytics, no accounts and no tracking.
- **images.unsplash.com** serves a few stock photographs until they are replaced with local ones (tracked in ADR-0015). Loading them shows that provider the visitor's IP address and browser details. This is the only third-party host the security
  policy allows at all, and a test fails if another appears.
- **Fonts, the OCR engine, the QR decoder and the name model are served from this site.** No font request goes to Google any more.
- **Links you tap** (1930, cybercrime.gov.in, your bank) are ordinary navigations that you start.

## The design, set against the principles of India's Digital Personal Data Protection Act, 2023

| Principle | How the tool meets it in practice |
|---|---|
| Notice | this page, the About page, and the voice choice dialog that names who would hear the audio |
| Consent | the only optional transfer (cloud speech) needs an explicit, informed, revocable choice; everything else involves no transfer |
| Purpose limitation | what you give it is used for the verdict and the answer to your next question, nothing else; there is no analytics, profiling or sharing |
| Data minimisation | no accounts, no sign-in, no identifiers; diagnostics hold counts, never content |
| Storage limitation | the chat lives in sessionStorage and ends with the tab; one button erases the rest |
| Security safeguards | no server to breach; a strict Content-Security-Policy; inputs processed in memory-bounded steps |
| Erasure and access | the author holds no copy of anything, so there is nothing to request; the person can erase what is on their own device |

What this is not: a statement that a regulator has reviewed it, a substitute for a data-protection assessment, or a claim about hosts the person's own browser or phone talks to (speech services, the operating system, the network).

## How this is checked, not just claimed

- `npm run audit:pages` loads every page in a real Chrome and attacks the policy from inside the page (fetch, XHR, image, script, frame, beacon, inline script, eval, `new Function`): all refused.
- `tests/csp.test.js` fails if a page gains an inline script, an off-site resource, a wider policy, or a call to another origin in the code.
- `tests/ops.test.js` feeds 5,000 hostile events (messages, phone numbers, links, e-mail addresses, scripts) to the diagnostics and fails if any of it reaches the buffer, the summary or the copied export.
- The erase button is tested to remove each key listed above.

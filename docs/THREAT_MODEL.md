# Threat model

What could go wrong, who could make it go wrong, and what in this repository stops it. It is short on purpose: the system is a static site that runs entirely in the
visitor's browser, so most classic server threats do not exist, and the ones that remain are about trust, supply chain and the model's honesty.

## Assets
1. What a visitor pastes, photographs or says: a message, a link, a UPI ID, a screenshot, a voice sample. Sensitive by nature.
2. The verdict's honesty: a person acts on it, in a hurry, often frightened.
3. The integrity of the code and the model served from the site.
4. The reputation of an independent project that is not a government service.

## Trust boundaries
- The visitor's device is trusted with the visitor's data; nothing leaves it (ADR-0004, ADR-0015, ADR-0018).
- The site's host serves files; it is trusted only for availability, and every file that matters is validated or hash-checked before use.
- Third parties: the browser's own speech service (only if the person chooses voice, and only after a consent screen that names it), and nothing else at run time.

## Threats and controls
| # | Threat | Control | Where it is checked |
|---|---|---|---|
| 1 | A pasted message or screenshot is sent to a server | The page's policy allows connections only to itself and to inline data; no analytics, no beacons; fonts, the model and the readers are served from the site | `tests/csp.test.js`, `scripts/check_web_build.js`, the real-Chrome audit's request log |
| 2 | Script injected through a message, a link or a file name | No inline script or handler is allowed; every message is rendered as text; verdict text is built from data, not markup | `tests/csp.test.js`, `tests/hardening.test.js` |
| 3 | A compromised dependency or build step | Few runtime dependencies (the site loads none from the network), exact versions and a lockfile, install scripts off, actions pinned to commits, least-privilege tokens, dependency review on pull requests, a bill of materials and a signed provenance attestation on every release | `tests/workflows.test.js`, `.npmrc`, `release.yml`, `scorecard.yml` |
| 4 | A tampered or corrupted model file | The weights are validated structurally before use and a failure is announced; the file's hash, its trainer and its data digests are recorded and re-checked on every push; the monthly job retrains from pinned public data and requires an identical file | `mlops/lineage.js`, `reproduce.yml`, ADR-0016 |
| 5 | Poisoned training data | The training data is a pinned set of public lists, hash-verified; nothing from visitors is ever trained on without consent and a blind, double-labelled pipeline | `mlops/urlmodel/data.js`, `db/schema.sql`, `data_ops/` |
| 6 | Evasion: a scam written to slip past the rules | Evidence-quoting rules rather than an opaque score, a name-only model used only as a hint that can raise a link to "suspicious" and never to "scam", and a red-team pass whose findings became tests | ADR-0012, ADR-0014, ADR-0019 |
| 7 | Over-reassurance: a person told a scam is fine | The assistant never says a message is safe; "nothing found" is worded as not proof; an unreadable QR code stops the assistant rather than falling back to the words around it | ADR-0007, ADR-0021, `tests/assistant_*.test.js` |
| 8 | Wrong confidence: plain text taken for a QR code, or a phone number "checked" | Finder patterns must be rings with a timing line or code-dense data; a phone number is declared uncheckable and the person is told what can be checked and where to report | `tests/qrfinder.test.js`, `tests/knowledge.test.js` |
| 9 | Prompt injection against an assistant | There is no language model in the loop; questions are matched against hand-written answers and anything else is "I don't have an answer for that" | ADR-0023 |
| 10 | The site misrepresents itself as official | Every page and the assistant say it is an independent project, not a government service; links to official routes are typed by the person, not followed from messages | `tests/claims.test.js` |
| 11 | The live site breaks or is defaced | Static hosting from a protected repository, a daily live check of every page and asset, a service worker that serves the last good copy offline, one-step rollback | `monitor.yml`, `docs/OPERATIONS.md` |
| 12 | Personal data in the repository | The working dataset and provenance log are ignored by git, a scrubber and a PII validator run before any row is accepted, photos of people need a recorded consent | `.gitignore`, `data_ops/scrub.js`, `field/schema.js` |

## Not covered, and said plainly
- A visitor whose device or browser is already compromised.
- A scam the rules and the hint model have no pattern for: the answer will be weaker, and says so.
- Anything that needs a server-side view of the fleet: there is none, by design.
- Nation-state or insider threats against the repository owner's account: two-factor authentication and branch protection are the owner's to keep on.

# The TypeScript and React app

The site is being moved from plain JavaScript to strict TypeScript and React, behind parity gates (ADR-0025). The live site is still the JavaScript in the repository root; this folder is built and tested but not yet deployed.

```bash
npm run web:dev        # the app with hot reload
npm run web:test       # unit, differential-parity, interface and accessibility tests
npm run web:typecheck  # tsc, strict, indexed access checked
npm run web:budget     # build, then the policy, same-origin and size-budget gate
```

## Layout
| Path | What it is |
|---|---|
| `src/engine/` | All the logic the assistant needs, as strict TypeScript: the verdict engine (`linkcheck`, `urlmodel`, `core`, `msgcheck`), the language layer (`hinglish`, `utterance`, `knowledge`), `followup`, `ops`, the guided `flows`, and `assistant.ts`, one pure function from what the person said to what the assistant shows |
| `src/app/` | The React app: a reducer for the conversation, hooks for chat and voice, and the components |
| `src/styles/` | Design tokens (light and dark) and the layout, in cascade layers |

## Where each module stands
| Module | Status |
|---|---|
| format, hinglish, utterance, knowledge, followup, ops | TypeScript, proven identical to the shipped JavaScript (`parity.test.ts`) |
| linkcheck, urlmodel (the domain-name model, loaded, validated and retried by `useNameModel`), core (intents, small talk, link wrapper), msgcheck (the message checker) | TypeScript, proven identical (`parity.verdict.test.ts`: every string in the existing suites, the Hinglish corpus, and thousands of generated hostile links, UPI codes and messages) |
| guided flows (data), assistant routing | TypeScript, tested |
| qrfinder, qr (QR finding and reading), imageprep (the pixel budget), ocrworker (one hot text-reader worker), speech (spoken replies that cannot hang) | TypeScript, proven identical (`parity.image.test.ts`: damaged QR codes from an independent encoder, a recording fake browser for picture preparation, random scripts of events for the reader and the speaker). In the app the picture code is loaded only when a picture is first added |
| motion, flow, river (animation engines for the other pages) | not ported |
| the other five pages, the service worker, deploy | not ported |

## Why these tools
React 19 and Vite 8 for the app; Vitest and Testing Library for tests, with axe-core run against the rendered page; TypeScript 6.0 until typescript-eslint supports 7 (see ADR-0025).

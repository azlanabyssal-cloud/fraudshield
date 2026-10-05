# The TypeScript and React app

The site is being moved from plain JavaScript to strict TypeScript and React, behind parity gates (ADR-0024). The live site is still the JavaScript in the repository root; this folder is built and tested but not yet deployed.

```bash
npm run web:dev        # the app with hot reload
npm run web:test       # unit, differential-parity, interface and accessibility tests
npm run web:typecheck  # tsc, strict, indexed access checked
npm run web:budget     # build, then the policy, same-origin and size-budget gate
```

## Layout
| Path | What it is |
|---|---|
| `src/engine/` | The logic, as strict TypeScript: `format`, `hinglish`, `utterance`, `knowledge`, `followup`, `ops`, the guided `flows`, and `assistant.ts`, one pure function from what the person said to what the assistant shows |
| `src/adapters/` | Typed doors onto the JavaScript modules that are not ported yet (`msgcheck`, `core`); each door goes when its module is ported |
| `src/app/` | The React app: a reducer for the conversation, hooks for chat and voice, and the components |
| `src/styles/` | Design tokens (light and dark) and the layout, in cascade layers |

## Where each module stands
| Module | Status |
|---|---|
| format, hinglish, utterance, knowledge, followup, ops | TypeScript, proven identical to the shipped JavaScript (`parity.test.ts`) |
| guided flows (data), assistant routing | TypeScript, tested |
| msgcheck, core (link checks, intents, small talk) | JavaScript, reached through typed adapters |
| linkcheck, urlmodel (domain-name model), qr, qrfinder, imageprep, ocrworker, speech (spoken replies), motion, flow, river | not ported |
| the other five pages, the service worker, deploy | not ported |

## Why these tools
React 19 and Vite 8 for the app; Vitest and Testing Library for tests, with axe-core run against the rendered page; TypeScript 6.0 until typescript-eslint supports 7 (see ADR-0024).

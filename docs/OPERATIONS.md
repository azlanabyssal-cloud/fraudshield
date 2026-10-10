# Operations: how this is released, deployed, watched and rolled back

FraudShield is a static site and a set of files, not a service. There is no server to patch, no database in production and no telemetry from visitors (ADR-0018),
so operating it means three things: shipping a change that has been proven, knowing within a day if the live site stops working, and being able to go back.

## What runs, and where
| Piece | Where | Proven by |
|---|---|---|
| The six pages, scripts, styles, fonts, icons, video | GitHub Pages, from this repository | `npm run check`, `npm run ux:clicks`, `scripts/smoke_live.js` |
| The domain-name model (`data/urlmodel.json`) | served with the site, checked in the browser before use | `npm run model:lineage:check`, monthly `reproduce.yml` |
| The rules (links, QR, messages, answers) | in the page's scripts | the test suite, the labelled question sets, the red-team ADRs |
| The release evidence gate | CI | `node mlops/run.js` (blocking on a release, a report on a pull request) |

## The pipeline
| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | every pull request and push to `master` | lint, generated regions, brand and motion checks, model lineage, the full test suite, the TypeScript app (strict), its build budget, a real-Chrome accessibility and speed audit, **every control clicked in a real Chrome on a phone and a laptop**, and the evidence report |
| `codeql.yml` | pull request, push, weekly | static analysis of the code |
| `dependency-review.yml` | every pull request | blocks a new or upgraded package with a known high-severity vulnerability |
| `scorecard.yml` | weekly | scores the repository's own supply-chain practices and posts them to the Security tab |
| `reproduce.yml` | monthly, on demand | retrains the model from the pinned public data and fails unless the file is byte-identical |
| `monitor.yml` | every morning, on demand | `scripts/smoke_live.js` against the live site; a failure sends the Actions failure e-mail |
| `release.yml` | a tag `vX.Y.Z` | the whole gate **and the field evidence** (no evidence, no release), then the site as served, a software bill of materials and a signed provenance attestation |
| `deploy.yml` | by hand | publishes exactly what `scripts/assemble_site.js` assembles, then runs the smoke test against the deployed site |

The evidence gate has two modes on purpose. A pull request is *told* there is no field data yet (a table on the run page) because nothing was measured and nothing
can be claimed either way; a model that measurably fails still fails there. A release runs the same gate without `--report`, so it cannot be tagged until the
evidence exists (ADR-0006, ADR-0010).

## Releasing
1. `npm run check` and `npm run ux:clicks` pass locally.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `release.yml` runs the gate, builds, attests and publishes. Verify a download: `gh attestation verify fraudshield-site-vX.Y.Z.tar.gz --repo azlanabyssal-cloud/fraudshield`, and compare `SHA256SUMS`.

## Deploying and rolling back
Until the repository's Pages source is switched to "GitHub Actions" the site is served from the `master` branch and `deploy.yml` changes nothing. After the switch:
- **Deploy:** run the workflow (default ref `master`). The `verify` job fails the run if the live site is not at the version just built.
- **Roll back:** run the workflow with an earlier tag as the ref. The previous release is one run away, and `sw.js`'s cache name changes with every release, so installed copies drop the bad version on their next visit.

## When the daily check fails
1. Open the run: it names the file and the status (`style.css: HTTP 404`, `sw.js: cache name is not ...`, `media/...: a range request answered 200`).
2. A 404 after a deploy means the assembled set is missing something: `tests/assemble.test.js` should have caught it, so add the missing case there first.
3. A stale service worker means a cache is serving an old file: bump the cache name in `sw.js` and redeploy.
4. If it is GitHub Pages itself, there is nothing to fix; the page `githubstatus.com` says so.

## If a bad model or rule ships
Revert the commit (the model is one file, `data/urlmodel.json`, and its lineage is checked on every push), tag a patch release, deploy. The assistant never says a
message is safe, so a missed scam is a weaker answer, not a false reassurance (ADR-0007); say so plainly in the release notes.

## What is not watched
There is no visitor telemetry, so real-world accuracy and usage cannot be seen from here, and `docs/OBSERVABILITY.md` says so. The on-device diagnostics panel is for
the person at the keyboard. Field evidence comes only from consented, labelled messages (`data_ops/`, `db/`), which is why the release gate waits for it.

## Settings that live outside the repository
These need an owner's click and are not done by code: Pages source (the cutover), branch protection on `master` requiring `test`, secret scanning and push protection,
and private vulnerability reporting (already on). `scorecard.yml` will report any of these that are missing.

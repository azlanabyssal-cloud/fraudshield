# Label store

PostgreSQL schema for double-blind labeling of the golden holdout. PostgreSQL is the database;
this directory is the schema, access rules and tests around it.

## What it enforces
| Rule | Mechanism |
|---|---|
| A labeler sees only their own labels | row-level security (`FORCE`), identity via `set_config('app.who', ...)` |
| A labeler cannot write as someone else | `WITH CHECK (annotator_id = app_user())` |
| Labels are never edited | no UPDATE/DELETE grant on `labels` |
| No personal data in stored text | CHECK constraint calling `pii_check()` |
| No duplicate messages | unique index on `normalize_for_dedup(text)` |
| Agreement is measurable | `cohen_kappa(a, b)` |
| Disagreements are visible | `needs_adjudication` view |
| Output feeds the existing pipeline | `export_rows(stage)` returns the CSV columns `validate_csv.js` expects |

## Tests
`npm test` runs `tests/db.test.js` on PGlite (PostgreSQL compiled to WASM). The SQL and JS PII
checks run over one corpus and must agree.

## Not done
- Never run against a networked PostgreSQL server; PGlite is single-connection, so concurrency
  behaviour is untested.
- No migrations tool; `schema.sql` is the whole schema.
- No real annotators or data yet.

## Run on a real server
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

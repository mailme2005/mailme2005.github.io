# Tripzy place library tools

Tripzy Issue 382 (ADR-0048, in the Tripzy repository). The app and the plan engine read the
place library from `tripzy/places/places_sg.json` on this site. Folders starting with `_` are
not published.

| File | What it is |
| --- | --- |
| `build.js` | The library checker, an exact copy of Tripzy's `places/build.js` (copied at Tripzy commit `9f75404f`). Change it there first, then copy it here. |
| `publish.js` | CSV → checks → compares with the published file → writes the next version and a summary, within the limits below. |
| `test/` | Offline tests: `node --test _tools/places/test/*.test.js` |
| `../../.github/workflows/tripzy-places.yml` | Runs daily (06:00 Singapore) and on demand; opens or updates one pull request. |

**Limits (D145):** every row must pass the checks (Singapore coordinates, lengths, known
categories, no links outside `source`, …); at most 3 places removed at a time; a removed id
(kept in `retired_ids`) never comes back. The workflow never merges or pushes to `main`.

**The published file:** `schema_version` 1, `library_version` (goes up by one per update),
`country`, `count`, `places` (as `build.js` writes them), `retired_ids`.

**Setup (once):** in the Sheet, File → Share → Publish to web → the place sheet → CSV; put the
link in this repository's Actions variable `TRIPZY_PLACES_CSV_URL`. Then allow GitHub Actions to
create pull requests (Settings → Actions → General).

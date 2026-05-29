# `easyread/ecloze` modernizer incident

Date: 2026-05-29

## Summary

The generic cloze modernizer was run against `easyread/ecloze`, which
shares the word "cloze" but does not share the same body structure as
the `begin1` cloze family.
It rewrote the pages into the wrong layout, removed the original
`ClozeDiv`/button-panel form structure, and produced broken output.

## Impact

- 198 `easyread/ecloze/*.html` pages were rewritten incorrectly.
- The body markup lost the legacy answer form and panel wiring.
- Validation noise appeared around unclosed or misordered elements
  because the generated structure no longer matched the source family.

## Root Cause

- The modernizer treated `easyread/ecloze` as if it were the same
  family as `begin1/cloze`.
- The tool optimized for the `begin1` cloze shape and replaced the
  `ecloze` body with a different template.
- There was no family gate preventing a destructive transform on a
  structurally incompatible corpus.

## What Worked

- The pages were recoverable from source control.
- The family-specific favicon normalization was safe.

## Lessons Learned

- Shared labels are not shared structure.
- A bulk transform must prove the target family before rewriting body markup.
- If a corpus only needs head normalization, the tool should make that
  explicit and refuse broader rewrites.

## Prevention

- `scripts/modernize-cloze-pages.cjs` now refuses to run on
  `easyread/ecloze` unless `--head-only` is set.
- `scripts/modernize-ecloze-pages.cjs` now forces `--head-only`.
- The safe `ecloze` path only normalizes favicon links and does not
  touch body markup.

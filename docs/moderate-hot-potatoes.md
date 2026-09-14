# Hot Potatoes Page Modernization

Use the repository-wide modernizer to consolidate inline presentation and
runtime visibility behavior across identified Hot Potatoes pages. Existing
head `<style>` blocks are preserved byte-for-byte; the migration handles inline
`style` attributes and generated button behavior.

## Commands

```sh
npm run modernize:hot-potatoes:dry
npm run modernize:hot-potatoes:apply
npm run test:modernize:hot-potatoes
```

Dry run is the default and does not write pages. It reports page coverage,
unmapped companion stories, ambiguous Hot Potatoes structures, inline style
attributes, button changes, and runtime visibility reads and writes. Apply
repeats the preflight, stops if any page is ambiguous or unmapped, verifies
external backups against the exact preflight content, then writes only changed
pages. A batch above 50 changed pages fails closed. A larger batch requires
both `--allow-bulk` and one or more explicit `--scope` arguments. Each target is
checked again immediately before replacement; writes use same-directory
temporary files and atomic renames, and a failed batch restores already-written
pages from the verified backups. The transformation also names generated
ShortAnswer fields that lack an accessible name. Every run re-evaluates all
identified pages, including pages touched by an earlier attempt. Each endpoint
is compared with its selected family prototype and classified `PASS`,
`UPDATE`, or `BLOCKED`. The per-page comment records the version, family,
prototype, and companion story. A matching comment never skips structural,
asset, or SRI checks. Bump `CURRENT_MODERNIZATION_VERSION` whenever the target
contract changes. Missing required structure, unresolved companion stories,
and unsafe transformations are printed as prototype anomalies and block the
entire apply.

The checked prototypes are `begin5/cloze/b5cloze008.html` for cloze,
`begin1/dict/b1d001.html` for dictation, `begin1/sent/b1mx00101.html` for
sentence scramble, and `begin1/cloze/b1cloze001.html` for the shared
Hot Potatoes contract. The companion story path (for example,
`begin1/b1/b1001.html`) is separately checked and drives the page's title and
theme.

The normalizer handles known prototype differences without touching exercise
answers: it converts plain title text to `h1.ExerciseTitle` and can restore an
empty title heading from that page's own document title; it adds the current
`.wrapfit` hook and action row to cloze pages that use the supported `.wrapit`
shell; and it adds a current animated Close control at the wrapper footer when
dictation or sentence pages have none. It also repairs the verified
`supereasy/dict/se_d039.html` layout where an outer `cenmar` encloses the full
exercise and a nested `cenmar` contains its Close control. That exception is
accepted only when the title, instruction, main, feedback, and nested Close
structure all match; other unexpected wrappers stay visible as anomaly alerts
and block apply. The linked-story script still replaces the temporary heading
text with the companion story title at runtime. The tests cover these repairs,
SRI-managed family assets, idempotence, and the rule that a current version
comment never suppresses a repair.

A different checkout can be scanned with `node scripts/modernize-hot-potatoes-pages.cjs
--dry-run --root PATH`. Use `--scope begin1` through `--scope begin6` to
preflight and apply one level at a time; `--scope` can be repeated to select
several configured roots. For example, after reviewing
`npm run modernize:hot-potatoes:dry`, a deliberate large B1 migration uses the
same explicit scope in both commands:

```sh
node scripts/modernize-hot-potatoes-pages.cjs --dry-run --scope begin1
node scripts/modernize-hot-potatoes-pages.cjs --apply --scope begin1 --allow-bulk
```

The apply gate counts changed pages, not scanned pages. `--allow-bulk` without
an explicit scope is an error. Do not add scopes or the bulk override until the
dry-run's changed-page count and samples have been reviewed.

`--allow-bulk` approves the entire planned set for the explicit scope in one
run. It does not apply 50 pages and queue the rest; the CLI has no page-offset
or batch-size option. Do not treat it as a 50-page continuation flag.

The scan identifies pages by Hot Potatoes metadata or the generated
`body#TheBody` and `FuncButton` structure under the configured exercise roots.
It excludes saved `-bu.html` copies. When the title or companion story cannot
be resolved, the script reports the page and refuses to apply partial
coverage.

## Shared behavior

The script consolidates supported inline display and visibility declarations
into utility classes in `css/sis-hot-potatoes.css`. It migrates runtime
`.style.display` and `.style.visibility` reads and writes to
`js/hot-potatoes-ui.js`, which uses those classes. Unsupported inline CSS or
runtime patterns are reported as transformation failures rather than dropped.
The migration also normalizes Hot Potatoes controls, removes generated Potato
hover/focus handlers, neutralizes the legacy runtime button-state functions so
they cannot strip the shared button class, and updates the labels to “Show
answers” and “Show all” / “Show one”. JavaScript Close links become real Close
buttons using the shared Check/Hint skin and delegated close behavior.

The shared layout centers exercise content, uses 12px vertical gaps, adapts
panes to screen width, and keeps the saved-details idle message compact. Each
exercise hides its empty feedback panel until feedback exists, and points to
its companion story for a clamped title and deterministic
background/paper theme. `js/story-theme.js` sets theme data attributes before
paint; `style/style.css` and `css/sis-hot-potatoes.css` map those attributes to
predeclared image URLs, so the theme does not need inline style writes.
The global theme selector stores its light/dark choice as a data attribute, and
the shared font stylesheet applies the corresponding `color-scheme` property.

The page transformer injects each selected prototype's shared and
family-specific stylesheets and scripts with current SRI hashes, then stamps
the page with the current modernization version. Cloze uses
`css/sis-cloze-submit.css` and `js/sis-cloze-submit.js`; dictation and sentence
scramble use `css/sis-exercise-layout.css`, `css/sis-cloze-submit.css`, and
`js/sis-exercise-submit.js`. After changing those shared assets, refresh the affected exercise
and story page references with the SRI tooling, then verify the exact affected
page set rather than rehashing hidden backups or unrelated legacy pages.
The SRI watcher tracks `css/`, `style/`, and `js/` assets. A watcher process
that started before this watch-list change will not adopt the new directory
until its normal restart; in that case, run `sri-rehash.cjs --verify` against
the HTML pages that reference the changed asset, apply only that same file
list, and verify it again. SRI-only refreshes update integrity attributes; they
must not rerun page modernization or alter exercise content.

## Bulk-change and recovery contract

The user reported that recovery from a damaging broad change took about nine
hours. The recorded Hot Potatoes migration on 2026-09-12 changed 10,715 pages;
a later accessible-name pass changed 1,784 pages. Those counts establish the
potential blast radius, but do not by themselves prove which individual edit
caused the reported recovery. The safeguards below prevent an unreviewed
repository-wide apply and preserve a verified recovery source.

Before applying, keep the dry-run output and review its changed count, sample
paths, transformation totals, ambiguous pages, and unmapped stories. Any
ambiguity or unsupported runtime/style pattern stops the complete run; never
skip failed pages to make a partial bulk pass appear successful. Keep the
scope to the affected content root. An apply above 50 changed pages must repeat
that exact scope and add `--allow-bulk`. Do not use the override without a
reviewed dry-run for the same scope.

The apply path validates that every target still matches the preflight source,
backs up every changed page before writing, and checks every backup byte for
byte. If the backup is missing or differs, no page is written. It stages output
beside each target, replaces files atomically, and rolls back any pages already
replaced if the batch fails. It reads back every successfully replaced page
before reporting success. The external backup directory is printed only after
a successful apply; preserve it until the postflight checks pass.

If a batch must be restored, use the exact backup directory printed by the
apply, preview it against the checkout, and restore only the files present in
that backup. For example, set `BACKUP` to the run directory and `ROOT` to the
checkout root, then run:

```sh
rsync -ani "$BACKUP/" "$ROOT/"
```

Review every listed path against the backup manifest; a page already identical
to its backup may be omitted from rsync's changed-file preview. Then apply the
same copy without `-n`:

```sh
rsync -ai "$BACKUP/" "$ROOT/"
```

This restore must not use `--delete`; the backup contains only the page files
changed by that run. Re-run the modernizer dry-run for the restored scope,
compare page hashes or representative content against the backup, run the
modernizer tests, and check the actual exercise routes in a browser before any
sync or release.

Regression tests enforce the 50-page default limit, require an explicit scope
for a bulk override, prove an oversized apply performs no backup or writes,
reject stale preflight content, verify backup bytes before writing, and check
that cloze Check/Hint effects stay within their button bounds while keyboard
focus remains visible.

## Applied migration record

On 2026-09-12, the apply command migrated 10,715 pages with companion stories
and reported no ambiguous or unmapped pages. It removed 14,912 inline style
attributes, normalized 108,639 controls, removed 555,604 generated hover
handlers, and migrated 3,629 visibility reads and 133,214 visibility writes.
The original files are backed up at:

`/home/eagles/dockerz/efast-bu/modernize-hot-potatoes-2026-09-12T17-53-20-909Z-339393`

The post-apply dry run reported no further changes. The apply run also verified
that every original page head `<style>` block remained unchanged.

On 2026-09-13, a follow-up apply added accessible names to 12,006 ShortAnswer
fields across 1,784 pages. Those pages are backed up at:

`/home/eagles/dockerz/efast-bu/modernize-hot-potatoes-2026-09-12T18-31-30-222Z-453106`

On 2026-09-13, the cloze button-boundary CSS change required an SRI-only
refresh for 4,158 pages. Their exact pre-refresh copies are at:

`/home/eagles/dockerz/efast-bu/sri-cloze-submit-css-2026-09-13T12-36-14-872Z-679071`

The sibling manifest
`/home/eagles/dockerz/efast-bu/sri-cloze-submit-css-2026-09-13T12-36-14-872Z-679071.MANIFEST.sha256`
contains SHA-256 hashes for all 4,158 copies. Post-refresh verification scanned
the same 4,158 pages and reported zero stale integrity values. It retained
nine missing-asset warnings from the existing `begin6/dict/1. The Hairstyle
Change.html` page; those unrelated legacy asset paths were not changed.

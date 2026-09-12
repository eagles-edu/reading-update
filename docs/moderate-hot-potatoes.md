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
repeats the preflight, stops if any page is ambiguous or unmapped, creates
backups with `scripts/write-backup.cjs`, and writes only changed pages. The
transformation also names generated ShortAnswer fields that lack an accessible
name. It is idempotent. A different checkout can be scanned with
`node scripts/modernize-hot-potatoes-pages.cjs --dry-run --root PATH`.

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
hover/focus handlers, and updates the labels to “Show answers” and “Show all” /
“Show one”.

The shared layout centers exercise content, uses 12px vertical gaps, adapts
panes to screen width, and keeps the saved-details idle message compact. Each
exercise points to its companion story for a clamped title and deterministic
background/paper theme. `js/story-theme.js` sets theme data attributes before
paint; `style/style.css` and `css/sis-hot-potatoes.css` map those attributes to
predeclared image URLs, so the theme does not need inline style writes.
The global theme selector stores its light/dark choice as a data attribute, and
the shared font stylesheet applies the corresponding `color-scheme` property.

The page transformer injects the shared stylesheet and scripts with current
SRI hashes. After changing those shared assets, refresh the affected exercise
and story page references with the SRI tooling, then verify the exact affected
page set rather than rehashing hidden backups or unrelated legacy pages.

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

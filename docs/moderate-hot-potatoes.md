# Hot Potatoes Page Modernization

Use the repository-wide modernizer to consolidate inline presentation and runtime visibility behavior across identified Hot Potatoes pages. Existing head `<style>` blocks are preserved byte-for-byte; the migration handles inline `style` attributes and generated button behavior.

## Commands

```sh
npm run modernize:hot-potatoes:dry
npm run modernize:hot-potatoes:apply
npm run test:modernize:hot-potatoes
npm run audit:cloze:integrity
npm run audit:dict:integrity
npm run audit:sent:integrity
npm run audit:comp:integrity
```

Dry run is the default and does not write pages. It reports page coverage, unmapped companion stories, ambiguous Hot Potatoes structures, inline style attributes, button changes, and runtime visibility reads and writes. Apply repeats the preflight, stops if any page is ambiguous or unmapped, verifies external backups against the exact preflight content, then writes only changed pages. A batch above 50 changed pages fails closed. A larger batch requires both `--allow-bulk` and one or more explicit `--scope` arguments. Each target is checked again immediately before replacement; writes use same-directory temporary files and atomic renames, and a failed batch restores already-written pages from the verified backups. The transformation also names generated ShortAnswer fields that lack an accessible name. Every run re-evaluates all identified pages, including pages touched by an earlier attempt. The summary separates requirements missing in the source, pages already compliant with no file changes, and pages requiring file updates; the family breakdown uses the same counts. File updates can include SRI or version-marker refreshes, so they are not described as conversions. Static post-normalization checks show passed pages against the expected cloze, dictation, sentence, and comprehension contract. A current version comment and similarity to a prototype never establish compliance. The per-page comment records the version, family, prototype, and companion story. Bump `CURRENT_MODERNIZATION_VERSION` whenever the target contract changes. Missing required structure, unresolved companion stories, and unsafe transformations are reported as source-structure blocks and stop the entire apply. For a scoped recovery run, `--allow-blocked` excludes only pages that fail transformation and records each as `BLOCKED` with remediation in the JSON report; it never permits ambiguous pages or unresolved companion stories, and requires an explicit `--scope` or `--path`.

`npm run audit:cloze:integrity` is read-only over every cloze page in the configured level and content collections (`begin1` through `begin6`, `eslread`, `essays`, `kidsenglish`, `kidsenglish2`, `kidsenglish3`, and `people`). It implements the shared and cloze-specific checklist, verifies local asset bytes against each page's SRI values, resolves companion stories, checks action-control and empty-navigation contracts, compares structural shape, and writes `docs/CLOZE-INTEGRITY-REPORT.json` plus Markdown. Add `--visual-dir output/playwright/cloze-integrity` after the Playwright sample pass to record that five artifacts per collection/level were captured.

`npm run audit:dict:integrity`, `npm run audit:sent:integrity`, and `npm run audit:comp:integrity` apply the same read-only audit pattern to dictation, sentence scramble, and comprehension. Each independently runs the complete shared and family-specific MMOR contract against every page, checks family assets/SRI/story mapping, identity gates, action-control styling and clipping, empty legacy navigation, runtime placement/scoring contracts, and source placeholders. Prototype shape comparison is supplemental evidence only; it cannot make a page pass when a checklist requirement fails. Each command writes a family-specific JSON/Markdown report. Use `--visual-dir output/playwright/<family>-integrity` after the five-page-per-collection browser sample pass to mark visual artifacts captured.

The checked family prototypes are `begin1/cloze/b1cloze001.html` for cloze, `begin1/dict/b1d001.html` for dictation, `begin1/sent/b1mx00101.html` for sentence scramble, and `essays/comp/essaycomp001.html` for comprehension. Their mobile viewport metadata is required across all four families; cloze also requires the B1 prototype marker and an accessible label for every `GapN` input. The companion story path (for example, `begin1/b1/b1001.html`) is separately checked and drives the page's title and theme.

Every finished cloze, dictation, sentence, and comprehension page requires one direct canonical shell: `body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit`. The normalizer recognizes legacy `.wrapit`, `.exercise-wrapper`, and the documented `cenmar` source shape only as input, then removes those legacy shell tokens from the finished page. Runtime selectors use the canonical shell only.

The normalizer adds the required mobile viewport metadata and, for cloze pages, the B1 prototype marker plus screen-reader labels for every `GapN` input. It handles known prototype differences without touching exercise answers: it converts plain title text to `h1.ExerciseTitle`, moves the title and instructions into one instruction panel, and can restore an empty title heading from that page's own document title; it adds the current `.wrapfit` hook and action row to cloze pages that use the supported `.wrapit` shell; it adds a current animated Close control at the wrapper footer when a page has none; and it removes duplicate Close controls, including Close buttons left in legacy top/bottom navigation bars. Sentence sequence pages retain both blue `TopNavBar` and `BottomNavBar` containers whenever they contain legitimate `Previous` or `Next` controls. If a terminal sequence page has a real immediate predecessor but its populated bars were lost, the normalizer discovers the sequence's actual final position and restores a `Previous` control in both bars; this supports sequences longer than five pages. Empty and Close-only bars remain removable. It also repairs the verified `supereasy/dict/se_d039.html` layout where an outer `cenmar` encloses the full exercise and a nested `cenmar` contains its Close control. That exception is accepted only when the title, instruction, main, feedback, and nested Close structure all match; other unexpected wrappers stay visible as anomaly alerts and block apply. The linked-story script still replaces the temporary heading text with the companion story title at runtime. The tests cover all four prototypes, this duplicate-control regression, terminal sentence navigation restoration including sequences longer than five pages, SRI-managed family assets, idempotence, and the rule that a current version comment never suppresses a repair.

Malformed-source rule: restore a truncated exercise only from a verified complete source before modernization. `begin1/sent/b1mx08905.html` was restored from its verified authoritative source and modernized. The unrelated kidsenglish3 404 placeholder is preserved as `kidsenglish3/sent/kemx305582.html.invalid` and is excluded from exercise audits because its original exercise content is unavailable. The remaining HTTP 404 placeholders `essays/cloze/cloze100.html` and `essays/comp/comp100.html` remain `ACTION_REQUIRED`; the modernizer must not invent answers, questions, or controls for them.

## UPDATING EXERCISES

A different checkout can be scanned with `node scripts/modernize-hot-potatoes-pages.cjs --dry-run --root PATH`. Use `--scope begin1` through `--scope begin6` to preflight and apply one level at a time; `--scope begin1` scans B1 only and does not include B2. `--scope` can be repeated to select several configured roots. Each run prints its effective scope with the per-family counts. For example, after reviewing `npm run modernize:hot-potatoes:dry`, a deliberate large B1 migration uses the same explicit scope in both commands:

```sh
node scripts/modernize-hot-potatoes-pages.cjs --dry-run --scope begin1
node scripts/modernize-hot-potatoes-pages.cjs --apply --scope begin1 --allow-bulk
```

The apply gate counts changed pages, not scanned pages. `--allow-bulk` without an explicit scope is an error. Do not add scopes or the bulk override until the dry-run's changed-page count and samples have been reviewed.

`--allow-bulk` approves the entire planned set for the explicit scope in one run. It does not apply 50 pages and queue the rest; the CLI has no page-offset or batch-size option. Do not treat it as a 50-page continuation flag.

The scan identifies pages by Hot Potatoes metadata or the generated `body#TheBody` and `FuncButton` structure under the configured exercise roots. It excludes saved `-bu.html` copies. When the title or companion story cannot be resolved, the script reports the page and refuses to apply partial coverage.

## Shared behavior

The script consolidates supported inline display and visibility declarations into utility classes in `css/sis-hot-potatoes.css`. It migrates runtime `.style.display` and `.style.visibility` reads and writes to `js/hot-potatoes-ui.js`, which uses those classes. Unsupported inline CSS or runtime patterns are reported as transformation failures rather than dropped. The migration also normalizes Hot Potatoes controls, removes generated Potato hover/focus handlers, neutralizes the legacy runtime button-state functions so they cannot strip the shared button class, and updates the labels to “Show answers” and “Show all” / “Show one”. JavaScript Close links become real Close buttons using the shared Check/Hint skin and delegated close behavior.

The shared layout centers exercise content, uses 12px vertical gaps, adapts panes to screen width, and keeps the saved-details idle message compact. Each exercise hides its empty feedback panel until feedback exists, and points to its companion story for a clamped title and deterministic background/paper theme. `js/story-theme.js` sets theme data attributes before paint; `style/style.css` and `css/sis-hot-potatoes.css` map those attributes to predeclared image URLs, so the theme does not need inline style writes. The global theme selector stores its light/dark choice as a data attribute, and the shared font stylesheet applies the corresponding `color-scheme` property.

All family instruction paragraphs use the shared `body#TheBody #InstructionsDiv .sis-exercise-instructions` token from `css/sis-hot-potatoes.css`: `font-size: 1rem`, `font-weight: 400`, `line-height: 1.5`, `margin: 0`, and `text-indent: 0`. Family scripts must generate that class rather than a family-specific instruction class.

The page transformer injects each selected prototype's shared and family-specific stylesheets and scripts with current SRI hashes, then stamps the page with the current modernization version. Cloze uses `style/font-stack.css`, `js/theme-selector.js`, `css/sis-cloze-submit.css`, and `js/sis-cloze-submit.js`; dictation and sentence scramble use `css/sis-exercise-layout.css`, `css/sis-cloze-submit.css`, and `js/sis-exercise-submit.js`; comprehension uses those layout assets plus `js/sis-comprehension-submit.js`. All four families normalize to exactly one accessible Close control. Cloze normalization also converts active legacy `CheckButton*`/`ShowHint()` controls to exactly one static `#check` and `#hint` pair, and removes a legacy `#TopNavBar`/`#BottomNavBar` when its only meaningful content is a Close control. This prevents the runtime-built prototype footer from producing a black navigation strip and duplicate Close button. After changing those shared assets, refresh the affected exercise and story page references with the SRI tooling, then verify the exact affected page set rather than rehashing hidden backups or unrelated legacy pages. The SRI watcher tracks `css/`, `style/`, and `js/` assets. A watcher process that started before this watch-list change will not adopt the new directory until its normal restart; in that case, run `sri-rehash.cjs --verify` against the HTML pages that reference the changed asset, apply only that same file list, and verify it again. SRI-only refreshes update integrity attributes; they must not rerun page modernization or alter exercise content.

## Bulk-change and recovery contract

The user reported that recovery from a damaging broad change took about nine hours. The recorded Hot Potatoes migration on 2026-09-12 changed 10,715 pages; a later accessible-name pass changed 1,784 pages. Those counts establish the potential blast radius, but do not by themselves prove which individual edit caused the reported recovery. The safeguards below prevent an unreviewed repository-wide apply and preserve a verified recovery source.

Before applying, keep the dry-run output and review its changed count, sample paths, transformation totals, ambiguous pages, and unmapped stories. Any ambiguity or unsupported runtime/style pattern stops the complete run; never skip failed pages to make a partial bulk pass appear successful. Keep the scope to the affected content root. An apply above 50 changed pages must repeat that exact scope and add `--allow-bulk`. Do not use the override without a reviewed dry-run for the same scope.

The apply path validates that every target still matches the preflight source, backs up every changed page before writing, and checks every backup byte for byte. If the backup is missing or differs, no page is written. It stages output beside each target, replaces files atomically, and rolls back any pages already replaced if the batch fails. Before apply, every cloze, dictation, sentence, and comprehension page is normalized a second time; the output must be byte-stable and its family submission script must contain the EaglesID/student-email Check/Hint instruction. After apply, the same requirements are checked again against each written page. Any missing requirement blocks preflight or rolls back the complete batch, and the summary reports static checks passed versus expected family checks. The external backup directory is printed only after a successful apply; preserve it until the postflight checks pass.

## RESTORATION

If a batch must be restored, use the exact backup directory printed by the apply, preview it against the checkout, and restore only the files present in that backup. For example, set `BACKUP` to the run directory and `ROOT` to the checkout root, then run:

```sh
rsync -ani "$BACKUP/" "$ROOT/"
```

Review every listed path against the backup manifest; a page already identical to its backup may be omitted from rsync's changed-file preview. Then apply the same copy without `-n`:

```sh
rsync -ai "$BACKUP/" "$ROOT/"
```

This restore must not use `--delete`; the backup contains only the page files changed by that run. Re-run the modernizer dry-run for the restored scope, compare page hashes or representative content against the backup, run the modernizer tests, and check the actual exercise routes in a browser before any sync or release.

Regression tests enforce the 50-page default limit, require an explicit scope for a bulk override, prove an oversized apply performs no backup or writes, reject stale preflight content, verify backup bytes before writing, and check that cloze Check/Hint effects stay within their button bounds while keyboard focus remains visible.

## Applied migration record

On 2026-09-12, the apply command migrated 10,715 pages with companion stories and reported no ambiguous or unmapped pages. It removed 14,912 inline style attributes, normalized 108,639 controls, removed 555,604 generated hover handlers, and migrated 3,629 visibility reads and 133,214 visibility writes. The original files are backed up at:

`/home/eagles/dockerz/efast-bu/modernize-hot-potatoes-2026-09-12T17-53-20-909Z-339393`

The post-apply dry run reported no further changes. The apply run also verified that every original page head `<style>` block remained unchanged.

On 2026-09-13, a follow-up apply added accessible names to 12,006 ShortAnswer fields across 1,784 pages. Those pages are backed up at:

`/home/eagles/dockerz/efast-bu/modernize-hot-potatoes-2026-09-12T18-31-30-222Z-453106`

On 2026-09-13, the cloze button-boundary CSS change required an SRI-only refresh for 4,158 pages. Their exact pre-refresh copies are at:

`/home/eagles/dockerz/efast-bu/sri-cloze-submit-css-2026-09-13T12-36-14-872Z-679071`

The sibling manifest `/home/eagles/dockerz/efast-bu/sri-cloze-submit-css-2026-09-13T12-36-14-872Z-679071.MANIFEST.sha256` contains SHA-256 hashes for all 4,158 copies. Post-refresh verification scanned the same 4,158 pages and reported zero stale integrity values. It retained nine missing-asset warnings from the existing `begin6/dict/1. The Hairstyle Change.html` page; those unrelated legacy asset paths were not changed.

The current contract has a shared baseline plus family-specific requirements. The checks below describe what the modernizer requires in the finished page; its prototypes are cloze `begin1/cloze/b1cloze001.html`, dictation `begin1/dict/b1d001.html`, sentence scramble `begin1/sent/b1mx00101.html`, and comprehension `essays/comp/essaycomp001.html` ([profiles in the script](/home/eagles/dockerz/efast-copy/scripts/modernize-hot-potatoes-pages.cjs:38)).

## Requirements for all four exercise types

1. `<body id="TheBody">`.
2. A viewport meta tag with `width=device-width` and `initial-scale=1` or `1.0`.
3. An instruction panel containing an `h1.ExerciseTitle`, plus `#InstructionsDiv` and `#MainDiv`.
4. Exactly one accessible Close control with the `btn-74 tm1-5` classes in the finished page. The shared stylesheet defines `.tm1-5 { margin-top: 1.5em; }`.
5. A resolvable companion story, used at runtime for the exercise title and theme.
6. Shared assets: `css/sis-hot-potatoes.css`, `js/hot-potatoes-ui.js`, `css/hot-potatoes-feedback.css`, `js/hot-potatoes-feedback.js`, and `js/story-theme.js`.
7. Supported inline display/visibility styles converted to shared classes; legacy visibility code and button handlers normalized; empty feedback and empty legacy navigation bars are removed or hidden until used.
8. Current asset integrity hashes in the generated page, preserved head `<style>` blocks, and no remaining inline `style` attributes. ([Shared behavior in the guide](/home/eagles/dockerz/efast-copy/docs/moderate-hot-potatoes.md:89))
9. Exactly one direct canonical shell: `body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit`. Final pages contain neither `.wrapit` nor `.exercise-wrapper` as a direct shell.
10. The runtime identity panel must explain that EaglesID and student email activate Check and Hint. Empty or invalid identity data keeps Check and Hint disabled.
11. Every non-Close action control uses `btn-17 hp-button`; its animated effect is clipped to its own button. Close remains the separately defined `btn-74 tm1-5` control.

**Cloze — B1 001 cloze** prototype

1. The direct canonical shell described above.
2. `<meta name="sis-cloze-prototype" content="current">`.
3. The title structure must be `.hp-instructions-panel > .Titles > h1.ExerciseTitle`.
4. `#InstructionsDiv`, `#MainDiv`, `#ClozeDiv`, and `#FeedbackDiv`.
5. A `.btn17Container` action row and a `.btn-74` Close control.
6. At least one input with an ID like `Gap0` must exist, and every such input must have a matching `<label for="Gap0">`. A page with no static gap fields is blocked as an incomplete source page; the modernizer will not fabricate exercise content.
7. Family assets: `style/font-stack.css`, `js/theme-selector.js`, `css/sis-cloze-submit.css`, and `js/sis-cloze-submit.js`, all with current SRI. The normalizer adds the action row and gap labels when missing, converts legacy Check/Hint controls to `#check`/`#hint`, reduces duplicate Close controls to one, and unwraps a one-Close legacy navigation bar so the runtime footer is the only rendered Close control; it leaves HTTP error placeholders blocked rather than fabricating exercise content. ([Cloze profile and checks](/home/eagles/dockerz/efast-copy/scripts/modernize-hot-potatoes-pages.cjs:47))

**Dictation — B1 001 dictation** exercise

1. The direct canonical shell described above.
2. The title structure must be `.hp-instructions-panel > .Titles > h1.ExerciseTitle`.
3. `#InstructionsDiv`, `#MainDiv`, and `#FeedbackDiv`, plus exactly one finished `.btn-74` Close control.
4. Family assets: `css/sis-exercise-layout.css`, `css/sis-cloze-submit.css`, and `js/sis-exercise-submit.js` marked `data-sis-exercise-family="dict"`.
5. Short-answer textareas need accessible names. If no recognizable Close control exists, the normalizer adds one at the wrapper footer; duplicate Close controls are reduced to one. ([Dictation profile](/home/eagles/dockerz/efast-copy/scripts/modernize-hot-potatoes-pages.cjs:67))
6. Runtime places Submit in the final question's inline action controls; Check, Hint, and Answers stay in each question's inline action controls.

**Sentence scramble — B1 001 sentence** exercise

1. The direct canonical shell described above.
2. The title structure must be `.hp-instructions-panel > .Titles > h1.ExerciseTitle`.
3. `#InstructionsDiv`, `#MainDiv`, and `#FeedbackDiv`, plus exactly one finished `.btn-74` Close control.
4. Family assets: `css/sis-exercise-layout.css`, `css/sis-cloze-submit.css`, and `js/sis-exercise-submit.js` marked `data-sis-exercise-family="sent"`.
5. Short-answer textareas need accessible names. If no recognizable Close control exists, the normalizer adds one at the wrapper footer; duplicate Close controls are reduced to one. ([Sentence profile](/home/eagles/dockerz/efast-copy/scripts/modernize-hot-potatoes-pages.cjs:84))
6. Runtime places Check, Undo, Restart, Hint, and Submit together in the inline action controls.
7. Sequence navigation is part of the sentence contract: populated pages keep both blue `TopNavBar` and `BottomNavBar` containers with their legitimate `Previous`/`Next` controls. The actual terminal page of every local sequence, whether it ends at `05`, `08`, or another position, must have a `Previous` control in both bars pointing to the immediate existing predecessor. Empty or Close-only legacy bars are removed, and the page still has exactly one footer Close control.

The version comment records the version, family, prototype, and story, but does not establish that these requirements are met. The audit checks every documented structural, asset, runtime, control, and source-health requirement separately; prototype comparison is supplemental and never substitutes for the full checklist.

**Comprehension — essays/comp/essaycomp001.html** modernization

1. The direct canonical shell described above.
2. The title structure must be `.hp-instructions-panel > .Titles > h1.ExerciseTitle`.
3. `#InstructionsDiv`, `#MainDiv`, `#Questions`, and `#FeedbackDiv` are unique and correctly nested.
4. Exactly one finished `.btn-74` Close control is present.
5. Family assets include `css/sis-exercise-layout.css`, `css/sis-cloze-submit.css`, `css/sis-exercise-family-layout.css`, and `js/sis-comprehension-submit.js` marked `data-sis-exercise-family="comp"`, all with current SRI.
6. `#Questions` contains indexed `.QuizQuestion` items, one `.MCAnswers` list per question, and `CheckMCAnswer`-wired answer buttons.
7. Submission preserves the native MC scorer and sends SIS-compatible `totalQuestions`, `correctCount`, `pendingCount`, `incorrectCount`, and `scorePercent` fields after all questions are complete. The five-question browser contract is covered by `scripts/sis-comprehension-submit.test.cjs`.

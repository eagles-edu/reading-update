# Ecloze Modernization SOP

This workflow is mandatory for `easyread/ecloze`.

The goal is not to strip the legacy exercise into a blank scaffold.
The goal is to normalize the existing exercise into the established
mobile-first cloze shell, then wire SIS live reporting into that same
shell.

The structural reference shape is the live begin-family page at
`begin5/cloze/b5cloze008.html` as served from the local test host.
Use that shape as the apples-to-apples model for wrapper, spacing,
panels, buttons, and close control behavior.

## Rules

1. Back up before the first write.
2. Work from a representative copy inside the live
   `easyread/ecloze/` directory, alongside the target pages.
3. Lint before any edit.
4. Fix broken structural lint failures first. Close-order, nesting,
   implicit-close, and similar HTML repair issues are real code
   errors, not modernization output.
5. Only after the page is structurally sound do we prototype the
   modernization shape.
6. The prototype shape is the established cloze shell plus the shared
   assets:
   - any `ExerciseTitle` heading becomes `h1.ExerciseTitle`
   - gap inputs get accessible labels
   - the shared CSS is used for the mobile-first shell
   - the shared SIS JS is loaded for live reporting
7. Modernize the representative copy manually until it is clean and
   matches the established shape.
8. Lint again after every pass.
9. Only after the representative copy is clean, update the modernizer rules.
10. Apply the proven rules in bulk to the live `easyread/ecloze` set.
11. Lint and verify again after bulk apply.

## Required shape checks

The representative and bulk output must preserve the established
ecloze structure:

- `h1.ExerciseTitle` at the top of the title block. Any
  `ExerciseTitle` heading level from `h1` through `h6` is normalized
  to `h1`.
- Gap inputs wrapped with accessible labels.
- Existing instructions panel, main cloze panel, feedback panel,
  check/hint buttons, and close button preserved.
- The body shell matches the `begin5/cloze/b5cloze008.html` pattern:
  - `div.Titles`
  - `#InstructionsDiv.StdDiv`
  - `#MainDiv.StdDiv`
  - `#ClozeDiv`
  - `div.btn17Container`
  - `button.btn-17#check`
  - `button.btn-17#hint`
  - `#FeedbackDiv`
  - `button.btn-74` close control
- No `NavButtonBar` wrappers remain in the normalized output.
- The shared CSS file `css/sis-cloze-submit.css` is linked so the
  mobile-first shell is driven by shared styles, not repeated inline
  layout rules.
- The shared SIS bridge `js/sis-cloze-submit.js` is linked so the
  exercise reports live results.
- The shared font/theme assets remain linked when present in the
  legacy head, with integrity rehashed after the update.
- `verify:ecloze` must pass after bulk modernization.
- Structural repair comes first; the prototype starts only after the
  page is valid enough to reason about the target shape.

## Standard run order

1. Create or select an in-tree working copy in `easyread/ecloze/` itself.
2. Run `html:check:file` on the copy.
3. Read the lint failures and fix broken structure before prototype work.
4. Modernize the copy with the dedicated ecloze sample script for the
   target shape only. The target shape includes the shared CSS and SIS
   bridge.
5. Re-run `html:check:file` on the copy.
6. Adjust the sample modernizer until the copy is clean.
7. Run the family modernizer against `easyread/ecloze`.
8. Re-run `html:check:file` and `verify:ecloze`.

## Notes

- The sample copy is the source of truth for the final ecloze shape.
- The family modernizer must stay aligned with the representative copy.
- The canonical shell is mobile first and constrained to
  `max-width: 920px`.
- The shared layout spacing is:
  - top margin around the shell: `2rem`
  - title bottom margin: `1rem`
  - instructions panel spacing: `1rem`
  - body/footer rule spacing: `1rem`
- Existing button styles are preserved through shared CSS:
  - check and hint controls use the shared button treatment
  - close buttons use the established close-button treatment
- Any apply path must write backups under `/home/eagles/dockerz/efast-bu`.

# Cloze Modernization SOP

This workflow is mandatory for all `begin*/cloze` families and for
`easyread/ecloze`.

The goal is to normalize every cloze corpus to the same established
mobile-first shell shape used by `begin5/cloze/b5cloze008.html`, while
preserving the actual story content and gap logic.

## Rules

1. Back up before the first write.
2. Keep the working copy in the live family directory.
3. Lint before any edit.
4. Fix broken structure first.
5. Normalize the established shell shape next.
6. Modernize headings and labels after the page is structurally sound.
7. Re-run lint after each pass.
8. Apply the proven family rules in bulk only after the representative
   copy is clean.
9. Verify again after the bulk pass.

## Target Shape

The target shell follows `begin5/cloze/b5cloze008.html`:

- `div.Titles`
- `#InstructionsDiv.StdDiv`
- `#MainDiv.StdDiv`
- `#ClozeDiv`
- `div.btn17Container`
- `button.btn-17#check`
- `button.btn-17#hint`
- `#FeedbackDiv`
- `button.btn-74` close control

Additional normalized behavior:

- `h1.ExerciseTitle` at the top of the title block.
- Any `ExerciseTitle` heading level from `h1` through `h6` is
  normalized to `h1`.
- Gap inputs get accessible labels.
- The shared CSS file `css/sis-cloze-submit.css` is linked.
- The shared SIS bridge `js/sis-cloze-submit.js` is linked.
- `NavButtonBar` wrappers and their CSS selectors do not remain.
- The shell stays mobile first and constrained to `max-width: 920px`.

## Standard Run Order

1. Select a representative file in the live family directory.
2. Run `html:check:file` on that representative.
3. Fix structural HTML defects first.
4. Modernize the representative until it matches the target shape.
5. Re-run `html:check:file` on the representative.
6. Run the family modernizer across the whole directory.
7. Re-run lint and family verification.

## Backup Rule

Any apply path must write backups under `/home/eagles/dockerz/efast-bu`
before the first file write.

# Make dictation and sentence modernization as real and verifiable as cloze

## Summary

The current checkout cannot prove the requested outcome. The three B1 prototype files already contain dirty, partial modernization changes, so a no-op run only proves that the current normalizer accepts those files. The Begin1 dry run predicts 726 normalized pages, yet 720 source pages require structural changes and one sentence page is blocked (`begin1/sent/b1mx06301.html`). That prediction is not functional proof.

The key testing gap is concrete: the dictation/sentence runtime suite serves generated fixture HTML at B1 URLs instead of the real B1 prototype files. It can pass while the actual prototype pages remain legacy or fail to boot. Cloze must remain the proven behavior model; dictation and sentence need equivalent real-page verification.

## Implementation changes

- Preserve the dirty checkout before any write:
  - Verify `HEAD` equals `origin/main` and record the complete dirty-file inventory.
  - Create and verify an external SHA-256 backup of all tracked and untracked work.
  - Capture preflight SHA-256, wrapper inventory, MMOR results, source-to-story mapping, and asset SRI for the three prototypes and B1001’s seven exercises.
  - Refuse an apply if any selected file differs from its preflight bytes.

- Make the normalizer’s acceptance contract independent:
  - Rename prototype-derived internal names so reports no longer imply that a page passed merely by matching a prototype.
  - Keep stable MMOR IDs and make each check inspect the normalized page structure and its resolved local assets.
  - Require exactly one direct `body#TheBody > .wrapfit`; retain `.wrapit` only when it existed as a compatibility class; remove `.exercise-wrapper`.
  - Accept only known direct wrapper shapes. Block missing, nested, duplicate, unknown, or structurally ambiguous wrappers with a page-specific remediation.
  - Preserve head `<style>` blocks, remove managed inline visibility styles, recalculate SRI, and enforce the story mapping.

- Close the dictation/sentence family gap:
  - Treat `sis-exercise-submit.js` as a separate family runtime contract from cloze’s `sis-cloze-submit.js`.
  - Verify after browser boot that the identity panel was inserted into the real page, names EaglesID and student email, disables Check and Hint until valid values exist, and enables them after valid values.
  - Verify dictation textareas retain accessible names; sentence feedback and `#GuessDiv` remain hidden until content exists.
  - Verify family CSS does not apply cloze geometry to dictation or sentence wrappers.
  - Preserve legacy exercise logic and make the shared runtime wrap it rather than replacing scoring, hints, question sequencing, or answer handling.

- Add safe target selection:
  - Add repeatable `--path <repo-relative-page>` to the modernizer for a reviewed set of individual pages.
  - Use it for the three B1 prototypes first, then the B1001 story’s seven linked exercises.
  - Keep `--scope begin1` dry-run-only for this work. Do not apply the remaining Begin1 corpus.

- Produce evidence, not marker counts:
  - Extend JSON reporting with preflight and final wrapper values, source and final MMOR rows, browser result status, asset/SRI evidence, file hashes, change category, blocker, and remediation.
  - Report “Good,” “Bad,” and “Ugly” by family. Count only actual structural writes as conversions; keep SRI-only, marker-only, unchanged, blocked, and browser-unverified pages separate.

## Test plan

- Replace generated B1 URL fixtures with a local static server that serves the real prototype and B1001 exercise files plus their real shared assets.
- Add failure tests for each wrapper shape: `.wrapfit`, `.wrapit`, both, `.exercise-wrapper`, missing, nested, duplicate, and unknown.
- Add real-page browser tests for all three prototypes:
  - empty and invalid EaglesID/email keep Check and Hint unavailable;
  - valid details enable them;
  - Hint, Check, feedback, score, Submit eligibility, Close, and story title/theme work on the real page;
  - sentence empty `#GuessDiv` and all empty feedback panels are invisible until content is written.
- Complete each B1001 exercise flow using its real embedded answer data through visible controls, then verify the series completion and Submit state.
- Capture desktop and mobile screenshots of the prototypes and B1001 set. Fail verification on horizontal overflow, clipped controls, overlap, console errors, failed local assets, or missing identity/feedback behavior.
- Run structural/MMOR tests, runtime tests, SRI checks, `git diff --check`, then a full Begin1 dry run. The final dry run must distinguish the single blocked sentence source from pages that are safely transformable.

## Assumptions

- `.wrapfit` is mandatory for all finished cloze, dictation, and sentence pages; `.wrapit` is compatibility-only.
- The first writable target is only the three B1 prototypes, followed by the seven linked B1001 exercises after those prototypes pass real-page tests.
- The companion story remains untouched unless runtime title/theme verification identifies a story defect.
- No broad Begin1 apply, commit, push, or deployment occurs as part of this work.

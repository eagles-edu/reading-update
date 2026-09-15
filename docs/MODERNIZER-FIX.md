# Bring the Hot Potatoes modernizer to operational readiness

## Summary

The audit found a class-contract mismatch: dictation and sentence pages are required to have `.exercise-wrapper`, while their runtime expects a direct `body#TheBody > .wrapit` or `.wrapfit`. That can produce a structural pass while the exercise shell and identity gate fail to initialize. The current post-conversion check proves idempotence, not functional behavior.

The B2 dry run reports 770 pages with no planned changes and current asset hashes. The B1 dry run reports 727 updates, including 623 false wrapper gaps and version-marker-only changes. Those counters must be separated from actual requirement compliance and structural conversion.

## Implementation changes

- **Protect the existing checkout first.** Recheck that `HEAD` matches `origin/main` (the audited state did). Before editing, make and verify an external backup of all current local changes and a SHA-256 manifest. Preserve the 9,967-file dirty tree; do not commit or push it as a batch.
- **Correct checks by family.** Keep cloze’s `.wrapfit` contract. For dictation and sentence, accept and validate the direct `.wrapit` or `.wrapfit` wrapper the runtime actually selects. Stop adding or requiring `.exercise-wrapper`; preserve that class where it already exists. Fail closed when the required direct wrapper is absent.
- **Make post-conversion verification independent.** Parse the resulting DOM and check each shared and family requirement from the supplied MMOR list: IDs and nesting, working Close control, linked story resolution, exact family assets and markers, gap labels, accessible textareas, styles, feedback behavior, preserved head styles, and absence of inline styles. Resolve each local asset URL and recalculate its integrity hash. Keep normalization idempotence as a separate check.
- **Verify behavior in the browser.** For cloze, dictation, and sentence, test the rendered identity panel and its EaglesID/email instruction; Check and Hint disabled for empty or invalid details and enabled for valid details; gated actions; scoring, hints, feedback, Close, and story-derived title/theme. A class or static prompt alone cannot pass these checks.
- **Produce an actionable report.** Add optional `--report <path>` JSON output while keeping the default run read-only. Report every page and every MMOR requirement as pass/fail with observed evidence, family, story, change category (`structural`, `SRI`, `version-only`, or `none`), and remediation for failures. Print separate compliance and change totals, with Good/Bad/Ugly findings; correct counters so no-op title wrapping or marker-only updates are not described as conversions.

## Verification

- Add table-driven tests that remove each requirement by family, including a dictation/sentence page with only `.exercise-wrapper`; it must fail verification.
- Run the modernizer, shared-runtime, cloze-layout, and browser tests. Add browser cases for empty, invalid, and valid identity in all three families.
- Run dry-run reports across all configured roots. Confirm family and per-requirement totals, asset hashes, no silent passes, and that a second normalization makes no changes.
- Capture and inspect screenshots of all three B1 prototypes and representative B2 dictation/sentence pages at desktop and mobile widths. Check the instruction/identity layout, controls, feedback modal, clipping, overlap, horizontal overflow, console errors, and failed local requests.
- Keep the exercise-page mass apply and public mirror/deployment outside this modernizer-readiness change.

## Assumptions

- The runtime’s supported direct wrappers define the dictation and sentence contract; `.exercise-wrapper` may remain as an extra class but is not a substitute.
- The selected checkout policy is **keep local and back up**. The already-pushed `HEAD` is the baseline; preserve existing local work and stage only reviewed modernizer-related files.
- A page is operationally compliant only when structural checks and browser behavior both pass. Version markers and idempotence are evidence about changes, not compliance.

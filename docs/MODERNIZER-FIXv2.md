# Standardize wrapper normalization and verify modernizer readiness

## Summary

Use `.wrapfit` as the canonical direct wrapper for cloze, dictation, and sentence pages. A read-only preflight will inventory every wrapper form before conversion; normalization will preserve `.wrapit` where it already exists for compatibility and remove the generated `.exercise-wrapper` convention. The modernizer will pass only when independent MMOR checks and family behavior tests pass—not just when a second normalization makes no changes.

## Implementation changes

- **Protect the existing work before editing.** Recheck `HEAD` against `origin/main`; the audited state was already equal. Back up all local tracked and untracked changes outside the repository, verify each copied file and a SHA-256 manifest, then edit. Preserve the existing dirty tree and stage only reviewed modernizer changes.
- **Inventory, then normalize.** Run a no-write preflight over every selected root. Report each direct wrapper’s tag, full class list, count, family, and structural shape, including missing, nested, duplicate, and previously generated `.exercise-wrapper` cases. Map recognized wrappers to direct `.wrapfit`; preserve `.wrapit` and other unrelated class tokens. Remove `.exercise-wrapper` from normalized targets. Block and report unrecognized or ambiguous structures rather than guessing.
- **Make `.wrapfit` the verified family contract.** Update the normalizer, runtime selection, docs, and tests so all three families require the direct `.wrapfit` wrapper. Mark the wrapper with its family and scope cloze-only wrapper spacing to cloze, since dictation and sentence pages also load the cloze submission stylesheet. Preserve `.wrapit` compatibility styling.
- **Verify every MMOR item independently.** Give each shared and family requirement a stable ID and check the parsed resulting DOM, runtime-resolvable story and assets, recalculated SRI, head-style preservation, inline-style removal, and functional Close control. Include the runtime-generated EaglesID/email gate: clear instructions, disabled Check/Hint for empty or invalid details, and enabled actions for valid details.
- **Make the report complete and actionable.** Add optional `--report <path>` JSON output; default runs remain read-only and print a summary. Include every scanned page, every MMOR result with observed evidence, wrapper values before and after normalization, change category, blockers, and a concrete remediation. Separate compliance totals from structural, SRI, version-only, unchanged, and blocked counts. Summarize Good, Bad, and Ugly findings by family; never count marker-only updates or idempotence as conversions.

## Verification

- Add per-family tests for each checklist requirement, including `.wrapit`-only input, `.wrapfit` input, both classes, prior `.exercise-wrapper` output, ambiguous/missing wrappers, and a deliberately wrong wrapper that runtime selectors cannot find. Confirm normalized output is idempotent and retains unrelated classes.
- Run the modernizer, shared-runtime, cloze-layout, and browser suites. Test empty, invalid, and valid identity values; gated Check/Hint, scoring, hints, feedback, Close, and story-derived title/theme for all three families.
- Run the preflight and dry-run reports across all configured roots. Compare per-page structural results with post-normalization results; confirm every local asset URL resolves and every embedded hash matches its file. Report all skipped and blocked pages.
- Capture and inspect browser screenshots for cloze, dictation, and sentence prototypes plus representative converted pages at desktop and mobile sizes. Check wrapper geometry, instruction and identity panels, controls, feedback, clipping, overlap, horizontal overflow, console errors, and failed asset requests.
- Keep the page corpus unchanged during this readiness pass. The report must identify the exact pages that a later backup-first apply would normalize; that apply is a separate operation.

## Assumptions

- The selected wrapper policy is `.wrapfit` for all three families; existing `.wrapit` tokens remain only for compatibility.
- The known B1/B2 page populations are not proof of compliance. Each page must pass independent MMOR checks and family behavior verification.

===================================

## Perfect the B1 001 prototypes, align the B1001 set, then implement MMOR

## the Summary

Understood: the prototype is the model used for comparison, so it must first pass MMOR independently; matching a flawed prototype is not success. In this repository, “B1001 set” means companion story `begin1/b1/b1001.html` and its seven linked exercises: B1 cloze, dictation, and sentence 01–05.

The B1 cloze page’s modernization marker currently names a B5 prototype, while the modernizer profile identifies the B1 cloze prototype. Correct that inconsistency as part of making the three family prototypes authoritative.

## Ordered work

1. **Protect the checkout.** Recheck that `HEAD` matches `origin/main`—they matched during this read-only pass—and make a verified external backup of all current tracked and untracked local changes. The checkout currently reports 9,974 dirty status entries; the seven B1001 exercise pages have SRI-only diffs, and the companion story is clean. Verify every backup and its SHA-256 manifest before editing. Preserve existing work; do not push or commit the dirty tree.
2. **Perfect the three prototypes first.** Validate each prototype against an explicit MMOR contract independent of the prototype HTML itself, so prototype self-comparison cannot pass tautologically. Correct each family’s shared requirements and family-specific requirements, including direct canonical `.wrapfit`, identity-gate runtime/assets, story mapping, current SRI, functional Close, and no inline styles. Preserve `.wrapit` where present for compatibility, remove the generated `.exercise-wrapper` convention, and scope cloze-only wrapper styling so dictation and sentence retain their intended layout.
3. **Align the B1001 set to its family prototype.** Produce a before/after checklist matrix for all seven exercise pages. After each family prototype passes, align its linked B1001 pages to that family’s contract while preserving exercise content and companion-story links. Verify `b1001.html` as the runtime title/theme source; change it only if that verification finds a defect. Recalculate and verify SRI for affected local assets. Do not apply changes to the rest of Begin1 in this step.
4. **Implement the modernizer against the proven contract.** Add a read-only preflight that inventories wrapper tags and complete class combinations, identifies unsupported or ambiguous structures, and emits per-page MMOR evidence. Normalize recognized wrappers to direct `.wrapfit`, preserve compatibility classes, and fail visibly on unclassified structures. Make post-conversion checks independent of idempotence and ensure the runtime uses the canonical wrapper. Add optional `--report <path>` JSON output and update the modernizer documentation to match actual checks and counters.

## Verification and report

- Use stable MMOR IDs to check every shared and family requirement separately: body and viewport; instruction/title/IDs and nesting; functional Close; runtime-resolved story; shared and family assets; family markers; labels and textarea names; identity prompt and gate behavior; normalized visibility/button behavior; hidden empty feedback; current integrity hashes; preserved head styles; no inline styles.
- Add tests for each requirement by family, plus wrapper inventories for `.wrapit`, `.wrapfit`, both, prior `.exercise-wrapper`, missing, nested, duplicate, and unknown wrappers. Include a wrong-wrapper case that must fail before runtime behavior can be reported as passing.
- Run the modernizer, shared-runtime, cloze-layout, and browser suites. In the browser, test empty/invalid/valid EaglesID and email, Check/Hint gating, scoring, hints, feedback, Close, and story-derived title/theme for all three families.
- Capture and inspect screenshots of the three prototypes and B1001 exercise set at desktop and mobile sizes. Check layout, clipping, overlap, horizontal overflow, console errors, and failed asset requests. Run a full Begin1 dry-run for coverage, but make no writes outside the B1001 set in this work.
- Deliver a human-readable Good/Bad/Ugly summary and a granular per-page report: each requirement’s result and observed evidence, wrapper values before/after, story and asset resolution, change category, blockers, and specific remediation. Keep compliance totals separate from structural changes, SRI-only changes, version-only changes, unchanged pages, and blocked pages.

## an explicit list of Assumptions

- `.wrapfit` is the canonical direct wrapper for all three exercise families; `.wrapit` remains only as a compatibility class.
- The B1001 work set is the companion story plus all seven linked exercises. The other Begin1 pages receive a dry-run report only.
- The audited Git baseline is already pushed because `HEAD` equals `origin/main`; the full local backup is still required before any edit.

=========================================

## Make `.wrapfit` the required wrapper, then align B1 001

## annotated Summary

Confirmed: **`.wrapfit` is the canonical required class**. Every finished prototype and normalized exercise page must have a direct `body#TheBody > .wrapfit`. `.wrapit` alone never passes; it may remain as an extra legacy class for compatibility.

## theOrdered work

1. **Protect the checkout.** Recheck `HEAD` against `origin/main` and back up all current tracked and untracked changes outside the repository. Verify each copy and its SHA-256 manifest before editing. Preserve the dirty tree and stage only reviewed changes.
2. **Perfect prototypes first.** Independently validate and update the cloze, dictation, and sentence prototypes against MMOR. Fix the B1 cloze prototype marker that currently names B5. Each prototype must meet the shared and family requirements before serving as the comparison model.
3. **Align the B1001 set.** Compare the companion story and seven linked exercises against their respective family prototype. Normalize recognized direct wrappers to `.wrapfit`, retain `.wrapit` only as a compatibility token, and remove the generated `.exercise-wrapper` convention. Preserve exercise content; change the companion story only if story/title/theme checks reveal a defect.
4. **Implement the modernizer.** Add a read-only preflight that inventories direct wrapper tags and full class combinations. Normalize recognized wrappers to `.wrapfit`; block and report ambiguous or unknown structures. Make MMOR verification independent of prototype self-comparison and idempotence. Scope cloze-only wrapper styling so the canonical wrapper does not impose cloze geometry on other families. Add optional `--report <path>` JSON output.

## the Verification and report

- Give every shared and family MMOR requirement a stable ID; verify the parsed structure, runtime story and assets, SRI hashes, preserved head styles, removed inline styles, family-specific controls/labels, and the runtime EaglesID/email gate.
- Test `.wrapfit`, `.wrapit` alone, both classes, prior `.exercise-wrapper`, missing, nested, duplicate, and unknown wrappers. A final page without direct `.wrapfit` must fail.
- Run modernizer, runtime, layout, and browser tests. Exercise identity gating, Check/Hint, scoring, feedback, Close, and story-derived title/theme for all three families.
- Capture and inspect prototype and B1001-page screenshots at desktop and mobile sizes; check layout, clipping, overlap, overflow, console errors, and failed asset requests.
- Produce Good/Bad/Ugly summaries and per-page evidence with wrapper values before and after, every MMOR result, changes, blockers, and remediation. Separate compliance from structural, SRI-only, version-only, unchanged, and blocked counts.
- Run a full Begin1 dry run for coverage; make no writes beyond the B1001 set in this work.

## the Assumptions

- The B1001 set is `begin1/b1/b1001.html` plus its seven linked exercises.
- `HEAD` already matches `origin/main`; verify again before editing. Back up all local changes regardless.
- `.wrapit` is compatibility only; **`.wrapfit` is the acceptance requirement**.

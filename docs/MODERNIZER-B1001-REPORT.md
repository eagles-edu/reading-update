# B1001 Hot Potatoes modernization report

Date: 2026-09-15. Scope: the B1001 companion story's seven exercises only. The story was read as the runtime title/theme source and was not changed.

## Good

- `begin1/cloze/b1cloze001.html`, `begin1/dict/b1d001.html`, and `begin1/sent/b1mx00101.html` are the finished B1 reference pages.
- `begin1/sent/b1mx00102.html` through `b1mx00105.html` were converted in the targeted apply.
- A post-apply dry run reports 7/7 source pages MMOR-compliant, 7/7 independent post-normalization MMOR checks passed, 7/7 idempotence checks passed, zero planned writes, zero unresolved stories, zero ambiguous files, and zero blockers.
- Every page has one direct `body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit` shell. No B1001 page retains direct `.wrapit` or `.exercise-wrapper` shell tokens.
- The static MMOR evidence records every shared/family asset and its SRI, story resolution, preserved head styles, no inline styles, heading placement, Close control, identity guard, feedback visibility, wrapper inventory, and family-specific controls. The JSON evidence is [b1001-mmor-post.json](/tmp/b1001-mmor-post.json).
- The browser test serves actual files and assets from this checkout. It proves each B1 prototype has the canonical shell, heading in the instruction panel, blank-identity Check/Hint gate, valid EaglesID/email enablement, inline Submit placement, separate Close control, animated action controls, hidden empty sentence feedback, no mobile horizontal overflow, and no console or page errors.
- Runtime/scoring suite, cloze layout suite, button-containment suite, real-page browser suite, and modernizer suite pass.

## Bad

- The full Begin1 dry-run identifies 719 legacy pages that still need conversion. They were intentionally not written in this task.
- `begin1/sent/b1mx06301.html` blocks a future full Begin1 apply because it has no title or instruction panel. Repair its source structure before authorizing that batch.

## Ugly

- The pre-apply B1001 set had four sentence pages missing canonical shell tokens even though they carried a current version marker. The targeted apply changed those four pages; the marker is no longer used as acceptance evidence.
- The external backup verified before this conversion is `/home/eagles/dockerz/efast-bu/modernize-hot-potatoes-2026-09-15T06-55-57-349Z-456595`. The checkout-wide pre-edit backup is `/home/eagles/dockerz/efast-bu/modernizer-standardization-pre-edit-2026-09-15T06-33-26-954Z-382030`.

## Commands and evidence

```sh
node scripts/modernize-hot-potatoes-pages.cjs --dry-run --scope begin1 --path begin1/cloze/b1cloze001.html --path begin1/dict/b1d001.html --path begin1/sent/b1mx00101.html --path begin1/sent/b1mx00102.html --path begin1/sent/b1mx00103.html --path begin1/sent/b1mx00104.html --path begin1/sent/b1mx00105.html --report /tmp/b1001-mmor-post.json
npm run test:modernize:hot-potatoes
npm run test:sis:exercise-submit
npm run test:sis:cloze-layout
node --test scripts/cloze-button-boundary.test.cjs
node --test scripts/sis-exercise-real-pages.test.cjs
```

Visual evidence was inspected at 390px for cloze and dictation, and at 390px and 1440px for sentence: [cloze](/home/eagles/dockerz/efast-copy/output/playwright/b1-cloze-canonical-390.png), [dictation](/home/eagles/dockerz/efast-copy/output/playwright/b1-dictation-canonical-390.png), [sentence mobile](/home/eagles/dockerz/efast-copy/output/playwright/b1-sentence-canonical-390.png), and [sentence desktop](/home/eagles/dockerz/efast-copy/output/playwright/b1-sentence-canonical-1440.png).

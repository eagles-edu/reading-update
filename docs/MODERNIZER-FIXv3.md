# Hot Potatoes modernizer contract and regression repair

## Current finding

The previous contract checked that dictation, sentence, and comprehension pages had at least one Close control. That was too weak. A scan of the modernized corpus found 749 sentence pages with three `btn-74` controls: one in the legacy top navigation, one in the legacy bottom navigation, and one in the canonical footer. The cloze audit already required exactly one and therefore caught the equivalent cloze artifact. The screenshot annotations on `kidsenglish3/cloze/kecloze3033.html` are not page DOM content; the page now renders one combined title/instruction panel and one Close control. The duplicate-control defect is nevertheless real in the sentence family.

Before modernization, malformed sources are repaired or explicitly blocked. `begin2/dict/b2d031.html`, `supereasy/dict/se_d143.html`, and `begin2/sent/b2mx07903.html` were truncated mid-document and were restored from the last complete repository source before modernization. The B1 sentence page `begin1/sent/b1mx08905.html` was subsequently restored from its verified authoritative source and modernized; the unrelated kidsenglish3 404 placeholder was quarantined as `kidsenglish3/sent/kemx305582.html.invalid` because no exercise source exists. The remaining 404 placeholders `essays/cloze/cloze100.html` and `essays/comp/comp100.html` remain blocked; the modernizer must never fabricate their answers or structure.

## Four prototype contracts

The independent prototype contracts are:

| Family | Prototype | Companion story |
|---|---|---|
| Cloze | `begin1/cloze/b1cloze001.html` | `begin1/b1/b1001.html` |
| Dictation | `begin1/dict/b1d001.html` | `begin1/b1/b1001.html` |
| Sentence scramble | `begin1/sent/b1mx00101.html` | `begin1/b1/b1001.html` |
| Comprehension | `essays/comp/essaycomp001.html` | `essays/e/essay001.html` |

Every finished page must independently satisfy the shared contract: one `body#TheBody`, mobile viewport metadata, one direct `data-sis-exercise-shell hp-exercise-shell wrapfit`, one instruction panel containing the only `.Titles > h1.ExerciseTitle` and `#InstructionsDiv`, unique exercise blocks, exactly one accessible `btn-74 tm1-5` Close control, the shared `.tm1-5 { margin-top: 1.5em; }` rule, resolvable companion story/theme, current SRI for all managed assets, preserved head style blocks, no inline style attributes, normalized visibility/runtime handlers, empty legacy navigation removed, identity gating, and clipped `btn-17 hp-button` action controls.

Family-specific requirements remain separate: cloze requires the prototype marker, labelled `GapN` inputs, `#ClozeDiv`, `btn17Container`, and cloze submission assets; dictation requires named ShortAnswer fields and inline question controls; sentence requires the sentence control group and hidden empty `#GuessDiv`; comprehension requires indexed `.QuizQuestion` items, one `.MCAnswers` list per question, `CheckMCAnswer` wiring, and all five SIS scoring fields.

The complete shared and family-specific checklist is maintained in [moderate-hot-potatoes.md](moderate-hot-potatoes.md). The modernizer profiles and current version are defined in [modernize-hot-potatoes-pages.cjs](/home/eagles/dockerz/efast-copy/scripts/modernize-hot-potatoes-pages.cjs:38).

## Repair implemented

`modernize-hot-potatoes-pages.cjs` now applies the same Close normalization to all four exercise families. It removes duplicate `btn-74` controls, removes empty or Close-only legacy `TopNavBar`/`BottomNavBar` containers, and preserves legitimate sentence navigation. Sentence sequence pages retain both blue nav containers when they contain `Previous` or `Next`; the actual terminal page of each discovered sequence is repaired with a `Previous` control in both bars pointing to the immediate predecessor, including sequences longer than five pages. The MMOR now requires exactly one Close control, requires exactly one instruction panel/title block, and independently checks the terminal sentence navigation contract. A current version marker cannot suppress any repair.

The test suite now covers:

- all four real prototypes through the independent MMOR;
- the three-Close sentence regression and idempotent normalization;
- terminal sentence pages restoring both blue `Previous` navigation bars, including sequences longer than five pages;
- the split-title/instruction layout contract;
- duplicate/empty legacy navigation behavior;
- shared and family SRI, identity, runtime, wrapper, action-control, and source-health requirements.

## Verification commands

```sh
npm run test:modernize:hot-potatoes
npm run audit:cloze:integrity
npm run audit:dict:integrity
npm run audit:sent:integrity
npm run audit:comp:integrity
```

Audits are read-only. Any page with an HTTP placeholder or malformed source remains `ACTION_REQUIRED`; the audit must not turn a missing exercise into a false pass. Page writes require the modernizer dry-run, an explicit scope or path, a verified external backup, and `--allow-bulk` for more than 50 changed pages. No commit, push, or deployment is part of this repair.

## Result interpretation

The useful result is the four-family checklist total, not the modernization version count. A page passes only when every shared and family-specific requirement passes. Structural conversion, SRI-only changes, unchanged pages, malformed source blocks, and browser-unverified pages must remain distinguishable in the reports.

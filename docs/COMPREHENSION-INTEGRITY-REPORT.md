# Comprehension Integrity and Prototype Audit

Generated: 2026-09-16T21:57:50.433Z

## Summary

- Pages audited: 563
- Pages passing every check: 562
- Pages requiring action: 1
- Prototype: `essays/comp/essaycomp001.html`
- Prototype MMOR status: PASS
- Visual samples: 0/30 expected artifacts captured (PLANNED)

## Collection totals

| Collection | Pages | Pass | Action required |
|---|---:|---:|---:|
| eslread | 363 | 363 | 0 |
| essays | 100 | 99 | 1 |
| people | 100 | 100 | 0 |

## Checklist totals

| ID | Pass | Fail |
|---|---:|---:|
| SH-01 | 562 | 1 |
| SH-02 | 562 | 1 |
| SH-03 | 562 | 1 |
| SH-04 | 562 | 1 |
| SH-05 | 562 | 1 |
| ASSET-CSS-SIS-HOT-POTATOES-CSS | 562 | 1 |
| ASSET-JS-HOT-POTATOES-UI-JS | 562 | 1 |
| ASSET-CSS-HOT-POTATOES-FEEDBACK-CSS | 562 | 1 |
| ASSET-JS-HOT-POTATOES-FEEDBACK-JS | 562 | 1 |
| ASSET-JS-STORY-THEME-JS | 562 | 1 |
| ASSET-CSS-SIS-EXERCISE-LAYOUT-CSS | 562 | 1 |
| ASSET-CLOZE-SUBMIT-CSS | 562 | 1 |
| ASSET-CSS-SIS-EXERCISE-FAMILY-LAYOUT-CSS | 562 | 1 |
| ASSET-COMPREHENSION-SUBMIT-JS | 562 | 1 |
| SH-06 | 562 | 1 |
| ID-01 | 563 | 0 |
| CO-01 | 562 | 1 |
| CO-02 | 562 | 1 |
| CO-03 | 562 | 1 |
| CO-04 | 562 | 1 |
| SH-10 | 562 | 1 |
| SH-09 | 562 | 1 |
| SH-08 | 563 | 0 |
| SH-07 | 563 | 0 |
| SH-11 | 563 | 0 |
| SH-12 | 563 | 0 |
| CO-05 | 563 | 0 |
| SRC-01 | 562 | 1 |
| PROTO-01 | 562 | 1 |

## Visual sample set

| Collection | Page | Desktop artifact | Mobile artifact |
|---|---|---|---|
| eslread | `eslread/comp/comp001.html` | `output/playwright/comp-integrity/eslread-comp001-desktop.png` | `output/playwright/comp-integrity/eslread-comp001-mobile.png` |
| eslread | `eslread/comp/comp092.html` | `output/playwright/comp-integrity/eslread-comp092-desktop.png` | `output/playwright/comp-integrity/eslread-comp092-mobile.png` |
| eslread | `eslread/comp/comp183.html` | `output/playwright/comp-integrity/eslread-comp183-desktop.png` | `output/playwright/comp-integrity/eslread-comp183-mobile.png` |
| eslread | `eslread/comp/comp275.html` | `output/playwright/comp-integrity/eslread-comp275-desktop.png` | `output/playwright/comp-integrity/eslread-comp275-mobile.png` |
| eslread | `eslread/comp/comp365.html` | `output/playwright/comp-integrity/eslread-comp365-desktop.png` | `output/playwright/comp-integrity/eslread-comp365-mobile.png` |
| essays | `essays/comp/comp100.html` | `output/playwright/comp-integrity/essays-comp100-desktop.png` | `output/playwright/comp-integrity/essays-comp100-mobile.png` |
| essays | `essays/comp/essaycomp025.html` | `output/playwright/comp-integrity/essays-essaycomp025-desktop.png` | `output/playwright/comp-integrity/essays-essaycomp025-mobile.png` |
| essays | `essays/comp/essaycomp050.html` | `output/playwright/comp-integrity/essays-essaycomp050-desktop.png` | `output/playwright/comp-integrity/essays-essaycomp050-mobile.png` |
| essays | `essays/comp/essaycomp074.html` | `output/playwright/comp-integrity/essays-essaycomp074-desktop.png` | `output/playwright/comp-integrity/essays-essaycomp074-mobile.png` |
| essays | `essays/comp/essaycomp099.html` | `output/playwright/comp-integrity/essays-essaycomp099-desktop.png` | `output/playwright/comp-integrity/essays-essaycomp099-mobile.png` |
| people | `people/comp/pcomp001.html` | `output/playwright/comp-integrity/people-pcomp001-desktop.png` | `output/playwright/comp-integrity/people-pcomp001-mobile.png` |
| people | `people/comp/pcomp026.html` | `output/playwright/comp-integrity/people-pcomp026-desktop.png` | `output/playwright/comp-integrity/people-pcomp026-mobile.png` |
| people | `people/comp/pcomp051.html` | `output/playwright/comp-integrity/people-pcomp051-desktop.png` | `output/playwright/comp-integrity/people-pcomp051-mobile.png` |
| people | `people/comp/pcomp075.html` | `output/playwright/comp-integrity/people-pcomp075-desktop.png` | `output/playwright/comp-integrity/people-pcomp075-mobile.png` |
| people | `people/comp/pcomp100.html` | `output/playwright/comp-integrity/people-pcomp100-desktop.png` | `output/playwright/comp-integrity/people-pcomp100-mobile.png` |

## Actionable findings

### `essays/comp/comp100.html`

- **SH-01:** body#TheBody exists exactly once. Observed: `{"count":0,"idCount":0}`. Remediation: undefined
- **SH-02:** Viewport declares device width and initial scale 1. Observed: `{"content":null}`. Remediation: undefined
- **SH-03:** Instruction panel contains .Titles > h1.ExerciseTitle and #InstructionsDiv; #MainDiv is unique in the wrapper. Observed: `{"instructionPanels":0,"titleFound":false,"instructions":0,"main":0}`. Remediation: undefined
- **SH-04:** Close is an accessible btn-74 button handled by the shared Close runtime. Observed: `{"count":0,"accessible":false,"runtimeBound":true}`. Remediation: undefined
- **SH-05:** Companion story resolves and story-theme.js binds its title and theme at runtime. Observed: `{"story":"essays/e/essay100.html","scriptCount":0,"titleUrl":null,"themeKey":null,"runtimeBound":true}`. Remediation: undefined
- **ASSET-CSS-SIS-HOT-POTATOES-CSS:** Local link css/sis-hot-potatoes.css resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-EIG7+2mbmdKXw+7WBMoTcp9CjUjCXLpkpUdjZim1TkqVohjU0/SEOZCnuw68IYQ8","observed":[]}`. Remediation: undefined
- **ASSET-JS-HOT-POTATOES-UI-JS:** Local script js/hot-potatoes-ui.js resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-c4OwTCi/mt46Ngl5y4KjpMDXFfOrzS4A0tGg3r4Oxq71V680/2tAQ/4V+l4Cfp8g","observed":[]}`. Remediation: undefined
- **ASSET-CSS-HOT-POTATOES-FEEDBACK-CSS:** Local link css/hot-potatoes-feedback.css resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-ZQ3tblPuuwTjNvW0dnwXf3qe3MbFrBiveKXfa5sVqlzprA7wAC8WIUBaPPIDklM4","observed":[]}`. Remediation: undefined
- **ASSET-JS-HOT-POTATOES-FEEDBACK-JS:** Local script js/hot-potatoes-feedback.js resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-oXf/svhjkrSmioKJy1ewVAuWM+qroqJyxsGnKH+xMdYcKu034RNe8owRKiNw64Tq","observed":[]}`. Remediation: undefined
- **ASSET-JS-STORY-THEME-JS:** Local script js/story-theme.js resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-8VAqiIrvm0upO+8Nkxle4qQ0pcWFb1/TxOLqexMoqaS4uuFA1o4tOvOc72iWfgbJ","observed":[]}`. Remediation: undefined
- **ASSET-CSS-SIS-EXERCISE-LAYOUT-CSS:** Local link css/sis-exercise-layout.css resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-5HOjSZ/dHoz5qDsXvpEOXtqPTq50symoGkXfouRlWh+2X5MCVufbyJuTDg7a3y6o","observed":[]}`. Remediation: undefined
- **ASSET-CLOZE-SUBMIT-CSS:** Local link css/sis-cloze-submit.css resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-O8x9dnVVIUDBVWqyxIoevfyflx64R983fR2e/kt0oP4Isbfr2CQUOhBsqgnNO+Fy","observed":[]}`. Remediation: undefined
- **ASSET-CSS-SIS-EXERCISE-FAMILY-LAYOUT-CSS:** Local link css/sis-exercise-family-layout.css resolves and has current SRI. Observed: `{"expectedIntegrity":"sha384-lMrEC2hIdcG0BKizRp5odtgd0DMvWdtT5o63AE4zenOH6B92c9t6MDTuoLK0214j","observed":[]}`. Remediation: undefined
- **ASSET-COMPREHENSION-SUBMIT-JS:** Local script js/sis-comprehension-submit.js resolves and has current SRI for comp. Observed: `{"expectedIntegrity":"sha384-syJT/g32IJWwaavzPV4mpFlsVnt7J3ocE083s4rC62T/AT1oKm1RjB3R7Bllo7iy","observed":[]}`. Remediation: undefined
- **SH-06:** Every required shared and family asset resolves locally with its current SRI. Observed: `{"required":9,"failed":["ASSET-CSS-SIS-HOT-POTATOES-CSS","ASSET-JS-HOT-POTATOES-UI-JS","ASSET-CSS-HOT-POTATOES-FEEDBACK-CSS","ASSET-JS-HOT-POTATOES-FEEDBACK-JS","ASSET-JS-STORY-THEME-JS","ASSET-CSS-SIS-EXERCISE-LAYOUT-CSS","ASSET-CLOZE-SUBMIT-CSS","ASSET-CSS-SIS-EXERCISE-FAMILY-LAYOUT-CSS","ASSET-COMPREHENSION-SUBMIT-JS"]}`. Remediation: undefined
- **CO-01:** Direct body wrapper is canonical .wrapfit with the comprehension family marker. Observed: `{"wrapperTag":null,"classes":[],"family":null}`. Remediation: undefined
- **CO-02:** Instruction, main, feedback, and Questions blocks are unique and nested in the exercise wrapper. Observed: `{"questions":0,"instructions":0,"main":0,"feedback":0,"questionsInMain":false}`. Remediation: undefined
- **CO-03:** Each comprehension question has one indexed QuizQuestion and a multiple-choice answer list. Observed: `{"questionItems":0,"indexedQuestions":0,"answerLists":0}`. Remediation: undefined
- **CO-04:** Each comprehension answer is wired to the legacy CheckMCAnswer scorer. Observed: `{"answerButtons":0,"questionItems":0}`. Remediation: undefined
- **SH-10:** One direct canonical shell has .hp-exercise-shell, .wrapfit, and data-sis-exercise-shell; no legacy wrapper alias remains. Observed: `{"directWrappers":[],"nestedWrappers":[]}`. Remediation: undefined
- **SH-09:** Required exercise IDs are unique. Observed: `{"ids":{"InstructionsDiv":0,"MainDiv":0,"FeedbackDiv":0}}`. Remediation: undefined
- **SRC-01:** Source is not an HTTP error placeholder or duplicated document. Observed: `{"bytes":635,"errorPlaceholder":true,"duplicateHtmlEndings":false}`. Remediation: Recover the original exercise source or exclude this malformed placeholder until its content is restored.
- **PROTO-01:** Structural shape matches the comp prototype contract. Observed: `{"pass":false,"differences":["body false != prototype true","wrapper false != prototype true","instructionPanel false != prototype true","title false != prototype true","instructions 0 != prototype 1","main 0 != prototype 1","feedback 0 != prototype 1","close count 0 is missing the prototype control","questionList is missing from comprehension structure","answerLists is missing from comprehension structure","answerButtons is missing from comprehension structure"]}`. Remediation: Compare this page with essays/comp/essaycomp001.html and repair the named structural difference.

## Visual verification note

Run the Playwright visual pass, then rerun this audit with `--visual-dir` to mark visual artifacts complete.

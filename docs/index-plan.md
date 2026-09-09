# Add Human-Readable Story Locators

## Summary

Keep the six-level grouping, but rename every merged tab with sequential
letters and assign each story a stable locator such as:

`Starters Reading B-64`

Letters identify the tab; numbers preserve the story’s existing sequence number.

## Locator Scheme

Letters run continuously in display order within each level:

| Level | Tab sequence |
|---|---|
| Starters | `A–B` = `ke1`, `C–D` = `ke2` |
| Movers | `A–D` = `begin1`, `E–F` = `easyread` |
| Flyers | `A–B` = `begin4`, `C–D` = `ke3` |
| KET | `A–B` = `begin2`, `C–F` = `begin3` |
| PET | `A–C` = `begin5`, `D` = `begin6` |
| IELTS | `A–B` = `essays`, `C–E` = `eslread`, `F–G` = `people` |

Examples:

- `Starters Reading A-1`
- `Starters Reading B-64`
- `Movers Reading E-101`
- `IELTS Reading F-52`

The numeric portion remains the existing story number encoded by the
current story sequence/file. Stories will not be renumbered.

## Implementation Changes

- Rename visible tab labels to include their letter and source range, for example:
  - `A — ke1`
  - `B — ke1`
  - `C — ke2`
- Add a locator to every story entry in the index data.
- Display the short locator, such as `B-64`, on every index story card.
- Display the full locator, such as `Starters Reading B-64`, on the corresponding story page.
- Keep the six main index owners and grouped collections:

  - `kidsenglish/index.html`
  - `begin1/index.html`
  - `begin4/index.html`
  - `begin2/index.html`
  - `begin5/index.html`
  - `essays/index.html`

- Keep all secondary index URLs available.
- Keep every story MENU link aligned with its level’s main index.
- Update the documentation to describe the six levels, tab letters, and locator format.
- Preserve unrelated existing working-tree modifications.

## Verification

- Confirm every story has exactly one locator within its level.
- Confirm every tab letter matches its merged display order.
- Confirm all index cards show locators.
- Confirm sampled story pages show the matching full locator.
- Verify root level cards, merged tabs, legacy indexes, fragment links, and MENU return links in a browser.
- Search all grouped story folders for duplicate or stale locator/menu values.

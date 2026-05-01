# Dual-Theme Refresh for `index.html` with SIS-Style Dark Mode

## Summary

Keep the current light mode as the default visual baseline, then add a second dark theme inspired by the local SIS repo’s containment style. The page will support both modes through a sun/moon theme selector placed in the header, while preserving the current section order and layout. Both themes will share the same improved section framing, contrast discipline, mobile-first behavior, and hero-area visitor counter.

## Implementation Changes

- Keep the existing light theme as the default mode, but clean it up with the previously planned containment improvements:
  every major block including header and footer gets a centered framed container, clearer section boundaries, and stronger focus through contrast without rearranging panels.
- Add a dark theme variant based on the SIS repo’s visual language:
  dark blue-gray page canvas, contained panel surfaces, crisp borders, restrained shadows, and professional blue-gray contrast using the supplied image palette as the base.
- Refactor theme values into a token system in `:root` plus a dark-theme override, likely via `html[data-theme="dark"]` or equivalent.
- Keep one shared structural CSS layer for layout, spacing, borders, radius, and component sizing; only color/surface/shadow tokens should change between themes where possible.
- Add a header theme selector with sun/moon affordance:
  compact toggle control in the header, visually aligned with the existing nav/CTA area, usable on mobile, keyboard accessible, and consistent with the site styling.
- Persist the selected theme in `localStorage`, following the SIS pattern of applying the theme early to avoid flash on load.
- Respect system preference only as an initial fallback if no saved preference exists; otherwise saved user choice wins.
- Preserve the current content order and panel relationships:
  hero intro, levels, sample card, features, library, teachers, and footer remain in the same order and general arrangement.
- Apply the section-shell treatment consistently in both modes:
  header, hero/levels, features, library, teachers, and footer each appear as centered bounded panels rather than open content bands.
- Improve contrast and hierarchy in both modes:
  stronger distinction between page background, section shell, inner cards, and supporting elements so the user is guided to explore the page.
- Keep the implementation mobile first:
  stacked defaults, compact header behavior, safe touch targets for the theme toggle, and no horizontal overflow.
- Add the visitor counter in the hero stats area, styled to match the stat cards in both light and dark modes.
- Use an external hosted hit counter/badge for the visitor count, but wrap it inside local stat styling so it reads as part of the design rather than a third-party embed.

## Public Interface / Markup Changes

- Keep the page as a single-file `index.html`.
- Add minimal markup for:
  a theme toggle control in the header, shared section-shell wrappers if needed, and a visitor-counter stat item in the hero metrics row.
- Add a small inline script in the document head to apply the saved theme before paint, and a small interaction script near the end of the body to handle toggle behavior and persistence.
- No backend changes or local API additions.

## Test Plan

- Verify default load behavior:
  page loads in light mode unless a saved preference exists; saved dark mode restores correctly on refresh.
- Verify theme switching:
  header toggle changes between light and dark immediately, updates icon/label state correctly, and persists across reloads.
- Verify mobile behavior:
  header remains usable with nav plus theme toggle, all section shells fit within viewport, and no overflow appears.
- Verify desktop/tablet behavior:
  centered framed sections remain aligned, current panel arrangement is preserved, and both themes maintain clear hierarchy.
- Verify visual parity:
  both themes use the same structural layout and framing, with only palette/surface differences rather than layout drift.
- Verify visitor counter:
  loads in the hero stats row, remains legible in both themes, and fails gracefully without collapsing the layout.
- Verify accessibility:
  theme toggle is keyboard reachable, has clear accessible labeling, focus states remain visible, and contrast improves materially in both themes.

## Assumptions

- “Light mode current” means retain the current light-direction design rather than replacing it with a new light visual system.
- “Dark mode like SIS” means adopting SIS-style panel containment, crisp borders, and disciplined framing, not copying SIS’s exact light palette.
- The preferred theme control is a sun/moon toggle in the header rather than a dropdown or separate settings panel.
- The visitor counter remains a real external counter placed in the hero stats area.
- Existing content and panel order remain unchanged unless minimal wrapper markup is required to standardize section framing.

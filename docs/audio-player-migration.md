# Shared audio player migration

The shared player is a progressive enhancement for static story and dictation pages.
Existing `<audio>` elements remain the source of truth; the migration does not replace
their source URLs. `player-proof.js` discovers marked audio elements, builds the compact
player controls, and keeps the native audio element available until the custom controls
mount successfully.

Run a narrow dry run first:

```bash
npm run modernize:audio:dry -- --family dictation --include begin1/dict
```

Apply a reviewed narrow scope:

```bash
npm run modernize:audio:apply -- --family dictation --include begin1/dict --allow-bulk
```

The script is idempotent, creates a backup before every write, adds SRI-protected root
asset links with the correct relative path, and reports pages missing a usable `</head>`.
It refuses an apply that would change more than 50 pages unless `--allow-bulk` is given.
Future page generators should emit `data-eagles-audio="v1"` and the shared asset block;
the migration script is the static backfill tool for existing pages.

Prototype copies live beside their source pages as `*.audio-player-prototype.html` and
are excluded from deployment. Current prototypes are `easyread/es/easy001.audio-player-prototype.html`
and `begin1/dict/b1d015.audio-player-prototype.html`.

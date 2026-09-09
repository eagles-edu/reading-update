# Dev-First Deployment

Work in the repo copy first:

- `/home/eagles/dockerz/efast-copy`

The reading site is deployed under the domain root with this layout:

- root landing page: `/home/thuvien.eagles.edu.vn/public_html/index.html`
- reading site: `/home/thuvien.eagles.edu.vn/public_html/reading/`

Public URLs are:

- `https://thuvien.eagles.edu.vn/`
- `https://thuvien.eagles.edu.vn/reading/kidsenglish/`
- `https://thuvien.eagles.edu.vn/reading/begin1/`
- corresponding `/reading/<directory>/` paths for the other levels

## Development sync

Preview the curated, non-destructive sync:

```bash
npm run sync:dev
```

Apply it:

```bash
npm run sync:dev:apply
```

The sync has two whitelist phases:

1. only the source root `index.html` goes to the public root;
2. `favicon.ico`, shared assets, and approved reading directories go to
   `public_html/reading/`.

Apply mode never uses `--delete`. Existing unrelated root files and
`/efast/` remain protected. Precompression runs after a successful apply and
generates gzip level 6 and Brotli level 5 sidecars for approved text assets.

For the graphical FreeFileSync workflow:

```bash
npm run sync:dev:ffs
```

Its two batch files are:

- `scripts/efast-root-index.ffs_batch`
- `scripts/efast-reading.ffs_batch`

Use the temporary staging option before touching the live target:

```bash
npm run sync:dev -- --public-root /tmp/efast-preview --no-sudo --apply
```

The older `sync-dev-to-live.sh` and `efast-rsync-manifest.sh` helpers are
not part of the new `/reading/` deployment workflow; do not use them for this
layout.

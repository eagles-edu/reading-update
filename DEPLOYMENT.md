# Dev-First Deployment

Work in the repo copy first:

- `/home/eagles/dockerz/efast-copy`

Only sync to live after the dev state is stable:

- live webroot: `/home/thuvien.eagles.edu.vn/public_html`

Current sync set:

- `index.html`, `favicon.ico`, `pics/`, and `images/` at the live webroot
- the reading mirror under `efast/` via the exact rsync manifest helper

Exact efast manifest:

```bash
bash ./scripts/efast-rsync-manifest.sh
bash ./scripts/efast-rsync-manifest.sh --apply
```

Use the repo sync helper:

```bash
./scripts/sync-dev-to-live.sh
./scripts/sync-dev-to-live.sh --apply
```

Rules:

- Keep live untouched while iterating in dev.
- Do not sync clutter, backups, browser artifacts, or generated output.
- Add new live-worthy files explicitly, not by syncing the whole tree.

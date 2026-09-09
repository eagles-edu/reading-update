# Development sync

The development sync is a whitelist-based, non-destructive deployment for the
reading site. It keeps the domain landing page at the public root and places
all reading-site assets below `/reading/`.

## Public layout

```
/home/thuvien.eagles.edu.vn/public_html/index.html
/home/thuvien.eagles.edu.vn/public_html/reading/
```

The root index is served at `https://thuvien.eagles.edu.vn/`. Reading levels
are served at paths such as:

- `https://thuvien.eagles.edu.vn/reading/kidsenglish/`
- `https://thuvien.eagles.edu.vn/reading/begin1/`
- `https://thuvien.eagles.edu.vn/reading/begin2/`

There is no duplicate `/reading/index.html` landing page. Existing unrelated
root files and the live `/efast/` tree are outside this workflow.

## Rsync commands

Preview the changes; dry-run is the default:

```bash
npm run sync:dev
```

Apply the changes:

```bash
npm run sync:dev:apply
```

Test against a disposable local destination:

```bash
npm run sync:dev -- --public-root /tmp/efast-preview --no-sudo --apply
```

The sync runs two phases:

1. Copy only the source `index.html` to the public root.
2. Copy `favicon.ico`, shared assets, and the approved reading collections to
   `public_html/reading/`.

No phase uses rsync `--delete`. Apply mode therefore cannot remove existing
root files, `/efast/`, or other target files outside the whitelist. Repository
documentation, scripts, dependencies, backups, browser artifacts, archives,
and generated `.gz/.br` files are excluded.

## FreeFileSync

The split batch configurations are:

- `scripts/efast-root-index.ffs_batch`
- `scripts/efast-reading.ffs_batch`

Run both through the wrapper:

```bash
npm run sync:dev:ffs
```

The root batch targets only `public_html/index.html`; the reading batch targets
only `public_html/reading/`.

## Precompression

After a successful apply, the rsync helper runs:

```bash
npm run precompress:dev
```

The same step is also run by `npm run sync:dev:apply` and
`npm run sync:dev:ffs`. It creates gzip level 6 and Brotli level 5 sidecars
for HTML, CSS, JavaScript, JSON, SVG, XML, text, and webmanifest files under
the root index and `/reading/`. Audio, archives, backups, `/efast/`, and
unrelated public-root files are not compressed. The web server must be
configured with `gzip_static` and `brotli_static` or an equivalent sidecar
configuration.

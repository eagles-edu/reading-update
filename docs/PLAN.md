# Normal MP3 Deployment, Curated Commit, and Push

## Summary

- Forget R2 entirely.
- Keep MP3s served normally from the site’s `/reading/.../audio/` paths.
- Preserve existing Git LFS tracking for MP3s.
- Create a curated reading-site commit and push it to `origin/main`.
- Do not rewrite Git history or force-push.

## Site and audio handling

- Keep `audio/` directories in the rsync and FreeFileSync whitelists.
- Deploy MP3s normally beneath:

```text
/home/thuvien.eagles.edu.vn/public_html/reading/<level>/audio/
```

- Preserve relative audio references in story pages.
- Do not rewrite HTML audio URLs.
- Do not add R2 scripts, R2 configuration, R2 URL references, or R2 documentation.
- Keep MP3s tracked through Git LFS; verify LFS is available before commit/push.

## Curated Git commit

Stage only:

- Root `/reading/` deployment changes.
- Six grouped indexes and approved reading collections.
- Required favicon, SRI, MENU, and asset-path updates.
- Sync, FreeFileSync, Brotli/gzip scripts.
- Deployment documentation and npm commands.
- Existing tracked MP3/LFS state as-is.

Exclude:

- `docs/R2 Admin Read & Write.md` and Cloudflare exports.
- Credentials or credential-containing files.
- `.playwright-cli/`, `.sto/`, `vendor/`, planning scratch files.
- Unrelated `writing/` changes.
- Any untracked local artifacts.

Add narrow ignore rules for local Cloudflare exports and browser artifacts so they cannot enter the commit accidentally.

## Git overflow handling

- Do not use `git add .`.
- Stage directory-level pathspecs for the approved site collections to avoid shell argument overflow.
- Confirm no staged blob exceeds the hosting limit.
- Run `git diff --cached --check`.
- Run a staged-file audit for secrets, artifacts, unrelated directories, and R2 references.
- Do not run `git filter-repo`, `git lfs migrate`, `git gc --prune`, or force-push.

Commit message:

```text
Deploy reading site under /reading with normal audio
```

Then push:

```bash
git push origin main
```

## Verification

Before committing:

- Validate shell scripts, JSON, FreeFileSync XML, and targeted HTML.
- Verify all six main indexes and story pages retain working relative audio URLs.
- Run the temporary staging sync and confirm MP3s appear under `/reading/`.
- Confirm `.gz` and `.br` files are generated only for eligible text assets.
- Confirm audio files are not compressed.
- Browser-test root, `/reading/kidsenglish/`, tabs, a story page, audio request, and MENU return.
- Confirm no R2 URL or R2 credential file is staged.

After pushing:

- Verify the new commit exists on `origin/main`.
- Confirm the working tree contains only intentionally excluded local files.
- Confirm the deployed layout remains:
  - root landing page at `/`
  - reading levels under `/reading/<directory>/`
  - audio under normal `/reading/<directory>/audio/` paths.

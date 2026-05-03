# Graded Reading Rsync Tree

This is the review tree for the `graded-reading/` sync target.

## Shared Assets

These are central assets used across multiple folder trees and should stay in one shared location.

```text
style/
  style.css
  style.css.bu  [backup/orphan, exclude]

pics/
  favicon.png
  backgroud.webp

images/
  Count-Down.gif
  blue-arrow-304924_50-left.png
  blue-arrow-304924_50-right.png
  green-arrow-153643_50x55-right.png
  green-arrow-153643_640-left.png
  rarrow-Asset 1.svg
  rwsl_iconsss22_r1_c1.png
  rwsl_iconsss22_r1_c3.png
  rwsl_iconsss22_r1_c5.png
  rwsl_iconsss22_r1_c7.png
  icons/
    icomoon/
      symbol-defs.svg
      SVG/
        headphones.svg
        help.svg
        key.svg

audio/
  dailylife001.mp3 ... dailylife077.mp3
  dating01.mp3 ... dating13.mp3
  election01.mp3 ... election12.mp3
  entertainment01.mp3 ... entertainment20.mp3
  food01.mp3 ... food11.mp3
  health01.mp3 ... health20.mp3
  housing01.mp3 ... housing10.mp3
  jobs01.mp3 ... jobs16.mp3
  restaurant01.mp3 ... restaurant10.mp3
  safety01.mp3 ... safety12.mp3
  schoollife01.mp3 ... schoollife15.mp3
  shop01.mp3 ... shop10.mp3
  sports01.mp3 ... sports12.mp3
  transportation01.mp3 ... transportation21.mp3
  travel01.mp3 ... travel14.mp3

fonts/
  glyphicons-halflings-regular.eot
  glyphicons-halflings-regular.svg
  glyphicons-halflings-regular.ttf
  glyphicons-halflings-regular.woff
  glyphicons-halflings-regular.woff2

AboutPageAssets/
  images/
    profilephoto.png
    social.png
  styles/
    aboutPageStyle.css
```

## Folder Trees

```text
easydialogs/
  index.html
  daily_life.html
  dating.html
  entertainment.html
  food.html
  health.html
  housing.html
  jobs.html
  restaurant.html
  safety.html
  schoollife.html
  shopping.html
  sports.html
  transportation.html
  travel.html
  vote.html
  audio/
  images/
  ec/
    css/

kidsenglish/
  index.html
  index_a.html
  audio/
  cloze/
  dict/
  ke/
  kemx/
  kewords/
  pics/
  s.png

kidsenglish2/
  index.html
  index_a.html
  audio/
  cloze/
  dict/
  ke2/
  pics/
  sent/
  w2/

kidsenglish3/
  index.html
  index_a.html
  audio/
  cloze/
  dict/
  ke3/
  pics/
  sent/
  w3/

begin1/
  index.html
  index_a.html
  audio/
  b1/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w1/

begin2/
  index.html
  index_a.html
  audio/
  b2/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w2/
  vnu.jar  [validator artifact, exclude from sync]

begin3/
  index.html
  index_a.html
  audio/
  b3/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w3/
  vnu.jar  [validator artifact, exclude from sync]

begin4/
  index.html
  index_a.html
  audio/
  b4/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w4/

begin5/
  index.html
  index_a.html
  audio/
  b5/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w5/

begin6/
  index.html
  audio/
  b6/
  cloze/
  dict/
  pics/
  s.png
  sent/
  w6/

supereasy/
  index.html
  index_a.html
  index_b.html
  index_c.html
  audio/
  dict/
  images/
  s.png
  at.png
  se/
  secloze/
  semx/
  sewords/

easyread/
  index.html
  audio/
  dict/
  ecloze/
  ecross/
  emx/
  es/
  ewords/
  images/
  s.png
  wax

eslread/
  index.html
  index_2.html
  index_3.html
  audio/
  cloze/
  comp/
  dict/
  pics/
  s.png
  ss/
  words/

people/
  index.html
  index_a.html
  audio/
  cloze/
  comp/
  dict/
  p/
  pics/
  s.png
  words/

essays/
  index.html
  audio/
  cloze/
  comp/
  dict/
  e/
  pics/
  s.png
  words/
```

## Cross-Folder Links

- `style/style.css` is the shared stylesheet for the legacy trees.
- `pics/backgroud.webp` is referenced by `style/style.css`.
- `pics/favicon.png` is used broadly across the folders.
- `audio/` is a shared content bucket and should not be duplicated per tree.
- `images/` is a shared asset bucket and contains the icon sprite used by the current homepage work.
- `begin2/b2/css/`, `begin4/b4/css/`, `begin5/b5/css/`, and `easydialogs/ec/css/` are local overrides that belong to their owning trees.
- `begin6/dict/1. The Hairstyle Change.html` still references a legacy `assets/bootstrap.min.css` and `assets/bootstrap.min.js` path. Treat that as a stale dependency unless that page is repaired.

## Sync Guidance

- Keep `robot/` out of the mirror.
- Keep backup and packaging files out of the mirror.
- Keep the shared asset buckets centralized instead of copying them into multiple SSOTs.
- Use the manifest-based rsync helper for the live mirror.

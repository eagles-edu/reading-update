Findings


AboutPageAssets/ is only referenced by robot/starters_reading_01.html (line 8), so if robot/ stays excluded it is effectively an orphan for this mirror. OMIT FROM SYNC

There are 10,747 local references to purl.org/dc/elements/1.1/index.html, but there is no matching local purl.org/ tree in the repo. That is a broken local asset/link pattern.   IF ITS LEGACY NOISE, ELIMINATE FROM SYNC

begin6/dict/1. The Hairstyle Change.html (line 11) still points at assets/bootstrap.min.css and assets/bootstrap.min.js, but there is no live assets/ tree under the reading roots.  TRANSFOM TO SITE WIRING, INCLUDE IN SYNC

The obvious runtime orphans are: **OMIT ALL FROM SYNC**

style/style.css.bu

supereasy/style.css.old

images/icons/icomoon.zip

images/icons/icomoon/svgxuse.js

needed.css

dict improvements.txt.css

inline_styles.log

dead_classes.log

begin2/b2/vnu.jar

begin3/b3/vnu.jar

the many _notes, _vti_cnf, .old, .older, .log, .zip, and .7z files in the reading trees

Centralization opportunities

style.css is a one-off legacy stylesheet used only by index-old.html (line 10). OMIT FROM SYNC;  Everything else uses style/style.css. That is the clearest SSOT split. OK

/favicon.ico should stay centralized. OK

pics/backgroud.webp is a shared background asset used by both stylesheet paths. OK

audio/ and images/ are shared buckets and should remain centralized. OK

begin2/b2/css/, begin4/b4/css/, begin5/b5/css/, and easydialogs/ec/css/ are local one-offs and are better left inside their owning trees OK

images/icons/icomoon/ is the icon SSOT for the current homepage wiring. OK


One-offs


index-old.html is the only page still pointing at root-level style.css.  OMIT FROM SYNC

begin6/dict/1. The Hairstyle Change.html is the only confirmed page with the stale assets/bootstrap.* dependency. NORMALIZE TO SITE WIRING

robot/ is a separate subtree with its own assumptions, but it is out of scope for the graded-reading mirror. CORRECT

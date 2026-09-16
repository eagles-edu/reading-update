const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { isTargetFile, transformHtml } = require('./modernize-audio-players.cjs');

const root = path.resolve(__dirname, '..');

test('targets story and dictation pages but not unrelated pages', () => {
  assert.equal(isTargetFile('begin1/dict/b1d015.html', 'dictation'), true);
  assert.equal(isTargetFile('easyread/es/es001.html', 'stories'), true);
  assert.equal(isTargetFile('begin1/cloze/b1cloze001.html', 'all'), false);
  assert.equal(isTargetFile('writing/w001.html', 'all'), false);
});

test('adds shared assets and markers without changing audio sources', () => {
  const file = path.join(root, 'begin1', 'dict', 'fixture.html');
  const source = `<!doctype html><html><head><title>Fixture</title></head><body>
<!-- <audio controls><source src="commented.mp3"></audio> -->
<audio class="audio-player" controls><source src="https://example.test/audio.mp3" type="audio/mp3"></audio>
</body></html>`;
  const result = transformHtml(source, file, root);

  assert.equal(result.blocked, null);
  assert.deepEqual(result.changes, ['shared player assets', 'audio markers']);
  assert.match(result.source, /href="\.\.\/\.\.\/player-proof\.css"/);
  assert.match(result.source, /src="\.\.\/\.\.\/player-proof\.js"/);
  assert.match(result.source, /data-eagles-audio="v1" crossorigin="anonymous"/);
  assert.match(result.source, /src="https:\/\/example\.test\/audio\.mp3"/);
  assert.match(result.source, /commented\.mp3/);
  assert.doesNotMatch(result.source, /commented\.mp3"[^>]*data-eagles-audio/);

  const second = transformHtml(result.source, file, root);
  assert.deepEqual(second.changes, []);
  assert.equal(second.source, result.source);
});

test('blocks pages without a head close tag', () => {
  const result = transformHtml('<html><body><audio></audio></body></html>', path.join(root, 'easyread', 'es', 'fixture.html'), root);
  assert.equal(result.blocked, 'missing </head>');
  assert.deepEqual(result.changes, []);
});

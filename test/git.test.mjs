import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileDiffIntoHunks, extractPathFromFileDiff } from '../src/git.mjs';

test('extractPathFromFileDiff reads the "b/" path from a diff header', () => {
  const diff = 'diff --git a/src/old.mjs b/src/new.mjs\nindex 123..456 100644\n--- a/src/old.mjs\n+++ b/src/new.mjs\n';
  assert.equal(extractPathFromFileDiff(diff), 'src/new.mjs');
});

test('extractPathFromFileDiff returns null when there is no diff header', () => {
  assert.equal(extractPathFromFileDiff('not a diff'), null);
});

test('parseFileDiffIntoHunks returns null for a binary/mode-only diff (no @@ hunk)', () => {
  const diff = 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n';
  assert.equal(parseFileDiffIntoHunks(diff), null);
});

test('parseFileDiffIntoHunks splits a single-hunk diff into header + one hunk', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 123..456 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,2 +1,2 @@',
    '-old line',
    '+new line',
    ' context',
  ].join('\n');

  const result = parseFileDiffIntoHunks(diff);
  assert.ok(result);
  assert.equal(result.hunks.length, 1);
  assert.match(result.header, /^diff --git/);
  assert.match(result.hunks[0], /^@@ -1,2 \+1,2 @@/);
});

test('parseFileDiffIntoHunks splits a multi-hunk diff into separate hunks', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 123..456 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,2 +1,2 @@',
    '-old line one',
    '+new line one',
    '@@ -10,2 +10,2 @@',
    '-old line two',
    '+new line two',
  ].join('\n');

  const result = parseFileDiffIntoHunks(diff);
  assert.equal(result.hunks.length, 2);
  assert.match(result.hunks[0], /old line one/);
  assert.match(result.hunks[1], /old line two/);
});

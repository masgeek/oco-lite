import { execFileSync } from 'node:child_process';
import { die } from './die.mjs';

export function assertGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    die('Not inside a git repository.');
  }
}

export function getStagedDiff(pathspec) {
  const args = pathspec
    ? ['diff', '--staged', '--no-color', '--', pathspec]
    : ['diff', '--staged', '--no-color'];
  let diff;
  try {
    diff = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    die('Failed to run `git diff --staged`.');
  }
  if (!diff.trim()) die('No staged changes found. Run `git add <files>` first.');
  return diff;
}

export function getStagedFiles() {
  try {
    return execFileSync('git', ['diff', '--staged', '--name-only'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Unstaged + untracked working-tree changes, for the interactive staging prompt. */
export function getWorkingTreeChanges() {
  let output;
  try {
    output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const rest = line.slice(3);
      const arrowIdx = rest.indexOf(' -> ');
      const file = arrowIdx === -1 ? rest : rest.slice(arrowIdx + 4);
      return { status, file };
    });
}

export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n[... diff truncated ...]';
}

/** Split one file's unified diff into { header, hunks[] }. Returns null for binary/mode-only diffs. */
export function parseFileDiffIntoHunks(fileDiff) {
  const lines = fileDiff.split('\n');
  const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunkIdx === -1) return null;

  const header = lines.slice(0, firstHunkIdx).join('\n');
  const body = lines.slice(firstHunkIdx);

  const hunks = [];
  let current = [];
  for (const line of body) {
    if (line.startsWith('@@') && current.length > 0) {
      hunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push(current.join('\n'));

  return { header, hunks };
}

export function getFileDiffs() {
  const fullDiff = getStagedDiff(null);
  return fullDiff.split(/(?=^diff --git )/m).filter((p) => p.trim().length > 0);
}

export function extractPathFromFileDiff(fileDiff) {
  const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return match ? match[2] : null;
}

export function commitWithMessage(message, pathspec) {
  const args = pathspec ? ['commit', '-m', message, '--', pathspec] : ['commit', '-m', message];
  try {
    execFileSync('git', args, { stdio: 'inherit' });
  } catch {
    die(`git commit failed${pathspec ? ` for ${pathspec}` : ''}.`);
  }
}

/** Used by --check mode to re-classify the most recent commit. */
export function getLastCommitMessage() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
  } catch {
    die('Could not read the last commit message. Is there at least one commit?');
  }
}

export function getLastCommitDiff() {
  try {
    return execFileSync('git', ['show', '--no-color', '--pretty=format:', 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch {
    die('Could not read the last commit diff.');
  }
}

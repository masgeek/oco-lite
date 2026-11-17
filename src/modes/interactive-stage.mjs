import * as clack from '@clack/prompts';
import { execFileSync } from 'node:child_process';
import { getWorkingTreeChanges } from '../git.mjs';
import { setRunOptions } from '../cli-args.mjs';

const STATUS_HINTS = {
  '??': 'untracked',
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
};

function describeStatus(status) {
  return STATUS_HINTS[status] || STATUS_HINTS[status.replace(/[MD]$/, '')] || status;
}

/**
 * Nothing is staged: offer to stage some/all working-tree changes instead of
 * just dying with "run git add first". Returns true once at least one file
 * has been staged, false if there was nothing to stage or the user backed out.
 */
export async function maybeInteractiveStage() {
  const changes = getWorkingTreeChanges();
  if (changes.length === 0) return false;

  clack.intro('No staged changes found');

  const selected = await clack.multiselect({
    message: 'Select files to stage',
    options: changes.map((c) => ({ value: c.file, label: c.file, hint: describeStatus(c.status) })),
    initialValues: changes.map((c) => c.file),
    required: false,
  });

  if (clack.isCancel(selected) || selected.length === 0) {
    clack.cancel('Nothing staged.');
    return false;
  }

  execFileSync('git', ['add', '--', ...selected], { stdio: 'ignore' });
  clack.outro(`Staged ${selected.length} file(s).`);
  return true;
}

const MODE_OPTIONS = [
  { value: 'single', label: 'Single commit', hint: 'one commit for everything staged' },
  { value: 'split', label: 'Split by file', hint: 'merges related files, one commit per file otherwise' },
  { value: 'split-hunks', label: 'Split by hunk', hint: 'one commit per logical diff hunk' },
  { value: 'group', label: 'Group (model-decided)', hint: 'let the model decide how to group staged files' },
];

const COMMIT_BEHAVIOR_OPTIONS = [
  { value: 'ask', label: 'Commit with confirmation', hint: 'review/edit each message before committing' },
  { value: 'auto', label: 'Commit automatically', hint: 'no per-commit confirmation' },
  { value: 'preview', label: 'Preview only', hint: "generate the message(s), don't commit" },
];

/**
 * Only asked on a fully bare `oco-lite` invocation (no mode/commit flags at
 * all — see cli-args.mjs's `bareInvocation`) right after interactive staging,
 * since otherwise there's no signal for which mode the user actually wants.
 */
export async function maybeInteractivePickRunOptions() {
  const mode = await clack.select({ message: 'How should this be committed?', options: MODE_OPTIONS, initialValue: 'single' });
  if (clack.isCancel(mode)) {
    clack.cancel('Aborted.');
    return false;
  }

  const behavior = await clack.select({
    message: 'Commit behavior',
    options: COMMIT_BEHAVIOR_OPTIONS,
    initialValue: 'ask',
  });
  if (clack.isCancel(behavior)) {
    clack.cancel('Aborted.');
    return false;
  }

  setRunOptions({
    mode,
    shouldCommit: behavior !== 'preview',
    autoYes: behavior === 'auto',
  });
  return true;
}

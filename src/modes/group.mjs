import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import { getStagedDiff, getStagedFiles, truncateDiff } from '../git.mjs';
import { buildGroupingPrompt } from '../prompts.mjs';
import { parseGroupingResult } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit, breakingDetectionEnabled } from '../cli-args.mjs';
import { die } from '../die.mjs';
import { runSingleMode } from './single.mjs';
import { runStrictSplitMode } from './split.mjs';

/**
 * Sends all staged files' diffs to the model in one request and asks it to
 * cluster files that implement the same logical change into groups, so a
 * related edit spread across several files becomes one commit instead of
 * several. Each group gets its own breaking-change assessment.
 *
 * Returns true if a valid grouping was found and handled (printed, and
 * committed if --commit/-y was passed), or false if the model's response
 * didn't parse into a valid grouping — the caller decides the fallback.
 */
export async function runGroupedCommitFlow(files) {
  const { GROUP_MAX_DIFF_PER_FILE } = await loadConfig();
  const fileEntries = files.map((path) => ({
    path,
    diff: truncateDiff(getStagedDiff(path), GROUP_MAX_DIFF_PER_FILE),
  }));

  let raw;
  try {
    raw = await callModel(buildGroupingPrompt(fileEntries), `grouping for ${files.length} staged files`);
  } catch (err) {
    die(err.message);
  }

  const groups = parseGroupingResult(raw, files, breakingDetectionEnabled);
  if (!groups) return false;

  console.log(`\nDetected ${groups.length} logical group(s):\n`);
  groups.forEach((g, i) => {
    console.log(`Group ${i + 1}: ${g.files.join(', ')}`);
    console.log(chalk.dim('——————————————————'));
    console.log(g.message);
    console.log(chalk.dim('——————————————————'));
    if (g.breaking) console.log(chalk.yellow('⚠ marked as a BREAKING CHANGE'));
    console.log('');
  });

  if (!shouldCommit) return true;

  for (const g of groups) {
    const { proceed, message: finalMessage } = await confirmWithEdit(
      `Commit group [${g.files.join(', ')}] with the above message? [y/N/e] `,
      g.message
    );
    if (!proceed) {
      console.log(`Skipped group [${g.files.join(', ')}]. Files remain staged.`);
      continue;
    }
    execFileSync('git', ['commit', '-m', finalMessage, '--', ...g.files], { stdio: 'inherit' });
  }
  console.log('\nDone.');
  return true;
}

/** Explicit alias of the --split default: always attempts grouping (never a strict-split fallback). */
export async function runGroupMode() {
  const files = getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  if (files.length === 1) {
    console.log('Only one staged file — nothing to group, falling back to single-file mode.');
    return runSingleMode();
  }

  const grouped = await runGroupedCommitFlow(files);
  if (!grouped) {
    console.warn('Could not parse a valid grouping from the model. Falling back to one commit per file.');
    return runStrictSplitMode(files);
  }
}

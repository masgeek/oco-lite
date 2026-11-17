import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import { getLastCommitMessage, getLastCommitDiff, truncateDiff } from '../git.mjs';
import { buildPrompt } from '../prompts.mjs';
import { parseModelJson } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { ALLOWED_TYPES, BREAKING_GITMOJI } from '../constants.mjs';
import { die } from '../die.mjs';

/**
 * Re-classifies HEAD's diff and warns if the commit message that was
 * actually written looks inconsistent with that classification — catches
 * commits made by hand (bypassing oco-lite) that miss a breaking-change flag
 * or use a mismatched type. Read-only: never touches the index or history.
 * Exits non-zero if issues are found, so it's usable as a CI/hook gate.
 */
export async function runCheckMode() {
  const { MAX_DIFF } = await loadConfig();
  const message = getLastCommitMessage();
  const diff = truncateDiff(getLastCommitDiff(), MAX_DIFF);

  console.log('Checking the last commit message against its diff...\n');
  console.log(chalk.dim('Current message:'));
  console.log(chalk.dim('——————————————————'));
  console.log(message);
  console.log(chalk.dim('——————————————————'));
  console.log();

  let raw;
  try {
    raw = await callModel(buildPrompt(diff), 'classification for HEAD');
  } catch (err) {
    die(err.message);
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    die('Model returned an unparseable classification. Try again or check OCOLITE_MODEL.');
  }

  const issues = [];
  const expectedBreaking = parsed.breaking === true;
  const hasBreakingGitmoji = message.trimStart().startsWith(BREAKING_GITMOJI);
  const mentionsBreakingChange = /BREAKING CHANGE/i.test(message);

  if (expectedBreaking && !hasBreakingGitmoji && !mentionsBreakingChange) {
    issues.push(
      `Model classifies this diff as a BREAKING CHANGE (${parsed.breakingReason || 'no reason given'}), but the commit ` +
        `message doesn't flag it (no ${BREAKING_GITMOJI} or "BREAKING CHANGE" text).`
    );
  }
  if (!expectedBreaking && (hasBreakingGitmoji || mentionsBreakingChange)) {
    issues.push('The commit message flags a breaking change, but the model does not think this diff is breaking. Double check.');
  }

  const expectedType = ALLOWED_TYPES.has(parsed.type) ? parsed.type : null;
  if (expectedType) {
    const typeMatch = message.match(/^\S+\s+(\w+)(\([^)]*\))?:/);
    if (typeMatch && typeMatch[1] !== expectedType) {
      issues.push(`Model classifies this change as "${expectedType}", but the commit message uses type "${typeMatch[1]}".`);
    }
  }

  if (issues.length === 0) {
    console.log(chalk.green('✅ No issues found — message looks consistent with the diff.'));
    return;
  }

  console.log(chalk.yellow(`⚠ ${issues.length} issue(s) found:\n`));
  issues.forEach((issue, i) => console.log(`${i + 1}. ${issue}`));
  process.exitCode = 1;
}

import { execFileSync } from 'node:child_process';
import { getFileDiffs, extractPathFromFileDiff, parseFileDiffIntoHunks, commitWithMessage } from '../git.mjs';
import { generateMessageForDiffText, generateMessageFor } from '../generate.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit, dryRun } from '../cli-args.mjs';
import { die } from '../die.mjs';

export async function runSplitHunksMode() {
  const fileDiffs = getFileDiffs();
  if (fileDiffs.length === 0) die('No staged changes found.');

  console.log(
    dryRun
      ? `Previewing logical (per-hunk) commits across ${fileDiffs.length} file(s) — nothing will be staged or committed:\n`
      : `Splitting into logical (per-hunk) commits across ${fileDiffs.length} file(s):\n`
  );

  if (!dryRun) {
    // Guard against sweeping in unrelated edits: the whole-file fallback
    // below (`git add -- <file>`) stages the ENTIRE file, not just the
    // captured hunks, so any unstaged changes present on these files would
    // silently ride along into a commit the user never asked for.
    const unstagedFiles = new Set(
      execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    );
    const conflicting = fileDiffs.map(extractPathFromFileDiff).filter((f) => f && unstagedFiles.has(f));
    if (conflicting.length > 0) {
      die(
        `These file(s) have unstaged changes in addition to staged ones: ${conflicting.join(', ')}. ` +
          'Stash or commit the unstaged changes first — split-hunks mode can stage a whole file as a ' +
          'fallback, which would sweep unstaged edits into the commit.'
      );
    }
    execFileSync('git', ['reset'], { stdio: 'ignore' });
  }

  for (const fileDiff of fileDiffs) {
    const filePath = extractPathFromFileDiff(fileDiff);
    if (!filePath) {
      console.warn('Could not determine file path for a diff chunk, skipping.');
      continue;
    }

    const parsed = parseFileDiffIntoHunks(fileDiff);

    if (!parsed || parsed.hunks.length <= 1) {
      const message = await generateMessageForDiffText(fileDiff, filePath);
      if (dryRun) continue;

      execFileSync('git', ['add', '--', filePath], { stdio: 'ignore' });
      if (shouldCommit) {
        const { proceed, message: finalMessage } = await confirmWithEdit(`Commit "${filePath}" with this message? [y/N/e] `, message);
        if (proceed) commitWithMessage(finalMessage, filePath);
        else console.log(`Skipped ${filePath}.`);
      }
      continue;
    }

    console.log(`\n${filePath}: ${parsed.hunks.length} hunk(s) detected`);

    for (let i = 0; i < parsed.hunks.length; i++) {
      const patch = `${parsed.header}\n${parsed.hunks[i]}\n`;
      const label = `${filePath} (hunk ${i + 1}/${parsed.hunks.length})`;

      if (dryRun) {
        await generateMessageForDiffText(patch, label);
        continue;
      }

      try {
        execFileSync('git', ['apply', '--cached', '--whitespace=nowarn'], {
          input: patch,
          stdio: ['pipe', 'ignore', 'pipe'],
        });
      } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        const isPatchConflict = /patch does not apply|while searching for|corrupt patch|malformed patch/i.test(
          stderr
        );
        if (!isPatchConflict) {
          die(`git apply failed unexpectedly for ${filePath}: ${stderr || err.message}`);
        }
        console.warn(
          `  Hunk ${i + 1} failed to apply cleanly (context conflict). ` +
            `Falling back to committing the remaining changes in ${filePath} as one commit.`
        );
        execFileSync('git', ['add', '--', filePath], { stdio: 'ignore' });
        const message = await generateMessageFor(null, `${filePath} (remaining changes)`);
        if (shouldCommit) {
          const { proceed, message: finalMessage } = await confirmWithEdit(`Commit remaining "${filePath}" changes? [y/N/e] `, message);
          if (proceed) commitWithMessage(finalMessage, filePath);
        }
        break;
      }

      const message = await generateMessageFor(null, label);
      if (!shouldCommit) continue;

      const { proceed, message: finalMessage } = await confirmWithEdit(`Commit this hunk of "${filePath}"? [y/N/e] `, message);
      if (!proceed) {
        console.log(`  Skipped hunk ${i + 1}. It remains staged — commit or reset it manually.`);
        continue;
      }
      commitWithMessage(finalMessage, filePath);
    }
  }
  console.log(dryRun ? '\nDry run complete. Nothing was staged or committed.' : '\nDone.');
}

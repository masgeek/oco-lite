import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { autoYes } from './cli-args.mjs';

export function printVersion() {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const { name, version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  console.log(`${name} v${version}`);
}

export function printHelp() {
  console.log(`oco-lite — commit message generator backed by a local or cloud model

Usage:
  oco-lite init                   interactive setup — choose a provider/model and write a config file
  oco-lite use                    quick-switch to an already-configured provider (no full re-init)
  oco-lite                        print message for all staged changes
  oco-lite --commit               generate + confirm + commit
  oco-lite -y                     generate + commit, no confirmation
  oco-lite --split [--commit|-y]  merge related staged files into one commit each,
                                   one commit per file for everything else
  oco-lite --split --no-group-detection  strict one commit per staged file
  oco-lite --split-hunks [...]    one commit per logical diff hunk
  oco-lite --split-hunks --dry-run  preview hunks/messages, no staging or commits
  oco-lite --group [--commit|-y]  same relatedness detection as --split
  oco-lite --check                re-classify HEAD's diff, warn if its message looks inconsistent
  oco-lite --no-breaking-detection  skip breaking-change classification
  oco-lite --help                 show this help
  oco-lite --version              print the installed version

At any confirmation prompt, answer "e" to edit the message in $GIT_EDITOR/$EDITOR before committing.

Providers: OCOLITE_PROVIDER=ollama (default) | ollama-cloud | openai | anthropic
Env vars: OCOLITE_MODEL, OCOLITE_HOST, OCOLITE_API_KEY, OCOLITE_MAX_DIFF, OCOLITE_TIMEOUT_MS, OCOLITE_FALLBACK_MODELS
Config file: cosmiconfig-style "oco-lite" config (.oco-literc.json, "oco-lite" key in package.json, etc.)`);
}

/** Open `message` in $GIT_EDITOR/$EDITOR for editing; returns the edited text, or the original if the editor fails or leaves it empty. */
export function editMessageInEditor(message) {
  const editor = process.env.GIT_EDITOR || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
  const tmpFile = path.join(os.tmpdir(), `oco-lite-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, message, 'utf8');

  try {
    const result = spawnSync(`${editor} ${JSON.stringify(tmpFile)}`, { stdio: 'inherit', shell: true });
    if (result.error || result.status !== 0) {
      console.warn(`Editor "${editor}" did not exit cleanly; keeping the previous message.`);
      return message;
    }
    const edited = fs.readFileSync(tmpFile, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return edited.trim() ? edited : message;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Prompt for confirmation, allowing "e" to edit the message in $EDITOR first
 * (looping back to the same prompt with the edited text). Returns the final
 * { proceed, message }.
 */
export async function confirmWithEdit(question, message) {
  if (autoYes) return { proceed: true, message };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  let current = message;
  try {
    for (;;) {
      const answer = (await ask(question)).trim();
      if (/^e(dit)?$/i.test(answer)) {
        current = editMessageInEditor(current);
        console.log('——————————————————');
        console.log(current);
        console.log('——————————————————');
        continue;
      }
      return { proceed: /^y(es)?$/i.test(answer), message: current };
    }
  } finally {
    rl.close();
  }
}

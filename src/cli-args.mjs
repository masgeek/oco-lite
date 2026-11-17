export const args = process.argv.slice(2);
export const initMode = args[0] === 'init';
export const useMode = args[0] === 'use';
export let shouldCommit = args.includes('--commit') || args.includes('-y');
export let autoYes = args.includes('-y');
export let splitMode = args.includes('--split');
export let splitHunksMode = args.includes('--split-hunks');
export let groupMode = args.includes('--group');
export let dryRun = args.includes('--dry-run');
export const checkMode = args.includes('--check');
export const noGroupDetection = args.includes('--no-group-detection');
export let breakingDetectionEnabled = !args.includes('--no-breaking-detection');
export const helpRequested = args.includes('--help') || args.includes('-h');
export const versionRequested = args.includes('--version') || args.includes('-v');

// True when nothing on the command line selects a mode or commit behavior —
// the plain `oco-lite` invocation. Used to decide whether, on top of an
// interactive staging prompt (see modes/interactive-stage.mjs), we also ask
// the user which mode/commit behavior to run, instead of silently defaulting.
export const bareInvocation = !shouldCommit && !splitMode && !splitHunksMode && !groupMode && !dryRun && !checkMode;

/** Applies the config file's `breakingDetection: false`, once config.mjs's loadConfig() has resolved it. */
export function applyFileConfigToArgs(fileConfig) {
  if (fileConfig.breakingDetection === false) breakingDetectionEnabled = false;
}

/**
 * Lets modes/interactive-stage.mjs set the mode/commit behavior chosen in its
 * prompts after the fact. cli.mjs's dispatch reads the exports above as live
 * ESM bindings, so mutating them here is visible to every importer.
 */
export function setRunOptions({ mode, shouldCommit: sc, autoYes: ay } = {}) {
  if (mode !== undefined) {
    splitMode = mode === 'split';
    splitHunksMode = mode === 'split-hunks';
    groupMode = mode === 'group';
  }
  if (sc !== undefined) shouldCommit = sc;
  if (ay !== undefined) {
    autoYes = ay;
    if (ay) shouldCommit = true;
  }
}

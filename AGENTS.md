# AGENTS.md

## Purpose
Guidance for agents working on **oco-lite**, a Node.js CLI that generates conventional-commit
messages for staged git changes using a local or cloud LLM (Ollama, Ollama Cloud, OpenAI, or
Anthropic). The executable (`oco-lite.mjs`) is a thin entry point; all logic lives under `src/`.

## Key Commands
- `npm test` – syntax-checks every `.mjs` file, then runs the unit test suite (`node --test`) under `test/`.
- `node --check oco-lite.mjs` – syntax-check just the entry point.
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` – validate `package.json`.
- `npm pack --dry-run` – verify package files and `bin` entry before a release.
- `node oco-lite.mjs [--split|--split-hunks|--group] [--commit|-y] [--no-breaking-detection]` – run the tool against staged changes.
  *`--split`* = one commit per file (merging related files when possible), *`--split-hunks`* = one commit per diff hunk, *`--group`* = let the model group related files into commits.
- `node oco-lite.mjs init` / `node oco-lite.mjs use` – interactive setup / quick provider switch (writes a config file; see Configuration below).
- `node oco-lite.mjs --check` – re-classifies HEAD's diff and warns if the last commit message looks inconsistent with it (read-only, usable as a CI/hook gate).

## Configuration
Precedence, highest to lowest: **env var > config file > OS keychain (API key only) > built-in default**.
Resolved lazily and memoized by `loadConfig()` in `src/config.mjs` — nothing reads the config file or
keychain until the first call, so importing `config.mjs` has no side effects.

- Config file: cosmiconfig search (`.oco-literc.json/.yaml/.js`, `"oco-lite"` key in `package.json`, walking up to a global per-OS config dir) — written by `oco-lite init`/`use`.
- Env vars: `OCOLITE_PROVIDER` (`ollama` default | `ollama-cloud` | `openai` | `anthropic`), `OCOLITE_MODEL`, `OCOLITE_HOST`, `OCOLITE_API_KEY`, `OCOLITE_MAX_DIFF` (default 6000), `OCOLITE_TIMEOUT_MS` (default 60000), `OCOLITE_GROUP_MAX_DIFF_PER_FILE` (default 1200), `OCOLITE_FALLBACK_MODELS` (comma-separated, retried in order on failure).
- Per-provider defaults (model/host) live in `DEFAULT_MODELS`/`DEFAULT_HOSTS` in `src/config.mjs` — check there, not here, since they change independently of this doc.
- API keys: never required for `ollama`; for other providers, resolved from env > config file plaintext > OS keychain (`src/secrets.mjs`, via `@napi-rs/keyring`).

## Run Modes Overview
- **Single** (default) – one commit covering all staged diffs.
- **Split** – merges related staged files into one commit each (model-assisted), one commit per file for everything else; `--no-group-detection` forces strict one-commit-per-file.
- **Split-Hunks** – resets the index, applies each `@@` hunk with `git apply --cached`; falls back to a whole-file commit if a hunk fails to apply. Refuses to run if any involved file also has *unstaged* changes (would otherwise get swept into the whole-file fallback). `--dry-run` previews hunks/messages without touching the index.
- **Group** – sends all staged files' diffs in one request and asks the model to cluster related files into commits; missing/duplicate files are swept into a trailing `chore: update remaining files` commit; falls back to Split on an unparseable response.
- **Check** – re-classifies HEAD's diff, compares it against the actual commit message, exits non-zero on a mismatch.
- **Interactive staging** – if nothing is staged when any mode runs, `src/modes/interactive-stage.mjs` prompts (via `@clack/prompts`) to pick files to stage from `git status`. On a fully bare `oco-lite` invocation (no flags at all) it also asks which mode and commit behavior (ask/auto/preview) to use.

## CI Integration
- `.github/workflows/ci-check.yml` ("CI") runs on every push/PR across Node 22 & 24: `pnpm test` (syntax + unit tests), a `--help` smoke test, `package.json` validation, `pnpm audit --production`, and a dry-run `pnpm pack`.
- `.github/workflows/bump-version.yml` runs after CI succeeds on `main`: auto-generates a semver tag from conventional-commit messages and creates a GitHub Release, using a short-lived **GitHub App token** (not the default `GITHUB_TOKEN` — events from the default token don't trigger other workflows, which is why this step needs its own App).
- `.github/workflows/publish-npm.yml` triggers on that release being published and runs `npm stage publish` (npm Trusted Publishing/OIDC, no stored npm token). This only **stages** the release — the Trusted Publisher is configured stage-only, so a human still has to run `npm stage approve <stage-id>` (or approve on npmjs.com) with 2FA before it actually goes live. That manual gate is deliberate: a compromised workflow/token can stage a release but never finalize one by itself.
- No Ollama instance is reachable in CI; tests only cover pure functions (see Gotchas) and don't call a model.

## Release Process
1. Merge conventional-commit-formatted changes to `main`.
2. CI (`ci-check.yml`) runs automatically.
3. On success, `bump-version.yml` auto-tags (unprefixed, e.g. `1.2.3` — set via `tag_prefix: ""` on its `github-tag-action` step) and creates a GitHub Release.
4. `publish-npm.yml` stages the npm publish; a maintainer must manually approve it (2FA) before it's live.
> **Important**: The very first version on npm must still be published manually with a token that has `automation` access, before Trusted Publishing can take over for subsequent releases.

## Gotchas Agents Might Miss
- Unit tests (`test/*.test.mjs`, run via `npm test`/`node --test`) only cover pure functions with no git/network/config dependency (`src/git.mjs`'s diff parsing, `src/parsing.mjs`'s model-output parsing — the latter takes `breakingDetectionEnabled` as an explicit parameter specifically so it has zero dependency on `cli-args.mjs`/`config.mjs`). Nothing exercises the actual git/Ollama/provider plumbing — treat a green `npm test` as "parsing logic didn't regress," not "the CLI works end to end."
- `src/config.mjs`'s `loadConfig()` is async and memoized — call it, don't import the old eager named exports (`PROVIDER`, `API_KEY`, etc.), which no longer exist.
- `src/cli-args.mjs`'s mode/commit-behavior flags (`shouldCommit`, `autoYes`, `splitMode`, `splitHunksMode`, `groupMode`, `dryRun`) are mutable (`let`) live ESM bindings, not frozen consts — `setRunOptions()` lets the interactive-stage flow change them after the fact once the user picks a mode in the prompt.
- All git shell-out goes through `execFileSync` with argument arrays (`src/git.mjs`, `src/modes/split-hunks.mjs`) — never build a command string with interpolated file paths; diff content (and therefore file names) can't be trusted as shell-safe.
- `runSplitHunksMode` uses `git reset` and `git apply --cached`; it refuses to run if any involved file has unstaged changes, and distinguishes a genuine patch conflict (falls back to whole-file commit) from any other `git apply` failure (which it treats as fatal instead of silently masking).
- Model must return **pure JSON**; prompts enforce `format: 'json'`. Parsing falls back to a raw-text heuristic if needed (`fallbackFromRawText`).
- `npm pack --dry-run` is essential to catch missing files in the `files` field or incorrect `bin` path before publishing.

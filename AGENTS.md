# AGENTS.md

## Purpose
Guidance for OpenCode agents to work efficiently with **oco-lite**, a single‑file Node.js CLI that generates conventional commit messages via a local Ollama model.

## Key Commands
- `node --check oco-lite.mjs` – syntax‑check the script (acts as the repo’s test suite).
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` – validate `package.json`.
- `npm pack --dry-run` – verify package files and `bin` entry.
- `node oco-lite.mjs [--split|--split-hunks|--group] [--commit|-y] [--no-breaking-detection]` – run the tool against staged changes.
  *`--split`* = one commit per file, *`--split-hunks`* = one commit per diff hunk, *`--group`* = let model group files.

## Environment Variables (required for custom behaviour)
- `OCOLITE_MODEL` – Ollama model name (default `llama2` if unset).
- `OCOLITE_HOST` – Ollama server URL (default `http://127.0.0.1:11434`).
- `OCOLITE_MAX_DIFF` – max characters sent per request.
- `OCOLITE_TIMEOUT_MS` – request timeout.
- `OCOLITE_GROUP_MAX_DIFF_PER_FILE` – cap per file in `--group` mode.

## Run Modes Overview
- **Single** (default) – one commit covering all staged diffs.
- **Split** – commits per file.
- **Split‑Hunks** – resets index, applies each `@@` hunk with `git apply --cached`; falls back to whole‑file commit on failure.
- **Group** – sends all diffs, expects model to return grouping JSON; missing/duplicate files are added to a final `chore: update remaining files` commit; falls back to Split on unparseable response.

## CI Integration
- `.github/workflows/ci.yml` runs the four commands above (syntax check, package validation, dry‑run, and the tool) on every push/PR.
- Ensure a local Ollama instance is reachable during CI or mock the generate step.

## Release Process
```bash
npm version <patch|minor|major>   # updates package.json, git commit & tag
git push --follow-tags           # triggers .github/workflows/publish.yml
```
Tag names are unprefixed (e.g., `1.2.3`); `.npmrc` sets `tag-version-prefix=""`.
> **Important**: The first published version must be created manually (using an npm token with `automation` access) before the CI OIDC Trusted Publishing can run. Subsequent releases are automated via the publish workflow.


## Gotchas Agents Might Miss
- No test framework – the only verification is the syntax check above.
- All configuration is **environment variables**, not a config file.
- `runSplitHunksMode` uses `git reset` and `git apply --cached`; it may fail on overlapping hunks.
- Model must return **pure JSON**; prompts enforce `format: 'json'`. Parsing falls back to raw‑text heuristic if needed.
- `npm pack --dry-run` is essential to catch missing files in the `files` field or incorrect `bin` path before publishing.

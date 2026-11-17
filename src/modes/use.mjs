import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { loadConfig, DEFAULT_HOSTS, DEFAULT_MODELS } from '../config.mjs';
import { getApiKeySecret } from '../secrets.mjs';
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from '../global-config.mjs';
import { PROVIDER_OPTIONS, PROVIDER_LABELS } from '../provider-options.mjs';
import { cancelled, promptForModel } from '../wizard-ui.mjs';

const CLOUD_PROVIDERS = PROVIDER_OPTIONS.map((o) => o.value).filter((p) => p !== 'ollama');

/**
 * Quick-switch between providers you've already configured, without
 * re-running the full `init` wizard. "Already configured" means: ollama
 * (always, no key needed) or any cloud provider with a key already saved in
 * the OS keychain by a previous `init`/`use` run. Only asks for a model —
 * host/breaking-change/fallback-models and anything else already set are
 * left untouched. Updates whichever config file is currently in effect
 * (falls back to creating the global one if none exists yet).
 */
export async function runUseMode() {
  clack.intro('oco-lite use');

  const { fileConfig, fileConfigPath, PROVIDER } = await loadConfig();

  const candidates = [{ ...PROVIDER_OPTIONS[0], hint: 'no API key needed' }];
  for (const provider of CLOUD_PROVIDERS) {
    const key = await getApiKeySecret(provider);
    if (key) candidates.push({ value: provider, label: PROVIDER_LABELS[provider], hint: 'key found in keychain' });
  }

  if (candidates.length === 1) {
    clack.log.info('Only Ollama (local) is configured so far. Run `oco-lite init` to add a cloud provider.');
  }

  const provider = await clack.select({
    message: 'Switch to which provider?',
    options: candidates,
    initialValue: candidates.some((c) => c.value === PROVIDER) ? PROVIDER : candidates[0].value,
  });
  if (cancelled(provider)) return;

  const apiKey = provider === 'ollama' ? '' : await getApiKeySecret(provider);
  const host = fileConfig.provider === provider && fileConfig.host ? fileConfig.host : DEFAULT_HOSTS[provider];

  const model = await promptForModel(provider, host, apiKey ?? '');
  if (cancelled(model)) return;

  // Only .json-shaped files we fully control the format of are safe to
  // overwrite wholesale — a package.json needs its "oco-lite" key merged in
  // place, not the whole file replaced, and .yaml/.js config files aren't
  // plain JSON we can just stringify back.
  const canAutoWrite =
    !fileConfigPath || (path.extname(fileConfigPath) === '.json' && path.basename(fileConfigPath) !== 'package.json');

  if (!canAutoWrite) {
    clack.outro(
      `Your active config (${fileConfigPath}) isn't in a format oco-lite can safely auto-update.\n` +
        `Edit it by hand, or delete/rename it and re-run \`oco-lite use\` to get a dedicated file.`
    );
    return;
  }

  const targetPath = fileConfigPath ?? GLOBAL_CONFIG_PATH;
  const nextConfig = { ...fileConfig, provider, model: model || DEFAULT_MODELS[provider], host };
  delete nextConfig.apiKey; // never leave a stale plaintext key for whatever provider was active before

  if (!fileConfigPath) {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  clack.outro(`Switched to ${PROVIDER_LABELS[provider]} (${nextConfig.model}). Updated ${targetPath}.`);
}

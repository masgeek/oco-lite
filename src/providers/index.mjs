import ora from 'ora';
import { loadConfig } from '../config.mjs';
import { die } from '../die.mjs';
import { callOllamaOnce, callOllamaCloudOnce } from './ollama.mjs';
import { callOpenAiOnce } from './openai.mjs';
import { callAnthropicOnce } from './anthropic.mjs';

async function callModelOnce(prompt, model, spinner) {
  const { PROVIDER } = await loadConfig();
  if (PROVIDER === 'openai') return callOpenAiOnce(prompt, model, spinner);
  if (PROVIDER === 'anthropic') return callAnthropicOnce(prompt, model, spinner);
  if (PROVIDER === 'ollama-cloud') return callOllamaCloudOnce(prompt, model, spinner);
  return callOllamaOnce(prompt, model, spinner);
}

/**
 * Calls the configured provider with live streaming progress, trying
 * OCOLITE_FALLBACK_MODELS (in order, same provider) if the primary model
 * fails or times out.
 */
export async function callModel(prompt, label = 'response') {
  const { MODEL, FALLBACK_MODELS } = await loadConfig();
  const modelsToTry = [MODEL, ...FALLBACK_MODELS];
  const spinner = ora(`Generating ${label} with ${MODEL}...`).start();

  let lastErr;
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    if (i > 0) spinner.start(`Retrying ${label} with fallback model "${model}"...`);
    try {
      const result = await callModelOnce(prompt, model, spinner);
      spinner.succeed(`Generated ${label} with ${model}.`);
      return result;
    } catch (err) {
      lastErr = err;
      spinner.fail(`"${model}" failed: ${err.message}`);
    }
  }
  throw lastErr;
}

export async function assertProviderReachable() {
  const { PROVIDER, API_KEY, HOST } = await loadConfig();

  if (PROVIDER === 'openai' || PROVIDER === 'anthropic') {
    if (!API_KEY) {
      die(
        `OCOLITE_API_KEY (or config "apiKey") is required for provider "${PROVIDER}".\n` +
          `Set OCOLITE_PROVIDER=ollama to use a local Ollama model instead.`
      );
    }
    return;
  }

  if (PROVIDER === 'ollama-cloud' && !API_KEY) {
    die(
      `OCOLITE_API_KEY (or config "apiKey") is required for provider "ollama-cloud".\n` +
        `Get one from https://ollama.com/settings/keys.`
    );
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const headers = PROVIDER === 'ollama-cloud' ? { Authorization: `Bearer ${API_KEY}` } : {};
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal, headers });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    die(
      PROVIDER === 'ollama-cloud'
        ? `Cannot reach Ollama Cloud at ${HOST} (${err.message || err}). Check OCOLITE_API_KEY and your network connection.`
        : `Cannot reach Ollama at ${HOST} (${err.message || err}).\n` +
            `Is it running? Try: ollama serve\n` +
            `Or set OCOLITE_HOST if it's on a different address, or OCOLITE_PROVIDER=openai/anthropic/ollama-cloud to use a cloud provider instead.`
    );
  }
}

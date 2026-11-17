import { loadConfig } from '../config.mjs';
import { streamLines, wrapTimeoutError } from './stream.mjs';

async function callOllama(prompt, model, spinner, { endpoint, headers, body, extract }) {
  const { HOST } = await loadConfig();
  try {
    return await streamLines(
      `${HOST}${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
      {
        onLine: (line) => {
          if (!line.trim()) return '';
          try {
            return extract(JSON.parse(line));
          } catch {
            return '';
          }
        },
        onProgress: (full) => {
          if (spinner) spinner.text = `Generating with ${model}... (${full.length} chars received)`;
        },
      }
    );
  } catch (err) {
    throw await wrapTimeoutError(err, model);
  }
}

/** Local Ollama: /api/generate, NDJSON lines each a `{ response: "<token>" }` chunk. */
export function callOllamaOnce(prompt, model, spinner) {
  return callOllama(prompt, model, spinner, {
    endpoint: '/api/generate',
    headers: {},
    body: { model, prompt, stream: true, format: 'json', options: { temperature: 0.15 } },
    extract: (chunk) => (typeof chunk.response === 'string' ? chunk.response : ''),
  });
}

/**
 * Ollama Cloud (ollama.com): unlike local Ollama, /api/generate is not
 * usable here — Ollama's own cloud docs only show /api/chat against the
 * cloud host, and /api/generate returns 401 even with a valid key. Same
 * NDJSON streaming shape, but chat-style request/response:
 * `{ message: { role, content } }` instead of `{ response }`.
 */
export async function callOllamaCloudOnce(prompt, model, spinner) {
  const { API_KEY } = await loadConfig();
  return callOllama(prompt, model, spinner, {
    endpoint: '/api/chat',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      format: 'json',
      options: { temperature: 0.15 },
    },
    extract: (chunk) => (typeof chunk.message?.content === 'string' ? chunk.message.content : ''),
  });
}

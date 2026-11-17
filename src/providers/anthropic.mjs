import { loadConfig } from '../config.mjs';
import { streamLines, wrapTimeoutError } from './stream.mjs';

/** Anthropic Messages API: SSE "data: {...}" lines with content_block_delta events. */
export async function callAnthropicOnce(prompt, model, spinner) {
  const { HOST, API_KEY } = await loadConfig();
  try {
    return await streamLines(
      `${HOST}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature: 0.15,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      {
        onLine: (line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) return '';
          const data = trimmed.slice(5).trim();
          if (!data) return '';
          try {
            const event = JSON.parse(data);
            return event.type === 'content_block_delta' && typeof event.delta?.text === 'string' ? event.delta.text : '';
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

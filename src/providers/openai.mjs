import { loadConfig } from '../config.mjs';
import { streamLines, wrapTimeoutError } from './stream.mjs';

/** OpenAI (and any OpenAI-compatible endpoint via OCOLITE_HOST — Groq, Together, OpenRouter, a self-hosted vLLM/LM Studio server, etc.): SSE "data: {...}" lines. */
export async function callOpenAiOnce(prompt, model, spinner) {
  const { HOST, API_KEY } = await loadConfig();
  try {
    return await streamLines(
      `${HOST}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.15,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      {
        onLine: (line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) return '';
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') return '';
          try {
            const chunk = JSON.parse(data);
            return chunk.choices?.[0]?.delta?.content ?? '';
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

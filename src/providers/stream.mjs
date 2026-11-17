import { loadConfig } from '../config.mjs';

/**
 * Shared streaming-request plumbing: POSTs to `url`, reads the response body
 * line by line, and hands each raw line to `onLine` to extract a text delta
 * (return '' for lines with nothing to add). The inactivity timeout resets on
 * every chunk received, so a slow-but-active stream isn't killed early — only
 * a truly stalled one is.
 */
export async function streamLines(url, options, { onLine, onProgress }) {
  const { TIMEOUT_MS } = await loadConfig();
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const bumpTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  };

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let full = '';
    let buffer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bumpTimeout();

      buffer += decoder.decode(value, { stream: true });
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const delta = onLine(line);
        if (delta) {
          full += delta;
          if (onProgress) onProgress(full);
        }
      }
    }

    return full;
  } finally {
    clearTimeout(timer);
  }
}

export async function wrapTimeoutError(err, model) {
  if (err && err.name === 'AbortError') {
    const { TIMEOUT_MS } = await loadConfig();
    return new Error(`Request to "${model}" timed out after ${TIMEOUT_MS}ms of inactivity. Try a smaller diff or a faster model.`);
  }
  return err;
}

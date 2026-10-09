const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';

export function createProvider({
  baseUrl = process.env.UGEM_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.UGEM_MODEL ?? 'local-model',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    async complete(messages) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false }),
        });
      } catch (cause) {
        throw new Error(`${baseUrl} is inaccessible`, { cause });
      }

      if (!response.ok) {
        throw new Error(`${baseUrl} returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error(`${baseUrl} returned an invalid chat completion`);
      }
      return content;
    },
  };
}

export { DEFAULT_BASE_URL };

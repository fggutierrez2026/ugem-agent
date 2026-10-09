import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvider } from '../src/providers/index.js';

test('provider sends a minimal compatible completion request', async () => {
  let request;
  const provider = createProvider({
    baseUrl: 'http://model.test/',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'answer' } }] }),
      };
    },
  });

  const messages = [{ role: 'user', content: 'question' }];
  assert.equal(await provider.complete(messages), 'answer');
  assert.equal(request.url, 'http://model.test/v1/chat/completions');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'test-model',
    messages,
    stream: false,
  });
});

test('provider describes an inaccessible endpoint without leaking request data', async () => {
  const provider = createProvider({
    baseUrl: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  await assert.rejects(
    provider.complete([{ role: 'user', content: 'secret prompt' }]),
    (error) => {
      assert.match(error.message, /127\.0\.0\.1:8080 is inaccessible/);
      assert.doesNotMatch(error.message, /secret prompt/);
      return true;
    },
  );
});

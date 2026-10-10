import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createProvider, ProviderError } from '../src/providers/index.js';

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('configuration reads environment without exposing the credential', () => {
  const provider = createProvider({
    env: {
      UGEM_BASE_URL: 'http://model.test/',
      UGEM_MODEL: 'test-model',
      UGEM_REQUEST_TIMEOUT_MS: '1234',
      UGEM_API_KEY: 'top-secret',
    },
    fetchImpl: async () => assert.fail('must not make a request'),
  });

  assert.deepEqual(provider.configuration(), {
    baseUrl: 'http://model.test',
    model: 'test-model',
    timeoutMs: 1234,
    hasCredential: true,
  });
  assert.doesNotMatch(JSON.stringify(provider.configuration()), /top-secret/);
});

test('POST /v1/chat/completions parses a compatible response', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(await readBody(request)), {
      model: 'test-model',
      messages: [{ role: 'user', content: 'question' }],
      stream: false,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'answer' } }],
    }));
  }, async (baseUrl) => {
    const provider = createProvider({
      baseUrl,
      model: 'test-model',
      credential: 'test-key',
    });
    assert.equal(
      await provider.complete([{ role: 'user', content: 'question' }]),
      'answer',
    );
  });
});

test('standard HTTP error details are preserved and credentials are redacted', async () => {
  await withServer((request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      error: { message: `credential ${request.headers.authorization} denied` },
    }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, credential: 'test-key' });
    await assert.rejects(provider.complete([]), (error) => {
      assert.equal(error.code, 'http_error');
      assert.equal(error.status, 401);
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /test-key/);
      return true;
    });
  });
});

test('a dropped connection is reported as a network error', async () => {
  await withServer((request) => request.socket.destroy(), async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    await assert.rejects(
      provider.complete([]),
      (error) => error instanceof ProviderError && error.code === 'network_error',
    );
  });
});

test('a disconnect while reading the response is a network error', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"choices":');
    response.socket.destroy();
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    await assert.rejects(
      provider.complete([]),
      (error) => error instanceof ProviderError && error.code === 'network_error',
    );
  });
});

test('malformed JSON and malformed completion payloads are rejected', async (context) => {
  await context.test('malformed JSON', async () => {
    await withServer((request, response) => response.end('{bad'), async (baseUrl) => {
      const provider = createProvider({ baseUrl });
      await assert.rejects(
        provider.complete([]),
        (error) => error.code === 'invalid_response' && /malformed JSON/.test(error.message),
      );
    });
  });

  await context.test('missing message content', async () => {
    await withServer((request, response) => {
      response.end(JSON.stringify({ choices: [{}] }));
    }, async (baseUrl) => {
      const provider = createProvider({ baseUrl });
      await assert.rejects(
        provider.complete([]),
        (error) => error.code === 'invalid_response' && /chat completion/.test(error.message),
      );
    });
  });
});

test('model discovery returns provider IDs when exposed', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/v1/models');
    response.end(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'fallback' });
    assert.deepEqual(await provider.discoverModels(), {
      models: ['alpha', 'beta'],
      source: 'provider',
    });
  });
});

test('model discovery falls back for a single-model server', async () => {
  await withServer((request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'only-model' });
    assert.deepEqual(await provider.discoverModels(), {
      models: ['only-model'],
      source: 'configured',
    });
  });
});

test('provider model selection accepts only advertised IDs', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/v1/models');
    response.end(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'alpha' });

    assert.deepEqual(await provider.selectModel(' beta '), {
      model: 'beta',
      source: 'provider',
    });
    assert.equal(provider.configuration().model, 'beta');

    await assert.rejects(
      provider.selectModel('missing'),
      (error) => error.code === 'unsupported_model'
        && /not advertised/.test(error.message),
    );
    assert.equal(provider.configuration().model, 'beta');
  });
});

test('single-model fallback cannot be changed to an unverified ID', async () => {
  await withServer((request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'only-model' });

    await assert.rejects(
      provider.selectModel('other-model'),
      (error) => error.code === 'unsupported_model',
    );
    assert.equal(provider.configuration().model, 'only-model');
  });
});

test('runtime inspection reads optional llama.cpp properties truthfully', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/props?model=gemma-test&autoload=false');
    response.end(JSON.stringify({
      model_alias: 'gemma-loaded',
      is_sleeping: false,
      default_generation_settings: {
        n_ctx: 16_384,
        params: { chat_template_kwargs: { enable_thinking: true } },
      },
    }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'gemma-test' });
    assert.deepEqual(await provider.runtimeInfo(), {
      model: 'gemma-loaded',
      modelSource: 'provider',
      status: 'ready',
      contextLimit: 16_384,
      reasoning: 'on',
    });
  });
});

test('reasoning control is enabled only after a template capability probe', async () => {
  let completionBody;
  await withServer(async (request, response) => {
    if (request.url === '/props?model=thinker&autoload=false') {
      response.end(JSON.stringify({ chat_template: '{{ enable_thinking }}' }));
      return;
    }
    if (request.url === '/apply-template') {
      const body = JSON.parse(await readBody(request));
      const enabled = body.chat_template_kwargs.enable_thinking;
      response.end(JSON.stringify({ prompt: enabled ? 'think prompt' : 'plain prompt' }));
      return;
    }
    assert.equal(request.url, '/v1/chat/completions');
    completionBody = JSON.parse(await readBody(request));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"reasoning_content":"secret",'
      + '"content":null}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"final"}}]}\n\n');
    response.end('data: [DONE]\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'thinker' });

    assert.deepEqual(await provider.reasoningInfo(), {
      mode: 'auto',
      capability: 'supported',
      method: 'chat_template_kwargs',
      display: 'hidden',
    });
    assert.deepEqual(await provider.selectReasoning('off'), {
      mode: 'off',
      capability: 'supported',
      method: 'chat_template_kwargs',
      display: 'hidden',
    });
    assert.equal((await provider.reasoningInfo()).mode, 'off');

    const chunks = [];
    for await (const chunk of provider.stream([])) chunks.push(chunk);
    assert.deepEqual(chunks, ['final']);
    assert.deepEqual(completionBody.chat_template_kwargs, {
      enable_thinking: false,
    });
    assert.equal(completionBody.reasoning_format, 'deepseek');
  });
});

test('reasoning capability distinguishes unsupported from unknown control', async (context) => {
  await context.test('unsupported model template', async () => {
    await withServer(async (request, response) => {
      if (request.url.startsWith('/props?')) {
        response.end(JSON.stringify({ chat_template: 'static template' }));
        return;
      }
      const body = JSON.parse(await readBody(request));
      assert.equal(typeof body.chat_template_kwargs.enable_thinking, 'boolean');
      response.end(JSON.stringify({ prompt: 'same prompt' }));
    }, async (baseUrl) => {
      const provider = createProvider({ baseUrl });
      assert.equal((await provider.reasoningInfo()).capability, 'unsupported');
      await assert.rejects(
        provider.selectReasoning('off'),
        (error) => error.code === 'unsupported_reasoning',
      );
      assert.equal(provider.reasoningConfiguration().mode, 'auto');
    });
  });

  await context.test('unknown generic endpoint', async () => {
    await withServer((request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
    }, async (baseUrl) => {
      const provider = createProvider({ baseUrl });
      assert.equal((await provider.reasoningInfo()).capability, 'unknown');
      await assert.rejects(
        provider.selectReasoning('on'),
        (error) => error.code === 'unknown_reasoning',
      );
      assert.equal(provider.reasoningConfiguration().mode, 'auto');
    });
  });
});

test('request timeout aborts an unresponsive server', async () => {
  await withServer(() => {}, async (baseUrl) => {
    const provider = createProvider({ baseUrl, timeoutMs: 20 });
    await assert.rejects(
      provider.complete([]),
      (error) => error.code === 'timeout' && /20 ms/.test(error.message),
    );
  });
});

test('health detection and internal model updates support local lifecycle', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/health');
    response.end(JSON.stringify({ status: 'ok' }));
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'before' });
    assert.equal(await provider.health(), true);
    provider.setModel('after');
    assert.equal(provider.configuration().model, 'after');
  });
});

test('stream parses incremental chat chunks through [DONE]', async () => {
  await withServer(async (request, response) => {
    assert.deepEqual(JSON.parse(await readBody(request)), {
      model: 'stream-model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      stream_options: { include_usage: true },
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      'data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n',
    );
    response.write('data: {"choices":[{"delta":{"content":"Hola "}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"🌎"}}]}\n\n');
    response.end('data: [DONE]\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl, model: 'stream-model' });
    const chunks = [];
    for await (const chunk of provider.stream([
      { role: 'user', content: 'hello' },
    ])) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, ['Hola ', '🌎']);
  });
});

test('stream exposes reported usage, timings, and server context metadata', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    response.write('data: {"choices":[],"usage":{"prompt_tokens":3,'
      + '"completion_tokens":1},"timings":{"predicted_per_second":12},'
      + '"generation_settings":{"n_ctx":4096}}\n\n');
    response.end('data: [DONE]\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    const metadata = [];
    const chunks = [];
    for await (const chunk of provider.stream([], {
      onMetadata: (value) => metadata.push(value),
    })) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, ['ok']);
    assert.deepEqual(metadata, [{
      usage: { prompt_tokens: 3, completion_tokens: 1 },
      timings: { predicted_per_second: 12 },
      contextLimit: 4_096,
      tokensPredicted: undefined,
      tokensEvaluated: undefined,
      finishReason: undefined,
    }]);
  });
});

test('stream reserves output tokens and exposes a length finish reason', async () => {
  await withServer(async (request, response) => {
    assert.equal((JSON.parse(await readBody(request))).max_tokens, 256);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
    response.end('data: [DONE]\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    const metadata = [];
    const chunks = [];
    for await (const chunk of provider.stream([], {
      maxTokens: 256,
      onMetadata: (value) => metadata.push(value),
    })) chunks.push(chunk);

    assert.deepEqual(chunks, ['partial']);
    assert.equal(metadata.at(-1).finishReason, 'length');
  });
});

test('stream sends separate reasoning and total completion budgets', async () => {
  await withServer(async (request, response) => {
    const body = JSON.parse(await readBody(request));
    assert.equal(body.max_tokens, 8_192);
    assert.equal(body.reasoning_budget_tokens, 4_096);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: [DONE]\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    for await (const chunk of provider.stream([], {
      maxTokens: 8_192,
      reasoningBudget: 4_096,
    })) assert.fail(`Unexpected chunk: ${chunk}`);
  });
});

test('stream cancellation aborts the response', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  }, async (baseUrl) => {
    const controller = new AbortController();
    const provider = createProvider({ baseUrl });
    const iterator = provider.stream([], { signal: controller.signal });

    assert.deepEqual(await iterator.next(), { value: 'partial', done: false });
    controller.abort();
    await assert.rejects(
      iterator.next(),
      (error) => error.code === 'cancelled',
    );
  });
});

test('stream rejects EOF without the [DONE] sentinel', async () => {
  await withServer((request, response) => {
    response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  }, async (baseUrl) => {
    const provider = createProvider({ baseUrl });
    await assert.rejects(async () => {
      for await (const chunk of provider.stream([])) assert.equal(chunk, 'partial');
    }, (error) => error.code === 'invalid_response' && /\[DONE\]/.test(error.message));
  });
});

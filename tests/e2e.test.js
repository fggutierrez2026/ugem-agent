import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { main } from '../src/index.js';

function capture() {
  let value = '';
  const stream = new Writable({
    write(chunk, encoding, callback) {
      value += chunk.toString();
      callback();
    },
  });
  stream.read = () => value;
  return stream;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('v0.1 Q&A runs end to end against a compatible SSE endpoint', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ugem-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const forbiddenPath = join(directory, 'must-not-exist.txt');
  const configPath = join(directory, 'config.json');
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }));
      return;
    }
    if (request.url?.startsWith('/props?')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'unsupported' } }));
      return;
    }
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      requests.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = [
        { choices: [{ delta: { reasoning_content: 'hidden chain' } }] },
        { choices: [{ delta: { content: '# Mock answer\n\n' } }] },
        { choices: [{ delta: { content: '**bold** and $x^2$.\n\n' } }] },
        { choices: [{ delta: { content: '```js\nconsole.log("ok");\n```\n' } }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 20 },
          timings: { predicted_per_second: 40, predicted_ms: 500 },
          generation_settings: { n_ctx: 8_192 },
        },
      ];
      for (const event of events) {
        const frame = `data: ${JSON.stringify(event)}\n\n`;
        const splitAt = Math.max(1, Math.floor(frame.length / 2));
        response.write(frame.slice(0, splitAt));
        response.write(frame.slice(splitAt));
      }
      response.write('data: [DO');
      response.end('NE]\n\n');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  const output = capture();
  const error = capture();
  const question = `Create ${forbiddenPath} and explain x squared.`;

  await main({
    input: Readable.from([
      '/models\n',
      '/models beta\n',
      '/theme light forest\n',
      `${question}\n`,
      '/reasoning on\n',
      '/stats\n',
      '/clear\n',
      '/stats\n',
      '/exit\n',
    ]),
    output,
    error,
    env: {
      UGEM_AUTO_START: '0',
      UGEM_BASE_URL: `http://127.0.0.1:${port}`,
      UGEM_CONFIG_FILE: configPath,
      UGEM_MODEL: 'alpha',
      UGEM_REQUEST_TIMEOUT_MS: '5000',
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'beta');
  assert.deepEqual(requests[0].messages, [{ role: 'user', content: question }]);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].max_tokens, 4_096);
  assert.equal(Object.hasOwn(requests[0], 'tools'), false);
  assert.equal(Object.hasOwn(requests[0], 'tool_choice'), false);
  await assert.rejects(access(forbiddenPath), (cause) => cause.code === 'ENOENT');

  const rendered = output.read();
  assert.match(rendered, /Provider-advertised models/);
  assert.match(rendered, /Request model set to beta/);
  assert.match(rendered, /Theme changed to forest · mode light → light/);
  assert.match(rendered, /Mock answer/);
  assert.match(rendered, /bold and x²\./);
  assert.match(rendered, /┌─ js/);
  assert.match(rendered, /console\.log\("ok"\);/);
  assert.doesNotMatch(rendered, /hidden chain|```|\*\*bold\*\*/);
  assert.match(rendered, /20 output tok \(reported\)/);
  assert.match(rendered, /32 used · 8,160 available · 8,192 total/);
  assert.match(rendered, /Metrics: no completed answer yet/);
  assert.match(error.read(), /endpoint does not expose verifiable reasoning control/i);
});

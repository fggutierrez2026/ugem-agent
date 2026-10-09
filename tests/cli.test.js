import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createCli, HELP } from '../src/cli/app.js';

function capture() {
  let text = '';
  const stream = new Writable({
    write(chunk, encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  stream.read = () => text;
  return stream;
}

test('/help is local and does not contact the provider', async () => {
  const output = capture();
  let calls = 0;
  const cli = createCli({
    output,
    error: capture(),
    provider: { complete: async () => { calls += 1; } },
  });

  assert.equal(await cli.handleLine('/help'), true);
  assert.equal(output.read(), HELP);
  assert.equal(calls, 0);
});

test('/exit requests a clean exit', async () => {
  const cli = createCli({ output: capture(), error: capture() });
  assert.equal(await cli.handleLine('/exit'), false);
});

test('commands are case-insensitive where unambiguous', async () => {
  const output = capture();
  const cli = createCli({ output, error: capture() });
  assert.equal(await cli.handleLine('/HELP'), true);
  assert.equal(output.read(), HELP);
});

test('an inaccessible endpoint produces a clear error and rolls back the turn', async () => {
  const error = capture();
  const seen = [];
  const session = {
    addUserMessage: (content) => seen.push(content),
    addAssistantMessage: () => assert.fail('must not store a failed answer'),
    removeLastUserMessage: () => seen.pop(),
    messages: () => [{ role: 'user', content: seen.at(-1) }],
  };
  const cli = createCli({
    output: capture(),
    error,
    session,
    provider: { complete: async () => { throw new Error('connection refused'); } },
  });

  assert.equal(await cli.handleLine('hello'), true);
  assert.match(error.read(), /Model request failed: connection refused/);
  assert.deepEqual(seen, []);
});

test('a successful answer is rendered and stored', async () => {
  const output = capture();
  const cli = createCli({
    output,
    error: capture(),
    provider: { complete: async () => 'Hello back' },
  });

  assert.equal(await cli.handleLine('hello'), true);
  assert.equal(output.read(), 'Hello back\n');
});

test('interrupt is safe to call more than once', () => {
  const output = capture();
  const cli = createCli({ output, error: capture() });
  cli.interrupt();
  cli.interrupt();
  assert.equal(output.read(), '\n');
});

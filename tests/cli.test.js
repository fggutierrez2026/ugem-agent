import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createCli, HELP } from '../src/cli/app.js';
import { createSession } from '../src/session/index.js';

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

function streamingProvider(responses, calls = []) {
  return {
    async *stream(messages) {
      calls.push(messages);
      for (const chunk of responses.shift()) yield chunk;
    },
  };
}

test('/help is local and does not contact the provider', async () => {
  const output = capture();
  let calls = 0;
  const cli = createCli({
    output,
    error: capture(),
    provider: { stream: async function* () { calls += 1; } },
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

test('a provider failure produces a clear error and rolls back the turn', async () => {
  const error = capture();
  const session = createSession();
  const provider = {
    async *stream() {
      throw new Error('connection refused');
    },
  };
  const cli = createCli({ output: capture(), error, session, provider });

  assert.equal(await cli.handleLine('hello'), true);
  assert.match(error.read(), /Model request failed: connection refused/);
  assert.deepEqual(session.messages(), []);
});

test('streamed chunks render immediately and follow-ups receive history', async () => {
  const output = capture();
  const calls = [];
  const cli = createCli({
    output,
    error: capture(),
    provider: streamingProvider([['Hello', ' back'], ['Second']], calls),
  });

  await cli.handleLine('first');
  assert.equal(output.read(), 'Hello back\n');
  await cli.handleLine('follow-up');
  assert.deepEqual(calls[1], [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'Hello back' },
    { role: 'user', content: 'follow-up' },
  ]);
});

test('rendering does not alter the raw assistant message kept in history', async () => {
  const output = capture();
  const calls = [];
  const cli = createCli({
    output,
    error: capture(),
    provider: streamingProvider([['**bold**'], ['done']], calls),
  });

  await cli.handleLine('first');
  await cli.handleLine('follow-up');
  assert.match(output.read(), /^bold\n/);
  assert.equal(calls[1][1].content, '**bold**');
});

test('/Q&A enters the mode and /Q&A <question> asks once', async () => {
  const output = capture();
  const calls = [];
  const cli = createCli({
    output,
    error: capture(),
    provider: streamingProvider([['answer']], calls),
  });

  await cli.handleLine('/q&A');
  await cli.handleLine('/Q&A explicit question');
  assert.equal(output.read(), 'Q&A mode active.\nanswer\n');
  assert.equal(calls[0].at(-1).content, 'explicit question');
});

test('/clear removes history but retains the active Q&A mode', async () => {
  const output = capture();
  const calls = [];
  const cli = createCli({
    output,
    error: capture(),
    provider: streamingProvider([['one'], ['two']], calls),
  });

  await cli.handleLine('first');
  await cli.handleLine('/clear');
  await cli.handleLine('second');
  assert.match(output.read(), /Conversation cleared/);
  assert.deepEqual(calls[1], [{ role: 'user', content: 'second' }]);
});

test('Q&A sends only conversation messages, without repository context', async () => {
  const calls = [];
  const cli = createCli({
    output: capture(),
    error: capture(),
    provider: streamingProvider([['answer']], calls),
  });

  await cli.handleLine('What is 2 + 2?');
  assert.deepEqual(calls[0], [
    { role: 'user', content: 'What is 2 + 2?' },
  ]);
});

test('Ctrl+C cancels an active stream without retaining a partial turn', async () => {
  const output = capture();
  const error = capture();
  const session = createSession();
  const provider = {
    async *stream(messages, { signal }) {
      yield 'partial';
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const cause = new Error('cancelled');
          cause.code = 'cancelled';
          reject(cause);
        }, { once: true });
      });
    },
  };
  const cli = createCli({ output, error, session, provider });

  const pending = cli.handleLine('question');
  await new Promise((resolve) => setImmediate(resolve));
  cli.interrupt();
  await pending;

  assert.equal(output.read(), 'partial\n');
  assert.match(error.read(), /Model request cancelled/);
  assert.deepEqual(session.messages(), []);
});

test('idle interrupt is safe to call more than once', () => {
  const output = capture();
  const cli = createCli({ output, error: capture() });
  cli.interrupt();
  cli.interrupt();
  assert.equal(output.read(), '\n');
});

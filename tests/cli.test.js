import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createCli, HELP } from '../src/cli/app.js';
import { createSession } from '../src/session/index.js';
import { createMetrics } from '../src/metrics/index.js';

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

function clock(...values) {
  let index = 0;
  return () => values[index++];
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
  assert.match(
    output.read(),
    /┌─ status [^\n]*\n│ Q&A mode active\.[\s\S]+answer\n/,
  );
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

test('/stats shows the latest metrics and toggles the optional footer', async () => {
  const output = capture();
  const error = capture();
  const metrics = createMetrics({ now: clock(0, 100, 1_100, 2_000, 2_100, 3_100) });
  const provider = {
    async *stream(messages, { onMetadata }) {
      onMetadata({ usage: { prompt_tokens: 2, completion_tokens: 1 } });
      yield 'done';
    },
  };
  const cli = createCli({ output, error, metrics, provider });

  await cli.handleLine('first');
  await cli.handleLine('/stats');
  await cli.handleLine('/stats on');
  await cli.handleLine('second');
  await cli.handleLine('/stats maybe');

  assert.match(output.read(), /Input tokens: 2 \(reported\)/);
  assert.match(output.read(), /Per-answer metrics footer on\./);
  assert.match(output.read(), /done\n\n┌─ stats/);
  assert.match(
    output.read(),
    /response\s+1 output tok \(reported\)[\s\S]*context\s+\[░+\] limit N\/A[\s\S]*3 used · available N\/A \(estimated\)/,
  );
  assert.equal(error.read(), 'Usage: /stats [on|off]\n');
});

test('/code-color changes the fenced-code color locally', async () => {
  const output = capture();
  let selected = 'green';
  const renderer = {
    configuration: () => ({ codeColor: selected }),
    setCodeColor(value) {
      selected = value;
    },
  };
  const cli = createCli({ output, error: capture(), renderer });

  await cli.handleLine('/code-color yellow');

  assert.equal(selected, 'yellow');
  assert.match(output.read(), /Code color changed to yellow\./);
});

test('/theme selects another UI color combination', async () => {
  const output = capture();
  output.isTTY = true;
  const cli = createCli({ output, error: capture(), color: true });

  await cli.handleLine('/theme forest');
  cli.writePrompt();

  assert.match(output.read(), /Theme changed to forest\./);
  assert.match(output.read(), /\u001b\[32myou › /);
});

test('context use at 90 percent emits one warning even when the footer is off', async () => {
  const output = capture();
  const metrics = createMetrics({
    now: clock(0, 100, 1_100, 2_000, 2_100, 3_100),
    serverLimit: 10,
  });
  const provider = {
    async *stream(messages, { onMetadata }) {
      onMetadata({ usage: { prompt_tokens: 9, completion_tokens: 1 } });
      yield 'done';
    },
  };
  const cli = createCli({ output, error: capture(), metrics, provider });

  await cli.handleLine('first');
  await cli.handleLine('second');

  assert.equal(output.read().match(/context warning/g)?.length, 1);
  assert.match(output.read(), /100\.0% used · 0 tokens available/);
});

test('/models lists presets and clears history after a successful switch', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  let active = 'gemma4-e4b';
  let reasoning = 'auto';
  const localServer = {
    listModels: async () => [
      { id: 'gemma4-e4b', reasoning: 'auto', contextLimit: 32_768 },
      { id: 'qwen3.5-4b', reasoning: 'off', contextLimit: 65_536 },
    ],
    configuration: () => ({ preset: active, reasoning }),
    async selectModel(model, options) {
      active = model;
      reasoning = options.reasoning ?? 'off';
      return { model, status: 'started', reasoning, contextLimit: 65_536 };
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    localServer,
    provider: streamingProvider([]),
  });

  await cli.handleLine('/models');
  await cli.handleLine('/models qwen3.5-4b off');

  assert.match(output.read(), /\* gemma4-e4b · 32,768 ctx · reasoning auto/);
  assert.match(output.read(), /qwen3\.5-4b · 65,536 ctx · reasoning off/);
  assert.match(output.read(), /Model changed to qwen3\.5-4b · reasoning off/);
  assert.deepEqual(session.messages(), []);
});

test('/reasoning restarts the managed model and clears history on change', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  let reasoning = 'auto';
  const localServer = {
    configuration: () => ({ preset: 'qwen3.5-4b', reasoning }),
    async selectReasoning(mode, { onStatus }) {
      onStatus('Restarting local model...');
      reasoning = mode;
      return {
        model: 'qwen3.5-4b',
        status: 'started',
        reasoning,
        contextLimit: 65_536,
      };
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    localServer,
    provider: streamingProvider([]),
  });

  await cli.handleLine('/reasoning off');

  assert.match(output.read(), /Reasoning changed to off\. Conversation cleared\./);
  assert.deepEqual(session.messages(), []);
});

test('startup panel reports runtime status and context without inventing reasoning', async () => {
  const output = capture();
  output.isTTY = true;
  output.columns = 64;
  const provider = {
    configuration: () => ({ model: 'configured-model' }),
    runtimeInfo: async () => ({
      model: 'gemma-test',
      modelSource: 'provider',
      status: 'ready',
      contextLimit: 8_192,
      reasoning: 'unknown',
    }),
    stream: async function* () {},
  };
  const cli = createCli({ output, error: capture(), provider, color: false });

  await cli.writeStartup();

  assert.match(output.read(), /μgem agent  \/  Q&A/);
  assert.match(output.read(), /gemma-test \(provider, ready\)/);
  assert.match(output.read(), /reasoning\s+unknown/);
  assert.match(output.read(), /0 used · 8,192 available · 8,192 total/);
  assert.match(output.read(), /\[░░░░░░░░░░░░░░░░░░░░░░░░\] 0\.0%/);
});

test('TTY labels distinguish user and assistant with color-safe accents', async () => {
  const output = capture();
  output.isTTY = true;
  const cli = createCli({
    output,
    error: capture(),
    color: true,
    provider: streamingProvider([['answer']]),
  });

  cli.writePrompt();
  await cli.handleLine('question');

  assert.match(output.read(), /\u001b\[34myou › \u001b\[0m/);
  assert.match(output.read(), /\u001b\[32mμgem ›\u001b\[0m\nanswer/);
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

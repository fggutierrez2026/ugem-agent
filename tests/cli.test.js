import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createCli, HELP, terminalSupportsColor } from '../src/cli/app.js';
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
  const cli = createCli({
    output,
    error: capture(),
    color: true,
    env: { TERM: 'xterm' },
  });

  await cli.handleLine('/theme light forest');
  cli.writePrompt();

  assert.match(output.read(), /Theme changed to forest · mode light → light\./);
  assert.match(output.read(), /\u001b\[32myou › /);
});

test('terminal color support respects capability and no-color signals', () => {
  assert.equal(terminalSupportsColor({ isTTY: false }, {}), false);
  assert.equal(terminalSupportsColor({ isTTY: true }, { TERM: 'dumb' }), false);
  assert.equal(terminalSupportsColor({ isTTY: true }, { NO_COLOR: '' }), false);
  assert.equal(
    terminalSupportsColor({ isTTY: true, hasColors: () => false }, {}),
    false,
  );
  assert.equal(
    terminalSupportsColor({ isTTY: true, hasColors: () => true }, { WT_SESSION: '1' }),
    true,
  );
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

test('/models lists managed presets and clears history when requested', async () => {
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
  await cli.handleLine('/models qwen3.5-4b off clear');

  assert.match(output.read(), /\* gemma4-e4b · 32,768 ctx · reasoning auto/);
  assert.match(output.read(), /qwen3\.5-4b · 65,536 ctx · reasoning off/);
  assert.match(output.read(), /Model changed to qwen3\.5-4b · reasoning off/);
  assert.match(output.read(), /Conversation cleared/);
  assert.deepEqual(session.messages(), []);
});

test('/models requires a clear or keep decision when history exists', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  let selections = 0;
  const localServer = {
    listModels: async () => [],
    configuration: () => ({ preset: 'alpha', reasoning: 'auto' }),
    async selectModel() {
      selections += 1;
      return { model: 'beta', reasoning: 'auto', contextLimit: 4_096 };
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    localServer,
    provider: streamingProvider([]),
  });

  await cli.handleLine('/models beta');

  assert.match(output.read(), /Conversation has 1 messages/);
  assert.match(output.read(), /\/models beta clear/);
  assert.match(output.read(), /\/models beta keep/);
  assert.equal(selections, 0);
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'old context' }]);
});

test('/models can keep history across a managed model switch', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  const localServer = {
    configuration: () => ({ preset: 'alpha', reasoning: 'auto' }),
    async selectModel(model) {
      return { model, reasoning: 'auto', contextLimit: 4_096 };
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    localServer,
    provider: streamingProvider([]),
  });

  await cli.handleLine('/models beta keep');

  assert.match(output.read(), /Conversation history kept/);
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'old context' }]);
});

test('/models lists and selects provider-advertised models', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  let active = 'alpha';
  const provider = {
    discoverModels: async () => ({
      models: ['alpha', 'beta'],
      source: 'provider',
    }),
    configuration: () => ({ model: active }),
    async selectModel(model) {
      if (!['alpha', 'beta'].includes(model)) throw new Error('not advertised');
      active = model;
      return { model, source: 'provider' };
    },
    stream: async function* () {},
  };
  const localServer = {
    managesModels: () => false,
    configuration: () => ({ status: 'existing' }),
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    provider,
    localServer,
  });

  await cli.handleLine('/models');
  await cli.handleLine('/models beta keep');

  assert.match(output.read(), /Provider-advertised models/);
  assert.match(output.read(), /\* alpha/);
  assert.match(output.read(), /Request model set to beta \(provider\)/);
  assert.match(output.read(), /Conversation history kept/);
  assert.equal(active, 'beta');
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'old context' }]);
});

test('/models explains external single-model endpoint configuration', async () => {
  const output = capture();
  const provider = {
    discoverModels: async () => ({
      models: ['fixed-model'],
      source: 'configured',
    }),
    configuration: () => ({ model: 'fixed-model' }),
    stream: async function* () {},
  };
  const cli = createCli({
    output,
    error: capture(),
    provider,
    localServer: { managesModels: () => false },
  });

  await cli.handleLine('/models');

  assert.match(output.read(), /Configured single-model endpoint/);
  assert.match(output.read(), /UGEM_BASE_URL and UGEM_MODEL/);
});

test('/models reports rejected provider switches without changing history', async () => {
  const error = capture();
  const session = createSession();
  session.addUserMessage('old context');
  const provider = {
    configuration: () => ({ model: 'alpha' }),
    async selectModel() {
      const cause = new Error('Model "missing" was not advertised by the endpoint');
      cause.code = 'unsupported_model';
      throw cause;
    },
    stream: async function* () {},
  };
  const cli = createCli({
    output: capture(),
    error,
    session,
    provider,
    localServer: { managesModels: () => false },
  });

  await cli.handleLine('/models missing keep');

  assert.match(error.read(), /Could not change model:.*not advertised/);
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'old context' }]);
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

  assert.match(output.read(), /\u001b\[94myou › \u001b\[0m/);
  assert.match(output.read(), /\u001b\[92mμgem ›\u001b\[0m\nanswer/);
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

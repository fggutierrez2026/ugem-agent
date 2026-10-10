import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
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
    metrics: createMetrics({ footer: false }),
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

test('/clear also removes metrics from the previous conversation', async () => {
  const output = capture();
  const metrics = createMetrics({ now: clock(0, 100, 1_100) });
  const cli = createCli({
    output,
    error: capture(),
    metrics,
    provider: streamingProvider([['answer']]),
  });

  await cli.handleLine('first');
  await cli.handleLine('/clear');
  await cli.handleLine('/stats');

  assert.equal(metrics.latest(), null);
  assert.equal(metrics.contextStatus().used, 0);
  assert.match(output.read(), /Metrics: no completed answer yet/);
});

test('/settings shows the compact menu and shortcuts persist explicit choices', async () => {
  const output = capture();
  const updates = [];
  let codeColor = 'green';
  const settings = {
    configuration: () => ({ path: '/home/test/.config/ugem/config.json' }),
    async update(values) {
      updates.push(values);
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    settings,
    provider: {
      configuration: () => ({ model: 'test-model' }),
      reasoningConfiguration: () => ({ mode: 'auto' }),
      stream: async function* () {},
    },
    localServer: { managesModels: () => false },
    renderer: {
      configuration: () => ({ codeColor }),
      setCodeColor(value) {
        codeColor = value;
      },
    },
  });

  await cli.handleLine('/settings');
  await cli.handleLine('/theme light forest');
  await cli.handleLine('/code-color yellow');
  await cli.handleLine('/stats off');
  await cli.handleLine('/context auto');

  assert.match(output.read(), /Appearance: classic · auto → dark/);
  assert.match(output.read(), /Model: test-model \(provider request\)/);
  assert.match(output.read(), /Streaming: on \(SSE\)/);
  assert.match(output.read(), /Preferences file: \/home\/test\/\.config\/ugem/);
  assert.deepEqual(updates, [
    { theme: 'forest', themeMode: 'light' },
    { codeColor: 'yellow' },
    { stats: false },
    { contextBudget: null },
  ]);
});

test('a persistence failure keeps the session change and reports it', async () => {
  const error = capture();
  const metrics = createMetrics();
  const cli = createCli({
    output: capture(),
    error,
    metrics,
    settings: {
      async update() {
        throw new Error('read-only config');
      },
    },
  });

  await cli.handleLine('/stats off');

  assert.equal(metrics.footerEnabled(), false);
  assert.match(error.read(), /changed for this session.*read-only config/);
});

test('startup reports settings recovery notices without blocking Q&A', async () => {
  const output = capture();
  let stopped = false;
  const cli = createCli({
    input: Readable.from(['/exit\n']),
    output,
    error: capture(),
    settings: {
      configuration: () => ({
        notices: ['Invalid settings file; defaults are active.'],
      }),
    },
    localServer: {
      ensureRunning: async () => ({ status: 'unmanaged', contextLimit: null }),
      async stop() {
        stopped = true;
      },
    },
  });

  await cli.run();

  assert.match(output.read(), /settings warning/);
  assert.match(output.read(), /Invalid settings file; defaults are active/);
  assert.equal(stopped, true);
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

test('/context shows limits and sets only a validated session budget', async () => {
  const output = capture();
  const error = capture();
  const metrics = createMetrics({ serverLimit: 8_192 });
  const cli = createCli({ output, error, metrics });

  await cli.handleLine('/context');
  await cli.handleLine('/context 4096');
  await cli.handleLine('/context 16384');

  assert.match(output.read(), /Confirmed server limit: 8,192 tokens/);
  assert.match(output.read(), /Reserved final output: 2,048 tokens/);
  assert.match(output.read(), /Reasoning budget: none/);
  assert.match(output.read(), /Session context budget set to 4,096 tokens/);
  assert.match(output.read(), /does not change llama-server --ctx-size/);
  assert.equal(metrics.contextStatus().budget, 4_096);
  assert.match(error.read(), /exceeds the confirmed server limit 8,192/);
});

test('/context includes the managed reasoning level in the completion reserve', async () => {
  const output = capture();
  const cli = createCli({
    output,
    error: capture(),
    metrics: createMetrics({ serverLimit: 32_768 }),
    localServer: {
      managesModels: () => true,
      configuration: () => ({
        preset: 'qwen3.5-4b',
        reasoning: 'on',
        reasoningBudget: 4_096,
        reasoningLevel: 'high',
      }),
    },
  });

  await cli.handleLine('/context');

  assert.match(output.read(), /Reasoning budget: 4,096 tokens \(high\/on\)/);
  assert.match(output.read(), /Total completion reserve: 8,192 tokens/);
  assert.match(output.read(), /Estimated input room after reserve: 24,576 tokens/);
});

test('/context refuses an unvalidated budget when the server limit is unknown', async () => {
  const error = capture();
  const cli = createCli({
    output: capture(),
    error,
    metrics: createMetrics(),
    provider: {},
  });

  await cli.handleLine('/context 4096');

  assert.match(error.read(), /server context limit is unknown/);
});

test('estimated context overflow is explicit and does not contact the provider', async () => {
  const output = capture();
  const session = createSession();
  let calls = 0;
  const cli = createCli({
    output,
    error: capture(),
    session,
    metrics: createMetrics({ serverLimit: 8, outputReserve: 4 }),
    provider: { stream: async function* () { calls += 1; } },
  });

  await cli.handleLine('x'.repeat(28));

  assert.equal(calls, 0);
  assert.deepEqual(session.messages(), []);
  assert.match(output.read(), /context overflow/);
  assert.match(output.read(), /Request not sent/);
  assert.match(output.read(), /Use \/clear/);
});

test('answers receive an output reserve and provider truncation is explicit', async () => {
  const output = capture();
  let receivedMaxTokens;
  const provider = {
    async *stream(messages, { maxTokens, onMetadata }) {
      receivedMaxTokens = maxTokens;
      yield 'partial';
      onMetadata({ finishReason: 'length' });
    },
  };
  const cli = createCli({
    output,
    error: capture(),
    provider,
    metrics: createMetrics({ serverLimit: 32_768, footer: false }),
  });

  await cli.handleLine('question');

  assert.equal(receivedMaxTokens, 4_096);
  assert.match(output.read(), /output limit/);
  assert.match(output.read(), /incomplete; this was reported by the provider/);
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
    managesModels: () => true,
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

  assert.match(
    output.read(),
    /Reasoning changed to off\. Conversation cleared\./,
  );
  assert.match(output.read(), /Reasoning content[\s\S]*remains hidden/);
  assert.deepEqual(session.messages(), []);
});

test('/reasoning selects low, medium, and high token budgets', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('retained');
  let reasoning = 'on';
  let reasoningBudget = 4_096;
  let reasoningLevel = 'high';
  const selections = [];
  const localServer = {
    managesModels: () => true,
    configuration: () => ({
      preset: 'qwen3.5-4b',
      reasoning,
      reasoningBudget,
      reasoningLevel,
    }),
    async selectReasoning(mode, options) {
      reasoning = mode;
      reasoningBudget = options.reasoningBudget;
      reasoningLevel = reasoningBudget === 1_024 ? 'low'
        : reasoningBudget === 2_048 ? 'medium' : 'high';
      selections.push({ mode, reasoningBudget });
      return {
        model: 'qwen3.5-4b',
        status: 'existing',
        reasoning,
        reasoningBudget,
        reasoningLevel,
        contextLimit: 32_768,
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

  await cli.handleLine('/reasoning low');
  await cli.handleLine('/reasoning medium');
  await cli.handleLine('/reasoning high');

  assert.deepEqual(selections, [
    { mode: 'on', reasoningBudget: 1_024 },
    { mode: 'on', reasoningBudget: 2_048 },
    { mode: 'on', reasoningBudget: 4_096 },
  ]);
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'retained' }]);
  assert.match(output.read(), /Reasoning level changed to low \(1,024 tokens\)/);
  assert.match(output.read(), /Reasoning level changed to medium \(2,048 tokens\)/);
  assert.match(output.read(), /Reasoning level changed to high \(4,096 tokens\)/);
});

test('managed reasoning has separate reasoning/final limits and reported peak use', async () => {
  const output = capture();
  let requestOptions;
  const provider = {
    async *stream(messages, options) {
      requestOptions = options;
      options.onMetadata({
        usage: { prompt_tokens: 100, completion_tokens: 3_000 },
      });
      yield 'done';
    },
  };
  const localServer = {
    managesModels: () => true,
    configuration: () => ({
      preset: 'qwen3.5-4b',
      reasoning: 'on',
      reasoningBudget: 2_048,
      reasoningLevel: 'medium',
    }),
  };
  const cli = createCli({
    output,
    error: capture(),
    provider,
    localServer,
    metrics: createMetrics({ serverLimit: 32_768 }),
  });

  await cli.handleLine('question');

  assert.equal(requestOptions.reasoningBudget, 2_048);
  assert.equal(requestOptions.maxTokens, 6_144);
  assert.match(output.read(), /peak\s+\[███/);
  assert.match(output.read(), /3,100 used/);
  assert.match(output.read(), /2,048 reasoning \+ 4,096 final tok/);
});

test('/reasoning reports generation and display as separate settings', async () => {
  const output = capture();
  const cli = createCli({
    output,
    error: capture(),
    provider: {
      reasoningInfo: async () => ({
        mode: 'auto',
        capability: 'unsupported',
        method: null,
        display: 'hidden',
      }),
      stream: async function* () {},
    },
    localServer: { managesModels: () => false },
  });

  await cli.handleLine('/reasoning');

  assert.match(output.read(), /Generation request: auto/);
  assert.match(output.read(), /unsupported by the active model template/);
  assert.match(output.read(), /display policy does not disable/);
  assert.match(output.read(), /generation\./);
});

test('/reasoning uses verified external control and clears history', async () => {
  const output = capture();
  const session = createSession();
  session.addUserMessage('old context');
  let mode = 'auto';
  const provider = {
    reasoningConfiguration: () => ({ mode }),
    async selectReasoning(requested) {
      mode = requested;
      return {
        mode,
        capability: 'supported',
        method: 'chat_template_kwargs',
        display: 'hidden',
      };
    },
    stream: async function* () {},
  };
  const cli = createCli({
    output,
    error: capture(),
    session,
    provider,
    localServer: { managesModels: () => false },
  });

  await cli.handleLine('/reasoning off');

  assert.equal(mode, 'off');
  assert.deepEqual(session.messages(), []);
  assert.match(output.read(), /generation request changed to off/i);
  assert.match(output.read(), /Reasoning content remains hidden/);
});

test('/reasoning preserves history when external capability is unknown', async () => {
  const error = capture();
  const session = createSession();
  session.addUserMessage('old context');
  const provider = {
    reasoningConfiguration: () => ({ mode: 'auto' }),
    async selectReasoning() {
      const cause = new Error('endpoint exposes no verifiable reasoning control');
      cause.code = 'unknown_reasoning';
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

  await cli.handleLine('/reasoning off');

  assert.match(error.read(), /no verifiable reasoning control/);
  assert.match(error.read(), /Current request remains auto/);
  assert.deepEqual(session.messages(), [{ role: 'user', content: 'old context' }]);
});

test('/reasoning token levels fail honestly for an external endpoint', async () => {
  const error = capture();
  let selections = 0;
  const cli = createCli({
    output: capture(),
    error,
    provider: {
      async selectReasoning() {
        selections += 1;
      },
      stream: async function* () {},
    },
    localServer: { managesModels: () => false },
  });

  await cli.handleLine('/reasoning medium');

  assert.equal(selections, 0);
  assert.match(error.read(), /levels require the μgem-managed llama\.cpp server/);
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

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createLocalServer } from '../src/providers/local-server.js';

const PRESETS = `[defaults]
reasoning=auto

[gemma4-e4b]
model=gemma.gguf
ctx_size=32768

[qwen3.5-4b]
model=qwen.gguf
reasoning=off
ctx_size=65536
`;

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('exit', 0);
    });
    return true;
  }
}

test('local server starts a preset, waits for health, and stops only its child', async () => {
  const health = [false, true];
  const models = [];
  const calls = [];
  const child = new FakeChild();
  const provider = {
    health: async () => health.shift() ?? true,
    configuration: () => ({ baseUrl: 'http://127.0.0.1:8081' }),
    setModel: (model) => models.push(model),
  };
  const server = createLocalServer({
    provider,
    env: { PATH: '/usr/bin', UGEM_API_KEY: 'secret' },
    launcher: '/apps/llama-server.bash',
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
    wait: async () => {},
  });

  assert.deepEqual(await server.ensureRunning(), {
    started: true,
    status: 'started',
    model: 'gemma4-e4b',
    reasoning: 'auto',
    reasoningBudget: 4_096,
    reasoningLevel: 'high',
    contextLimit: 32_768,
  });
  assert.equal(server.managesModels(), true);
  assert.equal(calls[0].command, '/apps/llama-server.bash');
  assert.deepEqual(calls[0].args, [
    'gemma4-e4b',
    '--host', '127.0.0.1',
    '--port', '8081',
    '--reasoning', 'auto',
    '--reasoning-budget', '4096',
    '--no-webui',
  ]);
  assert.equal(calls[0].options.env.UGEM_API_KEY, undefined);
  assert.deepEqual(models, ['gemma4-e4b']);

  await server.stop();
  assert.equal(server.managesModels(), false);
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('model presets are listed without starting a process', async () => {
  const server = createLocalServer({
    provider: {},
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
  });

  assert.deepEqual(await server.listModels(), [
    { id: 'gemma4-e4b', reasoning: 'auto', contextLimit: 32_768 },
    { id: 'qwen3.5-4b', reasoning: 'off', contextLimit: 65_536 },
  ]);
});

test('model selection refuses to replace an external healthy server', async () => {
  const server = createLocalServer({
    provider: {
      health: async () => true,
      configuration: () => ({ baseUrl: 'http://127.0.0.1:8081' }),
    },
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
  });

  await assert.rejects(
    server.selectModel('qwen3.5-4b'),
    /external; μgem will not stop or replace it/,
  );
});

test('model selection replaces an owned server and updates the provider', async () => {
  const health = [false, true, false, true];
  const children = [new FakeChild(), new FakeChild()];
  const models = [];
  let spawnIndex = 0;
  const provider = {
    health: async () => health.shift() ?? true,
    configuration: () => ({ baseUrl: 'http://127.0.0.1:8081' }),
    setModel: (model) => models.push(model),
  };
  const server = createLocalServer({
    provider,
    env: { PATH: '/usr/bin' },
    launcher: '/apps/llama-server.bash',
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
    spawnImpl: () => children[spawnIndex++],
    wait: async () => {},
  });

  await server.ensureRunning();
  assert.deepEqual(await server.selectModel('qwen3.5-4b'), {
    started: true,
    status: 'started',
    model: 'qwen3.5-4b',
    reasoning: 'off',
    reasoningBudget: 4_096,
    reasoningLevel: 'high',
    contextLimit: 65_536,
  });
  assert.deepEqual(children[0].signals, ['SIGTERM']);
  assert.deepEqual(models, ['gemma4-e4b', 'qwen3.5-4b', 'qwen3.5-4b']);

  await server.stop();
  assert.deepEqual(children[1].signals, ['SIGTERM']);
});

test('reasoning selection restarts the owned server with the new mode', async () => {
  const health = [false, true, false, true];
  const children = [new FakeChild(), new FakeChild()];
  const calls = [];
  let spawnIndex = 0;
  const provider = {
    health: async () => health.shift() ?? true,
    configuration: () => ({ baseUrl: 'http://127.0.0.1:8081' }),
    setModel: () => {},
  };
  const server = createLocalServer({
    provider,
    env: { PATH: '/usr/bin' },
    launcher: '/apps/llama-server.bash',
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
    spawnImpl(command, args) {
      calls.push({ command, args });
      return children[spawnIndex++];
    },
    wait: async () => {},
  });

  await server.ensureRunning();
  assert.deepEqual(await server.selectReasoning('off'), {
    started: true,
    status: 'started',
    model: 'gemma4-e4b',
    reasoning: 'off',
    reasoningBudget: 4_096,
    reasoningLevel: 'high',
    contextLimit: 32_768,
  });
  assert.deepEqual(children[0].signals, ['SIGTERM']);
  assert.deepEqual(calls[1].args.slice(-5), [
    '--reasoning', 'off', '--reasoning-budget', '4096', '--no-webui',
  ]);

  await server.stop();
});

test('reasoning budget levels change per request without restarting the model', async () => {
  const health = [false, true, true];
  const child = new FakeChild();
  let spawns = 0;
  const server = createLocalServer({
    provider: {
      health: async () => health.shift() ?? true,
      configuration: () => ({ baseUrl: 'http://127.0.0.1:8081' }),
      setModel: () => {},
    },
    env: { PATH: '/usr/bin', UGEM_REASONING: 'on' },
    launcher: '/apps/llama-server.bash',
    presetsFile: '/apps/presets.ini',
    exists: () => true,
    readFileImpl: async () => PRESETS,
    spawnImpl() {
      spawns += 1;
      return child;
    },
    wait: async () => {},
  });

  await server.ensureRunning();
  const selected = await server.selectReasoning('on', {
    reasoningBudget: 2_048,
  });

  assert.equal(spawns, 1);
  assert.equal(selected.reasoningLevel, 'medium');
  assert.equal(selected.reasoningBudget, 2_048);
  assert.equal(server.configuration().reasoningLevel, 'medium');
  await server.stop();
});

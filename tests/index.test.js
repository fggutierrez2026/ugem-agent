import assert from 'node:assert/strict';
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

test('main loads saved preferences before constructing the CLI runtime', async () => {
  const output = capture();
  let loaded = false;
  const settings = {
    async load() {
      loaded = true;
    },
    environment(env) {
      assert.equal(loaded, true);
      return {
        ...env,
        UGEM_THEME: 'forest',
        UGEM_THEME_MODE: 'light',
        UGEM_CODE_COLOR: 'yellow',
      };
    },
    get(key) {
      return key === 'stats' ? false : null;
    },
    configuration() {
      return {
        path: '/saved/config.json',
        notices: [],
      };
    },
    async update() {},
  };
  const localServer = {
    ensureRunning: async () => ({ status: 'unmanaged', contextLimit: null }),
    managesModels: () => false,
    async stop() {},
  };

  await main({
    input: Readable.from(['/settings\n', '/exit\n']),
    output,
    error: capture(),
    env: {},
    settings,
    provider: {
      configuration: () => ({ model: 'saved-model' }),
      reasoningConfiguration: () => ({ mode: 'auto' }),
      stream: async function* () {},
    },
    localServer,
  });

  assert.match(output.read(), /Appearance: forest · light → light/);
  assert.match(output.read(), /Code color: yellow/);
  assert.match(output.read(), /Metrics footer: off/);
  assert.match(output.read(), /Preferences file: \/saved\/config\.json/);
});

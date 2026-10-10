import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createSettings,
  SETTINGS_DEFAULTS,
  settingsPath,
} from '../src/settings/index.js';

async function temporaryConfig(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ugem-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'nested', 'config.json');
}

test('settings path follows Linux, Windows, and explicit override conventions', () => {
  assert.equal(
    settingsPath({ env: {}, platform: 'linux', home: '/home/test' }),
    '/home/test/.config/ugem/config.json',
  );
  assert.equal(
    settingsPath({
      env: { XDG_CONFIG_HOME: '/configuration' },
      platform: 'linux',
      home: '/home/test',
    }),
    '/configuration/ugem/config.json',
  );
  assert.equal(
    settingsPath({
      env: { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' },
      platform: 'win32',
      home: 'C:\\Users\\Test',
    }),
    'C:\\Users\\Test\\AppData\\Roaming\\ugem\\config.json',
  );
  assert.equal(
    settingsPath({ env: { UGEM_CONFIG_FILE: '/chosen/settings.json' } }),
    '/chosen/settings.json',
  );
});

test('missing settings use defaults and only explicit choices are persisted', async (t) => {
  const path = await temporaryConfig(t);
  const settings = createSettings({ path, now: () => 1, processId: 2 });

  await settings.load();
  assert.deepEqual(settings.configuration().preferences, SETTINGS_DEFAULTS);
  assert.deepEqual(settings.configuration().explicit, {});

  await settings.update({ theme: 'forest', stats: false });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(stored, {
    version: 1,
    preferences: { theme: 'forest', stats: false },
  });
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }

  const reloaded = createSettings({ path });
  await reloaded.load();
  assert.equal(reloaded.get('theme'), 'forest');
  assert.equal(reloaded.get('stats'), false);
  assert.equal(reloaded.get('reasoningLevel'), 'high');
});

test('saved preferences seed runtime environment without overriding explicit env', async (t) => {
  const path = await temporaryConfig(t);
  const settings = createSettings({ path });
  await settings.load();
  await settings.update({
    theme: 'violet',
    model: 'qwen3.5-4b',
    reasoning: 'on',
    reasoningLevel: 'medium',
  });

  assert.deepEqual(settings.environment({ UGEM_THEME: 'mono', PATH: '/bin' }), {
    UGEM_THEME: 'mono',
    UGEM_MODEL: 'qwen3.5-4b',
    UGEM_REASONING: 'on',
    UGEM_REASONING_LEVEL: 'medium',
    PATH: '/bin',
  });
});

test('legacy settings migrate while invalid values and secrets are ignored', async (t) => {
  const path = await temporaryConfig(t);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    theme: 'ocean',
    stats: 'yes',
    apiKey: 'must-not-survive',
  }));
  const settings = createSettings({ path });

  await settings.load();
  assert.equal(settings.get('theme'), 'ocean');
  assert.equal(settings.get('stats'), true);
  assert.match(settings.configuration().notices.join(' '), /legacy settings schema/);
  assert.match(settings.configuration().notices.join(' '), /invalid settings: stats/);

  await settings.update({ codeColor: 'yellow' });
  assert.doesNotMatch(await readFile(path, 'utf8'), /must-not-survive|apiKey/);
});

test('a corrupt or future settings file safely falls back and reports why', async () => {
  const corrupt = createSettings({
    path: '/config.json',
    readFileImpl: async () => '{"apiKey":"must-not-appear"',
  });
  await corrupt.load();
  assert.equal(corrupt.get('theme'), 'classic');
  assert.match(corrupt.configuration().notices[0], /Invalid settings file/);
  assert.doesNotMatch(corrupt.configuration().notices[0], /must-not-appear/);

  const future = createSettings({
    path: '/config.json',
    readFileImpl: async () => JSON.stringify({ version: 99, preferences: {} }),
  });
  await future.load();
  assert.equal(future.get('stats'), true);
  assert.match(future.configuration().notices[0], /Unsupported settings version 99/);
});

test('updates reject unknown, secret, and malformed values', async () => {
  const settings = createSettings({
    path: '/config.json',
    readFileImpl: async () => {
      const cause = new Error('missing');
      cause.code = 'ENOENT';
      throw cause;
    },
  });

  await assert.rejects(settings.update({ apiKey: 'secret' }), /Invalid setting apiKey/);
  await assert.rejects(settings.update({ contextBudget: -1 }), /contextBudget/);
  await assert.rejects(settings.update({ theme: 'unknown' }), /theme/);
});

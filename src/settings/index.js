import { homedir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

export const SETTINGS_VERSION = 1;

export const SETTINGS_DEFAULTS = Object.freeze({
  theme: 'classic',
  themeMode: 'auto',
  codeColor: 'green',
  stats: true,
  model: null,
  reasoning: 'auto',
  reasoningLevel: 'high',
  contextBudget: null,
});

const ENUMS = Object.freeze({
  theme: new Set(['classic', 'ocean', 'forest', 'violet', 'mono']),
  themeMode: new Set(['auto', 'dark', 'light']),
  codeColor: new Set([
    'auto', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow',
  ]),
  reasoning: new Set(['auto', 'on', 'off']),
  reasoningLevel: new Set(['low', 'medium', 'high']),
});

const ENVIRONMENT_KEYS = Object.freeze({
  theme: 'UGEM_THEME',
  themeMode: 'UGEM_THEME_MODE',
  codeColor: 'UGEM_CODE_COLOR',
  model: 'UGEM_MODEL',
  reasoning: 'UGEM_REASONING',
  reasoningLevel: 'UGEM_REASONING_LEVEL',
});

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validate(key, value) {
  if (!own(SETTINGS_DEFAULTS, key)) return { valid: false };
  if (ENUMS[key]) return { valid: ENUMS[key].has(value), value };
  if (key === 'stats') return { valid: typeof value === 'boolean', value };
  if (key === 'model') {
    return {
      valid: value === null || (typeof value === 'string' && value.trim() !== ''),
      value: typeof value === 'string' ? value.trim() : value,
    };
  }
  if (key === 'contextBudget') {
    return {
      valid: value === null || (Number.isSafeInteger(value) && value > 0),
      value,
    };
  }
  return { valid: false };
}

export function settingsPath({
  env = process.env,
  platform = process.platform,
  home = homedir(),
} = {}) {
  if (env.UGEM_CONFIG_FILE) return env.UGEM_CONFIG_FILE;
  if (platform === 'win32') {
    const base = env.APPDATA
      ?? env.LOCALAPPDATA
      ?? win32.join(home, 'AppData', 'Roaming');
    return win32.join(base, 'ugem', 'config.json');
  }
  const base = env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(base, 'ugem', 'config.json');
}

export function createSettings({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  path = settingsPath({ env, platform, home }),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir,
  renameImpl = rename,
  removeImpl = rm,
  now = () => Date.now(),
  processId = process.pid,
} = {}) {
  let explicit = {};
  let loaded = false;
  let notices = [];

  function accept(source, { legacy = false } = {}) {
    const accepted = {};
    const invalid = [];
    for (const [key, value] of Object.entries(source ?? {})) {
      const result = validate(key, value);
      if (result.valid) accepted[key] = result.value;
      else if (own(SETTINGS_DEFAULTS, key)) invalid.push(key);
    }
    if (invalid.length > 0) {
      notices.push(`Ignored invalid settings: ${invalid.join(', ')}.`);
    }
    if (legacy) notices.push('Loaded legacy settings schema; it will upgrade on save.');
    return accepted;
  }

  async function load() {
    notices = [];
    let source;
    try {
      source = await readFileImpl(path, 'utf8');
    } catch (cause) {
      if (cause?.code !== 'ENOENT') {
        notices.push(`Could not read settings; defaults are active (${cause.message}).`);
      }
      explicit = {};
      loaded = true;
      return configuration();
    }

    try {
      const parsed = JSON.parse(source);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('root value must be an object');
      }
      if (parsed.version == null || parsed.version === 0) {
        explicit = accept(parsed.preferences ?? parsed, { legacy: true });
      } else if (parsed.version === SETTINGS_VERSION) {
        if (
          !parsed.preferences
          || typeof parsed.preferences !== 'object'
          || Array.isArray(parsed.preferences)
        ) {
          throw new TypeError('preferences must be an object');
        }
        explicit = accept(parsed.preferences);
      } else if (
        Number.isSafeInteger(parsed.version)
        && parsed.version > SETTINGS_VERSION
      ) {
        explicit = {};
        notices.push(
          `Unsupported settings version ${parsed.version}; defaults are active.`,
        );
      } else {
        explicit = {};
        notices.push('Invalid settings schema version; defaults are active.');
      }
    } catch {
      explicit = {};
      notices.push('Invalid settings file; defaults are active.');
    }
    loaded = true;
    return configuration();
  }

  function get(key) {
    return own(explicit, key) ? explicit[key] : SETTINGS_DEFAULTS[key];
  }

  function preferences() {
    return Object.freeze(Object.fromEntries(
      Object.keys(SETTINGS_DEFAULTS).map((key) => [key, get(key)]),
    ));
  }

  function configuration() {
    return Object.freeze({
      version: SETTINGS_VERSION,
      path,
      preferences: preferences(),
      explicit: Object.freeze({ ...explicit }),
      notices: Object.freeze([...notices]),
    });
  }

  async function update(patch = {}) {
    if (!loaded) await load();
    const next = { ...explicit };
    for (const [key, value] of Object.entries(patch)) {
      const result = validate(key, value);
      if (!result.valid) throw new TypeError(`Invalid setting ${key}.`);
      next[key] = result.value;
    }
    const payload = `${JSON.stringify({
      version: SETTINGS_VERSION,
      preferences: next,
    }, null, 2)}\n`;
    const temporary = `${path}.${processId}.${now()}.tmp`;
    await mkdirImpl(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFileImpl(temporary, payload, { encoding: 'utf8', mode: 0o600 });
      await renameImpl(temporary, path);
    } catch (cause) {
      await removeImpl(temporary, { force: true }).catch(() => {});
      throw cause;
    }
    explicit = next;
    notices = [];
    return configuration();
  }

  function environment(base = env) {
    const result = { ...base };
    for (const [key, environmentKey] of Object.entries(ENVIRONMENT_KEYS)) {
      if (
        base[environmentKey] == null
        && own(explicit, key)
        && explicit[key] != null
      ) {
        result[environmentKey] = String(explicit[key]);
      }
    }
    return result;
  }

  return Object.freeze({
    load,
    get,
    update,
    environment,
    configuration,
  });
}

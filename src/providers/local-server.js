import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_LAUNCHER = resolve(
  REPOSITORY_ROOT,
  '..',
  '..',
  'apps',
  'llama-server.bash',
);
const DEFAULT_PRESET = 'gemma4-e4b';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function reasoningMode(value, fallback = null) {
  return ['on', 'off', 'auto'].includes(value) ? value : fallback;
}

function localEndpoint(configuration) {
  try {
    const url = new URL(configuration.baseUrl);
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (url.protocol !== 'http:' || !localHosts.has(url.hostname)) return null;
    return {
      host: url.hostname === '[::1]' ? '::1' : url.hostname,
      port: Number(url.port || 80),
    };
  } catch {
    return null;
  }
}

function tail(buffer, chunk, limit = 8_192) {
  return `${buffer}${chunk}`.slice(-limit);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function createLocalServer({
  provider,
  env = process.env,
  launcher = env.UGEM_LLAMA_LAUNCHER ?? DEFAULT_LAUNCHER,
  preset = env.UGEM_LLAMA_PRESET
    ?? (env.UGEM_MODEL && env.UGEM_MODEL !== 'local-model'
      ? env.UGEM_MODEL
      : DEFAULT_PRESET),
  presetsFile = env.UGEM_LLAMA_PRESETS ?? resolve(dirname(launcher), 'presets.ini'),
  spawnImpl = spawn,
  exists = existsSync,
  readFileImpl = readFile,
  wait = delay,
  startupTimeoutMs = positiveInteger(env.UGEM_LLAMA_START_TIMEOUT_MS, 120_000),
  pollIntervalMs = 250,
} = {}) {
  let child;
  let owned = false;
  let outputTail = '';
  let spawnError;
  let activePreset = preset;
  let activeReasoning = null;
  let lastStatus = 'unknown';

  async function presets() {
    if (!exists(presetsFile)) return [];
    const source = await readFileImpl(presetsFile, 'utf8');
    const result = [];
    let current;
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        current = section[1] === 'defaults'
          ? null
          : { id: section[1], reasoning: 'auto', contextLimit: null };
        if (current) result.push(current);
        continue;
      }
      if (!current) continue;
      const separator = line.indexOf('=');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key === 'reasoning' && ['on', 'off', 'auto'].includes(value)) {
        current.reasoning = value;
      } else if (key === 'ctx_size') {
        current.contextLimit = positiveInteger(value, null);
      }
    }
    return result;
  }

  async function ensureRunning({ onStatus = () => {} } = {}) {
    if (typeof provider?.health !== 'function') {
      lastStatus = 'unmanaged';
      return { started: false, status: 'unmanaged' };
    }
    if (await provider.health()) {
      lastStatus = 'existing';
      return { started: false, status: 'existing' };
    }

    const endpoint = localEndpoint(provider.configuration());
    const enabled = env.UGEM_AUTO_START !== '0';
    if (!enabled || !endpoint || !exists(launcher)) {
      lastStatus = 'unavailable';
      return { started: false, status: 'unavailable' };
    }

    const available = await presets();
    const selected = available.find((item) => item.id === activePreset);
    if (available.length > 0 && !selected) {
      throw new Error(
        `Unknown local model preset: ${activePreset}. Use /models to list presets.`,
      );
    }

    const selectedReasoning = activeReasoning
      ?? reasoningMode(env.UGEM_REASONING)
      ?? selected?.reasoning
      ?? 'auto';
    activeReasoning = selectedReasoning;

    onStatus(
      `Starting local model ${activePreset} · reasoning ${selectedReasoning}...`,
    );
    const childEnv = { ...env };
    delete childEnv.UGEM_API_KEY;
    child = spawnImpl(launcher, [
      activePreset,
      '--host', endpoint.host,
      '--port', String(endpoint.port),
      '--reasoning', selectedReasoning,
      '--no-webui',
    ], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    owned = true;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.stdout?.on('data', (chunk) => {
      outputTail = tail(outputTail, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      outputTail = tail(outputTail, chunk);
    });

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Could not start local llama.cpp server: ${spawnError.message}`);
      }
      if (child.exitCode != null) {
        const detail = outputTail.trim();
        throw new Error(
          `Local llama.cpp server exited with code ${child.exitCode}`
          + (detail ? `: ${detail}` : ''),
        );
      }
      if (await provider.health()) {
        provider.setModel?.(activePreset);
        lastStatus = 'started';
        return {
          started: true,
          status: 'started',
          model: activePreset,
          reasoning: selectedReasoning,
          contextLimit: selected?.contextLimit ?? null,
        };
      }
      await wait(pollIntervalMs);
    }

    await stop();
    throw new Error(
      `Local llama.cpp server did not become ready within ${startupTimeoutMs} ms`,
    );
  }

  async function stop() {
    if (!owned || !child) return;
    const processToStop = child;
    if (processToStop.exitCode == null) {
      processToStop.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveExit) => processToStop.once('exit', resolveExit)),
        wait(2_000),
      ]);
      if (processToStop.exitCode == null) processToStop.kill('SIGKILL');
    }
    owned = false;
    child = undefined;
    lastStatus = 'stopped';
  }

  async function selectModel(modelId, {
    reasoning,
    onStatus = () => {},
  } = {}) {
    const available = await presets();
    const selected = available.find((item) => item.id === modelId);
    if (!selected) {
      throw new Error(`Unknown local model preset: ${modelId}`);
    }
    const selectedReasoning = reasoningMode(reasoning, selected.reasoning);
    if (
      modelId === activePreset
      && selectedReasoning === activeReasoning
      && await provider.health()
    ) {
      provider.setModel?.(modelId);
      return {
        started: false,
        status: lastStatus,
        model: modelId,
        reasoning: selectedReasoning,
        contextLimit: selected.contextLimit,
      };
    }
    if (!owned && await provider.health()) {
      throw new Error(
        'The active llama.cpp server is external; μgem will not stop or replace it.',
      );
    }

    await stop();
    activePreset = modelId;
    activeReasoning = selectedReasoning;
    provider.setModel?.(modelId);
    return ensureRunning({ onStatus });
  }

  async function selectReasoning(reasoning, options = {}) {
    const selectedReasoning = reasoningMode(reasoning);
    if (!selectedReasoning) {
      throw new Error(`Invalid reasoning mode: ${reasoning}`);
    }
    return selectModel(activePreset, { ...options, reasoning: selectedReasoning });
  }

  return {
    ensureRunning,
    listModels: presets,
    selectModel,
    selectReasoning,
    stop,
    configuration: () => Object.freeze({
      enabled: env.UGEM_AUTO_START !== '0',
      launcher,
      preset: activePreset,
      reasoning: activeReasoning ?? reasoningMode(env.UGEM_REASONING, 'unknown'),
      presetsFile,
      status: lastStatus,
    }),
  };
}

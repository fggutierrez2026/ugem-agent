#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createCli } from './cli/app.js';
import { createMetrics } from './metrics/index.js';
import { createProvider } from './providers/index.js';
import { createLocalServer } from './providers/local-server.js';
import { createRenderer } from './renderer/index.js';
import { createSettings } from './settings/index.js';

export async function main(options = {}) {
  const baseEnvironment = options.env ?? process.env;
  const settings = options.settings ?? createSettings({ env: baseEnvironment });
  if (typeof settings.load === 'function') await settings.load();
  const env = typeof settings.environment === 'function'
    ? settings.environment(baseEnvironment)
    : baseEnvironment;
  const output = options.output ?? process.stdout;
  const provider = options.provider ?? createProvider({ env });
  const renderer = options.renderer ?? createRenderer({
    output,
    codeColor: env.UGEM_CODE_COLOR ?? 'green',
  });
  const metrics = options.metrics ?? createMetrics({
    contextBudget: settings.get?.('contextBudget'),
    footer: settings.get?.('stats') ?? true,
  });
  const localServer = options.localServer ?? createLocalServer({ provider, env });
  const cli = createCli({
    ...options,
    env,
    settings,
    provider,
    renderer,
    metrics,
    localServer,
  });
  await cli.run();
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`ugem: ${error.message}\n`);
    process.exitCode = 1;
  });
}

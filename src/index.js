#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createCli } from './cli/app.js';

export async function main(options = {}) {
  const cli = createCli(options);
  await cli.run();
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`ugem: ${error.message}\n`);
    process.exitCode = 1;
  });
}

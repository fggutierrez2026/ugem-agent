import { createInterface } from 'node:readline';
import { createProvider } from '../providers/index.js';
import { createSession } from '../session/index.js';
import { createRenderer } from '../renderer/index.js';

const HELP = `Commands:
  /help  Show this help
  /exit  Exit μgem

Enter a question to talk to the configured model endpoint.
`;

export function createCli({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  provider = createProvider(),
  session = createSession(),
  renderer = createRenderer({ output }),
} = {}) {
  let readline;
  let interrupted = false;

  function writePrompt() {
    if (output.isTTY) output.write('› ');
  }

  async function handleLine(rawLine) {
    const line = rawLine.trim();
    if (!line) return true;

    const command = line.toLowerCase();
    if (command === '/help') {
      output.write(HELP);
      return true;
    }

    if (command === '/exit') return false;

    if (command.startsWith('/')) {
      error.write(`Unknown command: ${line}. Use /help to list commands.\n`);
      return true;
    }

    try {
      session.addUserMessage(line);
      const answer = await provider.complete(session.messages());
      session.addAssistantMessage(answer);
      renderer.writeAnswer(answer);
    } catch (cause) {
      session.removeLastUserMessage();
      error.write(`Model request failed: ${cause.message}\n`);
    }
    return true;
  }

  function interrupt() {
    if (interrupted) return;
    interrupted = true;
    output.write('\n');
    readline?.close();
  }

  async function run() {
    readline = createInterface({
      input,
      output,
      terminal: Boolean(input.isTTY && output.isTTY),
    });
    readline.on('SIGINT', interrupt);

    writePrompt();
    for await (const line of readline) {
      if (!(await handleLine(line))) {
        readline.close();
        break;
      }
      writePrompt();
    }
  }

  return { run, handleLine, interrupt };
}

export { HELP };

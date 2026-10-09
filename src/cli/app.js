import { createInterface } from 'node:readline';
import { createProvider } from '../providers/index.js';
import { createSession } from '../session/index.js';
import { createRenderer } from '../renderer/index.js';

const HELP = `Commands:
  /Q&A [question]  Enter Q&A mode or ask a question
  /clear           Clear conversation history
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
  let activeController;
  let closed = false;

  function writePrompt() {
    if (output.isTTY) output.write('› ');
  }

  async function ask(question) {
    let answer = '';
    let wroteChunk = false;
    activeController = new AbortController();
    try {
      session.addUserMessage(question);
      for await (const chunk of provider.stream(session.messages(), {
        signal: activeController.signal,
      })) {
        answer += chunk;
        wroteChunk = true;
        renderer.writeChunk(chunk);
      }
      session.addAssistantMessage(answer);
      renderer.endAnswer();
    } catch (cause) {
      if (wroteChunk) renderer.endAnswer();
      session.removeLastUserMessage();
      if (cause?.code === 'cancelled') error.write('Model request cancelled.\n');
      else error.write(`Model request failed: ${cause.message}\n`);
    } finally {
      activeController = undefined;
    }
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

    if (command === '/clear') {
      session.clear();
      output.write('Conversation cleared.\n');
      return true;
    }

    const qAndA = line.match(/^\/q&a(?:\s+(.+))?$/i);
    if (qAndA) {
      if (qAndA[1]) await ask(qAndA[1]);
      else output.write('Q&A mode active.\n');
      return true;
    }

    if (command.startsWith('/')) {
      error.write(`Unknown command: ${line}. Use /help to list commands.\n`);
      return true;
    }

    await ask(line);
    return true;
  }

  function interrupt() {
    if (activeController) {
      activeController.abort();
      return;
    }
    if (closed) return;
    closed = true;
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

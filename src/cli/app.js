import { createInterface } from 'node:readline';
import { createProvider } from '../providers/index.js';
import { createLocalServer } from '../providers/local-server.js';
import { createSession } from '../session/index.js';
import { createRenderer } from '../renderer/index.js';
import { createMetrics } from '../metrics/index.js';
import {
  formatMetricsPanel,
  formatStartupPanel,
  formatStatusPanel,
  THEME_NAMES,
  themePalette,
} from './status.js';

const ANSI_RESET = '\u001b[0m';

const HELP = `Commands:
  /Q&A [question]  Enter Q&A mode or ask a question
  /clear           Clear conversation history
  /models [id] [reasoning]  List/select a model; reasoning: auto|on|off
  /reasoning [mode]         Show/change reasoning for the active model
  /theme [name]             Show/change color palette
  /code-color [color]       Show/change fenced-code color
  /stats [on|off]  Show metrics or toggle the per-answer footer
  /help            Show this help
  /exit            Exit μgem

Enter a question to talk to the configured model endpoint.
`;

export function createCli({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  provider = createProvider(),
  session = createSession(),
  renderer = createRenderer({ output }),
  metrics = createMetrics(),
  color = Boolean(output.isTTY && !process.env.NO_COLOR),
  localServer = createLocalServer({ provider }),
  theme = process.env.UGEM_THEME ?? 'classic',
} = {}) {
  let readline;
  let activeController;
  let closed = false;
  let promptStyleActive = false;
  let runtimeHint = {};
  let contextWarningShown = false;
  let selectedTheme = THEME_NAMES.includes(theme) ? theme : 'classic';

  function resetPromptStyle() {
    if (!promptStyleActive) return;
    output.write(ANSI_RESET);
    promptStyleActive = false;
  }

  function writePrompt() {
    if (!output.isTTY) return;
    const palette = themePalette(selectedTheme);
    output.write(color ? `${palette.user}you › ` : 'you › ');
    promptStyleActive = color;
  }

  function writeAssistantLabel() {
    if (!output.isTTY) return;
    const palette = themePalette(selectedTheme);
    output.write(color
      ? `${palette.assistant}μgem ›${ANSI_RESET}\n`
      : 'μgem ›\n');
  }

  function writeStatus(message, options = {}) {
    output.write(formatStatusPanel(message, {
      width: output.columns ?? 80,
      color,
      theme: selectedTheme,
      ...options,
    }));
  }

  async function writeStartup() {
    const configuredModel = provider.configuration?.().model ?? 'unknown';
    let runtime = {
      model: configuredModel,
      modelSource: 'configured',
      status: 'unknown',
      contextLimit: null,
      reasoning: 'unknown',
      ...runtimeHint,
    };
    if (typeof provider.runtimeInfo === 'function') {
      try {
        const inspected = await provider.runtimeInfo();
        runtime = { ...runtime, ...runtimeHint, ...inspected };
        if (inspected.reasoning === 'unknown' && runtimeHint.reasoning) {
          runtime.reasoning = runtimeHint.reasoning;
        }
      } catch {
        // Startup remains usable when optional capability discovery fails.
      }
    }
    if (runtime.contextLimit != null) {
      metrics.setContextLimits({ server: runtime.contextLimit });
    }
    output.write(formatStartupPanel({
      width: output.columns ?? 80,
      ...runtime,
      context: metrics.contextStatus(),
      color,
      theme: selectedTheme,
    }));
  }

  async function ask(question) {
    let answer = '';
    let wroteChunk = false;
    let measurement;
    activeController = new AbortController();
    try {
      session.addUserMessage(question);
      measurement = metrics.begin(session.messages());
      writeAssistantLabel();
      for await (const chunk of provider.stream(session.messages(), {
        signal: activeController.signal,
        onMetadata: (metadata) => measurement.addProviderMetadata(metadata),
      })) {
        answer += chunk;
        measurement.addChunk(chunk);
        wroteChunk = true;
        renderer.writeChunk(chunk);
      }
      session.addAssistantMessage(answer);
      renderer.endAnswer();
      const record = measurement.finish();
      if (metrics.footerEnabled()) {
        const reasoning = localServer.configuration?.().reasoning
          ?? runtimeHint.reasoning;
        const footer = metrics.formatFooter(record, {
          width: output.columns ?? 80,
          reasoning,
        });
        output.write('\n');
        output.write(formatMetricsPanel(footer, {
          width: output.columns ?? 80,
          color,
          theme: selectedTheme,
        }));
      }
      const capacity = record.context.budget ?? record.context.serverLimit;
      if (
        !contextWarningShown
        && capacity != null
        && record.context.used / capacity >= 0.9
      ) {
        contextWarningShown = true;
        const percent = (record.context.used / capacity * 100).toFixed(1);
        const available = Math.max(0, capacity - record.context.used);
        writeStatus(
          `${percent}% used · `
          + `${available.toLocaleString('en-US')} tokens available. `
          + 'Use /clear before the context fills.',
          { title: 'context warning', tone: 'warning' },
        );
      }
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
    resetPromptStyle();
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
      metrics.resetContext();
      contextWarningShown = false;
      writeStatus('Conversation cleared.', { tone: 'success' });
      return true;
    }

    const models = line.match(/^\/models?(?:\s+(.+))?$/i);
    if (models) {
      if (typeof localServer.listModels !== 'function') {
        error.write('Local model selection is unavailable.\n');
        return true;
      }
      const args = models[1]?.trim().split(/\s+/) ?? [];
      const [requested, requestedReasoning] = args;
      if (
        args.length > 2
        || (requestedReasoning && !['auto', 'on', 'off'].includes(
          requestedReasoning.toLowerCase(),
        ))
      ) {
        error.write('Usage: /models [id] [auto|on|off]\n');
        return true;
      }
      if (!requested) {
        const available = await localServer.listModels();
        const active = localServer.configuration?.().preset;
        const rows = ['Local models:'];
        for (const item of available) {
          rows.push(`  ${item.id === active ? '*' : ' '} ${item.id}`
            + ` · ${item.contextLimit?.toLocaleString('en-US') ?? 'N/A'} ctx`
            + ` · reasoning ${item.reasoning}`);
        }
        rows.push('Use /models <id> [auto|on|off] to select one.');
        writeStatus(rows.join('\n'), { title: 'models' });
        return true;
      }

      const previous = localServer.configuration?.();
      try {
        const selected = await localServer.selectModel(requested, {
          reasoning: requestedReasoning?.toLowerCase(),
          onStatus: () => {},
        });
        runtimeHint = selected;
        if (
          requested !== previous?.preset
          || selected.reasoning !== previous?.reasoning
        ) {
          session.clear();
          metrics.resetContext();
          contextWarningShown = false;
          writeStatus(
            `Model changed to ${requested} · reasoning ${selected.reasoning}. `
            + 'Conversation cleared.',
            { tone: 'success' },
          );
        } else {
          writeStatus(
            `Model ${requested} · reasoning ${selected.reasoning} is already active.`,
          );
        }
        if (output.isTTY) await writeStartup();
      } catch (cause) {
        error.write(`Could not change model: ${cause.message}\n`);
      }
      return true;
    }

    const reasoning = line.match(/^\/reasoning(?:\s+(\S+))?$/i);
    if (reasoning) {
      const requested = reasoning[1]?.toLowerCase();
      if (!requested) {
        const current = localServer.configuration?.().reasoning ?? 'unknown';
        writeStatus(`Reasoning: ${current}.`, { title: 'reasoning' });
        return true;
      }
      if (!['auto', 'on', 'off'].includes(requested)) {
        error.write('Usage: /reasoning [auto|on|off]\n');
        return true;
      }
      if (typeof localServer.selectReasoning !== 'function') {
        error.write('Reasoning control is unavailable for this server.\n');
        return true;
      }
      const previous = localServer.configuration?.().reasoning;
      try {
        const selected = await localServer.selectReasoning(requested, {
          onStatus: () => {},
        });
        runtimeHint = selected;
        if (selected.reasoning !== previous) {
          session.clear();
          metrics.resetContext();
          contextWarningShown = false;
          writeStatus(
            `Reasoning changed to ${selected.reasoning}. Conversation cleared.`,
            { tone: 'success' },
          );
        } else {
          writeStatus(`Reasoning ${selected.reasoning} is already active.`);
        }
        if (output.isTTY) await writeStartup();
      } catch (cause) {
        error.write(`Could not change reasoning: ${cause.message}\n`);
      }
      return true;
    }

    const themeCommand = line.match(/^\/theme(?:\s+(\S+))?$/i);
    if (themeCommand) {
      const requested = themeCommand[1]?.toLowerCase();
      if (!requested) {
        writeStatus(
          `Theme: ${selectedTheme}. Available: ${THEME_NAMES.join(', ')}.`,
          { title: 'theme' },
        );
        return true;
      }
      if (!THEME_NAMES.includes(requested)) {
        error.write(`Usage: /theme [${THEME_NAMES.join('|')}]\n`);
        return true;
      }
      selectedTheme = requested;
      writeStatus(`Theme changed to ${selectedTheme}.`, {
        title: 'theme',
        tone: 'success',
      });
      return true;
    }

    const codeColor = line.match(/^\/code-color(?:\s+(\S+))?$/i);
    if (codeColor) {
      const requested = codeColor[1]?.toLowerCase();
      const available = [
        'auto', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow',
      ];
      if (!requested) {
        const current = renderer.configuration?.().codeColor ?? 'unknown';
        writeStatus(`Code color: ${current}.`, { title: 'code' });
        return true;
      }
      if (!available.includes(requested)) {
        error.write(`Usage: /code-color [${available.join('|')}]\n`);
        return true;
      }
      if (typeof renderer.setCodeColor !== 'function') {
        error.write('Code color selection is unavailable.\n');
        return true;
      }
      renderer.setCodeColor(requested);
      writeStatus(`Code color changed to ${requested}.`, {
        title: 'code',
        tone: 'success',
      });
      return true;
    }

    const stats = line.match(/^\/stats(?:\s+(\S+))?$/i);
    if (stats) {
      const option = stats[1]?.toLowerCase();
      if (option === 'on' || option === 'off') {
        metrics.setFooterEnabled(option === 'on');
        writeStatus(`Per-answer metrics footer ${option}.`, { title: 'stats' });
      } else if (option) {
        error.write('Usage: /stats [on|off]\n');
      } else {
        writeStatus(metrics.formatStats(), { title: 'stats' });
      }
      return true;
    }

    const qAndA = line.match(/^\/q&a(?:\s+(.+))?$/i);
    if (qAndA) {
      if (qAndA[1]) await ask(qAndA[1]);
      else writeStatus('Q&A mode active.', { tone: 'success' });
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
    resetPromptStyle();
    output.write('\n');
    readline?.close();
  }

  async function run() {
    try {
      runtimeHint = await localServer.ensureRunning();
      if (output.isTTY) await writeStartup();
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
    } finally {
      resetPromptStyle();
      await localServer.stop();
    }
  }

  return { run, handleLine, interrupt, writePrompt, writeStartup };
}

export { HELP };

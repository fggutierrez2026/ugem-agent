import { createInterface } from 'node:readline';
import { createProvider } from '../providers/index.js';
import { createLocalServer } from '../providers/local-server.js';
import { createSession } from '../session/index.js';
import { createRenderer } from '../renderer/index.js';
import { createMetrics } from '../metrics/index.js';
import {
  APPEARANCE_MODES,
  formatMetricsPanel,
  formatStartupPanel,
  formatStatusPanel,
  resolveAppearance,
  THEME_NAMES,
  themePalette,
} from './status.js';

const ANSI_RESET = '\u001b[0m';

export function terminalSupportsColor(output, env = process.env) {
  if (!output?.isTTY || env.NO_COLOR != null || env.TERM === 'dumb') return false;
  if (typeof output.hasColors === 'function') return output.hasColors();
  return true;
}

const HELP = `Commands:
  /Q&A [question]  Enter Q&A mode or ask a question
  /clear           Clear conversation history
  /models [id] [options]    List/select; options: reasoning, clear|keep
  /reasoning [mode]         Show/change reasoning for the active model
  /theme [mode] [palette]   mode: auto|dark|light
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
  env = process.env,
  provider = createProvider(),
  session = createSession(),
  renderer = createRenderer({ output }),
  metrics = createMetrics(),
  color = terminalSupportsColor(output, env),
  localServer = createLocalServer({ provider, env }),
  theme = env.UGEM_THEME ?? 'classic',
  themeMode = env.UGEM_THEME_MODE ?? 'auto',
} = {}) {
  let readline;
  let activeController;
  let closed = false;
  let promptStyleActive = false;
  let runtimeHint = {};
  let contextWarningShown = false;
  let selectedTheme = THEME_NAMES.includes(theme) ? theme : 'classic';
  let selectedThemeMode = APPEARANCE_MODES.includes(themeMode) ? themeMode : 'auto';
  let resolvedAppearance = resolveAppearance(selectedThemeMode, env);

  function resetPromptStyle() {
    if (!promptStyleActive) return;
    output.write(ANSI_RESET);
    promptStyleActive = false;
  }

  function writePrompt() {
    if (!output.isTTY) return;
    const palette = themePalette(selectedTheme, resolvedAppearance);
    output.write(color ? `${palette.user}you › ` : 'you › ');
    promptStyleActive = color;
  }

  function writeAssistantLabel() {
    if (!output.isTTY) return;
    const palette = themePalette(selectedTheme, resolvedAppearance);
    output.write(color
      ? `${palette.assistant}μgem ›${ANSI_RESET}\n`
      : 'μgem ›\n');
  }

  function writeStatus(message, options = {}) {
    output.write(formatStatusPanel(message, {
      width: output.columns ?? 80,
      color,
      theme: selectedTheme,
      appearance: resolvedAppearance,
      ...options,
    }));
  }

  function resetConversation() {
    session.clear();
    metrics.resetContext();
    contextWarningShown = false;
  }

  function managedModelSelection() {
    if (typeof localServer.managesModels === 'function') {
      return localServer.managesModels();
    }
    const status = localServer.configuration?.().status;
    return status == null && typeof localServer.selectModel === 'function';
  }

  function parseModelOptions(args) {
    let reasoning;
    let history;
    for (const option of args) {
      const normalized = option.toLowerCase();
      if (['auto', 'on', 'off'].includes(normalized) && reasoning == null) {
        reasoning = normalized;
      } else if (['clear', 'keep'].includes(normalized) && history == null) {
        history = normalized;
      } else {
        return null;
      }
    }
    return { reasoning, history };
  }

  function historyChoiceRequired(modelId, history) {
    const messageCount = session.messages().length;
    if (messageCount === 0 || history) return false;
    writeStatus(
      `Conversation has ${messageCount} messages. Choose how to switch:\n`
      + `  /models ${modelId} clear  — start a new conversation\n`
      + `  /models ${modelId} keep   — retain current history`,
      { title: 'model switch', tone: 'warning' },
    );
    return true;
  }

  function applyHistoryChoice(history) {
    if (history === 'keep') {
      contextWarningShown = false;
      return 'Conversation history kept.';
    }
    resetConversation();
    return 'Conversation cleared.';
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
        if (
          inspected.modelSource === 'configured'
          && runtimeHint.modelSource === 'provider'
        ) {
          runtime.modelSource = 'provider';
        }
        if (inspected.status === 'unknown' && runtimeHint.status) {
          runtime.status = runtimeHint.status;
        }
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
      appearance: resolvedAppearance,
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
          appearance: resolvedAppearance,
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
      resetConversation();
      writeStatus('Conversation cleared.', { tone: 'success' });
      return true;
    }

    const models = line.match(/^\/models?(?:\s+(.+))?$/i);
    if (models) {
      const args = models[1]?.trim().split(/\s+/) ?? [];
      const requested = args.shift();
      const options = parseModelOptions(args);
      if (!options) {
        error.write(
          'Usage: /models [id] [auto|on|off] [clear|keep]\n',
        );
        return true;
      }
      const managed = managedModelSelection();
      if (!requested) {
        try {
          if (managed) {
            const available = await localServer.listModels();
            const active = localServer.configuration?.().preset;
            const rows = ['Managed local models:'];
            for (const item of available) {
              rows.push(`  ${item.id === active ? '*' : ' '} ${item.id}`
                + ` · ${item.contextLimit?.toLocaleString('en-US') ?? 'N/A'} ctx`
                + ` · reasoning ${item.reasoning}`);
            }
            rows.push(
              'Use /models <id> [auto|on|off] [clear|keep] to select one.',
            );
            writeStatus(rows.join('\n'), { title: 'models' });
          } else {
            if (typeof provider.discoverModels !== 'function') {
              throw new Error('Model discovery is unavailable for this provider.');
            }
            const discovered = await provider.discoverModels();
            const active = provider.configuration?.().model;
            const rows = [discovered.source === 'provider'
              ? 'Provider-advertised models:'
              : 'Configured single-model endpoint:'];
            for (const modelId of discovered.models) {
              rows.push(`  ${modelId === active ? '*' : ' '} ${modelId}`);
            }
            if (discovered.source === 'provider') {
              rows.push('Use /models <id> [clear|keep] to select one.');
            } else {
              rows.push(
                'Set UGEM_BASE_URL and UGEM_MODEL before starting μgem '
                + 'to configure another external endpoint.',
              );
            }
            writeStatus(rows.join('\n'), { title: 'models' });
          }
        } catch (cause) {
          error.write(`Could not list models: ${cause.message}\n`);
        }
        return true;
      }

      if (managed) {
        const previous = localServer.configuration?.();
        const changes = requested !== previous?.preset
          || (options.reasoning != null && options.reasoning !== previous?.reasoning);
        if (changes && historyChoiceRequired(requested, options.history)) return true;
        try {
          const selected = await localServer.selectModel(requested, {
            reasoning: options.reasoning,
            onStatus: () => {},
          });
          runtimeHint = selected;
          if (changes) {
            const historyMessage = applyHistoryChoice(options.history);
            metrics.setContextLimits({ server: selected.contextLimit });
            writeStatus(
              `Model changed to ${requested} · reasoning ${selected.reasoning}. `
              + historyMessage,
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

      if (options.reasoning) {
        error.write(
          'Reasoning selection is unavailable for this external provider; '
          + 'use /models <id> [clear|keep].\n',
        );
        return true;
      }
      const previousModel = provider.configuration?.().model;
      if (requested === previousModel) {
        writeStatus(`Model ${requested} is already active.`);
        return true;
      }
      if (historyChoiceRequired(requested, options.history)) return true;
      if (typeof provider.selectModel !== 'function') {
        error.write('Provider model selection is unavailable.\n');
        return true;
      }
      try {
        const selected = await provider.selectModel(requested);
        runtimeHint = {
          model: selected.model,
          modelSource: selected.source,
          status: 'configured',
          contextLimit: null,
          reasoning: 'unknown',
        };
        metrics.setContextLimits({ server: null });
        const historyMessage = applyHistoryChoice(options.history);
        if (typeof provider.runtimeInfo === 'function') {
          try {
            const inspected = await provider.runtimeInfo();
            runtimeHint = { ...runtimeHint, ...inspected };
            metrics.setContextLimits({ server: inspected.contextLimit });
          } catch {
            // Runtime inspection is optional after a verified request-ID change.
          }
        }
        writeStatus(
          `Request model set to ${selected.model} (${selected.source}). `
          + historyMessage,
          { tone: 'success' },
        );
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
          resetConversation();
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

    const themeCommand = line.match(/^\/theme(?:\s+(.+))?$/i);
    if (themeCommand) {
      const args = themeCommand[1]?.trim().toLowerCase().split(/\s+/) ?? [];
      if (args.length === 0) {
        writeStatus(
          `Theme: ${selectedTheme} · mode ${selectedThemeMode}`
          + ` → ${resolvedAppearance}. Palettes: ${THEME_NAMES.join(', ')}.`,
          { title: 'theme' },
        );
        return true;
      }
      let nextTheme = selectedTheme;
      let nextMode = selectedThemeMode;
      let sawTheme = false;
      let sawMode = false;
      for (const option of args) {
        if (THEME_NAMES.includes(option) && !sawTheme) {
          nextTheme = option;
          sawTheme = true;
        } else if (APPEARANCE_MODES.includes(option) && !sawMode) {
          nextMode = option;
          sawMode = true;
        } else {
          error.write(
            'Usage: /theme [auto|dark|light] '
            + `[${THEME_NAMES.join('|')}]\n`,
          );
          return true;
        }
      }
      if (args.length > 2) {
        error.write(
          'Usage: /theme [auto|dark|light] '
          + `[${THEME_NAMES.join('|')}]\n`,
        );
        return true;
      }
      selectedTheme = nextTheme;
      selectedThemeMode = nextMode;
      resolvedAppearance = resolveAppearance(selectedThemeMode, env);
      writeStatus(
        `Theme changed to ${selectedTheme} · mode ${selectedThemeMode}`
        + ` → ${resolvedAppearance}.`, {
        title: 'theme',
        tone: 'success',
        },
      );
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

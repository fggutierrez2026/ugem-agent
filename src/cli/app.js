import { createInterface } from 'node:readline';
import { createProvider } from '../providers/index.js';
import { createLocalServer } from '../providers/local-server.js';
import { createSession } from '../session/index.js';
import { createRenderer } from '../renderer/index.js';
import {
  createMetrics,
  formatContextBar,
  formatContextDetails,
} from '../metrics/index.js';
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
const REASONING_LEVELS = Object.freeze({
  low: 1_024,
  medium: 2_048,
  high: 4_096,
});

export function terminalSupportsColor(output, env = process.env) {
  if (!output?.isTTY || env.NO_COLOR != null || env.TERM === 'dumb') return false;
  if (typeof output.hasColors === 'function') return output.hasColors();
  return true;
}

const HELP = `Commands:
  /Q&A [question]  Enter Q&A mode or ask a question
  /clear           Clear conversation history
  /models [id] [options]    List/select; reasoning level and clear|keep
  /reasoning [setting]      auto|on|off|low (1K)|medium (2K)|high (4K)
  /context [tokens|auto]    Show/set the validated session context budget
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

  async function refreshContextLimit() {
    const current = metrics.contextStatus();
    if (current.serverLimit != null) return current;
    const configuredLimit = runtimeHint.contextLimit
      ?? localServer.configuration?.().contextLimit;
    if (Number.isSafeInteger(configuredLimit) && configuredLimit > 0) {
      metrics.setContextLimits({ server: configuredLimit });
      return metrics.contextStatus();
    }
    if (typeof provider.runtimeInfo === 'function') {
      try {
        const inspected = await provider.runtimeInfo();
        if (Number.isSafeInteger(inspected.contextLimit) && inspected.contextLimit > 0) {
          runtimeHint = { ...runtimeHint, ...inspected };
          metrics.setContextLimits({ server: inspected.contextLimit });
        }
      } catch {
        // Context inspection is optional for OpenAI-compatible providers.
      }
    }
    return metrics.contextStatus();
  }

  function contextSummary(prefix) {
    const status = metrics.contextStatus();
    const capacity = status.budget ?? status.serverLimit;
    const reasoningBudget = currentReasoningBudget();
    const completionReserve = status.outputReserve + reasoningBudget;
    const inputRoom = capacity == null
      ? null
      : Math.max(0, capacity - status.used - completionReserve);
    return [
      ...(prefix ? [prefix] : []),
      `Usage: ${formatContextBar(status)} (${status.source})`,
      `Retained: ${formatContextDetails(status)} (${status.source})`,
      `Session budget: ${status.budget == null
        ? 'auto (server limit)'
        : status.budget.toLocaleString('en-US') + ' tokens'}.`,
      `Confirmed server limit: ${status.serverLimit == null
        ? 'N/A'
        : status.serverLimit.toLocaleString('en-US') + ' tokens'}.`,
      `Reserved final output: ${status.outputReserve.toLocaleString('en-US')} tokens.`,
      `Reasoning budget: ${reasoningBudget > 0
        ? reasoningBudget.toLocaleString('en-US') + ' tokens ('
          + currentReasoningLabel() + ')'
        : 'none'}.`,
      `Total completion reserve: ${completionReserve.toLocaleString('en-US')} tokens.`,
      `Estimated input room after reserve: ${inputRoom == null
        ? 'N/A'
        : inputRoom.toLocaleString('en-US') + ' tokens'}.`,
      'This command does not change llama-server --ctx-size; changing that '
        + 'server limit may require a model reload or server restart.',
    ].join('\n');
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
    let reasoningBudget;
    let reasoningLabel;
    let history;
    for (const option of args) {
      const normalized = option.toLowerCase();
      const selection = reasoningSelection(normalized);
      if (selection && reasoning == null) {
        ({ mode: reasoning, budget: reasoningBudget, label: reasoningLabel } = selection);
      } else if (['clear', 'keep'].includes(normalized) && history == null) {
        history = normalized;
      } else {
        return null;
      }
    }
    return { reasoning, reasoningBudget, reasoningLabel, history };
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

  function reasoningStatus(info, { managed = false } = {}) {
    let control;
    if (managed) {
      control = 'available through a managed server restart';
    } else if (info.capability === 'supported') {
      control = 'supported through verified per-request template control';
    } else if (info.capability === 'unsupported') {
      control = 'unsupported by the active model template';
    } else {
      control = 'unknown; the endpoint exposes no verifiable capability';
    }
    const budgetLine = managed && info.mode !== 'off'
      ? [`Budget: ${info.level ?? 'high'} · `
        + `${(info.budget ?? 4_096).toLocaleString('en-US')} reasoning tokens.`]
      : [];
    return [
      `Generation request: ${info.mode ?? 'unknown'}.`,
      ...budgetLine,
      `Control: ${control}.`,
      'Reasoning content: hidden; display policy does not disable generation.',
    ].join('\n');
  }

  function currentReasoningMode() {
    return managedModelSelection()
      ? localServer.configuration?.().reasoning ?? 'unknown'
      : provider.reasoningConfiguration?.().mode
        ?? runtimeHint.reasoning
        ?? 'unknown';
  }

  function currentReasoningBudget() {
    if (currentReasoningMode() === 'off' || !managedModelSelection()) return 0;
    const budget = localServer.configuration?.().reasoningBudget;
    return Number.isSafeInteger(budget) && budget > 0 ? budget : 0;
  }

  function currentReasoningLabel() {
    if (currentReasoningMode() === 'off') return 'off';
    if (!managedModelSelection()) return currentReasoningMode();
    const level = localServer.configuration?.().reasoningLevel ?? 'high';
    return `${level}/${currentReasoningMode()}`;
  }

  function reasoningSelection(value) {
    if (Object.hasOwn(REASONING_LEVELS, value)) {
      return { mode: 'on', budget: REASONING_LEVELS[value], label: value };
    }
    if (value === 'on') {
      return { mode: 'on', budget: REASONING_LEVELS.high, label: 'high' };
    }
    if (value === 'auto') {
      return { mode: 'auto', budget: REASONING_LEVELS.high, label: 'high' };
    }
    if (value === 'off') return { mode: 'off', budget: 0, label: 'off' };
    return null;
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
    const reasoningDisplay = runtime.reasoningBudget > 0
      && runtime.reasoning !== 'off'
      ? `${runtime.reasoning}/${runtime.reasoningLevel ?? 'custom'} `
        + `(${runtime.reasoningBudget.toLocaleString('en-US')} tok)`
      : runtime.reasoning;
    output.write(formatStartupPanel({
      width: output.columns ?? 80,
      ...runtime,
      reasoning: reasoningDisplay,
      context: metrics.contextStatus(),
      color,
      theme: selectedTheme,
      appearance: resolvedAppearance,
    }));
  }

  async function ask(question) {
    const prospectiveMessages = [
      ...session.messages(),
      { role: 'user', content: question },
    ];
    const reasoningBudget = currentReasoningBudget();
    const assessment = metrics.assessContext(prospectiveMessages, {
      reasoningBudget,
    });
    if (!assessment.allowed) {
      const overflow = assessment.required - assessment.capacity;
      writeStatus(
        `Request not sent: the conversation needs about `
        + `${assessment.required.toLocaleString('en-US')} tokens `
        + `(${assessment.used.toLocaleString('en-US')} estimated input + `
        + `${assessment.outputReserve.toLocaleString('en-US')} final output + `
        + `${assessment.reasoningReserve.toLocaleString('en-US')} reasoning), `
        + `which exceeds the ${assessment.capacity.toLocaleString('en-US')}-token `
        + `budget by ${overflow.toLocaleString('en-US')}. Use /clear to start `
        + 'a new conversation or /context to inspect the limits.',
        { title: 'context overflow', tone: 'warning' },
      );
      return;
    }
    let answer = '';
    let wroteChunk = false;
    let measurement;
    activeController = new AbortController();
    try {
      session.addUserMessage(question);
      measurement = metrics.begin(session.messages(), {
        outputReserve: assessment.outputReserve,
        reasoningBudget: assessment.reasoningReserve,
      });
      writeAssistantLabel();
      for await (const chunk of provider.stream(session.messages(), {
        signal: activeController.signal,
        maxTokens: assessment.reserve,
        reasoningBudget: assessment.reasoningReserve || undefined,
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
        const footer = metrics.formatFooter(record, {
          width: output.columns ?? 80,
          reasoning: currentReasoningLabel(),
        });
        output.write('\n');
        output.write(formatMetricsPanel(footer, {
          width: output.columns ?? 80,
          color,
          theme: selectedTheme,
          appearance: resolvedAppearance,
        }));
      }
      if (record.finishReason === 'length') {
        writeStatus(
          `The completion reached its ${assessment.reserve.toLocaleString('en-US')}-token `
          + 'combined reasoning/final limit and may be incomplete; this was reported '
          + 'by the provider. '
          + 'Use /clear if you need to recover conversation space.',
          { title: 'output limit', tone: 'warning' },
        );
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

    const context = line.match(/^\/context(?:\s+(.+))?$/i);
    if (context) {
      const requested = context[1]?.trim().toLowerCase();
      await refreshContextLimit();
      if (requested == null) {
        writeStatus(contextSummary(), { title: 'context' });
        return true;
      }
      if (requested === 'auto') {
        metrics.clearContextBudget();
        contextWarningShown = false;
        writeStatus(contextSummary('Session context budget returned to auto.'), {
          title: 'context',
          tone: 'success',
        });
        return true;
      }
      if (!/^\d+$/.test(requested)) {
        error.write('Usage: /context [tokens|auto]\n');
        return true;
      }
      try {
        metrics.setContextBudget(Number(requested), session.messages(), {
          reasoningBudget: currentReasoningBudget(),
        });
        contextWarningShown = false;
        writeStatus(contextSummary(
          `Session context budget set to ${Number(requested).toLocaleString('en-US')} tokens.`,
        ), { title: 'context', tone: 'success' });
      } catch (cause) {
        error.write(`Could not set context budget: ${cause.message}\n`);
      }
      return true;
    }

    const models = line.match(/^\/models?(?:\s+(.+))?$/i);
    if (models) {
      const args = models[1]?.trim().split(/\s+/) ?? [];
      const requested = args.shift();
      const options = parseModelOptions(args);
      if (!options) {
        error.write(
          'Usage: /models [id] [auto|on|off|low|medium|high] [clear|keep]\n',
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
              'Use /models <id> [auto|on|off|low|medium|high] [clear|keep] '
              + 'to select one.',
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
        const budgetChanges = options.reasoningBudget > 0
          && options.reasoningBudget !== previous?.reasoningBudget;
        if (
          (changes || budgetChanges)
          && historyChoiceRequired(requested, options.history)
        ) return true;
        try {
          const selected = await localServer.selectModel(requested, {
            reasoning: options.reasoning,
            reasoningBudget: options.reasoningBudget,
            onStatus: () => {},
          });
          runtimeHint = selected;
          if (changes || budgetChanges) {
            const historyMessage = applyHistoryChoice(options.history);
            metrics.setContextLimits({ server: selected.contextLimit });
            writeStatus(
              `Model changed to ${requested} · reasoning ${selected.reasoning}`
              + `${selected.reasoning === 'off' ? ''
                : `/${selected.reasoningLevel} (${selected.reasoningBudget} tok)`}. `
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
      const managed = managedModelSelection();
      if (!requested) {
        if (managed) {
          const configuration = localServer.configuration?.() ?? {};
          writeStatus(reasoningStatus({
            mode: configuration.reasoning ?? 'unknown',
            level: configuration.reasoningLevel,
            budget: configuration.reasoningBudget,
          }, { managed: true }), {
            title: 'reasoning',
          });
        } else {
          const info = typeof provider.reasoningInfo === 'function'
            ? await provider.reasoningInfo()
            : { mode: 'unknown', capability: 'unknown' };
          writeStatus(reasoningStatus(info), { title: 'reasoning' });
        }
        return true;
      }
      const selection = reasoningSelection(requested);
      if (!selection) {
        error.write('Usage: /reasoning [auto|on|off|low|medium|high]\n');
        return true;
      }
      if (managed) {
        if (typeof localServer.selectReasoning !== 'function') {
          error.write('Reasoning control is unavailable for this server.\n');
          return true;
        }
        const previous = localServer.configuration?.() ?? {};
        try {
          const selected = await localServer.selectReasoning(selection.mode, {
            reasoningBudget: selection.budget || previous.reasoningBudget,
            onStatus: () => {},
          });
          runtimeHint = selected;
          const modeChanged = selected.reasoning !== previous.reasoning;
          const budgetChanged = selected.reasoning !== 'off'
            && selected.reasoningBudget !== previous.reasoningBudget;
          if (modeChanged) {
            resetConversation();
            writeStatus(
              `Reasoning changed to ${selected.reasoning}`
              + `${selected.reasoning === 'off' ? ''
                : `/${selected.reasoningLevel} `
                  + `(${selected.reasoningBudget.toLocaleString('en-US')} tokens)`}. `
              + 'Conversation cleared. Reasoning content remains hidden.',
              { tone: 'success' },
            );
          } else if (budgetChanged) {
            writeStatus(
              `Reasoning level changed to ${selected.reasoningLevel} `
              + `(${selected.reasoningBudget.toLocaleString('en-US')} tokens). `
              + 'Conversation history kept.',
              { tone: 'success' },
            );
          } else {
            writeStatus(
              `Reasoning ${selected.reasoning === 'off'
                ? 'off'
                : `${selected.reasoningLevel} (${selected.reasoningBudget} tokens)`}`
              + ' is already active.',
            );
          }
          if (output.isTTY) await writeStartup();
        } catch (cause) {
          error.write(`Could not change reasoning: ${cause.message}\n`);
        }
        return true;
      }

      if (Object.hasOwn(REASONING_LEVELS, requested)) {
        error.write(
          'Reasoning token levels require the μgem-managed llama.cpp server; '
          + 'this external endpoint only has verified auto/on/off control.\n',
        );
        return true;
      }

      if (typeof provider.selectReasoning !== 'function') {
        error.write(
          'Could not change reasoning: the endpoint exposes no verifiable control.\n',
        );
        return true;
      }
      const previous = provider.reasoningConfiguration?.().mode ?? 'unknown';
      try {
        const selected = await provider.selectReasoning(selection.mode);
        runtimeHint = {
          ...runtimeHint,
          reasoning: selected.mode,
          reasoningControl: selected.capability,
        };
        if (selected.mode !== previous) {
          resetConversation();
          writeStatus(
            `Reasoning generation request changed to ${selected.mode}. `
            + 'Conversation cleared. Reasoning content remains hidden.',
            { tone: 'success' },
          );
        } else {
          writeStatus(
            `Reasoning generation request ${selected.mode} is already active.`,
          );
        }
        if (output.isTTY) await writeStartup();
      } catch (cause) {
        error.write(
          `Could not change reasoning: ${cause.message}. `
          + `Current request remains ${previous}.\n`,
        );
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
        writeStatus(metrics.formatStats(undefined, {
          reasoning: currentReasoningMode(),
        }), { title: 'stats' });
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
      if (runtimeHint.contextLimit != null) {
        metrics.setContextLimits({ server: runtimeHint.contextLimit });
      }
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

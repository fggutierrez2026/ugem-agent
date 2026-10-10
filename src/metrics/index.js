const UNAVAILABLE = 'unavailable';
export const DEFAULT_OUTPUT_RESERVE = 4_096;

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveTokenLimit(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function estimateTokens(value) {
  const characters = Array.from(String(value ?? '')).length;
  return characters === 0 ? 0 : Math.ceil(characters / 4);
}

function estimateMessages(messages) {
  return messages.reduce((total, message) => (
    total + estimateTokens(typeof message?.content === 'string' ? message.content : '')
  ), 0);
}

function reportedTokens(provider, usageKey, timingKey, legacyKey) {
  return tokenCount(provider.usage?.[usageKey])
    ?? tokenCount(provider.timings?.[timingKey])
    ?? tokenCount(provider[legacyKey]);
}

function sourced(value, source) {
  return Object.freeze({ value, source: value == null ? UNAVAILABLE : source });
}

function formatDecimal(value) {
  return value.toFixed(1);
}

function formatSeconds(value) {
  if (value == null) return 'N/A';
  if (value < 1) return `${Math.round(value * 1_000)} ms`;
  return `${formatDecimal(value)} s`;
}

function formatTokens(metric) {
  return metric.value == null ? 'N/A' : String(metric.value);
}

function formatRate(metric) {
  return metric.value == null ? 'N/A' : `${formatDecimal(metric.value)} tok/s`;
}

function withSource(value, metric) {
  return `${value} (${metric.source})`;
}

function formatInteger(value) {
  return value.toLocaleString('en-US');
}

export function formatContextDetails(context) {
  const used = tokenCount(context?.used) ?? 0;
  const capacity = positiveTokenLimit(context?.budget)
    ?? positiveTokenLimit(context?.serverLimit);
  if (capacity == null) {
    return `${formatInteger(used)} used · available N/A`;
  }
  const available = Math.max(0, capacity - used);
  return `${formatInteger(used)} used · ${formatInteger(available)} available`
    + ` · ${formatInteger(capacity)} total`;
}

export function formatContextBar(context, { width = 20 } = {}) {
  const barWidth = Number.isSafeInteger(width) && width > 0 ? width : 20;
  const used = tokenCount(context?.used) ?? 0;
  const capacity = positiveTokenLimit(context?.budget)
    ?? positiveTokenLimit(context?.serverLimit);
  if (capacity == null) {
    return `[${'░'.repeat(barWidth)}] limit N/A`;
  }

  const ratio = used / capacity;
  const filled = Math.min(barWidth, Math.max(0, Math.round(ratio * barWidth)));
  const percent = (ratio * 100).toFixed(1);
  return `[${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${percent}%`;
}

export function createMetrics({
  now = () => performance.now(),
  contextBudget = null,
  serverLimit = null,
  outputReserve = DEFAULT_OUTPUT_RESERVE,
  footer = true,
} = {}) {
  let latest = null;
  let footerEnabled = Boolean(footer);
  let knownBudget = positiveTokenLimit(contextBudget);
  let knownServerLimit = positiveTokenLimit(serverLimit);
  if (
    knownBudget != null
    && knownServerLimit != null
    && knownBudget > knownServerLimit
  ) knownBudget = null;
  const configuredOutputReserve = positiveTokenLimit(outputReserve)
    ?? DEFAULT_OUTPUT_RESERVE;
  let currentUsed = 0;
  let currentSource = 'estimated';

  function activeCapacity(override) {
    return positiveTokenLimit(override)
      ?? knownBudget
      ?? knownServerLimit;
  }

  function reservedOutputTokens(capacity = activeCapacity()) {
    if (capacity == null) return configuredOutputReserve;
    return Math.min(
      configuredOutputReserve,
      Math.max(1, Math.floor(capacity / 4)),
    );
  }

  function assessContext(messages = [], {
    capacity: override,
    reasoningBudget = 0,
  } = {}) {
    const capacity = activeCapacity(override);
    const used = estimateMessages(messages);
    const outputReserve = reservedOutputTokens(capacity);
    const reasoningReserve = tokenCount(reasoningBudget) ?? 0;
    const reserve = outputReserve + reasoningReserve;
    return Object.freeze({
      allowed: capacity == null || used + reserve <= capacity,
      used,
      capacity,
      outputReserve,
      reasoningReserve,
      reserve,
      required: used + reserve,
      available: capacity == null ? null : Math.max(0, capacity - used - reserve),
      source: 'estimated',
    });
  }

  function contextStatus() {
    const capacity = activeCapacity();
    return Object.freeze({
      used: currentUsed,
      budget: knownBudget,
      serverLimit: knownServerLimit,
      outputReserve: reservedOutputTokens(capacity),
      source: currentSource,
    });
  }

  function begin(messages = [], {
    outputReserve = null,
    reasoningBudget = 0,
  } = {}) {
    const startedAt = now();
    const completionOutputBudget = positiveTokenLimit(outputReserve)
      ?? reservedOutputTokens();
    const completionReasoningBudget = tokenCount(reasoningBudget) ?? 0;
    let firstContentAt = null;
    let output = '';
    const provider = {};

    return {
      addChunk(content) {
        if (typeof content !== 'string') return;
        if (content.length > 0 && firstContentAt == null) firstContentAt = now();
        output += content;
      },

      addProviderMetadata(metadata = {}) {
        if (metadata.usage && typeof metadata.usage === 'object') {
          provider.usage = { ...provider.usage, ...metadata.usage };
        }
        if (metadata.timings && typeof metadata.timings === 'object') {
          provider.timings = { ...provider.timings, ...metadata.timings };
        }
        const contextLimit = positiveTokenLimit(metadata.contextLimit);
        if (contextLimit != null) {
          knownServerLimit = contextLimit;
          if (knownBudget != null && knownBudget > knownServerLimit) {
            knownBudget = null;
          }
        }
        if (tokenCount(metadata.tokensPredicted) != null) {
          provider.tokensPredicted = metadata.tokensPredicted;
        }
        if (tokenCount(metadata.tokensEvaluated) != null) {
          provider.tokensEvaluated = metadata.tokensEvaluated;
        }
        if (typeof metadata.finishReason === 'string') {
          provider.finishReason = metadata.finishReason;
        }
      },

      finish() {
        const finishedAt = now();
        const latencySeconds = Math.max(0, finishedAt - startedAt) / 1_000;
        const ttftSeconds = firstContentAt == null
          ? null
          : Math.max(0, firstContentAt - startedAt) / 1_000;

        const reportedInput = reportedTokens(
          provider,
          'prompt_tokens',
          'prompt_n',
          'tokensEvaluated',
        );
        const reportedOutput = reportedTokens(
          provider,
          'completion_tokens',
          'predicted_n',
          'tokensPredicted',
        );
        const inputTokens = sourced(
          reportedInput ?? estimateMessages(messages),
          reportedInput == null ? 'estimated' : 'reported',
        );
        const outputTokens = sourced(
          reportedOutput ?? estimateTokens(output),
          reportedOutput == null ? 'estimated' : 'reported',
        );

        const reportedRate = finiteNonNegative(provider.timings?.predicted_per_second);
        const reportedGenerationMs = finiteNonNegative(provider.timings?.predicted_ms);
        const measuredGenerationSeconds = firstContentAt == null
          ? null
          : Math.max(0, finishedAt - firstContentAt) / 1_000;
        const generationSeconds = reportedGenerationMs == null
          ? measuredGenerationSeconds
          : reportedGenerationMs / 1_000;

        let generationRate = reportedRate;
        let generationRateSource = 'reported';
        if (generationRate == null && generationSeconds > 0) {
          generationRate = outputTokens.value / generationSeconds;
          if (outputTokens.source === 'estimated') {
            generationRateSource = 'estimated';
          } else {
            generationRateSource = reportedGenerationMs == null
              ? 'measured'
              : 'reported';
          }
        }
        const wallRate = latencySeconds > 0
          ? outputTokens.value / latencySeconds
          : null;
        const visibleOutputTokens = estimateTokens(output);
        const contextUsed = inputTokens.value + visibleOutputTokens;
        const contextSource = 'estimated';
        const generationContextUsed = inputTokens.value + outputTokens.value;
        const generationContextSource = inputTokens.source === 'reported'
          && outputTokens.source === 'reported'
          ? 'reported'
          : 'estimated';
        currentUsed = contextUsed;
        currentSource = contextSource;

        latest = Object.freeze({
          inputTokens,
          outputTokens,
          latency: sourced(latencySeconds, 'measured'),
          ttft: sourced(ttftSeconds, 'measured'),
          generationThroughput: sourced(generationRate, generationRateSource),
          wallThroughput: sourced(
            wallRate,
            outputTokens.source === 'reported' ? 'measured' : 'estimated',
          ),
          finishReason: provider.finishReason ?? null,
          completionBudget: Object.freeze({
            output: completionOutputBudget,
            reasoning: completionReasoningBudget,
            total: completionOutputBudget + completionReasoningBudget,
          }),
          context: Object.freeze({
            used: contextUsed,
            budget: knownBudget,
            serverLimit: knownServerLimit,
            source: contextSource,
          }),
          generationContext: Object.freeze({
            used: generationContextUsed,
            budget: knownBudget,
            serverLimit: knownServerLimit,
            source: generationContextSource,
          }),
        });
        return latest;
      },
    };
  }

  function formatStats(record = latest, { reasoning } = {}) {
    const reasoningLine = reasoning == null
      ? []
      : [`Reasoning generation request: ${reasoning}.`];
    if (!record) {
      return [
        ...reasoningLine,
        'Metrics: no completed answer yet.',
        `Per-answer footer: ${footerEnabled ? 'on' : 'off'}.`,
        '',
      ].join('\n');
    }
    const budget = record.context.budget ?? 'N/A';
    const limit = record.context.serverLimit ?? 'N/A';
    const contextBar = formatContextBar(record.context);
    const generationBar = formatContextBar(record.generationContext);
    return [
      ...reasoningLine,
      `Input tokens: ${withSource(formatTokens(record.inputTokens), record.inputTokens)}`,
      `Output tokens: ${withSource(formatTokens(record.outputTokens), record.outputTokens)}`,
      `Latency: ${withSource(formatSeconds(record.latency.value), record.latency)}`,
      `TTFT: ${withSource(formatSeconds(record.ttft.value), record.ttft)}`,
      `Generation throughput: ${withSource(formatRate(record.generationThroughput), record.generationThroughput)}`,
      `Wall throughput: ${withSource(formatRate(record.wallThroughput), record.wallThroughput)}`,
      `Context: ${contextBar} (${record.context.source})`,
      `         ${formatContextDetails(record.context)}`,
      `Generation peak: ${generationBar} (${record.generationContext.source})`,
      `                 ${formatContextDetails(record.generationContext)}`,
      `Context limits: ${budget} budget / ${limit} server`,
      `Final-output reserve: ${record.completionBudget.output} tokens`,
      `Reasoning budget: ${record.completionBudget.reasoning} tokens`,
      `Per-answer footer: ${footerEnabled ? 'on' : 'off'}.`,
      '',
    ].join('\n');
  }

  function formatFooter(record = latest, { width = 80, reasoning } = {}) {
    if (!record) return '';
    const barWidth = Math.max(10, Math.min(28, width - 28));
    const lines = [
      '  ── stats',
    ];
    if (reasoning != null) {
      lines.push(`  mode       reasoning request ${reasoning}`);
    }
    lines.push(
      `  response   ${formatTokens(record.outputTokens)} output tok (${record.outputTokens.source})`,
      `  speed      ${formatRate(record.generationThroughput)}`
        + ` (${record.generationThroughput.source}) · ${formatSeconds(record.latency.value)} wall`,
      `  context    ${formatContextBar(record.context, { width: barWidth })}`,
      `             ${formatContextDetails(record.context)} (${record.context.source})`,
      `  peak       ${formatContextBar(record.generationContext, { width: barWidth })}`,
      `             ${formatContextDetails(record.generationContext)}`
        + ` (${record.generationContext.source})`,
      `  budget     ${record.completionBudget.reasoning.toLocaleString('en-US')} reasoning`
        + ` + ${record.completionBudget.output?.toLocaleString('en-US') ?? 'N/A'} final tok`,
      '',
    );
    return lines.join('\n');
  }

  return {
    begin,
    latest: () => latest,
    formatStats,
    formatFooter,
    contextStatus,
    assessContext,
    footerEnabled: () => footerEnabled,
    setFooterEnabled(value) {
      footerEnabled = Boolean(value);
    },
    setContextLimits(limits = {}) {
      const serverChanged = Object.hasOwn(limits, 'server');
      const budget = Object.hasOwn(limits, 'budget')
        ? limits.budget
        : knownBudget;
      const server = serverChanged ? limits.server : knownServerLimit;
      knownBudget = positiveTokenLimit(budget);
      knownServerLimit = positiveTokenLimit(server);
      if (serverChanged && knownServerLimit == null) knownBudget = null;
      if (knownBudget != null && knownServerLimit != null) {
        if (knownBudget > knownServerLimit) knownBudget = null;
      }
    },
    setContextBudget(value, messages = [], { reasoningBudget = 0 } = {}) {
      const budget = positiveTokenLimit(value);
      if (budget == null) {
        throw new RangeError('Context budget must be a positive integer.');
      }
      if (knownServerLimit == null) {
        throw new RangeError(
          'The server context limit is unknown, so this budget cannot be validated.',
        );
      }
      if (budget > knownServerLimit) {
        throw new RangeError(
          `Context budget ${formatInteger(budget)} exceeds the confirmed server limit `
          + `${formatInteger(knownServerLimit)}.`,
        );
      }
      const assessment = assessContext(messages, {
        capacity: budget,
        reasoningBudget,
      });
      if (!assessment.allowed) {
        throw new RangeError(
          `Current conversation needs about ${formatInteger(assessment.required)} tokens `
          + 'including the completion reserve. Use /clear before lowering the budget.',
        );
      }
      knownBudget = budget;
      return contextStatus();
    },
    clearContextBudget() {
      knownBudget = null;
      return contextStatus();
    },
    resetContext() {
      latest = null;
      currentUsed = 0;
      currentSource = 'estimated';
    },
  };
}

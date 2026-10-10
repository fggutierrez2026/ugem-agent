import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMetrics,
  estimateTokens,
  formatContextBar,
  formatContextDetails,
} from '../src/metrics/index.js';

function clock(...values) {
  let index = 0;
  return () => values[index++];
}

test('reported provider usage and timings take precedence over estimates', () => {
  const metrics = createMetrics({
    now: clock(0, 100, 1_100),
    contextBudget: 4_096,
  });
  const measurement = metrics.begin([{ role: 'user', content: 'question' }]);
  measurement.addChunk('answer');
  measurement.addProviderMetadata({
    usage: { prompt_tokens: 20, completion_tokens: 5 },
    timings: { predicted_ms: 250, predicted_per_second: 20 },
    contextLimit: 8_192,
  });

  const result = measurement.finish();
  assert.deepEqual(result.inputTokens, { value: 20, source: 'reported' });
  assert.deepEqual(result.outputTokens, { value: 5, source: 'reported' });
  assert.deepEqual(result.ttft, { value: 0.1, source: 'measured' });
  assert.deepEqual(result.latency, { value: 1.1, source: 'measured' });
  assert.deepEqual(result.generationThroughput, {
    value: 20,
    source: 'reported',
  });
  assert.deepEqual(result.wallThroughput, {
    value: 5 / 1.1,
    source: 'measured',
  });
  assert.deepEqual(result.context, {
    used: 22,
    budget: 4_096,
    serverLimit: 8_192,
    source: 'estimated',
  });
  assert.deepEqual(result.generationContext, {
    used: 25,
    budget: 4_096,
    serverLimit: 8_192,
    source: 'reported',
  });
});

test('missing usage produces clearly labeled token and speed estimates', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100) });
  const measurement = metrics.begin([{ role: 'user', content: '12345678' }]);
  measurement.addChunk('12345678');
  const result = measurement.finish();

  assert.equal(estimateTokens('12345678'), 2);
  assert.deepEqual(result.inputTokens, { value: 2, source: 'estimated' });
  assert.deepEqual(result.outputTokens, { value: 2, source: 'estimated' });
  assert.deepEqual(result.generationThroughput, {
    value: 2,
    source: 'estimated',
  });
  assert.deepEqual(result.wallThroughput, {
    value: 2 / 1.1,
    source: 'estimated',
  });
  assert.match(metrics.formatStats(), /N\/A budget \/ N\/A server/);
  assert.match(metrics.formatStats(), /estimated/);
});

test('generation speed derived from provider tokens and duration stays reported', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100) });
  const measurement = metrics.begin([{ role: 'user', content: 'question' }]);
  measurement.addChunk('answer');
  measurement.addProviderMetadata({
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    timings: { predicted_ms: 250 },
  });

  assert.deepEqual(measurement.finish().generationThroughput, {
    value: 20,
    source: 'reported',
  });
});

test('unavailable measurements render as N/A instead of invented values', () => {
  const metrics = createMetrics({ now: clock(0, 1_000) });
  const result = metrics.begin([]).finish();

  assert.deepEqual(result.ttft, { value: null, source: 'unavailable' });
  assert.deepEqual(result.generationThroughput, {
    value: null,
    source: 'unavailable',
  });
  assert.match(metrics.formatStats(), /TTFT: N\/A \(unavailable\)/);
  assert.match(
    metrics.formatStats(),
    /Generation throughput: N\/A \(unavailable\)/,
  );
});

test('the concise footer is optional and retains metric provenance', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100), footer: true });
  const measurement = metrics.begin([{ role: 'user', content: '1234' }]);
  measurement.addChunk('1234');
  const result = measurement.finish();

  assert.equal(metrics.footerEnabled(), true);
  assert.equal(
    metrics.formatFooter(result),
    '  ── stats\n'
      + '  response   1 output tok (estimated)\n'
      + '  speed      1.0 tok/s (estimated) · 1.1 s wall\n'
      + '  context    [░░░░░░░░░░░░░░░░░░░░░░░░░░░░] limit N/A\n'
      + '             2 used · available N/A (estimated)\n'
      + '  peak       [░░░░░░░░░░░░░░░░░░░░░░░░░░░░] limit N/A\n'
      + '             2 used · available N/A (estimated)\n'
      + '  budget     0 reasoning + 4,096 final tok\n',
  );
  metrics.setFooterEnabled(false);
  assert.equal(metrics.footerEnabled(), false);
});

test('the per-answer metrics footer is enabled by default', () => {
  const metrics = createMetrics();

  assert.equal(metrics.footerEnabled(), true);
  assert.match(metrics.formatStats(), /Per-answer footer: on/);
});

test('the footer can identify the selected reasoning mode', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100) });
  const measurement = metrics.begin([{ role: 'user', content: '1234' }]);
  measurement.addChunk('1234');

  assert.match(
    metrics.formatFooter(measurement.finish(), { reasoning: 'off' }),
    /mode\s+reasoning request off/,
  );
  assert.match(
    metrics.formatStats(undefined, { reasoning: 'unknown' }),
    /Reasoning generation request: unknown/,
  );
});

test('context bars show known progress and remain honest without a limit', () => {
  assert.equal(
    formatContextBar({ used: 2_048, budget: 8_192 }, { width: 8 }),
    '[██░░░░░░] 25.0%',
  );
  assert.equal(
    formatContextBar({ used: 250, budget: null, serverLimit: null }, { width: 8 }),
    '[░░░░░░░░] limit N/A',
  );
  assert.equal(
    formatContextDetails({ used: 2_048, budget: 8_192 }),
    '2,048 used · 6,144 available · 8,192 total',
  );
});

test('clearing a session resets current context and its last metrics', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100), serverLimit: 8_192 });
  const measurement = metrics.begin([{ role: 'user', content: '1234' }]);
  measurement.addChunk('1234');
  measurement.finish();

  assert.equal(metrics.contextStatus().used, 2);
  assert.notEqual(metrics.latest(), null);
  metrics.resetContext();
  assert.equal(metrics.contextStatus().used, 0);
  assert.equal(metrics.latest(), null);
  assert.match(metrics.formatStats(), /no completed answer yet/);
});

test('session context budgets are validated against confirmed server limits', () => {
  const unknown = createMetrics();
  assert.throws(
    () => unknown.setContextBudget(4_096),
    /server context limit is unknown/,
  );

  const metrics = createMetrics({ serverLimit: 8_192 });
  assert.throws(
    () => metrics.setContextBudget(16_384),
    /exceeds the confirmed server limit 8,192/,
  );
  metrics.setContextBudget(4_096);
  assert.equal(metrics.contextStatus().budget, 4_096);
  assert.equal(metrics.contextStatus().outputReserve, 1_024);
  metrics.clearContextBudget();
  assert.equal(metrics.contextStatus().budget, null);
});

test('context assessment reserves output and rejects estimated overflow', () => {
  const metrics = createMetrics({ serverLimit: 16, outputReserve: 8 });
  const allowed = metrics.assessContext([
    { role: 'user', content: '12345678901234567890' },
  ]);
  assert.deepEqual(allowed, {
    allowed: true,
    used: 5,
    capacity: 16,
    outputReserve: 4,
    reasoningReserve: 0,
    reserve: 4,
    required: 9,
    available: 7,
    source: 'estimated',
  });

  const overflow = metrics.assessContext([
    { role: 'user', content: 'x'.repeat(52) },
  ]);
  assert.equal(overflow.allowed, false);
  assert.equal(overflow.required, 17);
});

test('large context windows reserve enough room for reasoning and final output', () => {
  const metrics = createMetrics({ serverLimit: 32_768 });
  const assessment = metrics.assessContext([], { reasoningBudget: 4_096 });

  assert.equal(metrics.contextStatus().outputReserve, 4_096);
  assert.deepEqual(assessment, {
    allowed: true,
    used: 0,
    capacity: 32_768,
    outputReserve: 4_096,
    reasoningReserve: 4_096,
    reserve: 8_192,
    required: 8_192,
    available: 24_576,
    source: 'estimated',
  });
});

test('generation peak includes reported hidden reasoning while retained context does not', () => {
  const metrics = createMetrics({
    now: clock(0, 100, 1_100),
    serverLimit: 32_768,
  });
  const measurement = metrics.begin([
    { role: 'user', content: 'question' },
  ], { outputReserve: 4_096, reasoningBudget: 4_096 });
  measurement.addChunk('done');
  measurement.addProviderMetadata({
    usage: { prompt_tokens: 20, completion_tokens: 1_024 },
  });
  const result = measurement.finish();

  assert.equal(result.context.used, 21);
  assert.equal(result.generationContext.used, 1_044);
  assert.equal(result.generationContext.source, 'reported');
  assert.match(metrics.formatFooter(), /peak\s+\[█/);
  assert.match(metrics.formatFooter(), /1,044 used/);
  assert.match(metrics.formatFooter(), /4,096 reasoning \+ 4,096 final tok/);
});

test('a smaller server limit clears an incompatible session budget', () => {
  const metrics = createMetrics({ serverLimit: 8_192, contextBudget: 4_096 });
  metrics.setContextLimits({ server: 2_048 });

  assert.equal(metrics.contextStatus().budget, null);
  assert.equal(metrics.contextStatus().serverLimit, 2_048);
});

test('losing the confirmed server limit clears the validated session budget', () => {
  const metrics = createMetrics({ serverLimit: 8_192, contextBudget: 4_096 });
  metrics.setContextLimits({ server: null });

  assert.equal(metrics.contextStatus().budget, null);
  assert.equal(metrics.contextStatus().serverLimit, null);
});

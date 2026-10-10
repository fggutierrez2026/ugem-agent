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
      + '             2 used · available N/A (estimated)\n',
  );
  metrics.setFooterEnabled(false);
  assert.equal(metrics.footerEnabled(), false);
});

test('the footer can identify the selected reasoning mode', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100) });
  const measurement = metrics.begin([{ role: 'user', content: '1234' }]);
  measurement.addChunk('1234');

  assert.match(
    metrics.formatFooter(measurement.finish(), { reasoning: 'off' }),
    /mode\s+reasoning off/,
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

test('clearing a session resets current context without deleting last metrics', () => {
  const metrics = createMetrics({ now: clock(0, 100, 1_100), serverLimit: 8_192 });
  const measurement = metrics.begin([{ role: 'user', content: '1234' }]);
  measurement.addChunk('1234');
  const latest = measurement.finish();

  assert.equal(metrics.contextStatus().used, 2);
  metrics.resetContext();
  assert.equal(metrics.contextStatus().used, 0);
  assert.equal(metrics.latest(), latest);
});

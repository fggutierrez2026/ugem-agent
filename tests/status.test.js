import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMetricsPanel,
  formatStartupPanel,
  formatStatusPanel,
} from '../src/cli/status.js';

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

test('colored startup panel emphasizes identity and color-codes parameters', () => {
  const panel = formatStartupPanel({
    width: 64,
    model: 'qwen3.5-4b',
    modelSource: 'provider',
    status: 'ready',
    reasoning: 'off',
    context: { used: 1_000, serverLimit: 10_000 },
    color: true,
  });

  assert.match(panel, /\u001b\[1m\u001b\[34mμgem agent/);
  assert.match(panel, /\u001b\[34mmodel/);
  assert.match(panel, /\u001b\[32mqwen3\.5-4b/);
  assert.match(panel, /\[██░{22}\] 10\.0%/);
  for (const line of stripAnsi(panel).trimEnd().split('\n')) {
    assert.equal(Array.from(line).length, 64);
  }
});

test('theme palettes produce distinct framed status colors', () => {
  const forest = formatStatusPanel('Theme changed to forest.', {
    width: 64,
    title: 'theme',
    tone: 'success',
    theme: 'forest',
    color: true,
  });
  const violet = formatStatusPanel('Theme changed to violet.', {
    width: 64,
    title: 'theme',
    theme: 'violet',
    color: true,
  });

  assert.match(forest, /^\u001b\[32m┌─ theme/);
  assert.match(violet, /^\u001b\[36m┌─ theme/);
  assert.match(stripAnsi(forest), /└─+┘\n$/);
});

test('metrics are presented as an aligned status panel', () => {
  const footer = [
    '  ── stats',
    '  mode       reasoning off',
    '  speed      40.1 tok/s (reported) · 175 ms wall',
    '  context    [██░░░░░░] 25.0%',
    '             2,048 used · 6,144 available · 8,192 total (estimated)',
    '',
  ].join('\n');
  const panel = formatMetricsPanel(footer, { width: 72 });

  assert.match(panel, /^┌─ stats/);
  assert.match(panel, /│ speed\s+40\.1 tok\/s/);
  assert.match(panel, /│ context\s+\[██░░░░░░\] 25\.0%/);
  assert.match(panel, /│\s+2,048 used/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectTerminalAppearance,
  formatMetricsPanel,
  formatStartupPanel,
  formatStatusPanel,
  THEME_NAMES,
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

  assert.match(panel, /\u001b\[1m\u001b\[94mμgem agent/);
  assert.match(panel, /\u001b\[94mmodel/);
  assert.match(panel, /\u001b\[92mqwen3\.5-4b/);
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

  assert.match(forest, /^\u001b\[92m┌─ theme/);
  assert.match(violet, /^\u001b\[96m┌─ theme/);
  assert.match(stripAnsi(forest), /└─+┘\n$/);
});

test('auto appearance uses terminal hints and falls back conservatively', () => {
  assert.equal(detectTerminalAppearance({ COLORFGBG: '15;0' }), 'dark');
  assert.equal(detectTerminalAppearance({ COLORFGBG: '0;15' }), 'light');
  assert.equal(detectTerminalAppearance({ TERM_BACKGROUND: 'light' }), 'light');
  assert.equal(detectTerminalAppearance({ GTK_THEME: 'Adwaita-dark' }), 'dark');
  assert.equal(detectTerminalAppearance({}), 'dark');
});

test('every palette stays aligned in dark, light, and no-color output', () => {
  for (const theme of THEME_NAMES) {
    for (const appearance of ['dark', 'light']) {
      for (const width of [40, 80]) {
        const panel = formatStartupPanel({
          width,
          model: 'qwen3.5-4b',
          modelSource: 'provider',
          status: 'ready',
          reasoning: 'auto',
          context: { used: 9_000, serverLimit: 10_000 },
          color: true,
          theme,
          appearance,
        });
        for (const line of stripAnsi(panel).trimEnd().split('\n')) {
          assert.equal(Array.from(line).length, Math.min(72, width));
        }
      }
    }
  }

  const plain = formatStatusPanel('Readable without ANSI.', {
    color: false,
    theme: 'violet',
    appearance: 'light',
  });
  assert.doesNotMatch(plain, /\u001b\[/);
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

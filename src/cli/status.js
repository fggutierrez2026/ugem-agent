import { formatContextBar, formatContextDetails } from '../metrics/index.js';

const ANSI = Object.freeze({
  blue: '\u001b[34m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  white: '\u001b[37m',
  yellow: '\u001b[33m',
});

const THEMES = Object.freeze({
  classic: Object.freeze({
    assistant: ANSI.green,
    border: ANSI.blue,
    context: ANSI.cyan,
    identity: ANSI.blue,
    info: ANSI.blue,
    label: ANSI.blue,
    model: ANSI.green,
    progress: ANSI.green,
    reasoning: ANSI.yellow,
    speed: ANSI.green,
    statsBorder: ANSI.blue,
    success: ANSI.green,
    user: ANSI.blue,
    warning: ANSI.yellow,
  }),
  ocean: Object.freeze({
    assistant: ANSI.blue,
    border: ANSI.blue,
    context: ANSI.cyan,
    identity: ANSI.blue,
    info: ANSI.cyan,
    label: ANSI.cyan,
    model: ANSI.blue,
    progress: ANSI.cyan,
    reasoning: ANSI.white,
    speed: ANSI.blue,
    statsBorder: ANSI.cyan,
    success: ANSI.cyan,
    user: ANSI.cyan,
    warning: ANSI.yellow,
  }),
  forest: Object.freeze({
    assistant: ANSI.yellow,
    border: ANSI.green,
    context: ANSI.green,
    identity: ANSI.green,
    info: ANSI.green,
    label: ANSI.green,
    model: ANSI.yellow,
    progress: ANSI.green,
    reasoning: ANSI.cyan,
    speed: ANSI.yellow,
    statsBorder: ANSI.green,
    success: ANSI.green,
    user: ANSI.green,
    warning: ANSI.yellow,
  }),
  violet: Object.freeze({
    assistant: ANSI.magenta,
    border: ANSI.magenta,
    context: ANSI.cyan,
    identity: ANSI.magenta,
    info: ANSI.cyan,
    label: ANSI.cyan,
    model: ANSI.green,
    progress: ANSI.green,
    reasoning: ANSI.yellow,
    speed: ANSI.magenta,
    statsBorder: ANSI.cyan,
    success: ANSI.green,
    user: ANSI.cyan,
    warning: ANSI.yellow,
  }),
  mono: Object.freeze({
    assistant: ANSI.bold,
    border: ANSI.dim,
    context: ANSI.bold,
    identity: ANSI.bold,
    info: ANSI.bold,
    label: ANSI.bold,
    model: ANSI.bold,
    progress: ANSI.bold,
    reasoning: ANSI.bold,
    speed: ANSI.bold,
    statsBorder: ANSI.dim,
    success: ANSI.bold,
    user: ANSI.bold,
    warning: ANSI.bold,
  }),
});

export const THEME_NAMES = Object.freeze(Object.keys(THEMES));

export function themePalette(name = 'classic') {
  return THEMES[name] ?? THEMES.classic;
}

function sanitize(value) {
  return String(value ?? 'unknown')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value) {
  return sanitize(value) || 'unknown';
}

function visibleLength(value) {
  return Array.from(value.replace(/\u001b\[[0-9;]*m/g, '')).length;
}

function fit(value, width) {
  const characters = Array.from(sanitize(value));
  if (characters.length <= width) return characters.join('').padEnd(width);
  if (width <= 1) return '…'.slice(0, width);
  return `${characters.slice(0, width - 1).join('')}…`;
}

function wrapText(value, width) {
  const words = clean(value).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (Array.from(`${current} ${word}`).length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(fit(current, width).trimEnd());
      current = word;
    }
  }
  if (current) lines.push(fit(current, width).trimEnd());
  return lines;
}

function paint(value, style, color) {
  return color ? `${style}${value}${ANSI.reset}` : value;
}

function paddedStyled(plain, styled, width) {
  const padding = Math.max(0, width - visibleLength(styled));
  return {
    plain: fit(plain, width),
    styled: visibleLength(styled) > width ? fit(plain, width) : styled + ' '.repeat(padding),
  };
}

function contextTone(context, palette) {
  const capacity = context?.budget ?? context?.serverLimit;
  if (!capacity) return ANSI.dim;
  const ratio = (context?.used ?? 0) / capacity;
  if (ratio >= 0.9) return ANSI.red;
  if (ratio >= 0.7) return palette.warning;
  return palette.progress;
}

function box({ width, color, title = '', tone = ANSI.cyan, lines }) {
  const boxWidth = Math.max(20, Math.min(72, width));
  const contentWidth = boxWidth - 4;
  const safeTitle = fit(title, Math.max(0, boxWidth - 8)).trim();
  const topInner = safeTitle
    ? `─ ${safeTitle} ${'─'.repeat(Math.max(0, boxWidth - safeTitle.length - 5))}`
    : '─'.repeat(boxWidth - 2);
  const border = (value) => paint(value, tone, color);
  const output = [border(`┌${topInner}┐`)];
  for (const line of lines) {
    const normalized = typeof line === 'string'
      ? paddedStyled(line, line, contentWidth)
      : paddedStyled(line.plain, line.styled, contentWidth);
    output.push(`${border('│')} ${normalized.styled} ${border('│')}`);
  }
  output.push(border(`└${'─'.repeat(boxWidth - 2)}┘`), '');
  return output.join('\n');
}

function dataLine(label, value, {
  color,
  contentWidth,
  labelStyle = ANSI.cyan,
  valueStyle = ANSI.green,
} = {}) {
  const prefix = `${label.padEnd(11)} `;
  const safeValue = fit(value, Math.max(1, contentWidth - prefix.length)).trimEnd();
  return {
    plain: `${prefix}${safeValue}`,
    styled: `${paint(prefix, labelStyle, color)}${paint(safeValue, valueStyle, color)}`,
  };
}

export function formatStartupPanel({
  width = 80,
  model = 'unknown',
  modelSource = 'configured',
  status = 'unknown',
  reasoning = 'unknown',
  context = {},
  color = false,
  theme = 'classic',
} = {}) {
  const palette = themePalette(theme);
  const availableWidth = Number.isSafeInteger(width) ? width : 80;
  const boxWidth = Math.max(20, Math.min(72, availableWidth));
  const contentWidth = boxWidth - 4;
  const header = 'μgem agent  /  Q&A';
  const headerStyled = color
    ? `${ANSI.bold}${palette.identity}μgem agent${ANSI.reset}${ANSI.dim}  /  Q&A${ANSI.reset}`
    : header;
  const bar = formatContextBar(context, { width: Math.min(24, contentWidth - 12) });
  return box({
    width: availableWidth,
    color,
    tone: palette.border,
    lines: [
      { plain: header, styled: headerStyled },
      dataLine('model', `${clean(model)} (${clean(modelSource)}, ${clean(status)})`, {
        color,
        contentWidth,
        labelStyle: palette.label,
        valueStyle: palette.model,
      }),
      dataLine('reasoning', clean(reasoning), {
        color,
        contentWidth,
        labelStyle: palette.label,
        valueStyle: reasoning === 'off' ? ANSI.dim : palette.reasoning,
      }),
      dataLine('context', formatContextDetails(context), {
        color,
        contentWidth,
        labelStyle: palette.label,
        valueStyle: palette.context,
      }),
      dataLine('', bar, {
        color,
        contentWidth,
        labelStyle: palette.label,
        valueStyle: contextTone(context, palette),
      }),
    ],
  });
}

function metricLine(line, color, palette) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(mode|response|speed|context)\s+(.*)$/);
  if (!match) {
    const prefix = /^\s/.test(line) ? ' '.repeat(11) : '';
    return {
      plain: `${prefix}${trimmed}`,
      styled: `${prefix}${paint(trimmed, palette.context, color)}`,
    };
  }
  const [, label, value] = match;
  const prefix = label.padEnd(11);
  const percent = Number(value.match(/(\d+(?:\.\d+)?)%/)?.[1]);
  const styles = {
    mode: palette.reasoning,
    response: palette.model,
    speed: palette.speed,
    context: percent >= 90 ? ANSI.red : palette.context,
  };
  return {
    plain: `${prefix}${value}`,
    styled: `${paint(prefix, palette.label, color)}${paint(value, styles[label], color)}`,
  };
}

export function formatMetricsPanel(footer, {
  width = 80,
  color = false,
  theme = 'classic',
} = {}) {
  const palette = themePalette(theme);
  const lines = String(footer)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && line.trim() !== '── stats')
    .map((line) => metricLine(line, color, palette));
  return box({ width, color, title: 'stats', tone: palette.statsBorder, lines });
}

export function formatStatusPanel(message, {
  width = 80,
  color = false,
  title = 'status',
  tone = 'info',
  theme = 'classic',
} = {}) {
  const palette = themePalette(theme);
  const tones = {
    info: palette.info,
    success: palette.success,
    warning: palette.warning,
  };
  const style = tones[tone] ?? tones.info;
  const contentWidth = Math.max(16, Math.min(68, width - 4));
  const lines = String(message)
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => wrapText(line, contentWidth))
    .map((line) => ({
      plain: line,
      styled: paint(line, style, color),
    }));
  return box({ width, color, title, tone: style, lines });
}

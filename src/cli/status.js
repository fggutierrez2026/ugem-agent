import { formatContextBar, formatContextDetails } from '../metrics/index.js';

const ANSI = Object.freeze({
  black: '\u001b[30m',
  blue: '\u001b[34m',
  bold: '\u001b[1m',
  brightBlue: '\u001b[94m',
  brightCyan: '\u001b[96m',
  brightGreen: '\u001b[92m',
  brightMagenta: '\u001b[95m',
  brightRed: '\u001b[91m',
  brightWhite: '\u001b[97m',
  brightYellow: '\u001b[93m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  white: '\u001b[37m',
  yellow: '\u001b[33m',
});

function buildThemes(colors) {
  return Object.freeze({
    classic: Object.freeze({
      assistant: colors.green,
      border: colors.blue,
      context: colors.cyan,
      danger: colors.red,
      identity: colors.blue,
      info: colors.blue,
      label: colors.blue,
      model: colors.green,
      muted: colors.muted,
      progress: colors.green,
      reasoning: colors.yellow,
      speed: colors.green,
      statsBorder: colors.blue,
      success: colors.green,
      user: colors.blue,
      warning: colors.yellow,
    }),
    ocean: Object.freeze({
      assistant: colors.blue,
      border: colors.blue,
      context: colors.cyan,
      danger: colors.red,
      identity: colors.blue,
      info: colors.cyan,
      label: colors.cyan,
      model: colors.blue,
      muted: colors.muted,
      progress: colors.cyan,
      reasoning: colors.neutral,
      speed: colors.blue,
      statsBorder: colors.cyan,
      success: colors.cyan,
      user: colors.cyan,
      warning: colors.yellow,
    }),
    forest: Object.freeze({
      assistant: colors.yellow,
      border: colors.green,
      context: colors.green,
      danger: colors.red,
      identity: colors.green,
      info: colors.green,
      label: colors.green,
      model: colors.yellow,
      muted: colors.muted,
      progress: colors.green,
      reasoning: colors.cyan,
      speed: colors.yellow,
      statsBorder: colors.green,
      success: colors.green,
      user: colors.green,
      warning: colors.yellow,
    }),
    violet: Object.freeze({
      assistant: colors.magenta,
      border: colors.magenta,
      context: colors.cyan,
      danger: colors.red,
      identity: colors.magenta,
      info: colors.cyan,
      label: colors.cyan,
      model: colors.green,
      muted: colors.muted,
      progress: colors.green,
      reasoning: colors.yellow,
      speed: colors.magenta,
      statsBorder: colors.cyan,
      success: colors.green,
      user: colors.cyan,
      warning: colors.yellow,
    }),
    mono: Object.freeze({
      assistant: ANSI.bold,
      border: ANSI.dim,
      context: ANSI.bold,
      danger: ANSI.bold,
      identity: ANSI.bold,
      info: ANSI.bold,
      label: ANSI.bold,
      model: ANSI.bold,
      muted: ANSI.dim,
      progress: ANSI.bold,
      reasoning: ANSI.bold,
      speed: ANSI.bold,
      statsBorder: ANSI.dim,
      success: ANSI.bold,
      user: ANSI.bold,
      warning: ANSI.bold,
    }),
  });
}

const DARK_THEMES = buildThemes({
  blue: ANSI.brightBlue,
  cyan: ANSI.brightCyan,
  green: ANSI.brightGreen,
  magenta: ANSI.brightMagenta,
  muted: ANSI.dim,
  neutral: ANSI.brightWhite,
  red: ANSI.brightRed,
  yellow: ANSI.brightYellow,
});

const LIGHT_THEMES = buildThemes({
  blue: ANSI.blue,
  cyan: ANSI.cyan,
  green: ANSI.green,
  magenta: ANSI.magenta,
  muted: `${ANSI.dim}${ANSI.black}`,
  neutral: ANSI.black,
  red: ANSI.red,
  yellow: ANSI.magenta,
});

export const APPEARANCE_MODES = Object.freeze(['auto', 'dark', 'light']);
export const THEME_NAMES = Object.freeze(Object.keys(DARK_THEMES));

export function detectTerminalAppearance(env = process.env) {
  const hint = [
    env.TERM_BACKGROUND,
    env.TERMINAL_THEME,
    env.COLOR_SCHEME,
    env.GTK_THEME,
  ].filter(Boolean).join(' ').toLowerCase();
  if (hint.includes('light')) return 'light';
  if (hint.includes('dark')) return 'dark';

  const background = String(env.COLORFGBG ?? '').split(';').at(-1);
  if (/^\d+$/.test(background)) {
    return Number(background) >= 8 ? 'light' : 'dark';
  }
  return 'dark';
}

export function resolveAppearance(mode = 'auto', env = process.env) {
  if (mode === 'dark' || mode === 'light') return mode;
  return detectTerminalAppearance(env);
}

export function themePalette(name = 'classic', appearance = 'dark') {
  const themes = appearance === 'light' ? LIGHT_THEMES : DARK_THEMES;
  return themes[name] ?? themes.classic;
}

// ANSI styling affects only μgem output; it never changes the host terminal.

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
  if (ratio >= 0.9) return palette.danger;
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
  appearance = 'dark',
} = {}) {
  const palette = themePalette(theme, appearance);
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
        valueStyle: reasoning === 'off' ? palette.muted : palette.reasoning,
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
  const match = trimmed.match(/^(mode|response|speed|context|peak|budget)\s+(.*)$/);
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
    context: percent >= 90 ? palette.danger : palette.context,
    peak: percent >= 90 ? palette.danger : palette.warning,
    budget: palette.reasoning,
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
  appearance = 'dark',
} = {}) {
  const palette = themePalette(theme, appearance);
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
  appearance = 'dark',
} = {}) {
  const palette = themePalette(theme, appearance);
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

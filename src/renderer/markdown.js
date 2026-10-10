import { renderMath } from './math.js';

const ANSI_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)?)/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const CODE_PATTERN = /(`{1,3})([^`\n]+?)\1/g;
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\n]+\)|\\\([^\n]+?\\\)|\$[^$\n]+\$)/g;
const REMAINING_MATH_PATTERN = /(\\\([^\n]+?\\\)|\$[^$\n]+\$)/g;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  dim: '\x1b[2m',
  code: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  yellow: '\x1b[33m',
};

const CODE_COLORS = Object.freeze({
  auto: ANSI.green,
  blue: ANSI.blue,
  cyan: ANSI.code,
  green: ANSI.green,
  magenta: ANSI.magenta,
  red: ANSI.red,
  white: ANSI.white,
  yellow: ANSI.yellow,
});

export function sanitizeTerminalText(value) {
  return String(value).replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '');
}

function styled(value, code, color) {
  return color ? `${code}${value}${ANSI.reset}` : value;
}

export function renderInline(source, { color = false } = {}) {
  const protectedCode = [];
  const prepared = source.replace(CODE_PATTERN, (token, fence, code) => {
    let value;
    if (code) {
      const dollarMath = code.match(/^\$([^$]+)\$$/);
      const bracketMath = code.match(/^\\\((.+)\\\)$/);
      value = dollarMath || bracketMath
        ? renderMath((dollarMath ?? bracketMath)[1])
        : styled(code, ANSI.code, color);
    }
    const index = protectedCode.push(value) - 1;
    return `\u0000${index}\u0000`;
  });

  const nested = prepared.replace(INLINE_PATTERN, (token) => {
    if (token.startsWith('**') || token.startsWith('__')) {
      return styled(renderInline(token.slice(2, -2), { color }), ANSI.bold, color);
    }
    if (token.startsWith('*') || token.startsWith('_')) {
      return styled(renderInline(token.slice(1, -1), { color }), ANSI.italic, color);
    }
    if (token.startsWith('[')) {
      const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      return `${renderInline(match[1], { color })} (${match[2]})`;
    }
    if (token.startsWith('\\(')) return renderMath(token.slice(2, -2));
    return renderMath(token.slice(1, -1));
  });

  return nested
    .replace(REMAINING_MATH_PATTERN, (token) => {
      return token.startsWith('\\(')
        ? renderMath(token.slice(2, -2))
        : renderMath(token.slice(1, -1));
    })
    .replace(/\u0000(\d+)\u0000/g, (token, index) => protectedCode[Number(index)]);
}

function characterWidth(character) {
  const point = character.codePointAt(0);
  if (point >= 0x1100 && (
    point <= 0x115f || point === 0x2329 || point === 0x232a
    || (point >= 0x2e80 && point <= 0xa4cf)
    || (point >= 0xac00 && point <= 0xd7a3)
    || (point >= 0xf900 && point <= 0xfaff)
    || (point >= 0xfe10 && point <= 0xfe6f)
    || (point >= 0xff00 && point <= 0xff60)
    || (point >= 0x1f300 && point <= 0x1faff)
  )) return 2;
  return 1;
}

export function visibleWidth(value) {
  return [...value.replace(ANSI_PATTERN, '')]
    .reduce((width, character) => width + characterWidth(character), 0);
}

function sliceWidth(value, width) {
  let result = '';
  let used = 0;
  for (const character of value) {
    const size = characterWidth(character);
    if (used + size > width) break;
    result += character;
    used += size;
  }
  return result;
}

export function wrapText(value, width) {
  if (width <= 1) return [value];
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let line = '';

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      let remaining = word;
      while (visibleWidth(remaining) > width) {
        const piece = sliceWidth(remaining, width);
        lines.push(piece);
        remaining = remaining.slice(piece.length);
      }
      line = remaining;
    } else if (!line) line = word;
    else if (visibleWidth(`${line} ${word}`) <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function parseTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(rows, width, color) {
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from(
    { length: columns },
    (_, index) => renderInline(row[index] ?? '', { color: false }),
  ));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(
    3,
    ...normalized.map((row) => visibleWidth(row[column])),
  ));
  const available = Math.max(columns * 3, width - (columns - 1) * 3);
  while (widths.reduce((sum, cell) => sum + cell, 0) > available) {
    const largest = Math.max(...widths);
    const index = widths.indexOf(largest);
    if (largest <= 3) break;
    widths[index] -= 1;
  }

  const output = [];
  normalized.forEach((row, rowIndex) => {
    const wrapped = row.map((cell, column) => wrapText(cell, widths[column]));
    const height = Math.max(...wrapped.map((cell) => cell.length));
    for (let line = 0; line < height; line += 1) {
      const cells = wrapped.map((cell, column) => {
        const content = cell[line] ?? '';
        return content + ' '.repeat(widths[column] - visibleWidth(content));
      });
      const rendered = cells.join(' │ ').trimEnd();
      output.push(rowIndex === 0 ? styled(rendered, ANSI.bold, color) : rendered);
    }
    if (rowIndex === 0) {
      output.push(widths.map((cell) => '─'.repeat(cell)).join('─┼─'));
    }
  });
  return output;
}

export function createMarkdownStream({
  write,
  width,
  color = false,
  codeColor = 'green',
}) {
  let buffer = '';
  let pendingLine;
  let codeBlock = false;
  let codeLanguage = '';
  let codeLines = [];
  let tableRows;
  let mathLines;

  function terminalWidth() {
    return Math.max(20, Number(width()) || 80);
  }

  function emitWrapped(
    text,
    firstPrefix = '',
    nextPrefix = firstPrefix,
    style,
    { inline = true } = {},
  ) {
    const firstWidth = Math.max(1, terminalWidth() - visibleWidth(firstPrefix));
    const nextWidth = Math.max(1, terminalWidth() - visibleWidth(nextPrefix));
    const plain = inline ? renderInline(text, { color: false }) : text;
    const lines = wrapText(plain, Math.min(firstWidth, nextWidth));
    lines.forEach((line, index) => {
      const prefix = index === 0 ? firstPrefix : nextPrefix;
      const content = lines.length === 1
        ? (inline ? renderInline(text, { color }) : text)
        : line;
      write(`${prefix}${style ? styled(content, style, color) : content}\n`);
    });
  }

  function flushTable() {
    if (!tableRows) return;
    for (const line of renderTable(tableRows, terminalWidth(), color)) write(`${line}\n`);
    tableRows = undefined;
  }

  function emitMath(expression) {
    emitWrapped(renderMath(expression), '  ', '  ', ANSI.dim, { inline: false });
  }

  function splitCodeLine(line, widthLimit) {
    if (line === '') return [''];
    const lines = [];
    let current = '';
    let used = 0;
    for (const character of line) {
      const size = characterWidth(character);
      if (current && used + size > widthLimit) {
        lines.push(current);
        current = '';
        used = 0;
      }
      current += character;
      used += size;
    }
    if (current) lines.push(current);
    return lines;
  }

  function emitCodeBlock() {
    const boxWidth = terminalWidth();
    const contentWidth = Math.max(1, boxWidth - 4);
    const language = sanitizeTerminalText(codeLanguage).trim();
    const title = language ? `─ ${sliceWidth(language, boxWidth - 7)} ` : '─';
    const top = `┌${title}${'─'.repeat(Math.max(0, boxWidth - title.length - 2))}┐`;
    const borderStyle = ANSI.dim;
    const contentStyle = CODE_COLORS[codeColor] ?? CODE_COLORS.green;
    write(`${styled(top, borderStyle, color)}\n`);
    const visualLines = codeLines.flatMap((line) => splitCodeLine(line, contentWidth));
    for (const line of visualLines.length > 0 ? visualLines : ['']) {
      const padding = ' '.repeat(Math.max(0, contentWidth - visibleWidth(line)));
      write(
        `${styled('│', borderStyle, color)} `
        + `${styled(line + padding, contentStyle, color)} `
        + `${styled('│', borderStyle, color)}\n`,
      );
    }
    write(`${styled(`└${'─'.repeat(boxWidth - 2)}┘`, borderStyle, color)}\n`);
    codeLines = [];
    codeLanguage = '';
  }

  function processLine(line) {
    const fence = line.match(/^\s*```\s*([^\s`]*)/);
    if (codeBlock) {
      if (fence) {
        codeBlock = false;
        emitCodeBlock();
      } else codeLines.push(line);
      return;
    }
    if (fence) {
      codeBlock = true;
      codeLanguage = fence[1] ?? '';
      codeLines = [];
      return;
    }

    if (mathLines) {
      const close = line.indexOf('$$');
      if (close === -1) mathLines.push(line);
      else {
        mathLines.push(line.slice(0, close));
        emitMath(mathLines.join('\n'));
        mathLines = undefined;
        if (line.slice(close + 2).trim()) processLine(line.slice(close + 2));
      }
      return;
    }
    const display = line.match(/^\s*\$\$(.*)$/);
    if (display) {
      const close = display[1].indexOf('$$');
      if (close === -1) mathLines = [display[1]];
      else emitMath(display[1].slice(0, close));
      return;
    }
    const bracketMath = line.match(/^\s*\\\[(.*)\\\]\s*$/);
    if (bracketMath) {
      emitMath(bracketMath[1]);
      return;
    }

    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      write(`${styled('─'.repeat(terminalWidth()), ANSI.dim, color)}\n`);
      return;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      emitWrapped(heading[2], '  ', '  ', ANSI.bold);
      return;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      emitWrapped(quote[1], '│ ', '│ ', ANSI.italic);
      return;
    }
    const list = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const indent = '  '.repeat(Math.floor(list[1].length / 2));
      const marker = /^\d/.test(list[2]) ? `${list[2].replace(')', '.')} ` : '• ';
      const prefix = `${indent}${marker}`;
      emitWrapped(list[3], prefix, ' '.repeat(visibleWidth(prefix)));
      return;
    }
    if (line.trim() === '') {
      write('\n');
      return;
    }
    emitWrapped(line);
  }

  function acceptLine(line) {
    if (tableRows) {
      if (line.includes('|') && line.trim() !== '') tableRows.push(parseTableRow(line));
      else {
        flushTable();
        processLine(line);
      }
      return;
    }
    if (pendingLine !== undefined) {
      if (pendingLine.includes('|') && isTableSeparator(line)) {
        tableRows = [parseTableRow(pendingLine)];
        pendingLine = undefined;
        return;
      }
      processLine(pendingLine);
    }
    pendingLine = line;
  }

  function processCompleteLines() {
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      acceptLine(line);
    }
  }

  return {
    write(chunk) {
      buffer += sanitizeTerminalText(chunk);
      processCompleteLines();
    },
    end() {
      if (buffer) acceptLine(buffer.replace(/\r$/, ''));
      buffer = '';
      if (pendingLine !== undefined) processLine(pendingLine);
      pendingLine = undefined;
      flushTable();
      if (mathLines) {
        write(`$$${mathLines.join('\n')}\n`);
        mathLines = undefined;
      }
      if (codeBlock) {
        emitCodeBlock();
        codeBlock = false;
      }
    },
  };
}

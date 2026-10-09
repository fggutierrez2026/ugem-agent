import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../src/renderer/index.js';
import { renderInline, visibleWidth } from '../src/renderer/markdown.js';

const SAMPLE = `# Heading

A **bold** and *soft* [link](https://example.test) with \`code\`.

> Quoted text

1. Parent item
   - Nested item

| Name | Description |
| --- | --- |
| Alpha | A deliberately long table value that must wrap on narrow terminals |

\`\`\`js
  const value = 42;
\`\`\`

Inline $E = mc^2$.

$$\\frac{a}{b} \\leq \\sqrt{x}$$

Unsupported $\\begin{matrix}a&b\\end{matrix}$.`;

function render(source, { columns = 80, color = false, chunks } = {}) {
  const output = {
    columns,
    text: '',
    write(value) {
      this.text += value;
    },
  };
  const renderer = createRenderer({ output, color });
  if (chunks) {
    for (const chunk of chunks) renderer.writeChunk(chunk);
    renderer.endAnswer();
  } else renderer.writeAnswer(source);
  return output.text;
}

for (const columns of [40, 80, 120]) {
  test(`renderer matches the ${columns}-column golden output`, async () => {
    const path = fileURLToPath(new URL(`golden/renderer-${columns}.txt`, import.meta.url));
    assert.equal(render(SAMPLE, { columns }), await readFile(path, 'utf8'));
  });
}

test('arbitrary streaming splits never lose or duplicate rendered content', () => {
  const expected = render(SAMPLE, { columns: 40 });
  for (let size = 1; size <= 17; size += 1) {
    const chunks = [];
    for (let offset = 0; offset < SAMPLE.length; offset += size) {
      chunks.push(SAMPLE.slice(offset, offset + size));
    }
    assert.equal(render(SAMPLE, { columns: 40, chunks }), expected);
  }
});

test('incomplete Markdown is buffered until a stable line or end of answer', () => {
  const output = { columns: 80, text: '', write(value) { this.text += value; } };
  const renderer = createRenderer({ output, color: false });
  renderer.writeChunk('# Incomplete');
  assert.equal(output.text, '');
  renderer.endAnswer();
  assert.equal(output.text, '  Incomplete\n');
});

test('terminal width is read when each stable block is rendered', () => {
  let columns = 20;
  const output = { text: '', write(value) { this.text += value; } };
  const renderer = createRenderer({ output, color: false, width: () => columns });
  renderer.writeChunk('one two three four five six\n\n');
  columns = 40;
  renderer.writeChunk('one two three four five six\n\n');
  renderer.endAnswer();
  assert.equal(output.text, [
    'one two three four',
    'five six',
    '',
    'one two three four five six',
    '',
    '',
  ].join('\n'));
});

test('ANSI and terminal control sequences from the model are removed', () => {
  const malicious = '# Safe\n\n\x1b[31mred\x1b[0m\x1b]0;owned\x07 text\u0007';
  const result = render(malicious);
  assert.equal(result, '  Safe\n\nred text\n');
  assert.doesNotMatch(result, /\x1b|\u0007|owned/);
});

test('color mode styles Markdown while hiding its delimiters and fences', () => {
  const result = render('# Title\n\n**bold** *italic* `code`\n\n```js\nlet x = 1;\n```', {
    color: true,
  });
  assert.match(result, /\x1b\[1mTitle\x1b\[0m/);
  assert.match(result, /\x1b\[1mbold\x1b\[0m/);
  assert.match(result, /\x1b\[3mitalic\x1b\[0m/);
  assert.match(result, /\x1b\[36mcode\x1b\[0m/);
  assert.match(result, /\x1b\[36mlet x = 1;\x1b\[0m/);
  assert.doesNotMatch(result, /\*\*|```/);
});

test('all non-code lines respect a narrow terminal width', () => {
  const result = render(SAMPLE, { columns: 40 });
  for (const line of result.split('\n')) {
    if (line.includes('const value')) continue;
    assert.ok(visibleWidth(line) <= 40, `${visibleWidth(line)} columns: ${line}`);
  }
});

test('right arrow math is not confused with the right delimiter command', () => {
  assert.equal(
    renderInline('Entrada $\\rightarrow$ Función $\\rightarrow$ Salida'),
    'Entrada → Función → Salida',
  );
  assert.equal(renderInline('$\\left(x \\leq y\\right)$'), '(x ≤ y)');
});

test('display-math fallback preserves Markdown-sensitive LaTeX literally', () => {
  const source = '$$\\begin{matrix}x_i & y_i\\\\ x_j & y_j\\end{matrix}$$';
  assert.equal(
    render(source, { columns: 120 }),
    '  ⟦LaTeX: \\begin{matrix}x_i & y_i\\\\ x_j & y_j\\end{matrix}⟧\n',
  );
});

test('wrapped and fragmented inline math renders without raw delimiters', () => {
  const source = [
    'La indicadora $[x_i \\neq y_i]$ compara valores, mientras ',
    '$|A \\cap B|$ y $|A \\cup B|$ comparan conjuntos.',
  ].join('');
  const chunks = [...source];
  const result = render(source, { columns: 40, chunks });
  const normalized = result.replace(/\s+/g, ' ').trim();

  assert.match(normalized, /\[xᵢ ≠ yᵢ\]/);
  assert.match(normalized, /\|A ∩ B\|/);
  assert.match(normalized, /\|A ∪ B\|/);
  assert.doesNotMatch(result, /\$|\\neq|\\cap|\\cup/);
});

test('common nested roots, fractions, sums, and scripts remain legible', () => {
  assert.equal(
    renderInline('$\\sqrt{\\sum_{i=1}^{n} (x_i - y_i)^2}$'),
    '√(∑ᵢ₌₁ⁿ (xᵢ - yᵢ)²)',
  );
  assert.equal(
    renderInline('$\\frac{\\sum_{i=1}^{n} x_i y_i}{\\sqrt{\\sum_{i=1}^{n} x_i^2}}$'),
    '(∑ᵢ₌₁ⁿ xᵢ yᵢ)⁄(√(∑ᵢ₌₁ⁿ xᵢ²))',
  );
});

test('Minkowski and Mahalanobis notation renders without lossy fallback', () => {
  assert.equal(
    renderInline('$\\text{dist}(x, y) = \\left( \\sum_{i=1}^{n} |x_i - y_i|^p \\right)^{1/p}$'),
    'dist(x, y) = ( ∑ᵢ₌₁ⁿ |xᵢ - yᵢ|ᵖ )^(1/p)',
  );
  assert.equal(
    renderInline('$\\text{dist}(x, \\mu) = \\sqrt{(x - \\mu)^T \\Sigma^{-1} (x - \\mu)}$'),
    'dist(x, μ) = √((x - μ)ᵀ Σ⁻¹ (x - μ))',
  );
});

test('horizontal rules render to the current terminal width', () => {
  assert.equal(render('Before\n\n---\n\nAfter', { columns: 40 }), [
    'Before',
    '',
    '─'.repeat(40),
    '',
    'After',
    '',
  ].join('\n'));
});

test('common logarithmic, trigonometric, and limit notation renders legibly', () => {
  assert.equal(
    renderInline('$\\log_b(xy) = \\log_b(x) + \\log_b(y)$'),
    'log_(b)(xy) = log_(b)(x) + log_(b)(y)',
  );
  assert.equal(
    renderInline('$\\tan \\theta = \\frac{\\sin \\theta}{\\cos \\theta}$'),
    'tan θ = (sin θ)⁄(cos θ)',
  );
  assert.equal(
    renderInline('$\\cos(A \\pm B) = \\cos A \\cos B \\mp \\sin A \\sin B$'),
    'cos(A ± B) = cos A cos B ∓ sin A sin B',
  );
  assert.equal(renderInline('$\\lim_{x \\to c} x^n = c^n$'), 'lim_(x → c) xⁿ = cⁿ');
});

test('common calculus functions and spacing commands render legibly', () => {
  assert.equal(
    renderInline('$\\frac{d}{dx}(\\arcsin x) = \\frac{1}{\\sqrt{1-x^2}}$'),
    '(d)⁄(dx)(arcsin x) = (1)⁄(√(1-x²))',
  );
  assert.equal(
    renderInline('$\\int \\sec^2 x \\, dx = \\tan x + C$'),
    '∫ sec² x dx = tan x + C',
  );
  assert.equal(renderInline('$\\ln|x| + \\exp(x)$'), 'ln|x| + exp(x)');
});

test('math delimiters inside inline-code markers are normalized as math', () => {
  assert.equal(
    renderInline('Donde `$u$`, `$v$` y `\\(x_i \\neq y_i\\)` son variables.'),
    'Donde u, v y xᵢ ≠ yᵢ son variables.',
  );
  assert.match(renderInline('Use `npm test`.'), /Use npm test\./);
});

test('math nested in emphasis and links is rendered after outer Markdown', () => {
  assert.equal(
    renderInline('Donde **$u$**, *$v$* y [el valor $x_i$](https://example.test).'),
    'Donde u, v y el valor xᵢ (https://example.test).',
  );
  assert.equal(
    renderInline('Donde ``$u$`` es variable y `$PATH` permanece código.'),
    'Donde u es variable y $PATH permanece código.',
  );
  const colored = renderInline('**$u$** y *$v$*', { color: true });
  assert.match(colored, /\x1b\[1mu\x1b\[0m/);
  assert.match(colored, /\x1b\[3mv\x1b\[0m/);
});

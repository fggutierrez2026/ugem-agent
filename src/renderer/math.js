const SYMBOLS = new Map([
  ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'],
  ['\\theta', 'θ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\pi', 'π'],
  ['\\sigma', 'σ'], ['\\phi', 'φ'], ['\\omega', 'ω'], ['\\Delta', 'Δ'],
  ['\\Gamma', 'Γ'], ['\\Lambda', 'Λ'], ['\\Pi', 'Π'], ['\\Sigma', 'Σ'],
  ['\\Omega', 'Ω'], ['\\times', '×'], ['\\cdot', '·'], ['\\pm', '±'],
  ['\\mp', '∓'],
  ['\\leq', '≤'], ['\\le', '≤'], ['\\geq', '≥'], ['\\ge', '≥'],
  ['\\neq', '≠'], ['\\approx', '≈'], ['\\to', '→'], ['\\rightarrow', '→'],
  ['\\leftarrow', '←'], ['\\infty', '∞'], ['\\sum', '∑'], ['\\prod', '∏'],
  ['\\int', '∫'], ['\\partial', '∂'], ['\\nabla', '∇'], ['\\notin', '∉'],
  ['\\in', '∈'], ['\\subseteq', '⊆'], ['\\subset', '⊂'], ['\\supseteq', '⊇'],
  ['\\supset', '⊃'], ['\\equiv', '≡'], ['\\propto', '∝'],
  ['\\cap', '∩'], ['\\cup', '∪'], ['\\max', 'max'], ['\\min', 'min'],
  ['\\arcsin', 'arcsin'], ['\\arccos', 'arccos'], ['\\arctan', 'arctan'],
  ['\\sinh', 'sinh'], ['\\cosh', 'cosh'], ['\\tanh', 'tanh'],
  ['\\log', 'log'], ['\\ln', 'ln'], ['\\exp', 'exp'], ['\\lim', 'lim'],
  ['\\csc', 'csc'], ['\\sec', 'sec'], ['\\cot', 'cot'], ['\\tan', 'tan'],
  ['\\cos', 'cos'], ['\\sin', 'sin'],
]);

const SUPERSCRIPT = new Map(Object.entries({
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸',
  9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
  p: 'ᵖ', T: 'ᵀ',
}));

const SUBSCRIPT = new Map(Object.entries({
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈',
  9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ',
  h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ',
  r: 'ᵣ', s: 'ₛ', t: 'ₜ', x: 'ₓ',
}));

function script(value, alphabet) {
  const converted = [...value].map((character) => alphabet.get(character));
  return converted.every(Boolean) ? converted.join('') : undefined;
}

function readGroup(source, start) {
  if (source[start] !== '{') return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { content: source.slice(start + 1, index), end: index + 1 };
      }
    }
  }
  return undefined;
}

function transformStructures(source) {
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('\\sqrt', index)) {
      const radicand = readGroup(source, index + 5);
      if (radicand) {
        result += `√(${transformStructures(radicand.content)})`;
        index = radicand.end;
        continue;
      }
    }
    if (source.startsWith('\\frac', index)) {
      const numerator = readGroup(source, index + 5);
      const denominator = numerator && readGroup(source, numerator.end);
      if (numerator && denominator) {
        result += `(${transformStructures(numerator.content)})⁄(${transformStructures(denominator.content)})`;
        index = denominator.end;
        continue;
      }
    }
    result += source[index];
    index += 1;
  }
  return result;
}

export function renderMath(source) {
  const original = source.trim();
  let expression = transformStructures(original)
    .replace(/\\(?:left|right)(?=\s*[()[\]{}|.])/g, '')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:mathrm|operatorname)\{([^{}]*)\}/g, '$1')
    .replaceAll('\\displaystyle', '');

  for (const [latex, unicode] of SYMBOLS) expression = expression.replaceAll(latex, unicode);
  expression = expression
    .replace(/\\[,;:!] ?/g, ' ')
    .replace(/\\ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  expression = expression.replace(/\^\{([^{}]+)\}|\^([^\s])/g, (match, group, single) => {
    const value = group ?? single;
    return script(value, SUPERSCRIPT) ?? `^(${value})`;
  });
  expression = expression.replace(/_\{([^{}]+)\}|_([^\s])/g, (match, group, single) => {
    const value = group ?? single;
    return script(value, SUBSCRIPT) ?? `_(${value})`;
  });

  if (/[\\{}]/.test(expression)) return `⟦LaTeX: ${original}⟧`;
  return expression;
}

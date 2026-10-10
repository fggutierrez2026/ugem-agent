import { createMarkdownStream } from './markdown.js';

const CODE_COLORS = new Set([
  'auto', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow',
]);

function validCodeColor(value) {
  return CODE_COLORS.has(value) ? value : 'green';
}

export function createRenderer({
  output = process.stdout,
  color = Boolean(output.isTTY && !process.env.NO_COLOR),
  width = () => output.columns ?? 80,
  codeColor = process.env.UGEM_CODE_COLOR ?? 'green',
} = {}) {
  let stream;
  let selectedCodeColor = validCodeColor(codeColor);

  function currentStream() {
    stream ??= createMarkdownStream({
      write: (value) => output.write(value),
      width,
      color,
      codeColor: selectedCodeColor,
    });
    return stream;
  }

  return {
    writeAnswer(content) {
      currentStream().write(content);
      currentStream().end();
      stream = undefined;
    },
    writeChunk(content) {
      currentStream().write(content);
    },
    endAnswer() {
      currentStream().end();
      stream = undefined;
    },
    setCodeColor(value) {
      selectedCodeColor = validCodeColor(value);
    },
    configuration() {
      return Object.freeze({ codeColor: selectedCodeColor });
    },
  };
}

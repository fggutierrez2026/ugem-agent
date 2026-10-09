import { createMarkdownStream } from './markdown.js';

export function createRenderer({
  output = process.stdout,
  color = Boolean(output.isTTY && !process.env.NO_COLOR),
  width = () => output.columns ?? 80,
} = {}) {
  let stream;

  function currentStream() {
    stream ??= createMarkdownStream({
      write: (value) => output.write(value),
      width,
      color,
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
  };
}

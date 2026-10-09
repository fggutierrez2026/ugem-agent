export function createRenderer({ output = process.stdout } = {}) {
  return {
    writeAnswer(content) {
      output.write(`${content}\n`);
    },
    writeChunk(content) {
      output.write(content);
    },
    endAnswer() {
      output.write('\n');
    },
  };
}

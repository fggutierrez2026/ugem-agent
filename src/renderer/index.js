export function createRenderer({ output = process.stdout } = {}) {
  return {
    writeAnswer(content) {
      output.write(`${content}\n`);
    },
  };
}

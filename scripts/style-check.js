import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const failures = [];

async function checkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(filePath);
    } else if (entry.name.endsWith('.js')) {
      const content = await readFile(filePath, 'utf8');
      if (!content.endsWith('\n')) failures.push(`${filePath}: missing final newline`);
      content.split('\n').forEach((line, index) => {
        if (/\s+$/.test(line)) failures.push(`${filePath}:${index + 1}: trailing whitespace`);
        if (line.includes('\t')) failures.push(`${filePath}:${index + 1}: tab indentation`);
      });
    }
  }
}

for (const root of roots) await checkDirectory(root);

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
}

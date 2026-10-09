import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSse } from '../src/providers/sse.js';

async function* chunksOf(bytes, sizes) {
  let offset = 0;
  for (const size of sizes) {
    yield bytes.slice(offset, offset + size);
    offset += size;
  }
  if (offset < bytes.length) yield bytes.slice(offset);
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test('SSE parser preserves UTF-8 split across individual bytes', async () => {
  const source = [
    'data: {"text":"café 🌱"}\r\n',
    '\r\n',
    'data: [DONE]\r\n',
    '\r\n',
  ].join('');
  const bytes = new TextEncoder().encode(source);

  assert.deepEqual(
    await collect(parseSse(chunksOf(bytes, Array(bytes.length).fill(1)))),
    ['{"text":"café 🌱"}', '[DONE]'],
  );
});

test('SSE parser supports comments, split boundaries, and multiline data', async () => {
  const source = ': keepalive\n' + 'event: message\n' + 'data: first\n' + 'data: second\n\n';
  const bytes = new TextEncoder().encode(source);

  assert.deepEqual(
    await collect(parseSse(chunksOf(bytes, [2, 5, 1, 8, 3]))),
    ['first\nsecond'],
  );
});

test('SSE parser accepts CR line endings and a split CRLF pair', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: cr-only\r\rdata: split\r'),
    encoder.encode('\n\r'),
    encoder.encode('\n'),
  ];

  assert.deepEqual(
    await collect(parseSse(chunks)),
    ['cr-only', 'split'],
  );
});

export async function* parseSse(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let dataLines = [];

  function consumeLine(line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') {
      if (dataLines.length === 0) return undefined;
      const data = dataLines.join('\n');
      dataLines = [];
      return data;
    }
    if (line.startsWith(':')) return undefined;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    return undefined;
  }

  function consumeCompleteLines(final = false) {
    const events = [];
    let start = 0;
    let index = 0;
    while (index < buffer.length) {
      const character = buffer[index];
      if (character !== '\r' && character !== '\n') {
        index += 1;
        continue;
      }
      if (character === '\r' && index === buffer.length - 1 && !final) break;

      const line = buffer.slice(start, index);
      const event = consumeLine(line);
      if (event !== undefined) events.push(event);
      index += character === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      start = index;
    }
    buffer = buffer.slice(start);
    return events;
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    for (const event of consumeCompleteLines()) yield event;
  }

  buffer += decoder.decode();
  for (const event of consumeCompleteLines(true)) yield event;
  if (buffer !== '') {
    const event = consumeLine(buffer);
    if (event !== undefined) yield event;
  }
  if (dataLines.length > 0) yield dataLines.join('\n');
}

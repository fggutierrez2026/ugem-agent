export function createSession() {
  const history = [];

  return {
    addUserMessage(content) {
      history.push({ role: 'user', content });
    },
    addAssistantMessage(content) {
      history.push({ role: 'assistant', content });
    },
    removeLastUserMessage() {
      if (history.at(-1)?.role === 'user') history.pop();
    },
    clear() {
      history.length = 0;
    },
    messages() {
      return history.map((message) => ({ ...message }));
    },
  };
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatStatus = { configured: boolean; model?: string };

export async function getChatStatus(signal: AbortSignal): Promise<ChatStatus> {
  const response = await fetch('/api/status', { signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    return { configured: false };
  }
  const data = await response.json();
  return { configured: data.configured === true, model: data.model };
}

export async function requestReply(messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => Promise<unknown>): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok) {
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to send. Please try again later.');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('Invalid response format. Please check the API connection.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let completed = false;
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { completed = true; break; }
        const event = JSON.parse(data);
        if (event.error) throw new Error(typeof event.error === 'string' ? event.error : 'The model response was interrupted. Please try again.');
        const text = event.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) {
          content += text;
          await onText(content);
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error('Connection interrupted. The response is incomplete. Please send again.');
    if (!content.trim()) throw new Error('The model returned no text. Please try again.');
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

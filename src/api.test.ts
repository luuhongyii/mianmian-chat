import { describe, expect, it, vi } from 'vitest';
import { getChatStatus, requestReply } from './api';

function streamResponse(text: string, splitBytes = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += splitBytes) controller.enqueue(bytes.slice(i, i + splitBytes));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('NVIDIA streaming client', () => {
  it('handles UTF-8 and SSE frames split across network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(
      ': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"，朋友！"}}]}\n\ndata: [DONE]\n\n', 1
    )));
    const updates: string[] = [];
    const signal = new AbortController().signal;
    const messages = [{ role: 'user' as const, content: '你好' }];
    expect(await requestReply(messages, signal, async text => { updates.push(text); })).toBe('你好，朋友！');
    expect(updates).toEqual(['你好', '你好，朋友！']);
    expect(fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ signal, body: JSON.stringify({ messages }) }));
  });

  it('does not display reasoning as assistant output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\ndata: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n')));
    const onText = vi.fn();
    expect(await requestReply([], new AbortController().signal, onText)).toBe('回答');
    expect(onText).toHaveBeenCalledExactlyOnceWith('回答');
  });

  it('reports interrupted streams instead of treating partial text as complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('data: {"choices":[{"delta":{"content":"一半"}}]}\n\n')));
    await expect(requestReply([], new AbortController().signal, vi.fn())).rejects.toThrow('The response is incomplete');
  });

  it('reports streamed server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('event: error\ndata: {"error":"连接中断"}\n\n')));
    await expect(requestReply([], new AbortController().signal, vi.fn())).rejects.toThrow('连接中断');
  });

  it('rejects an empty model response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('data: [DONE]\n\n')));
    await expect(requestReply([], new AbortController().signal, vi.fn())).rejects.toThrow('The model returned no text');
  });

  it('shows API errors rather than fabricating a reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '额度不足' }, { status: 502 })));
    await expect(requestReply([], new AbortController().signal, vi.fn())).rejects.toThrow('额度不足');
  });

  it('does not report HTML fallback as a configured backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>')));
    expect(await getChatStatus(new AbortController().signal)).toEqual({ configured: false });
  });
});

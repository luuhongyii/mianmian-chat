import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { HISTORY_KEY, loadHistory } from './history';

beforeEach(() => localStorage.clear());

function answer(text: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function start(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await screen.findByText(/Configured/);
  return await screen.findByPlaceholderText('Write something…');
}

async function send(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

describe('chat interface using the real React ChatBotify component', () => {
  it('shows English interface text and accessible controls', async () => {
    await start(vi.fn().mockResolvedValue(Response.json({ configured: true })));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe("Hi, I'm Mianmian.");
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Chat with Mianmian' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\p{Script=Han}/u);
  });

  it('sends a message, displays a streamed response, and preserves conversational context', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true, model: 'test-model' }))
      .mockResolvedValueOnce(answer('你好，很高兴见到你！'))
      .mockResolvedValueOnce(answer('你刚才说了你好。'));
    const input = await start(fetchMock);
    await send(input, '你好');
    await screen.findByText('你好，很高兴见到你！');
    await waitFor(() => expect(screen.queryByPlaceholderText('Mianmian is thinking…')).toBeNull());
    await send(input, '我刚才说了什么？');
    await screen.findByText('你刚才说了你好。');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，很高兴见到你！' },
      { role: 'user', content: '我刚才说了什么？' },
    ]);
  });

  it('does not send whitespace, Shift+Enter, or Chinese composition confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ configured: true }));
    const input = await start(fetchMock);
    await send(input, '   ');
    fireEvent.change(input, { target: { value: '换行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.compositionEnd(input);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows configuration status and never substitutes fake replies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ configured: false }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText('Waiting for a cloud model');
    const input = await screen.findByPlaceholderText('Write something…');
    await send(input, '你好');
    expect((await screen.findByRole('alert')).textContent).toContain('No model is connected yet');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps failed messages out of model context and allows another send', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(Response.json({ error: '网络错误' }, { status: 502 }))
      .mockResolvedValueOnce(answer('这次成功了。'));
    const input = await start(fetchMock);
    await send(input, '失败的消息');
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByPlaceholderText('Mianmian is thinking…')).toBeNull());
    await send(input, '新的消息');
    await screen.findByText('这次成功了。');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages).toEqual([{ role: 'user', content: '新的消息' }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts a separate conversation without deleting the previous one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('旧对话回复'))
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('新对话回复'));
    let input = await start(fetchMock);
    await send(input, '旧消息');
    await screen.findByText('旧对话回复');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(screen.queryByText('旧对话回复')).toBeNull());
    input = await screen.findByPlaceholderText('Write something…');
    await send(input, '新消息');
    await screen.findByText('新对话回复');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).messages).toEqual([{ role: 'user', content: '新消息' }]);
    expect(loadHistory().conversations.filter(item => item.turns.length)).toHaveLength(2);
  });

  it('aborts an in-flight reply when a new conversation starts', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }))
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('新的回复'));
    const input = await start(fetchMock);
    await send(input, '正在等待的旧消息');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(loadHistory().conversations.flatMap(item => item.turns).find(turn => turn.user === '正在等待的旧消息')?.status).toBe('interrupted');
    const newInput = await screen.findByPlaceholderText('Write something…');
    await send(newInput, '新消息');
    await screen.findByText('新的回复');
    expect(screen.queryByText('正在等待的旧消息')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores saved messages after remount and sends their context on continuation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Hello, Alice.'))
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Your name is Alice.'));
    const input = await start(fetchMock);
    await send(input, 'My name is Alice.');
    await screen.findByText('Hello, Alice.');
    await waitFor(() => expect(loadHistory().conversations[0].turns[0].status).toBe('complete'));
    cleanup();
    render(<App />);
    await screen.findByText('Hello, Alice.');
    expect(screen.getByText('My name is Alice.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await send(await screen.findByPlaceholderText('Write something…'), 'What is my name?');
    await screen.findByText('Your name is Alice.');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).messages).toEqual([
      { role: 'user', content: 'My name is Alice.' },
      { role: 'assistant', content: 'Hello, Alice.' },
      { role: 'user', content: 'What is my name?' },
    ]);
  });

  it('switches saved conversations without mixing their contexts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Alpha reply'))
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Beta reply'))
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Alpha continued'));
    await send(await start(fetchMock), 'Alpha');
    await screen.findByText('Alpha reply');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await send(await screen.findByPlaceholderText('Write something…'), 'Beta');
    await screen.findByText('Beta reply');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'Open chat: Beta' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat: Alpha' }));
    await screen.findByText('Alpha reply');
    expect(screen.queryByText('Beta reply')).toBeNull();
    await send(await screen.findByPlaceholderText('Write something…'), 'Continue Alpha');
    await screen.findByText('Alpha continued');
    expect(JSON.parse(fetchMock.mock.calls[5][1].body).messages).toEqual([
      { role: 'user', content: 'Alpha' },
      { role: 'assistant', content: 'Alpha reply' },
      { role: 'user', content: 'Continue Alpha' },
    ]);
  });

  it('keeps chatting and reports when browser storage cannot save', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(answer('Still available'));
    await send(await start(fetchMock), 'Hello');
    await screen.findByText('Still available');
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
  });

  it('preserves an interrupted partial reply when switching away and back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockImplementationOnce((_url, options) => Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial reply"}}]}\n\n'));
          options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })))
      .mockResolvedValue(Response.json({ configured: true }));
    await send(await start(fetchMock), 'Streaming message');
    await screen.findByText('Partial reply');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open chat: Streaming message' }));
    await screen.findByText('Partial reply');
    expect((await screen.findByRole('alert')).textContent).toContain('interrupted');
    const turn = loadHistory().conversations.flatMap(item => item.turns)[0];
    expect(turn.assistant).toBe('Partial reply');
    expect(turn.status).toBe('interrupted');
  });

  it('does not overwrite unreadable saved history', async () => {
    localStorage.setItem(HISTORY_KEY, 'unreadable saved data');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ configured: true }));
    await start(fetchMock);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(localStorage.getItem(HISTORY_KEY)).toBe('unreadable saved data');
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createApiHandler } from './api.mjs';

let server;
let base;
let upstream;
let config;

beforeEach(async () => {
  config = { apiKey: 'test-only-not-a-real-key', model: 'test-model' };
  upstream = vi.fn();
  const api = createApiHandler({ getConfig: () => config, fetchImpl: upstream });
  server = createServer(async (request, response) => {
    if (request.headers['x-test-parsed-body']) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      request.body = request.headers['x-test-parsed-body'] === 'buffer' ? raw : request.headers['x-test-parsed-body'] === 'text' ? raw.toString('utf8') : JSON.parse(raw.toString('utf8'));
    }
    if (!await api(request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
});

const post = messages => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });

describe('local NVIDIA proxy', () => {
  it.each(['object', 'text', 'buffer'])('accepts a Vercel-preparsed %s request body', async kind => {
    const data = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n';
    upstream.mockResolvedValue(new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }));
    const messages = [{ role: 'user', content: '你好' }];
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-parsed-body': kind },
      body: JSON.stringify({ messages }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(data);
    expect(JSON.parse(upstream.mock.calls[0][1].body).messages.slice(1)).toEqual(messages);
  });
  it('returns only configuration state and model, never the API key', async () => {
    const response = await fetch(`${base}/api/status`);
    expect(await response.json()).toEqual({ configured: true, model: 'test-model' });
  });
  it('rejects missing configuration without calling the upstream API', async () => {
    config.apiKey = '';
    expect((await post([{ role: 'user', content: '你好' }])).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('validates message roles and the last user turn', async () => {
    for (const messages of [[], [{ role: 'system', content: 'x' }], [{ role: 'assistant', content: 'x' }], [{ role: 'user', content: ' ' }], null]) {
      expect((await post(messages)).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards real streaming bytes with thinking disabled and all successful conversation turns', async () => {
    const data = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n';
    upstream.mockResolvedValue(new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }));
    const messages = [{ role: 'user', content: '第一句' }, { role: 'assistant', content: '回复' }, { role: 'user', content: '第二句' }];
    const response = await post(messages);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(data);
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    const body = JSON.parse(options.body);
    expect(body.model).toBe('test-model');
    expect(body.messages.slice(1)).toEqual(messages);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.stream).toBe(true);
  });
  it('does not expose raw upstream errors or credentials', async () => {
    upstream.mockResolvedValue(new Response(config.apiKey, { status: 401 }));
    const response = await post([{ role: 'user', content: '你好' }]);
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('API Key is invalid');
    expect(body).not.toContain(config.apiKey);
  });
  it('cancels upstream inference when the client disconnects', async () => {
    let signal;
    upstream.mockImplementation(async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"开头"}}]}\n\n'));
          signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const response = await post([{ role: 'user', content: '你好' }]);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  });
});

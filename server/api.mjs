import { once } from 'node:events';
import { loadConfig } from './config.mjs';

export function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function upstreamError(status) {
  if (status === 401 || status === 403) return 'The NVIDIA API Key is invalid or lacks access. Please check the local configuration.';
  if (status === 404) return 'This model was not found on NVIDIA. Please check NVIDIA_MODEL.';
  if (status === 429) return 'The NVIDIA quota or rate limit has been reached. Please try again later.';
  return `NVIDIA cannot complete the request right now (HTTP ${status}). Please try again later.`;
}

export function createApiHandler({ getConfig = loadConfig, fetchImpl = fetch } = {}) {
  return async function handleApi(request, response) {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return false;

    let config;
    try { config = getConfig(); }
    catch { sendJson(response, 500, { error: 'Cannot read the local API configuration. Please check file permissions.' }); return true; }

    if (path === '/api/status' && request.method === 'GET') {
      sendJson(response, 200, { configured: Boolean(config.apiKey), model: config.model });
      return true;
    }
    if (path !== '/api/chat') { sendJson(response, 404, { error: 'Endpoint not found.' }); return true; }
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'Please use POST to send messages.' }); return true; }
    if (!config.apiKey) { sendJson(response, 503, { error: 'NVIDIA API Key is not configured. Please add it to the local .env file.' }); return true; }

    let body;
    try {
      const parsedBody = request.body;
      if (parsedBody !== undefined) {
        const raw = typeof parsedBody === 'string' || Buffer.isBuffer(parsedBody) ? parsedBody : JSON.stringify(parsedBody);
        if (Buffer.byteLength(raw) > 1024 * 1024) { sendJson(response, 413, { error: 'This conversation exceeds 1 MB.' }); return true; }
        body = typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody) ? parsedBody : JSON.parse(raw);
      } else {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 1024 * 1024) { sendJson(response, 413, { error: 'This conversation exceeds 1 MB.' }); return true; }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
    } catch { sendJson(response, 400, { error: 'Invalid message format.' }); return true; }

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.some(message =>
      !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()
    ) || messages.at(-1).role !== 'user') {
      sendJson(response, 400, { error: 'Please send valid chat messages.' });
      return true;
    }

    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    try {
      const upstream = await fetchImpl('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'system', content: "You are Mianmian, a friendly chat assistant. Respond naturally and concisely in the user's language." }, ...messages.map(({ role, content }) => ({ role, content }))],
          stream: true,
          max_tokens: 2048,
          temperature: 0.7,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        sendJson(response, 502, { error: upstreamError(upstream.status) });
        return true;
      }
      if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
        await upstream.body?.cancel();
        sendJson(response, 502, { error: 'NVIDIA returned an unrecognized response format. Please try again.' });
        return true;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      for await (const chunk of upstream.body) {
        if (!response.write(chunk)) await once(response, 'drain', { signal: controller.signal });
      }
      response.end();
    } catch (error) {
      if (!controller.signal.aborted && !response.destroyed) {
        const message = error.name === 'TimeoutError' ? 'NVIDIA response timed out. Please send again.' : 'Could not connect to NVIDIA. Please check your network and try again.';
        if (!response.headersSent) sendJson(response, 502, { error: message });
        else response.end(`\nevent: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      }
    } finally { response.off('close', disconnect); }
    return true;
  };
}

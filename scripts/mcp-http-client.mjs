import http from 'node:http';

let nextId = 1;

function decode(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const data = [...trimmed.matchAll(/^data:\s*(.*)$/gm)].map((match) => match[1] ?? '');
  const last = data.at(-1);
  return last === undefined ? trimmed : JSON.parse(last);
}

function post(urlString, body, headers) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: decode(Buffer.concat(chunks).toString('utf8'))
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

export class RawMcpClient {
  constructor(url, headers = {}) {
    this.url = url;
    this.headers = headers;
  }

  async request(method, params = {}) {
    const response = await post(
      this.url,
      { jsonrpc: '2.0', id: nextId++, method, params },
      this.headers
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MCP ${method} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }
    if (response.body?.error) {
      throw new Error(`MCP ${method} failed: ${JSON.stringify(response.body.error)}`);
    }
    return response.body?.result;
  }

  listTools() {
    return this.request('tools/list');
  }

  callTool(request) {
    return this.request('tools/call', request);
  }

  close() {
    return Promise.resolve();
  }
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

const port = 31808;
let server;
test.before(async () => {
  server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port) } });
  await new Promise(resolve => setTimeout(resolve, 300));
});
test.after(() => server.kill());
const get = (path, host = 'home.lab') => new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, response => {
  let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode, text: () => text, json: () => JSON.parse(text) }));
}).on('error', reject));

test('serves the family, tools, and status sites by hostname', async () => {
  for (const [host, title] of [['home.lab', 'Home Lab · Home'], ['tools.home.lab', 'Home Lab · Tools'], ['status.home.lab', 'Home Lab · Status']]) {
    const response = await get('/', host);
    assert.equal(response.status, 200);
    assert.match(response.text(), new RegExp(`<title>${title}`));
  }
});
test('returns health, configuration, and status data', async () => {
  assert.deepEqual((await get('/api/health')).json(), { ok: true });
  assert.ok((await get('/api/config')).json().cards.length > 0);
  const status = (await get('/api/status', 'status.home.lab')).json();
  assert.equal(typeof status.metrics.cpu, 'number');
});

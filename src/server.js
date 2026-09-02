import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const configPath = path.join(dataDir, 'config.json');
const databasePath = path.join(dataDir, 'home-lab.db');
const pageTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };

function readConfig() { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
function writeConfig(value) { fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`); }
function quote(value) { return value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`; }
function query(statement) { return execFileSync('sqlite3', ['-json', databasePath, statement], { encoding: 'utf8' }); }
query(`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL, image_url TEXT, link_url TEXT, category TEXT, pinned INTEGER NOT NULL DEFAULT 0, publish_at TEXT, expires_at TEXT, created_at TEXT NOT NULL)`);

function respond(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function serve(res, file) { res.writeHead(200, { 'content-type': pageTypes[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); }
function requestBody(req) { return new Promise((resolve, reject) => { let value = ''; req.on('data', chunk => { value += chunk; if (value.length > 1_000_000) reject(new Error('Request too large')); }); req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch { reject(new Error('Invalid JSON')); } }); }); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace('::ffff:', ''); }
function isAdmin(req) { return clientIp(req).startsWith(readConfig().adminNetwork); }
function safeText(value, length = 4000) { return String(value || '').slice(0, length); }

let previousCpu = os.cpus().map(cpu => ({ ...cpu.times }));
const history = [];
function readMetrics() {
  const currentCpu = os.cpus().map(cpu => cpu.times);
  let idle = 0, total = 0;
  currentCpu.forEach((times, index) => { const previous = previousCpu[index] || times; Object.keys(times).forEach(key => { total += times[key] - previous[key]; }); idle += times.idle - previous.idle; });
  previousCpu = currentCpu.map(times => ({ ...times }));
  const temperatures = fs.existsSync('/sys/class/thermal') ? fs.readdirSync('/sys/class/thermal').filter(x => x.startsWith('thermal_zone')).map(zone => { try { return Number(fs.readFileSync(`/sys/class/thermal/${zone}/temp`, 'utf8')) / 1000; } catch { return null; } }).filter(Number.isFinite) : [];
  const point = { at: new Date().toISOString(), cpu: total ? Math.round((1 - idle / total) * 100) : 0, memory: Math.round((1 - os.freemem() / os.totalmem()) * 100), load: Number(os.loadavg()[0].toFixed(2)), temperature: temperatures.length ? Math.round(Math.max(...temperatures)) : null };
  history.push(point);
  const cutoff = Date.now() - readConfig().metrics.historyHours * 3_600_000;
  while (history[0] && Date.parse(history[0].at) < cutoff) history.shift();
  return { ...point, uptime: os.uptime(), hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, history };
}
readMetrics(); setInterval(readMetrics, 5000).unref();

function healthCheck(url) { return new Promise(resolve => { const client = url.startsWith('https:') ? https : http; const request = client.request(url, { method: 'HEAD', timeout: 3500 }, response => resolve({ online: response.statusCode < 500, code: response.statusCode })); request.on('timeout', () => request.destroy()); request.on('error', () => resolve({ online: false })); request.end(); }); }
function siteFor(host) { return host === 'tools.home.lab' ? 'tools' : host === 'status.home.lab' ? 'status' : 'home'; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://home.lab');
    if (url.pathname === '/shared.css') return serve(res, path.join(root, 'public', 'shared.css'));
    if (url.pathname === '/api/health') return respond(res, 200, { ok: true });
    if (url.pathname === '/api/config') { if (req.method === 'GET') return respond(res, 200, readConfig()); if (!isAdmin(req)) return respond(res, 403, { error: 'Admin network only.' }); writeConfig(await requestBody(req)); return respond(res, 200, { ok: true }); }
    if (url.pathname === '/api/announcements' && req.method === 'GET') { const now = quote(new Date().toISOString()); return respond(res, 200, JSON.parse(query(`SELECT * FROM announcements WHERE (publish_at IS NULL OR publish_at <= ${now}) AND (expires_at IS NULL OR expires_at > ${now}) ORDER BY pinned DESC, created_at DESC`) || '[]')); }
    if (url.pathname === '/api/announcements' && req.method === 'POST') { if (!isAdmin(req)) return respond(res, 403, { error: 'Admin network only.' }); const input = await requestBody(req); if (!input.title || !input.body) return respond(res, 400, { error: 'A title and message are required.' }); const post = { id: crypto.randomUUID(), title: safeText(input.title, 160), body: safeText(input.body), priority: input.priority === 'important' ? 'important' : 'normal', image_url: safeText(input.image_url) || null, link_url: safeText(input.link_url) || null, category: safeText(input.category, 100) || null, pinned: input.pinned ? 1 : 0, publish_at: input.publish_at || null, expires_at: input.expires_at || null, created_at: new Date().toISOString() }; query(`INSERT INTO announcements VALUES (${Object.values(post).map(quote).join(',')})`); return respond(res, 201, post); }
    if (url.pathname.startsWith('/api/announcements/') && req.method === 'DELETE') { if (!isAdmin(req)) return respond(res, 403, { error: 'Admin network only.' }); query(`DELETE FROM announcements WHERE id = ${quote(url.pathname.split('/').at(-1))}`); return respond(res, 200, { ok: true }); }
    if (url.pathname === '/api/status') { const services = await Promise.all(readConfig().services.filter(service => service.enabled && service.url).map(async service => ({ ...service, ...await healthCheck(service.url) }))); return respond(res, 200, { metrics: readMetrics(), services }); }
    if (url.pathname === '/api/dns') { try { return respond(res, 200, { records: await dns.resolve(safeText(url.searchParams.get('host'), 253)) }); } catch (error) { return respond(res, 400, { error: error.message }); } }
    if (url.pathname === '/api/http-check') { try { const target = new URL(safeText(url.searchParams.get('url'))); if (!['http:', 'https:'].includes(target.protocol) || /(^localhost$|^127\.|^0\.|^169\.254\.|^::1$)/i.test(target.hostname)) throw new Error('Only public HTTP(S) destinations are allowed.'); return respond(res, 200, await healthCheck(target.href)); } catch (error) { return respond(res, 400, { error: error.message }); } }
    if (url.pathname === '/api/qr') return execFile('qrencode', ['-t', 'SVG', '-o', '-', safeText(url.searchParams.get('text'), 2000)], { maxBuffer: 2_000_000 }, (error, output) => { if (error) return respond(res, 503, { error: 'QR generator is unavailable. Run the setup script.' }); res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(output); });
    const site = siteFor(String(req.headers.host || '').split(':')[0]);
    return serve(res, path.join(root, 'public', site, url.pathname === '/admin' ? 'admin.html' : 'index.html'));
  } catch (error) { console.error(error); return respond(res, 500, { error: error.message }); }
});
server.listen(Number(process.env.PORT || 3080), '127.0.0.1', () => console.log('Home Lab portal listening on localhost:3080'));

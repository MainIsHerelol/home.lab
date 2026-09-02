import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dataDir = path.join(root, 'data'), configFile = path.join(dataDir, 'config.json');
const dbFile = path.join(dataDir, 'home-lab.db');
const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sql = statement => execFileSync('sqlite3', ['-json', dbFile, statement], { encoding: 'utf8' });
sql(`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal',image_url TEXT,link_url TEXT,category TEXT,pinned INTEGER NOT NULL DEFAULT 0,publish_at TEXT,expires_at TEXT,created_at TEXT NOT NULL)`);
const config = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
const json = (res, code, value) => { res.writeHead(code, {'content-type':'application/json'}); res.end(JSON.stringify(value)); };
const admin = req => (req.socket.remoteAddress || '').replace('::ffff:', '').startsWith(config().adminNetwork);
const body = req => new Promise((resolve, reject) => { let b=''; req.on('data', x => { b+=x; if(b.length>1e6) reject(Error('Request too large')); }); req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch{reject(Error('Invalid JSON'))}}); });
let prior=os.cpus().map(c=>({...c.times}),),history=[];
function metrics(){const now=os.cpus().map(c=>c.times);let idle=0,total=0;now.forEach((t,i)=>{let p=prior[i]||t;for(const k in t)total+=t[k]-p[k];idle+=t.idle-p.idle});prior=now.map(x=>({...x}));const temps=fs.existsSync('/sys/class/thermal')?fs.readdirSync('/sys/class/thermal').filter(x=>x.startsWith('thermal_zone')).map(x=>{try{return +fs.readFileSync(`/sys/class/thermal/${x}/temp`)/1000}catch{return null}}).filter(Number.isFinite):[];let p={at:new Date().toISOString(),cpu:total?Math.round((1-idle/total)*100):0,memory:Math.round((1-os.freemem()/os.totalmem())*100),load:os.loadavg()[0],temperature:temps.length?Math.round(Math.max(...temps)):null};history.push(p);let cut=Date.now()-config().metrics.historyHours*3600000;while(history[0]&&Date.parse(history[0].at)<cut)history.shift();return {...p,totalMemory:os.totalmem(),freeMemory:os.freemem(),uptime:os.uptime(),platform:`${os.type()} ${os.release()}`,hostname:os.hostname(),history}}
setInterval(metrics,5000).unref();metrics();
const check = url => new Promise(resolve=>{let c=url.startsWith('https:')?https:http,r=c.request(url,{method:'HEAD',timeout:3500},x=>resolve({online:x.statusCode<500,code:x.statusCode}));r.on('timeout',()=>r.destroy());r.on('error',()=>resolve({online:false}));r.end()});
const sendFile=(res,file,type='text/html')=>{res.writeHead(200,{'content-type':type});fs.createReadStream(file).pipe(res)};
const safe = s => String(s||'').slice(0,4000);
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local'), ip=(req.socket.remoteAddress||'').replace('::ffff:','');
 if(url.pathname==='/shared.css')return sendFile(res,path.join(root,'public','shared.css'),'text/css');
 if(url.pathname==='/api/health')return json(res,200,{ok:true});
 if(url.pathname==='/api/config'){if(req.method==='GET')return json(res,200,config());if(!admin(req))return json(res,403,{error:'Admin network only'});let x=await body(req);fs.writeFileSync(configFile,JSON.stringify(x,null,2)+'\n');return json(res,200,{ok:true})}
 if(url.pathname==='/api/announcements'){if(req.method==='GET'){let n=quote(new Date().toISOString());return json(res,200,JSON.parse(sql(`SELECT * FROM announcements WHERE (publish_at IS NULL OR publish_at <= ${n}) AND (expires_at IS NULL OR expires_at > ${n}) ORDER BY pinned DESC,created_at DESC`)||'[]'))}if(!admin(req))return json(res,403,{error:'Admin network only'});let x=await body(req);if(!x.title||!x.body)return json(res,400,{error:'A title and message are required.'});let a={id:crypto.randomUUID(),title:safe(x.title).slice(0,160),body:safe(x.body),priority:x.priority==='important'?'important':'normal',image_url:safe(x.image_url)||null,link_url:safe(x.link_url)||null,category:safe(x.category).slice(0,100)||null,pinned:x.pinned?1:0,publish_at:x.publish_at||null,expires_at:x.expires_at||null,created_at:new Date().toISOString()};sql(`INSERT INTO announcements VALUES (${[a.id,a.title,a.body,a.priority,a.image_url,a.link_url,a.category,a.pinned,a.publish_at,a.expires_at,a.created_at].map(quote).join(',')})`);return json(res,201,a)}
 if(url.pathname.startsWith('/api/announcements/')){if(!admin(req))return json(res,403,{error:'Admin network only'});sql(`DELETE FROM announcements WHERE id=${quote(url.pathname.split('/').pop())}`);return json(res,200,{ok:true})}
 if(url.pathname==='/api/status'){let services=await Promise.all(config().services.filter(x=>x.enabled).map(async x=>({...x,...await check(x.url)})));return json(res,200,{metrics:metrics(),services})}
 if(url.pathname==='/api/dns'){try{return json(res,200,{records:await dns.resolve(safe(url.searchParams.get('host')).slice(0,253))})}catch(e){return json(res,400,{error:e.message})}}
 if(url.pathname==='/api/http-check'){try{let t=new URL(safe(url.searchParams.get('url')));if(!['http:','https:'].includes(t.protocol)||/(^localhost$|^127\.|^0\.|^169\.254\.|^::1$)/i.test(t.hostname))throw Error('Only public HTTP(S) destinations are allowed.');return json(res,200,await check(t.href))}catch(e){return json(res,400,{error:e.message})}}
 if(url.pathname==='/api/qr'){let text=safe(url.searchParams.get('text'));return execFile('qrencode',['-t','SVG','-o','-',text],{maxBuffer:2e6},(e,out)=>{if(e)return json(res,503,{error:'QR generator is unavailable. Run the setup script.'});res.writeHead(200,{'content-type':'image/svg+xml'});res.end(out)})}
 let host=req.headers.host?.split(':')[0],site=host==='tools.home.lab'?'tools':host==='status.home.lab'?'status':'home',file=url.pathname==='/admin'?'admin.html':'index.html';return sendFile(res,path.join(root,'public',site,file));
}catch(e){console.error(e);json(res,500,{error:e.message})}}).listen(+process.env.PORT||3080,'127.0.0.1',()=>console.log('Home Lab portal listening on localhost'));

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const files = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/domain.js':['domain.js','text/javascript'], '/style.css':['style.css','text/css']};
export const server = http.createServer(async (req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  if(pathname === '/health' && req.method === 'GET') {res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true,mode:'demo',sendingEnabled:false}));}
  if(req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Envios e mutações no servidor desativados nesta versão demonstrativa.'}));}
  const file=files[pathname];
  if(!file){res.writeHead(404);return res.end('Não encontrado');}
  try {const content=await readFile(fileURLToPath(new URL('./public/'+file[0],import.meta.url)));res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);}
  catch {res.writeHead(500);res.end('Falha ao carregar aplicativo');}
});
if(process.argv[1]===fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT||3000),'0.0.0.0');

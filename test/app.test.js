import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,sendEmail,sendingEnabled} from '../public/domain.js';
import {server} from '../server.js';
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(resolve=>server.close(resolve)));
test('envios são bloqueados por código',()=>{assert.equal(sendingEnabled,false);assert.throws(sendEmail,/desativados/);});
test('CSV aceita BOM, aspas, separadores e linhas internas',()=>{const r=parseCSV('\uFEFFnome;email;empresa\r\n"Ana; Demo";ANA@example.com;"Linha\nDois"');assert.equal(r.contacts[0].nome,'Ana; Demo');assert.equal(r.contacts[0].email,'ana@example.com');assert.equal(r.contacts[0].empresa,'Linha\nDois');});
test('CSV conta inválidos e duplicados',()=>{const r=parseCSV('email\na@example.com\na@example.com\ninválido\n');assert.equal(r.contacts.length,1);assert.equal(r.duplicates,1);assert.equal(r.invalid,1);});
test('CSV rejeita formato inválido e arquivo grande',()=>{assert.throws(()=>parseCSV('nome\nAna'),/coluna email/);assert.throws(()=>parseCSV('email\n"aberto'),/não fechado/);assert.throws(()=>parseCSV('x'.repeat(2_000_001)),/2 MB/);});
test('raiz e módulos disponíveis com proteção de rede no navegador',async()=>{for(const path of ['/','/app.js','/domain.js','/style.css']){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);}});
test('endpoint de envio não aceita mutação',async()=>{const r=await fetch(base+'/api/send',{method:'POST'});assert.equal(r.status,403);});
test('saúde informa modo demo e caminhos desconhecidos são recusados',async()=>{assert.equal((await(await fetch(base+'/health')).json()).sendingEnabled,false);assert.equal((await fetch(base+'/missing')).status,404);});

test('incorporação Bitrix24 aceita parâmetros sem mudar a rota ou refletir tokens',async()=>{
 const query='?placement=LEFT_MENU&member_id=demo&placement_options=%7B%7D&__init=example-not-a-real-token';
 const r=await fetch(base+'/'+query);assert.equal(r.status,200);const html=await r.text();assert.match(html,/Envio de e-mails/);assert.ok(!html.includes('example-not-a-real-token'));
 assert.equal((await fetch(base+'/app.js?v=1')).status,200);
 assert.equal((await(await fetch(base+'/health'+query)).json()).sendingEnabled,false);
 assert.equal((await fetch(base+'/missing'+query)).status,404);
});

import {mkdirSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {randomBytes,scryptSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
mkdirSync('.local',{recursive:true});
if(!existsSync('.env.local')){
 const email='admin@gotipay.local',password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');
 const hash='scrypt$'+salt+'$'+scryptSync(password,Buffer.from(salt,'hex'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
 writeFileSync('.env.local',`APP_ORIGIN=http://127.0.0.1:5174\nAUTH_URL=http://127.0.0.1:5174\nAUTH_SECRET=${randomBytes(32).toString('base64url')}\nAPP_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nTURSO_DATABASE_URL=file:./.local/portugal-preview.db\nPUBLIC_API_ENABLED=false\nALLOWED_EMAILS=${email}\nADMIN_USERS='${JSON.stringify({[email]:hash})}'\n`,{flag:'wx'});
 writeFileSync('.local/acesso-portugal.txt',`Acesso apenas local: http://127.0.0.1:5174\nEmail: ${email}\nPalavra-passe: ${password}\nPagamentos reais desativados.\n`,{flag:'wx'});
}
process.loadEnvFile('.env.local');
if(process.env.TURSO_DATABASE_URL!=='file:./.local/portugal-preview.db')throw Error('Seed apenas permitido no banco local Portugal.');
const r=spawnSync(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status);
const db=createClient({url:process.env.TURSO_DATABASE_URL});const id='prd_'+'p'.repeat(43);
await db.execute({sql:'INSERT OR IGNORE INTO products(id,name,description,amount,image,shipping,delivery_days,active,created_at,updated_at,product_type) VALUES(?,?,?,?,?,?,?,1,?,?,?)',args:[id,'Produto de demonstração','Exemplo local para verificar o checkout Portugal. Substitua pelo seu produto no painel.',1990,readFileSync('public/goti-pay-avatar.jpg').toString('base64'),0,'Entrega em Portugal',Date.now(),Date.now(),'physical']});db.close();console.log('Checkout local: http://127.0.0.1:5174/comprar/'+id);console.log('Acesso guardado em .local/acesso-portugal.txt. Nenhuma credencial exibida.');

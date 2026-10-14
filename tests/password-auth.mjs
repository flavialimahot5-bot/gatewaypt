import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
mkdirSync('.sites-runtime', {recursive:true});
const dir=mkdtempSync(join(process.cwd(),'.sites-runtime','password-test-'));
const password=randomBytes(24).toString('base64url');
const salt=randomBytes(16);
const stored='scrypt$'+salt.toString('hex')+'$'+scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
const origin='http://127.0.0.1:5182';
const env={...process.env, NODE_ENV:'production', TURSO_DATABASE_URL:'file:'+join(dir,'test.db').replaceAll('\\','/'), AUTH_SECRET:randomBytes(32).toString('hex'), APP_ORIGIN:origin, AUTH_URL:origin, AUTH_TRUST_HOST:'true', ALLOWED_EMAILS:'owner@example.com', ADMIN_USERS:JSON.stringify({'owner@example.com':stored}), PUBLIC_API_ENABLED:'false'};
delete env.VERCEL;
delete env.TURSO_AUTH_TOKEN;
const migration=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
assert.equal(migration.status,0,migration.stderr);
Object.assign(process.env,env);
await build({entryPoints:['lib/server/password.ts'],outfile:join(dir,'password.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
const mod=await import(pathToFileURL(join(dir,'password.mjs')).href);
assert.equal(await mod.verifyPassword(password,stored),true);
assert.equal(await mod.verifyPassword('wrong',stored),false);
assert.equal(await mod.verifyPassword(password,'bad'),false);
const version=mod.credentialVersion('owner@example.com');
process.env.ADMIN_USERS='{}';
assert.equal(mod.credentialVersion('owner@example.com'),null);
process.env.ADMIN_USERS=JSON.stringify({'owner@example.com':stored.slice(0,-1)+(stored.endsWith('0')?'1':'0')});
assert.notEqual(mod.credentialVersion('owner@example.com'),version);
process.env.ADMIN_USERS=env.ADMIN_USERS;
assert.ok(version);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','5182'],{env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
try {
  let ready=false;
  for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/auth/csrf');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Test server failed to start: '+logs);
  async function attempt(email,pw,csrf=true){
    const response=await fetch(origin+'/api/auth/csrf');
    const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const {csrfToken}=await response.json();
    const r=await fetch(origin+'/api/auth/callback/credentials',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookies,Origin:origin},body:new URLSearchParams({email,password:pw,csrfToken:csrf?csrfToken:'invalid',callbackUrl:origin})});
    return r.headers.getSetCookie().filter(c=>c.includes('session-token=')&&!c.includes('session-token=;')).map(c=>c.split(';')[0]).join('; ');
  }
  assert.equal(await attempt('owner@example.com',password,false),'','CSRF bypass');
  assert.equal(await attempt('other@example.com',password),'','Unknown account authenticated');
  assert.equal(await attempt('owner@example.com','wrong'),'','Wrong password authenticated');
  const cookie=await attempt(' OWNER@example.com ',password);
  assert.ok(cookie,'Correct credentials did not create session');
  const session=await fetch(origin+'/api/auth/session',{headers:{Cookie:cookie}}).then(r=>r.json());
  assert.equal(session.user.email,'owner@example.com');
  assert.equal((await fetch(origin+'/api/admin/overview')).status,401);
  for(let i=0;i<10;i++) await attempt('owner@example.com','wrong');
  assert.equal(await attempt('owner@example.com',password),'','Rate limit bypass');
  console.log('Password auth passed: scrypt, account revocation, CSRF, invalid credentials, real session, admin isolation and persistent rate limit.');
} finally { server.kill(); }

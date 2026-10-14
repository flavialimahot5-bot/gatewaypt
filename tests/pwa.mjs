import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const manifest=JSON.parse(readFileSync('public/braks.webmanifest','utf8'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.start_url,'/topsdlsodo?app=braks-pay');
for(const icon of manifest.icons){
  const metadata=await sharp('public'+icon.src).metadata();
  assert.equal(`${metadata.width}x${metadata.height}`,icon.sizes);
}
const handlers={},notifications=[],opened=[];
const worker={
  addEventListener:(event,callback)=>{handlers[event]=callback;},skipWaiting:async()=>{},
  location:{origin:'https://gateway.example.com'},
  clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)},
  registration:{showNotification:async(title,options)=>notifications.push({title,options})},
};
runInNewContext(readFileSync('public/braks-sw.js','utf8'),{self:worker,URL});
assert.equal(handlers.fetch,undefined,'Never intercept/cache financial or checkout requests');
let task;
handlers.push({data:{json:()=>({title:'Venda aprovada',body:'R$ 67,88',tag:'test-paid',url:'https://evil.example'})},waitUntil:p=>{task=p;}});
await task;
assert.equal(notifications[0].title,'Venda aprovada');
assert.equal(notifications[0].options.data.url,'/topsdlsodo?section=Dashboard');
handlers.notificationclick({notification:{close(){},data:{url:'/topsdlsodo?section=Vendas'}},waitUntil:p=>{task=p;}});
await task;
assert.deepEqual(opened,['/topsdlsodo?section=Vendas']);
handlers.push({data:{json:()=>{throw Error('invalid');}},waitUntil:p=>{task=p;}});
await task;
assert.equal(notifications[1].title,'Goti Pay');
console.log('PWA: manifest, real icon sizes, visible notifications, safe click URLs and no financial caching passed.');

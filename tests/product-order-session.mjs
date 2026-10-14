import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".sites-runtime", { recursive: true });
await build({entryPoints:["lib/product-order-session.ts"],outfile:".sites-runtime/product-order-session.mjs",bundle:true,platform:"node",format:"esm"});
const {finishProductSession}=await import("../.sites-runtime/product-order-session.mjs");
const data=new Map();
globalThis.sessionStorage={getItem:key=>data.get(key)||null,removeItem:key=>data.delete(key)};
const key="product-order:product-a", saved=JSON.stringify({attempt:"original-attempt",token:"co_original"});
data.set(key,saved);
for(const status of ["PENDING","CREATING"]){
  assert.equal(finishProductSession("product-a","co_original",status,true),false);
  assert.equal(data.get(key),saved,"pending attempts must survive reload without another Pix");
}
for(const status of ["PAID","EXPIRED","FAILED","REFUNDED","CHARGEBACK"]){
  data.set(key,saved);
  assert.equal(finishProductSession("product-a","co_original",status,true),true,"reopening a completed product starts a new purchase");
  assert.equal(data.has(key),false);
  data.set(key,saved);
  assert.equal(finishProductSession("product-a","co_original",status,false),false,"live confirmation remains visible and can redirect to upsell");
  assert.equal(data.has(key),false,"completion clears storage before upsell navigation");
}
data.set(key,saved);data.set("product-order:product-b",saved);
finishProductSession("product-a","co_old","PAID",false);
assert.equal(data.get(key),saved,"a late response cannot erase another attempt");
finishProductSession("product-a","co_original","PAID",false);
assert.equal(data.get("product-order:product-b"),saved,"other products retain their own pending checkout");
sessionStorage.getItem=()=>{throw new Error("storage blocked")};
assert.equal(finishProductSession("product-a","co_original","PAID",true),true);
delete globalThis.sessionStorage;
console.log("Repeat purchase: pending idempotency, completed-session reset, live receipt, product isolation and blocked storage passed.");

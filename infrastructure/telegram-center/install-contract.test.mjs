import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir=new URL('./',import.meta.url);
test('installer validates and copies the complete transitive service import graph',()=>{
 const installer=fs.readFileSync(new URL('install.sh',dir),'utf8');
 const loops=[...installer.matchAll(/for file in ([^;]+); do/g)].map(m=>new Set(m[1].split(/\s+/)));
 assert.equal(loops.length,2);
 const visited=new Set();
 function visit(name){if(visited.has(name))return;visited.add(name);
   for(const list of loops)assert.ok(list.has(name),`Missing runtime module: ${name}`);
   const source=fs.readFileSync(new URL(name+'.mjs',dir),'utf8');
   for(const match of source.matchAll(/from ['"]\.\/([^'"]+)\.mjs['"]/g))visit(match[1]);
 }
 visit('service');
});

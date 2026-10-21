import test from 'node:test';import assert from 'node:assert/strict';import {productLink} from './product-links.mjs';
test('only complete validated ID mappings identify a product',()=>{
 const r={campaignId:'1',source:'operator',validatedAt:'2026-10-20T10:00Z',coverage:'COMPLETE',products:[{sku:'A',name:'Producto A'}]};
 assert.equal(productLink('1',[r]).name,'Producto A');assert.equal(productLink('2',[r]),null);
 assert.equal(productLink('1',[{...r,coverage:'PARTIAL'}]),null);assert.equal(productLink('1',[r,r]),null);
 assert.equal(productLink('1',[{...r,products:[...r.products,{productId:'B',name:'B'}]}]).name,'Varios productos');
 assert.equal(productLink('1',[{...r,validatedAt:'2999-01-01'}]),null);
});

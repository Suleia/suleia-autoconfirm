import test from 'node:test';
import assert from 'node:assert/strict';
import {findDetailsReceipt} from './address-receipt.mjs';
test('address details reconcile only an exact outgoing provider receipt in its attempt window',()=>{
 const at='2026-10-13T10:00:00Z',content='Para completar la dirección de tu pedido, indícanos: código postal. Gracias.';
 const m={type:'out',mid:'wamid.test',user_ns:'fixture',ts:Date.parse(at)/1000+20,text:content};
 const input={messages:[m],content,attemptedAt:at,conversationId:'fixture'};
 assert.equal(findDetailsReceipt(input).messageId,'wamid.test');
 for(const delta of [{type:'in'},{user_ns:'other'},{mid:'not-provider-id'},{text:'different request'},{ts:m.ts-1000},{ts:m.ts+1000}])assert.equal(findDetailsReceipt({...input,messages:[{...m,...delta}]}),null);
 assert.equal(findDetailsReceipt({...input,messages:[m,{...m,mid:'wamid.other'}]}),null);
});

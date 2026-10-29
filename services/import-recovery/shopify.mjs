import {normalizeId,digest} from './policy.mjs';

export const SHIPPING_MUTATION=`mutation RecoveryShippingAddress($input: OrderInput!) {
  orderUpdate(input: $input) { order { id } userErrors { field message } }
}`;

// requestOnce is a dedicated authenticated transport WITHOUT retries. Never use
// createShopifyReadAuth/fetchWithRetry for this mutation, nor customerUpdate.
export function recoveryShopify({shop,apiVersion='2026-04',requestOnce}){
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^20\d{2}-(01|04|07|10)$/.test(apiVersion)||typeof requestOnce!=='function')throw Error('RECOVERY_SHOPIFY_CONFIG_INVALID');
  const root=`https://${shop}/admin/api/${apiVersion}/`;
  const lastRead=new Map(),snapshot=o=>{const c=structuredClone(o);delete c.updated_at;return digest(c);};
  const checkShop=scope=>{if(scope!==shop)throw Error('RECOVERY_SHOP_MISMATCH');};
  return {
    async readOrder(id,scope){
      checkShop(scope);const r=await requestOnce(root+`orders/${normalizeId(id)}.json`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!r.ok)throw Error('RECOVERY_SHOPIFY_READ_FAILED');const j=await r.json();if(!j.order||normalizeId(j.order.id)!==normalizeId(id))throw Error('RECOVERY_SHOPIFY_SOURCE_INVALID');lastRead.set(normalizeId(id),snapshot(j.order));return j.order;
    },
    async updateShippingAddress(id,scope,address){
      checkShop(scope);
      // OrderInput replaces shippingAddress. Carry every contact field through,
      // including null/empty values, from a fresh exact-order GET.
      const expected=lastRead.get(normalizeId(id));if(!expected)throw Error('RECOVERY_FRESH_SOURCE_REQUIRED');
      const before=await this.readOrder(id,scope),a=before.shipping_address||{};
      if(snapshot(before)!==expected)throw Error('SOURCE_CHANGED_BEFORE_ADDRESS_WRITE');
      const shippingAddress={address1:address.street,address2:address.line2||'',city:address.city,province:address.province,zip:address.postalCode,country:address.country};
      for(const v of Object.values(shippingAddress))if(typeof v!=='string')throw Error('RECOVERY_SHIPPING_ADDRESS_INVALID');
      Object.assign(shippingAddress,{firstName:a.first_name??null,lastName:a.last_name??null,phone:a.phone??null,company:a.company??null});
      const input={id:`gid://shopify/Order/${normalizeId(id)}`,shippingAddress};
      const r=await requestOnce(root+'graphql.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:SHIPPING_MUTATION,variables:{input}}),redirect:'error',signal:AbortSignal.timeout(30000)});
      const j=await r.json().catch(()=>null);
      if(!r.ok||j?.errors||j?.data?.orderUpdate?.userErrors?.length||j?.data?.orderUpdate?.order?.id!==input.id)throw Error('RECOVERY_SHOPIFY_WRITE_UNVERIFIED');
      return {id:input.id}; // Agent always performs fresh independent GET.
    }
  };
}

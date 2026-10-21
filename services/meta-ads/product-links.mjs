// Explicit operator-validated catalogue. Campaign names never establish identity.
export function productLink(campaignId, links=[], now=Date.now()) {
  const rows=links.filter(r=>String(r.campaignId)===String(campaignId));
  if(rows.length!==1)return null;
  const r=rows[0],at=Date.parse(r.validatedAt);
  if(r.coverage!=='COMPLETE'||!r.source||!Number.isFinite(at)||at>now||!Array.isArray(r.products)||!r.products.length)return null;
  if(r.products.some(p=>!(p.productId||p.sku)||typeof p.name!=='string'||!p.name.trim()))return null;
  return {campaignId:String(campaignId),source:String(r.source),validatedAt:r.validatedAt,coverage:r.coverage,
    products:r.products.map(p=>({productId:p.productId||null,sku:p.sku||null,name:p.name})),
    name:r.products.length>1?'Varios productos':r.products[0].name};
}

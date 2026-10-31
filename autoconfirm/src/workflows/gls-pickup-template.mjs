import {createHash} from 'node:crypto';
export const PICKUP_TEMPLATE='suleia_gls_recogida_aviso_1_v1';
export const PICKUP_OWNER='EXISTING_AUTHORIZED_CHATBY_SENDER';
export const PICKUP_LANGUAGE='es_ES';
// Owner's final inline mapping. No renumbering or semantic substitutions.
export const PICKUP_VARIABLES=['customer_name','order_number','products','amount','agency_name','address_line','locality','opening_hours','phone','tracking_url'];
export const PICKUP_BODY=`📦 *¡Tu pedido de Suleia ya está listo para recoger!*

¡Hola, {{1}}! 😊

Tenemos buenas noticias: tu pedido ya está disponible en una agencia GLS. 💚

Te dejamos todos los detalles para que puedas recogerlo cómodamente:

📍 *¿DÓNDE PUEDES RECOGERLO?*

🏢 *Agencia GLS:* {{5}}
📍 *Dirección:* {{6}}
🏙️ *Localidad:* {{7}}
🕒 *Horario de recogida:* {{8}}
📞 *Teléfono de la agencia:* {{9}}

🛍️ *DATOS DE TU PEDIDO*

📦 *N.º de pedido:* {{2}}
✨ *Producto:* {{3}}
💶 *Importe a pagar:* {{4}}

💚 *¡Importante!* Recuerda llevar el importe indicado para abonar tu pedido en el momento de la recogida.

🔎 *Seguimiento de tu envío:*
{{10}}

Si tienes alguna duda o necesitas ayuda con la recogida, puedes responder directamente a este mensaje. ¡Estaremos encantados de ayudarte! 😊

*Gracias por confiar en Suleia.*
*Equipo Suleia* 💚`;
export const PICKUP_HASH=createHash('sha256').update(PICKUP_BODY).digest('hex');
export const PICKUP_EXAMPLES=['María','ES1234567','CollaGum × 2','29,99 €','GLS Madrid','Calle Ejemplo 1','28001 Madrid, Madrid','L–V 09:00–14:00 y 16:00–19:00','910000000','https://mygls.gls-spain.es/e/123456789/28001/es'];
export function pickupTemplatePayload(){return {name:PICKUP_TEMPLATE,language:PICKUP_LANGUAGE,category:'UTILITY',components:[{type:'BODY',text:PICKUP_BODY,example:{body_text:[PICKUP_EXAMPLES]}}]};}
export function pickupTemplateStatus(rows){
 const same=(rows||[]).filter(r=>r.name===PICKUP_TEMPLATE&&r.language===PICKUP_LANGUAGE);
 if(same.length!==1)return {approved:false,status:same.length?'AMBIGUOUS':'NOT_CREATED'};
 const r=same[0];let parts=r.components;try{if(typeof parts==='string')parts=JSON.parse(parts);}catch{parts=[];}
 const exact=Array.isArray(parts)&&parts.length===1&&parts[0].type==='BODY'&&parts[0].text===PICKUP_BODY;
 return {approved:exact&&r.status==='APPROVED'&&r.category==='UTILITY'&&!!r.id&&!!r.wa_template_id,exact,status:r.status,category:r.category,id:r.id,meta_id:r.wa_template_id,namespace:r.namespace,hash:exact?PICKUP_HASH:null};
}
export function pickupParameters(values){
 return Object.fromEntries(PICKUP_VARIABLES.map((name,i)=>{const v=String(values[name]??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();if(!v||v.length>600||/\{\{|\}\}|[\u0000-\u001f]/.test(v))throw Error('PICKUP_PARAMETER_INVALID_'+name.toUpperCase());return [`BODY_{{${i+1}}}`,v];}));
}

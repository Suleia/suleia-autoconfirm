// Customer evidence only. Carrier labels are deliberately not an input.
export const deliveryText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function customerDeliverySignals(value){
 const t=deliveryText(value),empty={wants_order:false,waiting_for_order:false,delivery_attempt_denied_by_customer:false,requests_redelivery:false,reports_non_delivery:false,explicit_desire:false,conditional:false};
 if(!t||t.length>1000||/https?:|ignora.*instrucciones/.test(t))return empty;
 const conditional=/\b(?:solo si|solamente si|si me|si hacen|si tengo|si dispongo|quizas?|tal vez|puede que|no se(?! (?:ha|han|paso|presento)\b))\b/.test(t);
 if(conditional)return {...empty,conditional:true};
 if(/\b(?:quiero recibirlo|sigo esperando|estoy esperando)\b/.test(t)&&!/\bno quiero recibirlo\b/.test(t)&&/\b(?:devolverlo|devolver|cancelalo)\b/.test(t))return {...empty,contradictory:true};
 if(/\b(?:ya no lo quiero|no lo quiero|no quiero (?:el|mi|este) pedido|no quiero recibirlo|no (?:sigo|estoy) esperando|devolverlo|devuelvelo|cancelalo)\b/.test(t))return empty;
 const waiting=/\b(?:sigo|seguimos|estoy|estamos) esperando\b|\bsigo sin recibir(?:lo| el pedido| mi pedido)?\b|\bestoy esperando que llegue\b/.test(t);
 const receive=/\bquiero recibir(?:lo| el pedido| mi pedido)\b|\bquiero que.*(?:entreguen|traigan)\b|\b(?:cuando|a que hora).*(?:me|nos) lo (?:van a )?entregar\b/.test(t);
 const noAttempt=/\bnadie (?:ha |a )?(?:venido|pasado|acudido)\b|\bno (?:se )?(?:ha |han )?(?:pasado|presentado|venido)(?: el repartidor)?\b|\bno (?:me |lo |me lo )?(?:ha|han) intentado entregar(?:lo)?\b|\bno ha (?:venido|acudido) nadie\b/.test(t);
 // Accept bounded common spacing mistakes ("me a llegado", "meallegado").
 const nonDelivery=/\bno (?:me\s*|nos |le |les )?(?:(?:ha|han|a|an|habia|habian)\s*)?(?:llegado|entregado|recibido|traido)\b|\bno (?:me |nos )?(?:ha|han) realizado (?:la |ninguna )?entrega\b/.test(t);
 const wants=waiting||receive||noAttempt||nonDelivery;
 const qualified=/\b(?:hoy|manana|tarde|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hora|partir|despues|antes|desde|entre|agencia|recoger|direccion|calle|postal|piso|puerta|efectivo|dinero|importe|pagar|pago|precio|descuento|euros|tarjeta)\b|\d/.test(t);
 return {wants_order:wants,waiting_for_order:wants,delivery_attempt_denied_by_customer:noAttempt,requests_redelivery:wants,reports_non_delivery:noAttempt||nonDelivery,explicit_desire:waiting||receive,delivery_qualification:qualified,conditional:false};
}
export function newDeliverySolution(signals){
 return ['El cliente confirma que sigue esperando y quiere recibir su pedido.',signals.delivery_attempt_denied_by_customer?'Indica que nadie ha acudido a realizar la entrega.':signals.reports_non_delivery?'Indica que todavía no ha recibido el pedido.':null,'Por favor, realizar una nueva entrega.'].filter(Boolean).join(' ');
}

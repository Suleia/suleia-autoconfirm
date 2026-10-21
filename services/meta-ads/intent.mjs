const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿?¡!]+|[¿?¡!.,]+$/g,'').replace(/\s+/g,' ').trim();
export function parseAdsIntent(input) {
  const text = clean(input).replace(/roas\s*\+\s*(\d)/g,'roas superior a $1').replace(/roas\s*-\s*(\d)/g,'roas inferior a $1');
  const periodMatch = /\b(hoy|ayer|ultimos (?:3|tres|7|siete|30|treinta) dias)\b/.exec(text);
  const period = periodMatch ? ({ 'ultimos tres dias':'3d','ultimos 3 dias':'3d','ultimos siete dias':'7d','ultimos 7 dias':'7d','ultimos treinta dias':'30d','ultimos 30 dias':'30d' }[periodMatch[1]] || periodMatch[1]) : null;
  if(!/^(sube|aumenta|baja|reduce|pon|fija|establece)\b/.test(text)&&/bloques|algoritmo|distribuyendo|estables|estabilidad|volatil|escalarias|escalar manana|plan de presupuestos|ultima vez|ultima subida|despues de|conviene (?:bajar|subir|mantener)|perjudicado|preparada para escalar|ha subido el cpm|fatigando|informe matinal/.test(text))return {kind:'algorithm',period:'30d',question:text};
  if (/\b(no|nunca|manana|automaticamente|cada|despues)\b/.test(text)) return { kind:'clarify', question:'Indica una única acción inmediata, campaña o filtro, importe y periodo.' };
  const filter = /roas (superior a|mayor que|inferior a|menor que) (\d+(?:[.,]\d+)?)/.exec(text);
  const change = /^(sube|aumenta|baja|reduce|pon|fija|establece)\b/.exec(text);
  if (change) {
    if (/rentables|optimizacion/.test(text)) return { kind:'clarify', question:'Indica el objetivo de ROAS o margen y el periodo; rentable no equivale a ROAS positivo.' };
    const amounts = [...text.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(€|euros?|%|por ciento)/g)];
    if (amounts.length !== 1) return { kind:'clarify', question:'Indica un único importe en euros o porcentaje.' };
    const amount = amounts[0], target=/\ba \d+(?:[.,]\d{1,2})?\s*(?:€|euros?)(?: diarios)?$/.test(text), mode = ['pon','fija','establece'].includes(change[1])||target ? 'set' : ['baja','reduce'].includes(change[1]) ? 'decrease' : 'increase';
    if (mode === 'set' && ['%','por ciento'].includes(amount[2])) return {kind:'clarify',question:'Para fijar un presupuesto indica euros, no un porcentaje.'};
    if (filter) {
      const remainder = text.replace(change[0],'').replace(amount[0],'').replace(filter[0],'').replace(periodMatch?.[0]||'\u0000','');
      if (!/^(?:\s|el|presupuesto|de|a|las|todas|campanas|activas|que|tengan|un|con)+$/.test(remainder)) return {kind:'clarify',question:'No he podido delimitar el filtro. Indica todas las campañas activas y un único criterio de ROAS.'};
      return {kind:'budget',mode,value:amount[1].replace(',','.'),unit:['%','por ciento'].includes(amount[2])?'percent':'money',selector:'ALL_ACTIVE',period:period||'hoy',filter:{operator:['superior a','mayor que'].includes(filter[1])?'gt':'lt',threshold:Number(filter[2].replace(',','.'))}};
    }
    let selector = text.slice(change[0].length).replace(/ diarios$/,'').replace(amount[0],'').replace(/^(?: el presupuesto de | el presupuesto | un | a | de )/,'').trim();
    selector = selector.replace(/^(?:el )?presupuesto (?:de )?/,'').replace(/^(?:a |de |la campana )/,'').replace(/ (?:a|en)$/,'').trim();
    if (!selector || /\b(campanas|todas|todos|hoy|ayer|roas|si|cuando)\b/.test(selector)) return {kind:'clarify',question:'Indica una campaña concreta o un filtro completo con periodo.'};
    return {kind:'budget',mode,value:amount[1].replace(',','.'),unit:['%','por ciento'].includes(amount[2])?'percent':'money',selector,period:null,filter:null,...(target&&!['pon','fija','establece'].includes(change[1])?{direction:['baja','reduce'].includes(change[1])?'decrease':'increase'}:{})};
  }
  if (/^(analiza|analizame|compara|comparame|que |por que |donde |prepara)/.test(text)) {
    if(/respecto a ayer/.test(text)&&!/\bhoy\b/.test(text))return {kind:'clarify',question:'¿Quieres comparar hoy con ayer o ayer con el día anterior?'};
    const reportPeriod=period||(/desde ayer/.test(text)?'ayer':'7d');
    const level = /anuncios/.test(text) && !/conjuntos/.test(text) ? 'ad' : /conjuntos/.test(text) ? 'adset' : 'campaign';
    const name = /(?:conjuntos de anuncios|anuncios|campanas|clientes) de (.+?)(?: hoy| ayer| (?:de )?los ultimos| ultimos|$)/.exec(text)?.[1] || /por que (.+?) ha empeorado/.exec(text)?.[1] || /mejorar de (.+?)(?: hoy| ayer|$)/.exec(text)?.[1] || /presupuesto recomendarias para (.+?)(?: hoy| ayer|$)/.exec(text)?.[1] || null;
    return {kind:'analysis',level,period:reportPeriod,selector:name,focus:/apaga|pausa/.test(text)?'improve':/mejor|funcionando/.test(text)?'top':/escalar|presupuesto|reducir gasto/.test(text)?'opportunities':/donde|perdiendo/.test(text)?'funnel':'diagnosis',compare:/compara|empeorado|respecto/.test(text)};
  }
  return {kind:'clarify',question:'Indica la acción, campaña o filtro, importe y periodo. Ejemplo: «Sube 10 € el presupuesto de todas las campañas activas que tengan un ROAS superior a 5 hoy».'};
}

export function budgetAfter(before, intent) {
  const value = String(intent.value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error('AMOUNT_INVALID');
  const [euros, cents=''] = value.split('.'), hundredths = Number(euros)*100 + Number(cents.padEnd(2,'0'));
  if (!Number.isSafeInteger(before) || before <= 0 || !Number.isSafeInteger(hundredths) || hundredths <= 0) throw Error('AMOUNT_INVALID');
  if (intent.mode === 'set') return hundredths;
  if (!['increase','decrease'].includes(intent.mode) || !['money','percent'].includes(intent.unit)) throw Error('CHANGE_INVALID');
  // Integer rational rounding, once, to the nearest EUR cent.
  const delta = intent.unit === 'percent' ? Number((BigInt(before)*BigInt(hundredths)+5000n)/10000n) : hundredths;
  return before + (intent.mode === 'increase' ? delta : -delta);
}

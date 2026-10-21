/* Uses the existing authenticated API. No provider credential or mutation UI. */
const AdsIntelligencePanel=(()=>{
  let period='7d',level='campaign',request=0;
  const metric=v=>v===null||v===undefined?'No disponible':Number(v).toLocaleString('es-ES',{maximumFractionDigits:2});
  const labels={MAX_BUDGET:'Supera el presupuesto máximo',MAX_CHANGE_PERCENT:'Supera el porcentaje de cambio permitido',MIN_BUDGET:'Inferior al presupuesto mínimo',INSUFFICIENT_SAMPLE:'Muestra insuficiente',SAMPLE_POLICY_NOT_CONFIGURED:'Falta configurar los mínimos de muestra',CAMPAIGN_DAILY_BUDGET_REQUIRED:'Sin presupuesto diario a nivel campaña',CAMPAIGN_INACTIVE:'Campaña inactiva',ROAS_FILTER_NOT_MET:'No cumple el filtro de ROAS',ROAS_MISSING:'ROAS ausente',ROAS_AMBIGUOUS:'ROAS ambiguo',ROAS_ZERO_SPEND:'Gasto cero',AUTOMATION_CONFLICT:'Conflicto potencial con una regla automática',METRIC_CHANGED:'Las métricas han cambiado',REVALIDATION_FAILED:'Cambio rechazado al volver a comprobarlo',PROVIDER_RESULT_UNKNOWN:'Resultado de Meta incierto',EXECUTION_INTERRUPTED_REVIEW_REQUIRED:'Ejecución interrumpida; necesita revisión',UNRESOLVED_OPERATION:'Operación anterior sin reconciliar',CIRCUIT_OPEN:'Ejecución bloqueada temporalmente por errores',PENDING:'Pendiente',SIMULATED:'Simulado',BLOCKED:'Bloqueado',STALE:'Datos cambiados',UNKNOWN:'Resultado incierto',REVIEW_REQUIRED:'Revisión necesaria',RUNNING:'En curso',EXPIRED:'Caducado',CANCELLED:'Cancelado',VERIFIED:'Verificado',RECONCILED:'Reconciliado'};
  const label=v=>labels[v]||v;
  Object.assign(labels,{FAILED:'Rechazado por Meta',COMPLETED:'Procesado',LAST_MOMENT_REVALIDATION_FAILED:'Presupuesto o estado cambiado justo antes del envío',LIVE_CANARY_ONLY:'Fuera de la campaña autorizada para la prueba'});
  const block=(title)=>{const el=node('section','ads-card');el.append(node('h3','',title));return el;};
  const line=(label,value)=>{const p=node('p');p.append(node('strong','',label+': '),node('span','',value));return p;};
  function diagnosis(d){
    const el=node('details','ads-diagnosis'),head=node('summary','',`${d.code} · ${d.severity} · Confianza ${d.confidence}`);el.append(head);
    el.append(line('Evidencia',JSON.stringify(d.evidence)),line('Causa probable',d.probableCause),line('Otras causas',d.alternatives.join('; ')||'Sin hipótesis alternativa documentada'),line('Impacto',d.impact),line('Acción recomendada',d.recommendedAction),line('Resultado esperado',d.expectedResult),line('Riesgos',d.risk));return el;
  }
  function proposal(p){
    const el=block(`Propuesta ${p.id} · ${label(p.state)}`);el.append(node('p','',p.request),line('Modo',p.mode),line('Caducidad',date(p.expiresAt)));
    for(const i of p.items){const row=node('div','ads-operation');row.append(node('strong','',`${i.name} · ${i.campaignId}`),line('Presupuesto',`${money(i.before===null?null:i.before/100)} → ${money(i.after===null?null:i.after/100)}/día`),line('Resultado',label(i.result?.state||'Pendiente')),line('Motivos',([...(i.result?.reasons||[]),...i.reasons]).map(label).join('; ')||'Sin bloqueos registrados'));
      if(i.result?.state==='UNKNOWN'||i.result?.state==='EXECUTING')row.append(node('p','ads-warning','Revisión necesaria: reconciliar Meta antes de cualquier nueva operación.'));
      el.append(row);
    }return el;
  }
  function render(data){
    const root=$('ads-view');root.replaceChildren();
    const filters=node('div','ads-card');
    for(const [label,items,selected,onChange] of [
      ['Periodo',[['hoy','Hoy'],['ayer','Ayer'],['3d','3 días completos'],['7d','7 días completos'],['30d','30 días completos']],period,v=>{period=v;}],
      ['Nivel',[['campaign','Campañas'],['adset','Conjuntos'],['ad','Anuncios']],level,v=>{level=v;}]
    ]){const field=node('label','',label+' '),select=node('select');select.setAttribute('aria-label',label);for(const[value,text]of items){const option=node('option','',text);option.value=value;option.selected=value===selected;select.append(option);}select.addEventListener('change',()=>{onChange(select.value);load();});field.append(select);filters.append(field);}root.append(filters);
    const header=block('Ads Intelligence');header.append(node('p','',`${data.range.since} → ${data.range.until} · Europe/Madrid · ${data.mode}`),line('Última consulta',date(data.observedAt)),node('p','ads-warning',data.liveEnabled?'Prueba LIVE limitada a la campaña autorizada. Cada operación requiere confirmación en Telegram.':'LIVE desactivado. Las propuestas se confirman en Telegram y se ejecutan en simulación. ROAS atribuido no equivale a beneficio neto.'),line('Atribución','7 días clic + 1 día visualización · fecha de conversión'));root.append(header);
    const controls=block('Límites y automatizaciones');controls.append(line('Máximo por campaña',money(data.limits.maxBudgetCents===null?null:data.limits.maxBudgetCents/100)),line('Cambio máximo',metric(data.limits.maxChangePercent)+' %'),line('Mínimos de muestra',`Gasto ${money(data.limits.minSpend)}, compras ${metric(data.limits.minPurchases)}, impresiones ${metric(data.limits.minImpressions)}`),line('Reglas nativas observadas',String(data.inventory.rules.length)),node('p','',data.inventory.rules.length?'Los posibles conflictos bloquean las propuestas hasta revisión.':'No se observaron reglas nativas en la consulta; no acredita ausencia de cambios por operadores externos.'));root.append(controls);
    const grid=node('div','ads-grid'),campaigns=new Map(data.inventory.campaigns.map(c=>[String(c.id),c])),recommended=new Map();
    for(const p of data.proposals)if(p.state==='PENDING'&&p.expiresAt>Date.now())for(const i of p.items)if(!i.reasons.length&&!recommended.has(i.campaignId))recommended.set(i.campaignId,i.after);
    for(const f of data.facts){const c=campaigns.get(f.campaignId),el=block(f.name||f.entityId);el.append(line('Presupuesto actual',c?.daily_budget?money(Number(c.daily_budget)/100)+'/día':'Sin presupuesto diario a nivel campaña'),line('Gasto',money(f.spend)),line('Compras / valor',`${metric(f.purchases)} / ${money(f.purchaseValue)}`),line('ROAS',`${metric(f.roas)} · ${f.roasStatus}`),line('CPM / CTR enlace / CPC enlace',`${money(f.cpm)} / ${metric(f.linkCtr)} % / ${money(f.linkCpc)}`),line('Alcance / frecuencia',`${metric(f.reach)} / ${metric(f.frequency)}`),line('Embudo',`Clics ${metric(f.linkClicks)} → Landing ${metric(f.landingPageViews)} → Carritos ${metric(f.addToCart)} → Checkout ${metric(f.initiateCheckout)} → Compras ${metric(f.purchases)}`));
      el.append(line('Presupuesto propuesto',recommended.has(f.campaignId)?money(recommended.get(f.campaignId)/100)+'/día':'Sin propuesta validada pendiente'));
      if(f.source==='META_NO_INSIGHT_ROW')el.append(node('p','','Meta no devuelve fila de Insights para esta entidad en el periodo. No se interpreta como gasto cero.'));
      if(!f.diagnoses.length)el.append(node('p','','Sin señal concluyente con la referencia y muestra disponibles.'));for(const d of f.diagnoses)el.append(diagnosis(d));grid.append(el);
    }root.append(grid);
    const history=block('Propuestas pendientes e historial de modificaciones');if(!data.proposals.length)history.append(node('p','','Sin propuestas registradas.'));for(const p of data.proposals)history.append(proposal(p));root.append(history);
  }
  async function load(){const current=++request,root=$('ads-view');try{const data=await api('/api/operations/ads-intelligence?period='+period+'&level='+level);if(current===request)render(data);}catch{if(current===request)root.replaceChildren(node('p','notice','Ads Intelligence aún no está habilitado o no puede consultar datos actuales. Revisa la configuración del servicio antes de usar sus resultados.'));}}
  return {load};
})();

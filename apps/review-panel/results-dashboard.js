/* Presentation of the canonical finance response. No revenue/cost/rate calculation. */
const ResultsV2 = (() => {
  const present=v=>v!==null && v!==undefined && Number.isFinite(Number(v));
  const count=v=>present(v)?number(v):'—';
  const multiplier=v=>present(v)?`${new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(v)}x`:'—';
  const palette={green:'#10a87e',blue:'#398af5',red:'#f45b79',violet:'#9670ed',amber:'#edb34c',gray:'#a3b4c7'};
  const columns=[['Día','day'],['Pedidos','created'],['Facturación','realRevenue'],['Costes','totalCosts'],['Beneficio','netProfit'],['Margen','marginPercent'],['ROI','roiPercent'],['ROAS','roas'],['Confirmados','confirmed'],['Entregados','delivered'],['Devueltos','returned'],['En tránsito','inTransit'],['Publicidad','metaSpend']];
  let visible=new Set(['day','created','realRevenue','totalCosts','netProfit','confirmed','delivered','returned','metaSpend','roas']);
  let historyWindow=9;
  function StatusBadge(label,tone='gray'){return node('span',`rv-status ${tone}`,label);}
  function MetricTooltip(label,description){const root=node('details','rv-metric-tooltip'),summary=node('summary','','ⓘ');summary.setAttribute('aria-label',`Cómo se calcula ${label}`);root.append(summary,node('p','',description));return root;}
  function Sparkline(values,tone){
    const svg=svgEl('svg',{viewBox:'0 0 100 28',class:`rv-sparkline ${tone}`,'aria-hidden':true});
    const vals=values.filter(present).map(Number);if(vals.length<2)return svg;
    const min=Math.min(...vals),span=Math.max(1,Math.max(...vals)-min);let points=[];
    const flush=()=>{if(points.length)svg.append(svgEl('polyline',{points:points.join(' '),fill:'none',stroke:palette[tone]||palette.green,'stroke-width':1.8}));points=[];};
    values.forEach((v,i)=>{if(!present(v)){flush();return;}points.push(`${2+i*96/Math.max(1,values.length-1)},${25-(v-min)*22/span}`);});flush();return svg;
  }
  function KpiCard({label,value,field,tone,icon,series,definition,lowerBetter=false,mode='percent'},data){
    const card=node('article',`rv-kpi ${tone}`),symbol=node('span','rv-kpi-icon');symbol.append(financeIcon(icon));
    card.setAttribute('data-metric',field);card.append(symbol,node('span','rv-kpi-label',label),node('strong','rv-kpi-value',value));
    const delta=data.comparison?.available===true?data.comparison.deltas?.[field]:null;
    const raw=mode==='percent'?delta?.percent:delta?.absolute;
    let comparison=node('small','rv-comparison unavailable','Sin comparación disponible');
    if(present(raw)){
      const better=lowerBetter?Number(raw)<0:Number(raw)>0;
      comparison=node('small',`rv-comparison ${Number(raw)===0?'neutral':better?'better':'worse'}`,`${Number(raw)>0?'↗ +':Number(raw)<0?'↘ −':'→ '}${new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(Math.abs(raw))}${mode==='points'?' pp':mode==='multiplier'?'x':' %'}`);
      comparison.title=`Respecto a ${data.comparison.period?.since || 'periodo anterior'} — ${data.comparison.period?.until || ''}`;
    }
    card.append(comparison,Sparkline(series,tone),MetricTooltip(label,`${definition || 'Definición no disponible en este informe.'} Periodo: ${data.period?.since || '—'} a ${data.period?.until || '—'} · Europe/Madrid.`));return card;
  }
  function SourceStatus(label,source,blocked=false){
    const status=blocked?'STALE':source?.status || 'UNAVAILABLE';
    const root=node('div',`rv-source ${status==='OK'?'fresh':status==='STALE'?'stale':'unknown'}`);
    root.append(node('span','rv-source-icon',label==='Meta'?'∞':label==='Dropea'?'✓':'▤'),stacked(label,status==='OK'?'Sincronizado':status==='STALE'?'Pendiente de actualizar':'No verificable'));
    const stamp=source?.lastSyncAt;root.append(node('small','',stamp?incidentDate(stamp):'Sin marca de tiempo'));return root;
  }
  function DataQualityBadge(data){
    const stale=Object.values(data.freshness?.sources||{}).some(s=>s?.status==='STALE');
    const complete=data.quality?.status==='OK' && data.coverage?.exactProfitAvailable!==false && present(data.totals?.exactNetProfit);
    if(stale)return StatusBadge('DATOS ATRASADOS','amber');
    if(!complete || ['dropea','meta','report'].some(k=>!['OK','STALE'].includes(data.freshness?.sources?.[k]?.status)))return StatusBadge('INCOMPLETO · revisar cobertura','amber');
    if(data.period?.current)return StatusBadge(`PROVISIONAL · MTD hasta ${incidentDate(data.period.until).split(',')[0]}`,'amber');
    if(Number(data.accounting?.unsettledOrders)>0 || data.coverage?.dropeaBreakdownPercent!==100)return StatusBadge('PROVISIONAL','amber');
    return StatusBadge('CONCILIADO','green');
  }
  function ChartCard(title,subtitle,chart,control=null){const card=node('article','rv-chart-card'),head=node('header','rv-chart-head');head.append(stacked(title,subtitle));if(control)head.append(control);card.append(head,chart);return card;}
  function legend(rows){const root=node('div','rv-legend');for(const [label,tone] of rows){const item=node('span');const dot=node('i');dot.style.background=palette[tone];item.append(dot,document.createTextNode(label));root.append(item);}return root;}
  function chartFrame(values,{percent=false}={}){
    const width=420,height=208,left=45,right=12,top=14,bottom=31;
    const scale=percent?{minimum:0,maximum:100,ticks:[0,25,50,75,100]}:niceMoneyScale(values.filter(present),3);
    const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,role:'img',class:'rv-chart-svg'});
    const y=v=>top+(scale.maximum-Number(v))/(scale.maximum-scale.minimum||1)*(height-top-bottom);
    for(const tick of scale.ticks){svg.append(svgEl('line',{x1:left,x2:width-right,y1:y(tick),y2:y(tick),class:tick===0?'rv-zero':'rv-grid'}));const label=svgEl('text',{x:left-6,y:y(tick)+3,'text-anchor':'end',class:'rv-axis'});label.textContent=percent?`${tick}%`:new Intl.NumberFormat('es-ES',{notation:'compact',maximumFractionDigits:1}).format(tick);svg.append(label);}
    return {svg,y,width,height,left,right,top,bottom,x:(i,n)=>left+(i+.5)*(width-left-right)/Math.max(1,n)};
  }
  function line(frame,rows,key,tone,{area=false}={}){
    let segment=[];const flush=()=>{if(segment.length){if(area && segment.length>1)frame.svg.append(svgEl('polygon',{points:`${segment[0].split(',')[0]},${frame.y(0)} ${segment.join(' ')} ${segment.at(-1).split(',')[0]},${frame.y(0)}`,fill:palette[tone],opacity:.10}));frame.svg.append(svgEl('polyline',{points:segment.join(' '),fill:'none',stroke:palette[tone],'stroke-width':2.1}));}segment=[];};
    rows.forEach((r,i)=>{if(!present(r[key])){flush();return;}segment.push(`${frame.x(i,rows.length)},${frame.y(r[key])}`);});flush();
  }
  function dayDetails(row,currency){return `${row.day} · Facturación ${money(row.realRevenue,currency)} · Costes ${money(row.totalCosts,currency)} · Beneficio ${money(row.netProfit,currency)} · Margen ${percentNumber(row.marginPercent)} · Entregados ${count(row.delivered)} · Devueltos ${count(row.returned)} · Meta ${money(row.metaSpend,currency)}`;}
  function timelineChart(data,mode){
    const rows=data.days || [],currency=data.currency || 'EUR',rates=mode==='rates';
    const keys=rates?['confirmationRatePercent','deliveryRatePercent']:mode==='pnl'?['realRevenue','totalCosts','netProfit']:['netProfit'];
    const root=node('div','rv-timeline');if(!rows.length || !rows.some(r=>keys.some(k=>present(r[k])))){root.append(node('p','rv-missing','Serie no disponible para este periodo'));return root;}
    const f=chartFrame(rows.flatMap(r=>keys.map(k=>r[k])),{percent:rates});f.svg.setAttribute('aria-label',rates?'Confirmación y entrega por fecha de compra':mode==='pnl'?'Facturación, costes y beneficio diario':'Beneficio diario por fecha de compra');
    if(mode==='pnl'){const w=(f.width-f.left-f.right)/rows.length*.32;rows.forEach((r,i)=>{for(const [k,offset,tone] of [['realRevenue',-1,'blue'],['totalCosts',0,'red']])if(present(r[k]))f.svg.append(svgEl('rect',{x:f.x(i,rows.length)+offset*w,y:Math.min(f.y(0),f.y(r[k])),width:Math.max(1,w-1),height:Math.abs(f.y(0)-f.y(r[k])),fill:palette[tone],opacity:.45,rx:1}));});}
    if(rates){line(f,rows,'confirmationRatePercent','green');line(f,rows,'deliveryRatePercent','blue');}else line(f,rows,'netProfit','green',{area:mode==='profit'});
    const tooltip=node('div','rv-chart-tooltip');tooltip.setAttribute('aria-live','polite');tooltip.textContent='Selecciona un día para ver su detalle';
    rows.forEach((r,i)=>{const description=rates?`${r.day} · Confirmación ${percentNumber(r.confirmationRatePercent)} · Entrega ${percentNumber(r.deliveryRatePercent)} · Confirmados ${count(r.confirmed)} · Entregados ${count(r.delivered)}`:dayDetails(r,currency);
      const hit=appendSvgTitle(svgEl('rect',{x:f.x(i,rows.length)-(f.width-f.left-f.right)/rows.length/2,y:f.top,width:(f.width-f.left-f.right)/rows.length,height:f.height-f.top-f.bottom,fill:'transparent',tabindex:0,class:'rv-chart-hit','aria-label':description}),description);
      for(const event of ['mouseenter','focus','click'])hit.addEventListener(event,()=>{tooltip.textContent=description;});f.svg.append(hit);
      if(i===0||i===rows.length-1||i%Math.ceil(rows.length/6)===0){const label=svgEl('text',{x:f.x(i,rows.length),y:f.height-10,'text-anchor':'middle',class:'rv-axis'});label.textContent=String(Number(r.day.slice(-2)));f.svg.append(label);}
    });
    root.append(legend(rates?[['Confirmación','green'],['Entrega','blue']]:mode==='pnl'?[['Facturación','blue'],['Costes','red'],['Beneficio','green']]:[['Beneficio neto diario','green']]),f.svg,tooltip);
    if(!rates)root.append(node('p','rv-chart-total',`Total del mes: ${money(data.totals?.exactNetProfit,currency)} · ${data.period?.current?'provisional':'según informe'}`));return root;
  }
  function statusChart(data){
    const c=data.counts||{},b=c.statusBreakdown||{},root=node('div','rv-status-chart');
    const rows=[['Entregados',b.delivered,'green'],['En tránsito / incidencias',b.inAir,'blue'],['Pendientes',b.pending,'amber'],['Devueltos',b.returned,'red'],['Cancelados',b.cancelled,'gray']];
    if(rows.some(r=>!present(r[1])) || rows.reduce((s,r)=>s+Number(r[1]),0)!==Number(c.created) || b.delivered!==c.delivered || b.returned!==c.returned){root.append(node('p','rv-missing','Desglose de estados no reconciliado. Consulta los recuentos del informe.'));return root;}
    const ring=node('div','rv-ring');let angle=0;const stops=rows.map(([,n,tone])=>{const start=angle;angle+=c.created?n*360/c.created:0;return `${palette[tone]} ${start}deg ${angle}deg`;});ring.style.background=c.created?`conic-gradient(${stops.join(',')})`:'#e8eef5';ring.append(stacked(count(c.created),'pedidos del periodo'));
    const list=node('dl','rv-state-legend');for(const [label,n,tone] of rows){const row=node('div');const dt=node('dt');dt.style.color=palette[tone];dt.textContent=label;row.append(dt,node('dd','',count(n)));list.append(row);}root.append(ring,list,node('p','rv-chart-note','Estados excluyentes del modelo actual. «En tránsito / incidencias» incluye las incidencias abiertas.'));return root;
  }
  function waterfall(data){
    const t=data.totals||{},currency=data.currency||'EUR',root=node('div','rv-waterfall');
    const parts=[['Producto','productCost'],['Envío','outboundShippingCost'],['Gestión','outboundFulfillmentCost'],['COD','codCost'],['Devolución','returnCost'],['Ajustes','dropeaAdjustmentsCost'],['Meta','metaSpend'],['Fijos','fixedCosts'],['Puntuales','oneOffCosts'],['Otros','otherCosts']];
    if(!present(t.realRevenue)||!present(t.exactNetProfit)||parts.some(([,key])=>!present(t[key]))){root.append(node('p','rv-missing','Beneficio provisional · faltan componentes del desglose'));for(const [label,key] of parts)root.append(stacked(label,money(t[key],currency)));return root;}
    // Running positions are chart geometry, never replacement report totals.
    let position=Number(t.realRevenue);const bars=[{label:'Ingresos',value:t.realRevenue,from:0,to:position,tone:'blue'}];
    for(const [label,key] of parts){const from=position;position-=Number(t[key]);bars.push({label,value:t[key],from,to:position,tone:Number(t[key])>=0?'red':'green'});}bars.push({label:'Neto',value:t.exactNetProfit,from:0,to:t.exactNetProfit,tone:t.exactNetProfit<0?'red':'green'});
    const f=chartFrame(bars.flatMap(b=>[b.from,b.to]));f.svg.setAttribute('aria-label','Desglose de ingresos y costes hasta beneficio neto');
    bars.forEach((b,i)=>{const x=f.x(i,bars.length),w=(f.width-f.left-f.right)/bars.length*.66;f.svg.append(appendSvgTitle(svgEl('rect',{x:x-w/2,y:Math.min(f.y(b.from),f.y(b.to)),width:w,height:Math.max(1,Math.abs(f.y(b.to)-f.y(b.from))),fill:palette[b.tone],rx:2,tabindex:0,'aria-label':`${b.label}: ${money(b.value,currency)}`}),`${b.label}: ${money(b.value,currency)}`));const label=svgEl('text',{x,y:f.height-10,class:'rv-axis','text-anchor':'middle'});label.textContent=b.label;f.svg.append(label);});root.append(f.svg,node('p','rv-chart-total',`Beneficio del informe: ${money(t.exactNetProfit,currency)}`));return root;
  }
  function history(data){
    const rows=(data.history||[]).map(r=>r.temporalModels?.pnl==='REALIZED_EVENT_DATE'?{...r,totals:{exactNetProfit:null}}:r).slice(-historyWindow),root=node('div','rv-history');if(!rows.length){root.append(node('p','rv-missing','Histórico no disponible'));return root;}
    const f=chartFrame(rows.map(r=>r.totals?.exactNetProfit));f.svg.setAttribute('aria-label','Beneficio mensual; MTD y periodos parciales identificados');
    rows.forEach((r,i)=>{const m=r.month||r.period?.month,v=r.totals?.exactNetProfit,x=f.x(i,rows.length),w=(f.width-f.left-f.right)/rows.length*.54;
      const qualifier=r.period?.current?'MTD':r.dataAvailability?.status?.includes('PARTIAL')||r.quality?.status==='REVIEW'?'PARCIAL':'';
      const desc=`${monthLabel(m)} · ${money(v,data.currency)} ${qualifier}`;
      const bar=appendSvgTitle(svgEl('rect',{x:x-w/2,y:present(v)?Math.min(f.y(0),f.y(v)):f.y(0)-2,width:w,height:present(v)?Math.max(1,Math.abs(f.y(v)-f.y(0))):4,fill:!present(v)?palette.gray:v<0?palette.red:palette.green,opacity:qualifier ? .7 : 1,rx:2,tabindex:0,role:'button','aria-label':desc}),desc);
      const choose=()=>{$('finance-month').value=m;loadResultsFinance();};bar.addEventListener('click',choose);bar.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});f.svg.append(bar);
      const label=svgEl('text',{x,y:f.height-14,'text-anchor':'middle',class:'rv-axis'});label.textContent=monthLabel(m).split(' ')[0].slice(0,3);f.svg.append(label);if(qualifier){const q=svgEl('text',{x,y:f.height-3,'text-anchor':'middle',class:'rv-partial'});q.textContent=qualifier;f.svg.append(q);}
    });root.append(f.svg,legend([['Beneficio','green'],['Pérdida','red'],['MTD / parcial: periodo incompleto','amber']]));return root;
  }
  function tableValue(row,key,currency){if(key==='day')return incidentDate(row.day).split(',')[0];if(['created','confirmed','delivered','returned','inTransit'].includes(key))return count(row[key]);if(['roiPercent','marginPercent'].includes(key))return percentNumber(row[key]);if(key==='roas')return multiplier(row[key]);return money(row[key],currency);}
  function DailyResultsTable(data){
    const root=node('div','rv-daily-table'),toolbar=node('div','rv-table-toolbar'),options=node('details','rv-column-options'),summary=node('summary','','Columnas');options.append(summary);
    const redraw=()=>{$('finance-daily').replaceChildren(DailyResultsTable(data));};
    for(const [label,key] of columns){const field=node('label'),input=node('input');input.type='checkbox';input.checked=visible.has(key);input.disabled=key==='day';input.addEventListener('change',()=>{input.checked?visible.add(key):visible.delete(key);redraw();});field.append(input,document.createTextNode(label));options.append(field);}
    const download=node('button','rv-export','↓ Exportar CSV');download.type='button';download.addEventListener('click',()=>{const csv=csvData(data);const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=`suleia-resultados-${data.period.month}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});toolbar.append(options,download);
    const selected=columns.filter(([,key])=>visible.has(key)),table=node('table','rv-results-table'),head=node('thead'),hr=node('tr');for(const [label] of selected)hr.append(node('th','',label));head.append(hr);const body=node('tbody');
    for(const row of data.days||[]){const tr=node('tr',present(row.netProfit)&&row.netProfit<0?'negative':'');for(const [,key] of selected)tr.append(node('td',key==='netProfit'?'rv-profit-cell':'',tableValue(row,key,data.currency)));body.append(tr);}
    const total={...data.counts,...data.totals,netProfit:data.totals?.exactNetProfit},foot=node('tfoot'),tr=node('tr');for(const [,key] of selected)tr.append(node('td',key==='netProfit'?'rv-profit-cell':'',key==='day'?'TOTAL DEL MES':tableValue(total,key,data.currency)));foot.append(tr);table.append(head,body,foot);const scroll=node('div','rv-table-scroll');scroll.append(table);root.append(toolbar,scroll);return root;
  }
  function csvData(data){const chosen=columns.filter(([,key])=>visible.has(key));const safe=value=>`"${String(value??'').replaceAll('"','""')}"`;return [chosen.map(([label])=>safe(label)).join(';'),...(data.days||[]).map(row=>chosen.map(([,key])=>safe(key==='day'?row.day:present(row[key])?row[key]:null)).join(';'))].join('\r\n');}
  function render(data){
    $('finance-view').classList.add('results-v2');const t=data.totals||{},c=data.counts||{},days=data.days||[],defs=data.definitions||{};
    const reconciled=!data.period?.current && Number(data.accounting?.unsettledOrders||0)===0 && data.quality?.status==='OK' && data.coverage?.dropeaBreakdownPercent===100 && present(t.exactNetProfit);
    const cards=[
      {label:reconciled?'Beneficio neto conciliado':'Beneficio neto provisional',field:'exactNetProfit',value:money(t.exactNetProfit,data.currency),tone:t.exactNetProfit<0?'red':'green',icon:'profit',series:days.map(r=>r.netProfit),definition:defs.netProfit},
      {label:'Facturación',field:'realRevenue',value:money(t.realRevenue,data.currency),tone:'blue',icon:'revenue',series:days.map(r=>r.realRevenue),definition:'Facturación realizada reconocida por el informe canónico.'},
      {label:'Costes totales',field:'totalCosts',value:money(t.totalCosts,data.currency),tone:'red',icon:'costs',series:days.map(r=>r.totalCosts),definition:'Suma de los componentes de coste reconocidos por el informe.',lowerBetter:true},
      {label:'ROI',field:'roiPercent',value:percentNumber(t.roiPercent),tone:'green',icon:'roi',series:days.map(r=>r.roiPercent),definition:defs.roi,mode:'points'},
      {label:'ROAS',field:'roas',value:multiplier(t.roas),tone:'violet',icon:'roas',series:days.map(r=>r.roas),definition:defs.roas,mode:'multiplier'},
      {label:'Margen neto',field:'marginPercent',value:percentNumber(t.marginPercent),tone:t.marginPercent<0?'red':'green',icon:'margin',series:days.map(r=>r.marginPercent),definition:defs.margin,mode:'points'},
      {label:'Tasa de confirmación',field:'confirmationRatePercent',value:percentNumber(c.confirmationRatePercent),tone:'green',icon:'confirmation',series:days.map(r=>r.confirmationRatePercent),definition:defs.confirmationRate || 'Confirmados / pedidos creados del periodo.',mode:'points'},
      {label:'Tasa de entrega',field:'deliveryRatePercent',value:percentNumber(c.deliveryRatePercent),tone:'blue',icon:'delivery',series:days.map(r=>r.deliveryRatePercent),definition:defs.deliveryRate,mode:'points'},
      {label:'Tasa de rechazo',field:'rejectionRatePercent',value:percentNumber(c.rejectionRatePercent),tone:'red',icon:'returns',series:[],definition:'Rechazados / pedidos creados del periodo. Definición canónica vigente; no es la tasa de devolución.',mode:'points',lowerBetter:true},
      {label:'Entregados',field:'delivered',value:count(c.delivered),tone:'green',icon:'delivered',series:days.map(r=>r.delivered),definition:'Pedidos creados en el periodo con entrega verificada.'},
      {label:'Devueltos',field:'returned',value:count(c.returned),tone:'red',icon:'returns',series:days.map(r=>r.returned),definition:'Pedidos creados en el periodo cuyo estado actual es devuelto.',lowerBetter:true},
      {label:'En tránsito',field:'inTransit',value:count(c.inTransit),tone:'blue',icon:'transit',series:days.map(r=>r.inTransit),definition:'Recuento canónico en tránsito; excluye incidencias.'}
    ];
    $('finance-hero').replaceChildren(...cards.map(card=>KpiCard(card,data)));
    const sources=data.freshness?.sources||{},blocked=Object.values(sources).some(s=>s?.status!=='OK');
    $('finance-freshness').replaceChildren(SourceStatus('Dropea',sources.dropea),SourceStatus('Meta',sources.meta),SourceStatus('Informe',sources.report,blocked),DataQualityBadge(data));
    const selector=node('select','rv-history-select');selector.setAttribute('aria-label','Meses de comparativa');for(const n of [6,9,12]){const option=node('option','',`${n} meses`);option.value=String(n);selector.append(option);}selector.value=String(historyWindow);selector.addEventListener('change',()=>{historyWindow=Number(selector.value);render(data);});
    $('results-v2-charts').replaceChildren(
      ChartCard('Evolución diaria de beneficio neto','Cohorte de compra · beneficio de cada día',timelineChart(data,'profit')),
      ChartCard('Facturación, costes y beneficio','Importes del informe · misma escala en euros',timelineChart(data,'pnl')),
      ChartCard('Estado de pedidos','Categorías excluyentes · estado actual',statusChart(data)),
      ChartCard('Confirmación vs entrega','Tasas por cohorte diaria · denominadores canónicos',timelineChart(data,'rates')),
      ChartCard('Desglose del beneficio','Componentes reales del informe',waterfall(data)),
      ChartCard('Comparativa mensual de beneficio','Selecciona una barra para abrir el mes',history(data),selector)
    );$('finance-daily').replaceChildren(DailyResultsTable(data));
    $('finance-daily-caption').textContent=`Datos hasta ${incidentDate(data.period?.until).split(',')[0]} · fecha de compra (Europe/Madrid). El total usa los mismos importes que las tarjetas. ${data.period?.current?'Mes actual provisional; comparación completa deshabilitada.':''}`;
  }
  return {render,KpiCard,SourceStatus,DataQualityBadge,MetricTooltip,Sparkline,ChartCard,StatusBadge,DailyResultsTable,timelineChart,statusChart,waterfall,history,csvData};
})();
function renderResultsDashboard(data){ResultsV2.render(data);}

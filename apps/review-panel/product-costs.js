/* Internal financial configuration; no provider or campaign operations. */
const ProductCostsPanel=(()=>{
  const view=document.getElementById('finance-view');if(!view)return {coverage(){}};
  let editing=null,configuration=null;
  const section=node('section','finance-panel product-costs-panel'),details=node('details'),summary=node('summary','','Configuración financiera · Costes de producto');
  details.id='finance-product-cost-configuration';details.append(summary);
  const heading=node('div','panel-heading'),copy=node('div');copy.append(node('h3','','Costes de producto'),node('p','','Tarifas internas por unidad entregada, con historial de cambios.'));
  const buttons=node('div','fixed-form-actions'),add=node('button','primary-button','+ Añadir coste'),reload=node('button','secondary-button','Actualizar costes');
  add.type=reload.type='button';buttons.append(add,reload);heading.append(copy,buttons);
  const tableRoot=node('div','results-table-scroll'),feedback=node('p','product-cost-feedback');feedback.setAttribute('role','status');
  const form=node('form','fixed-expense-form');form.hidden=true;
  const fields={};
  for(const [key,label,type] of [['product_id','Product ID','text'],['variant_id','Variant ID','text'],['amount','Coste unitario (€)','number'],['effective_from','Vigente desde','date'],['effective_to','Vigente hasta (opcional)','date']]){
    const wrapper=node('label','',label),input=node('input');input.type=type;input.name=key;input.required=key!=='effective_to';
    if(type==='number'){input.min='0';input.max='100000';input.step='0.01';}if(key.endsWith('_id'))input.pattern='[0-9]{1,18}';
    fields[key]=input;wrapper.append(input);form.append(wrapper);
  }
  const actions=node('div','fixed-form-actions'),cancel=node('button','secondary-button','Cancelar'),save=node('button','primary-button','Guardar coste');cancel.type='button';save.type='submit';actions.append(cancel,save);form.append(actions);
  details.append(heading,tableRoot,form,feedback);section.append(details);view.append(section);
  const gaps=node('div','product-cost-coverage');gaps.id='finance-product-cost-coverage';gaps.hidden=true;document.getElementById('finance-hero')?.before(gaps);
  function edit(rate=null){
    editing=rate;form.hidden=false;
    for(const key of Object.keys(fields)){fields[key].value=rate?.[key]??'';fields[key].readOnly=!!rate&&key.endsWith('_id');}
    if(!rate)fields.effective_from.value=state.finance?.period?.since||new Date().toISOString().slice(0,10);
    feedback.textContent='Fuente: coste confirmado por el propietario. El cambio queda auditado y recalcula los periodos afectados.';
    fields.amount.focus();
  }
  async function load(){
    feedback.textContent='Leyendo tarifas…';
    try{
      configuration=await api('/api/operations/finance/product-costs');
      const table=node('table','finance-product-cost-table'),head=node('thead'),row=node('tr'),body=node('tbody');
      for(const label of ['Producto','Product ID','Variant ID','Coste unitario','Fuente','Vigente desde','Estado',''])row.append(node('th','',label));head.append(row);
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      for(const rate of configuration.rates){
        const tr=node('tr'),state=rate.effective_from>day?'Programada':rate.effective_to&&rate.effective_to<day?'Histórica':'Vigente';
        for(const value of [rate.product_name||`Producto ${rate.product_id}`,rate.product_id,rate.variant_id,money(rate.amount,'EUR'),rate.source,rate.effective_from,state])tr.append(node('td','',value));
        const cell=node('td'),button=node('button','secondary-button','Editar');button.type='button';button.setAttribute('aria-label',`Editar coste de producto ${rate.product_id}, variante ${rate.variant_id}`);button.addEventListener('click',()=>edit(rate));cell.append(button);tr.append(cell);body.append(tr);
      }
      table.append(head,body);tableRoot.replaceChildren(table);feedback.textContent=`${configuration.rates.length} tarifas · ${configuration.findings.length} productos pendientes de coste.`;
    }catch{feedback.textContent='No se pudieron actualizar las tarifas. Puedes reintentar la lectura.';}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;
    try{
      const body=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value||null]));
      if(editing)body.version=editing.version;
      const result=await api('/api/operations/finance/product-costs'+(editing?'/'+editing.rate_id:''),{method:editing?'PATCH':'POST',body});
      form.hidden=true;await load();
      feedback.textContent=result.refresh?.state==='SYNC_PENDING'?'Tarifa guardada. Sincronización pendiente; se reintentará en la siguiente lectura.':'Tarifa guardada y auditada. Recálculo en curso.';
      state.financeCache.clear();await loadResultsFinance({force:true});
    }catch(error){feedback.textContent=error.message==='product_cost_conflict_reload'?'La tarifa ha cambiado o se solapa con otra. Actualiza los costes antes de guardar.':'No se pudo guardar la tarifa. Revisa los identificadores, el importe y las fechas.';}
    finally{save.disabled=false;}
  });
  add.addEventListener('click',()=>edit());reload.addEventListener('click',load);cancel.addEventListener('click',()=>{form.hidden=true;});
  details.addEventListener('toggle',()=>{if(details.open)load();});
  function coverage(report){
    const findings=report.productCostFindings||[],coverage=report.productCostCoverage;
    gaps.replaceChildren();gaps.hidden=!findings.length;
    if(!findings.length)return;
    gaps.append(node('strong','',`Coste de producto conocido: ${money(coverage?.knownAmount,report.currency)}`));
    for(const finding of findings){
      const line=node('p');line.textContent=`Coste pendiente: ${finding.name||finding.product_id} · ${finding.units} unidades · ${finding.order_ids?.length||0} pedidos. Product ID ${finding.product_id}; Variant ID ${finding.variant_id}. Días: ${(finding.days||[]).join(', ')}.`;
      const references=node('small','',`Pedidos: ${(finding.order_ids||[]).join(', ')} · ${finding.code}`);gaps.append(line,references);
    }
  }
  return {coverage};
})();

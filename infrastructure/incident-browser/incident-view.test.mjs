import test from 'node:test';
import assert from 'node:assert/strict';
import {clearIncidentDateFilter} from './incident-view.mjs';

function fixture({url='https://v2.app.dropea.com/es/dropshipper/incidences?tab=all&date_from=2026-10-18T22:00:00Z&date_to=2026-10-26T22:59:59Z',removeCount=1,dateCount=1,retainsDate=false,redirect}={}){
 const calls={clicks:0};
 const remove={filter(o){assert.deepEqual(o,{visible:true});return this;},async count(){return removeCount;},async click(){calls.clicks++;if(redirect){url=redirect;return;}if(!retainsDate){const u=new URL(url);u.searchParams.delete('date_from');u.searchParams.delete('date_to');url=u.href;}}};
 return {calls,page:{url:()=>url,getByPlaceholder(label,o){assert.equal(label,'Fecha');assert.deepEqual(o,{exact:true});return{count:async()=>dateCount};},getByRole(role,o){assert.equal(role,'button');assert.deepEqual(o,{name:'Quitar filtro',exact:true});return remove;},async waitForURL(predicate){if(!predicate(new URL(url)))throw Error('TimeoutError');}}};
}
test('persisted yesterday range is cleared before exact current issue lookup',async()=>{
 const f=fixture();assert.deepEqual(await clearIncidentDateFilter(f.page),{cleared:true});assert.equal(f.calls.clicks,1);assert.equal(new URL(f.page.url()).searchParams.get('tab'),'all');
});
test('unfiltered incident view is left unchanged',async()=>{
 const f=fixture({url:'https://v2.app.dropea.com/es/dropshipper/incidences?tab=all'});assert.deepEqual(await clearIncidentDateFilter(f.page),{cleared:false});assert.equal(f.calls.clicks,0);
});
test('absent or ambiguous filter controls block without clicking another filter',async()=>{
 for(const options of [{removeCount:0},{removeCount:2},{dateCount:0},{dateCount:2}]){const f=fixture(options);await assert.rejects(clearIncidentDateFilter(f.page),/INCIDENT_DATE_FILTER_UNVERIFIED/);assert.equal(f.calls.clicks,0);}
});
test('login, unrelated views and another origin are never operated',async()=>{
 for(const url of ['https://v2.app.dropea.com/login','https://v2.app.dropea.com/es/dropshipper/orders','https://example.com/incidences']){const f=fixture({url});await assert.rejects(clearIncidentDateFilter(f.page),/INCIDENT_VIEW_REQUIRED/);assert.equal(f.calls.clicks,0);}
});
test('unchanged range or redirect cannot be accepted as successful filter clearing',async()=>{
 for(const options of [{retainsDate:true},{redirect:'https://v2.app.dropea.com/login'}]){const f=fixture(options);await assert.rejects(clearIncidentDateFilter(f.page));assert.equal(f.calls.clicks,1);}
});

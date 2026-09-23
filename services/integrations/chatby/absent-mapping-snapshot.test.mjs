import test from 'node:test';import assert from 'node:assert/strict';
import {compareAbsentGraphSnapshots} from './absent-mapping-snapshot.mjs';
const fixture=()=>({complete:true,relevant_workflows:['workflow'],nodes:['absent','rejected'].map(node=>({workflow:'workflow',subflow:'shared',node,
 elements:[{element:node,template_id:'old',template_name:node,locale:'es_ES'}],destination_edges:['destination']}))});
test('only explicitly authorized AUSENTE nodes may change within a shared subflow',()=>{
 const a=fixture(),b=fixture();b.nodes[0].elements[0].template_id='v3';
 assert.equal(compareAbsentGraphSnapshots(a,b,['workflow:shared:absent']).pass,true);
 b.nodes[1].destination_edges=['changed'];
 assert.equal(compareAbsentGraphSnapshots(a,b,['workflow:shared:absent']).pass,false);
});
test('catalog-only, missing workflow and incomplete template snapshots fail closed',()=>{
 assert.throws(()=>compareAbsentGraphSnapshots({templates:[]},fixture(),[]),/FULL_GRAPH/);
 const s=fixture();s.relevant_workflows.push('missing');assert.throws(()=>compareAbsentGraphSnapshots(s,fixture(),[]),/WORKFLOW_MISSING/);
 const t=fixture();delete t.nodes[0].elements[0].locale;assert.throws(()=>compareAbsentGraphSnapshots(t,fixture(),[]),/INCOMPLETE_TEMPLATE/);
});

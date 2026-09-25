import test from 'node:test';import assert from 'node:assert/strict';
import {compareAbsentGraphSnapshots,verifyAbsentReproducibleRestore} from './absent-mapping-snapshot.mjs';
const fixture=()=>({complete:true,relevant_workflows:['workflow'],nodes:['absent','rejected'].map(node=>({workflow:'workflow',subflow:'shared',node,
 elements:[{element:node,template_id:'old',template_name:node,locale:'es_ES'}],destination_edges:['destination']}))});
test('only explicitly authorized AUSENTE nodes may change within a shared subflow',()=>{
 const a=fixture(),b=fixture();b.nodes[0].elements[0].template_id='v3';
 assert.equal(compareAbsentGraphSnapshots(a,b,['workflow:shared:absent']).pass,true);
 b.nodes[1].destination_edges=['changed'];
 assert.equal(compareAbsentGraphSnapshots(a,b,['workflow:shared:absent']).pass,false);
});

test('reproducible restore requires catalogs, screenshots and an exercised restore without claiming official export',()=>{
 const snapshot=()=>({...fixture(),mode:'REPRODUCIBLE_RESTORE',bot:'f295175',api_snapshot_hash:'a'.repeat(64),screenshot_hash:'b'.repeat(64),
 templates:Array.from({length:23},(_,id)=>({id})),subflows:['shared'],unrelated_visible_configuration_hash:'c'.repeat(64)});
 const before=snapshot(),after=snapshot();after.nodes[0].elements[0].template_id='v3';
 const restore={procedure:'restore exact node and routes',previous_template:'v2',previous_destinations:['destination'],draft_restore_verified:true,verification_hash:'d'.repeat(64)};
 const args={before,after,restore,authorizedNodeKeys:['workflow:shared:absent']};
 const result=verifyAbsentReproducibleRestore(args);assert.equal(result.pass,true);assert.equal(result.official_full_graph_export,false);
 assert.equal(verifyAbsentReproducibleRestore({...args,restore:{...restore,draft_restore_verified:false}}).pass,false);
 after.templates[0].id='changed';assert.equal(verifyAbsentReproducibleRestore(args).reason,'UNRELATED_CONFIGURATION_CHANGED');
});
test('catalog-only, missing workflow and incomplete template snapshots fail closed',()=>{
 assert.throws(()=>compareAbsentGraphSnapshots({templates:[]},fixture(),[]),/FULL_GRAPH/);
 const s=fixture();s.relevant_workflows.push('missing');assert.throws(()=>compareAbsentGraphSnapshots(s,fixture(),[]),/WORKFLOW_MISSING/);
 const t=fixture();delete t.nodes[0].elements[0].locale;assert.throws(()=>compareAbsentGraphSnapshots(t,fixture(),[]),/INCOMPLETE_TEMPLATE/);
});

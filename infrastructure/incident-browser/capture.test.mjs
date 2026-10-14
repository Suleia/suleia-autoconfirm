import test from 'node:test';
import assert from 'node:assert/strict';
import {contactNamePattern} from './capture.mjs';

test('contact name tolerates capitalization, whitespace and missing-surname placeholder',()=>{
 const pattern=contactNamePattern('  Persona   Ejemplo - ');
 for(const name of ['Persona Ejemplo','PERSONA EJEMPLO','Persona  Ejemplo -'])assert.ok(pattern.test(name));
 for(const name of ['Persona','Persona Ejemplo Otra','Otra Persona Ejemplo'])assert.equal(pattern.test(name),false);
});

test('contact matching retains meaningful names, accents, hyphens and literal regex characters',()=>{
 const pattern=contactNamePattern('María Pérez-López (Prueba)');
 assert.ok(pattern.test('MARÍA PÉREZ-LÓPEZ (Prueba)'));
 for(const name of ['Maria Pérez-López (Prueba)','María Pérez López (Prueba)','María Pérez-López Prueba'])assert.equal(pattern.test(name),false);
 assert.throws(()=>contactNamePattern(' - '),/CAPTURE_NAME_REQUIRED/);
});

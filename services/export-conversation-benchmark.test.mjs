import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeBenchmarkText} from './export-conversation-benchmark.mjs';
test('private benchmark sanitizer removes contacts, links, long identifiers and street literals',()=>{
 const result=sanitizeBenchmarkText('Mañana por la tarde. Mi nombre es Persona Privada. Teléfono 600111222. CP 28001. Calle Ejemplo 2 Madrid. a@example.com https://example.com');
 assert.doesNotMatch(result,/600111222|28001|Ejemplo|example.com|Persona Privada/);assert.match(result,/Mañana por la tarde/);
});

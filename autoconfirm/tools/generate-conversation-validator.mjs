import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {factOutputSchema} from '../src/customer-context/fact-schema.mjs';
const ajv=new Ajv({strict:true,allErrors:true,code:{source:true,esm:true}});
const validate=ajv.compile(factOutputSchema);
const sha=createHash('sha256').update(JSON.stringify(factOutputSchema)).digest('hex');
const output=standaloneCode(ajv,validate);
if(/require\(|from ["']ajv/.test(output))throw Error('VALIDATOR_MUST_BE_STANDALONE');
await writeFile(new URL('../src/customer-context/fact-validator.generated.mjs',import.meta.url),
  `// Generated with Ajv8.20.0. Schema SHA256: ${sha}\n${output}\n`);

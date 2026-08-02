import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractOperationMatrix, loadDropeaContract } from './contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../../contracts/external/dropea/public-api-v2/0.1.0/operation-matrix.json');
const { document, checksum, manifest } = loadDropeaContract();
const output = {
  contract_version: manifest.contract_version,
  openapi_version: manifest.openapi_version,
  sha256: checksum,
  generated_from_contract: true,
  verified_live: false,
  operations: contractOperationMatrix(document)
};
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
process.stdout.write(`DROPEA_OPERATION_MATRIX|PASS|operations=${output.operations.length}|writes_implemented=0|verified_live=false\n`);

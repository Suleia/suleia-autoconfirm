import { readFileSync } from 'node:fs';
import { replayIncidentAutopilot } from '../packages/platform-core/src/incident/autopilot-replay.mjs';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/replay-incident-autopilot-shadow.mjs <masked-records.json>');
const records = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(records)) throw new Error('Replay input must be a JSON array');
const report = replayIncidentAutopilot(records);
if (report.potential_unsafe_actions !== 0) throw new Error('Replay found an unsafe action candidate');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

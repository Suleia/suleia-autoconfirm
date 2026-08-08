import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const installRoot = path.resolve(process.argv[2] || '.');
const outputPath = path.resolve(process.argv[3] || path.join(installRoot, 'private-runtime', 'platform-runtime.json'));
const allowedOutputRoot = path.join(installRoot, 'private-runtime') + path.sep;
if (!outputPath.startsWith(allowedOutputRoot)) throw new Error('Runtime inventory output must stay in private-runtime');

const composeFile = path.join(installRoot, 'infrastructure', 'docker', 'compose.yaml');
const envFile = path.join(installRoot, '.env');

function fixed(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options
    }).trim();
  } catch {
    return '';
  }
}

function parseJsonOutput(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [value];
  } catch {
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
}

function runtimeSnapshot(name) {
  const snapshot = path.join(installRoot, 'private-runtime', name);
  try { return fs.readFileSync(snapshot, 'utf8'); } catch { return ''; }
}

function bytes(value) {
  const match = String(value || '').match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return null;
  const units = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
    KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  return Math.round(Number(match[1]) * (units[match[2].toUpperCase()] || 1));
}

function safePorts(publishers) {
  return (Array.isArray(publishers) ? publishers : []).map((item) => ({
    target_port: item.TargetPort ?? null,
    published_port: item.PublishedPort ?? null,
    protocol: item.Protocol || null
  }));
}

const composeArgs = ['compose', '--env-file', envFile, '--file', composeFile];
const ps = parseJsonOutput(fixed('docker', [...composeArgs, 'ps', '--format', 'json'])
  || runtimeSnapshot('compose-ps.json'));
const stats = parseJsonOutput(fixed('docker', ['stats', '--no-stream', '--format', '{{json .}}'])
  || runtimeSnapshot('docker-stats.json'));
const statsByName = new Map(stats.map((item) => [String(item.Name || '').toLowerCase(), item]));

const containers = ps.map((item) => {
  const observedStats = statsByName.get(String(item.Name || '').toLowerCase()) || {};
  const [ramUsage, ramLimit] = String(observedStats.MemUsage || '').split('/').map((part) => bytes(part?.trim()));
  const inspect = parseJsonOutput(fixed('docker', ['inspect', String(item.ID || item.Name),
    '--format', '{{json .HostConfig.RestartPolicy}}']))[0] || {};
  return {
    service: item.Service || null,
    name: item.Name || null,
    image: item.Image || null,
    version: String(item.Image || '').includes(':') ? String(item.Image).split(':').at(-1) : null,
    status: item.State || item.Status || 'UNKNOWN',
    health: item.Health || 'UNKNOWN',
    cpu_percent: Number.parseFloat(String(observedStats.CPUPerc || '').replace('%', '')) || null,
    ram_usage_bytes: ramUsage,
    ram_limit_bytes: ramLimit,
    ports: safePorts(item.Publishers),
    restart_policy: inspect.Name || null,
    last_failure: Number(item.ExitCode || 0) === 0 ? null : {
      exit_code: Number(item.ExitCode),
      finished_at: item.FinishedAt || null
    }
  };
});

const componentPaths = [
  'packages/platform-core/src/event-store.mjs',
  'packages/platform-core/src/digital-twin.mjs',
  'packages/platform-core/src/decision-engine.mjs',
  'packages/platform-core/src/incident/incident-processor.mjs',
  'packages/platform-core/src/incident/conversation-intelligence.mjs',
  'packages/platform-core/src/governance/policy-registry.mjs',
  'packages/platform-core/src/governance/temporal-policies.mjs',
  'packages/platform-core/src/timer-engine.mjs',
  'packages/platform-core/src/governance/risk-engine.mjs',
  'packages/platform-core/src/governance/qa-gate.mjs',
  'packages/suleia-operations-mcp/src/mcp/server.mjs',
  'packages/suleia-operations-mcp/test/mcp-tools.test.mjs',
  'packages/platform-core/test/incident-processor.test.mjs',
  'services/shadow-readonly-worker.mjs',
  'migrations/014_operational_data_model_hardening.sql',
  'migrations/015_platform_audit_readonly.sql',
  'docs/SULEIA_INCIDENT_MANAGEMENT_HANDBOOK_v1.0.md',
  'docs/company/AGENT_CATALOG.md',
  'infrastructure/docker/compose.yaml'
];

const files = componentPaths.flatMap((relativePath) => {
  const absolute = path.join(installRoot, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return [];
  const content = fs.readFileSync(absolute, 'utf8');
  const imports = [...content.matchAll(/(?:import[^'"\n]+from\s+|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]).slice(0, 50);
  const exports = [...content.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]).slice(0, 50);
  return [{ path: relativePath, sha256: crypto.createHash('sha256').update(content).digest('hex'), imports, exports }];
});

let testCount = 0;
for (const root of ['packages', 'apps', 'infrastructure']) {
  const absoluteRoot = path.join(installRoot, root);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const entry of fs.readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.test\.mjs$/.test(entry.name)) continue;
    const content = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    testCount += (content.match(/\btest\s*\(/g) || []).length;
  }
}

const memoryTotal = os.totalmem();
const memoryFree = os.freemem();
let disk = null;
try {
  const stats = fs.statfsSync('/');
  disk = { total_bytes: stats.blocks * stats.bsize, free_bytes: stats.bavail * stats.bsize };
} catch {}

const inventory = {
  schema_version: 'suleia-runtime-inventory-v1',
  generated_at: new Date().toISOString(),
  git: {
    commit: fixed('git', ['rev-parse', 'HEAD']) || process.env.SULEIA_RUNTIME_GIT_COMMIT || 'UNKNOWN',
    branch: fixed('git', ['branch', '--show-current']) || process.env.SULEIA_RUNTIME_GIT_BRANCH || 'DETACHED_OR_UNKNOWN'
  },
  host: {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpu_count: os.cpus().length,
    load_average: os.loadavg(),
    memory_total_bytes: memoryTotal,
    memory_free_bytes: memoryFree,
    disk
  },
  containers,
  backup: { status: process.env.SULEIA_RUNTIME_BACKUP_STATUS || 'UNKNOWN' },
  repository: { test_count: testCount, files }
};

await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o750 });
const temporary = `${outputPath}.tmp`;
await fsp.writeFile(temporary, `${JSON.stringify(inventory)}\n`, { mode: 0o640 });
await fsp.rename(temporary, outputPath);

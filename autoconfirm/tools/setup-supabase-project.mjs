import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/lib/files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workspaceRoot = path.resolve(root, '..');

loadEnvFile(path.join(root, '.env'));

const SUPABASE_API = 'https://api.supabase.com/v1';
const DEFAULT_RENDER_SERVICE_ID = 'srv-d8dkdrf40ujc73cpskag';
const DEFAULT_PUBLIC_URL = 'https://suleia-autoconfirm.onrender.com';

function mask(value) {
  if (!value) return '[empty]';
  const text = String(value);
  if (text.length <= 8) return '[redacted]';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function log(message, data) {
  if (data === undefined) {
    console.log(message);
    return;
  }
  console.log(`${message} ${JSON.stringify(data, null, 2)}`);
}

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

function randomPassword() {
  // Supabase requires a strong database password. Avoid punctuation that often
  // breaks JSON or shell escaping when passed through local setup wrappers.
  return `${crypto.randomBytes(18).toString('base64url')}Aa1`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function cleanError(payload, knownSecrets = []) {
  let text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const secret of knownSecrets.filter(Boolean)) {
    text = text.replaceAll(secret, '[redacted]');
  }
  return text;
}

async function request(method, url, { token, headers = {}, body, secrets = [] } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${cleanError(payload, [token, ...secrets])}`);
  }
  return payload;
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.organizations)) return payload.organizations;
  if (Array.isArray(payload?.projects)) return payload.projects;
  if (payload) return [payload];
  return [];
}

async function getOrganization(supabaseToken) {
  const forcedSlug = getEnv('SUPABASE_ORG_SLUG');
  const forcedId = getEnv('SUPABASE_ORG_ID');
  const organizations = asArray(await request('GET', `${SUPABASE_API}/organizations`, { token: supabaseToken }));
  if (!organizations.length) {
    throw new Error('Supabase no devuelve organizaciones para este token.');
  }

  const selected = organizations.find((org) => {
    if (forcedId && String(org.id) === forcedId) return true;
    if (forcedSlug && String(org.slug || org.name || '').toLowerCase() === forcedSlug.toLowerCase()) return true;
    return false;
  }) || organizations[0];

  return selected;
}

function projectRef(project) {
  return String(project?.ref || project?.id || project?.project_ref || project?.projectRef || '').trim();
}

function projectStatus(project) {
  return String(project?.status || project?.state || project?.db?.status || '').toLowerCase();
}

async function createProject(supabaseToken, organization) {
  const name = getEnv('SUPABASE_PROJECT_NAME', 'suleia-command-center');
  const region = getEnv('SUPABASE_PROJECT_REGION', 'eu-west-1');
  const dbPassword = getEnv('SUPABASE_DB_PASSWORD') || randomPassword();
  const plan = getEnv('SUPABASE_PROJECT_PLAN');

  const base = {
    name,
    region,
    db_pass: dbPassword
  };
  if (plan) base.plan = plan;

  const attempts = [
    { ...base, organization_id: organization.id },
    { ...base, organization_slug: organization.slug || organization.id },
    { ...base, org_id: organization.id }
  ];

  let lastError = null;
  for (const body of attempts) {
    try {
      const created = await request('POST', `${SUPABASE_API}/projects`, {
        token: supabaseToken,
        body,
        secrets: [dbPassword]
      });
      return { project: created, dbPassword };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function findExistingProject(supabaseToken, organization) {
  const name = getEnv('SUPABASE_PROJECT_NAME', 'suleia-command-center');
  const projects = asArray(await request('GET', `${SUPABASE_API}/projects`, { token: supabaseToken }));
  return projects.find((project) => {
    if (String(project.name || '').toLowerCase() !== name.toLowerCase()) return false;
    const projectOrg = String(project.organization_id || project.organization?.id || project.org_id || '');
    return !projectOrg || !organization?.id || projectOrg === String(organization.id);
  }) || null;
}

async function waitForProject(supabaseToken, ref, name) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const project = await request('GET', `${SUPABASE_API}/projects/${encodeURIComponent(ref)}`, {
        token: supabaseToken
      });
      const status = projectStatus(project);
      log('Estado Supabase:', { ref, status: status || 'unknown' });
      if (!status || ['active', 'healthy', 'available', 'running'].includes(status)) {
        return project;
      }
      if (['inactive', 'failed', 'errored'].includes(status)) {
        throw new Error(`Supabase marco el proyecto como ${status}.`);
      }
    } catch (error) {
      // Some accounts briefly return 404 while the project is being provisioned.
      const projects = asArray(await request('GET', `${SUPABASE_API}/projects`, { token: supabaseToken }));
      const listed = projects.find((item) => projectRef(item) === ref || item.name === name);
      if (listed && ['active', 'healthy', 'available', 'running', ''].includes(projectStatus(listed))) {
        return listed;
      }
    }
    await sleep(15000);
  }
  throw new Error('Supabase no dejo el proyecto listo dentro del tiempo esperado.');
}

async function getProjectApiKeys(supabaseToken, ref) {
  const payload = await request('GET', `${SUPABASE_API}/projects/${encodeURIComponent(ref)}/api-keys`, {
    token: supabaseToken
  });
  const items = asArray(payload);
  const service = items.find((item) => {
    const label = `${item.name || ''} ${item.key_type || ''} ${item.type || ''}`.toLowerCase();
    return label.includes('service');
  });
  const anon = items.find((item) => {
    const label = `${item.name || ''} ${item.key_type || ''} ${item.type || ''}`.toLowerCase();
    return label.includes('anon');
  });

  const serviceKey = service?.api_key || service?.key || payload?.service_role || payload?.service_role_key || payload?.serviceRoleKey;
  const anonKey = anon?.api_key || anon?.key || payload?.anon || payload?.anon_key || payload?.anonKey;

  if (!serviceKey) {
    throw new Error('No he podido localizar la service_role key de Supabase en la respuesta de API.');
  }
  return { serviceRoleKey: serviceKey, anonKey };
}

async function applySchema(supabaseToken, ref) {
  const schemaPath = path.join(root, 'supabase', 'schema.sql');
  const query = fs.readFileSync(schemaPath, 'utf8');
  const attempts = [
    { query },
    { sql: query }
  ];
  let lastError = null;
  for (const body of attempts) {
    try {
      return await request('POST', `${SUPABASE_API}/projects/${encodeURIComponent(ref)}/database/query`, {
        token: supabaseToken,
        body
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function setRenderEnvVar(renderToken, serviceId, key, value) {
  const encoded = encodeURIComponent(key);
  const url = `https://api.render.com/v1/services/${serviceId}/env-vars/${encoded}`;
  try {
    return await request('PUT', url, {
      token: renderToken,
      body: { value },
      secrets: [value]
    });
  } catch (error) {
    if (!String(error.message).includes('400')) throw error;
    return request('PUT', url, {
      token: renderToken,
      body: { envVar: { value } },
      secrets: [value]
    });
  }
}

async function startRenderDeploy(renderToken, serviceId) {
  return request('POST', `https://api.render.com/v1/services/${serviceId}/deploys`, {
    token: renderToken,
    body: { clearCache: 'do_not_clear' }
  });
}

function deployId(payload) {
  return String(payload?.id || payload?.deploy?.id || '').trim();
}

function deployStatus(payload) {
  return String(payload?.status || payload?.deploy?.status || '').trim();
}

async function waitRenderDeploy(renderToken, serviceId, id) {
  if (!id) {
    await sleep(90000);
    return { status: 'unknown_waited' };
  }
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const payload = await request('GET', `https://api.render.com/v1/services/${serviceId}/deploys/${id}`, {
      token: renderToken
    });
    const status = deployStatus(payload);
    log('Estado Render:', { deployId: id, status });
    if (['live', 'succeeded', 'deployed'].includes(status)) return payload;
    if (['build_failed', 'update_failed', 'canceled', 'failed'].includes(status)) {
      throw new Error(`Render fallo el deploy con estado ${status}.`);
    }
    await sleep(15000);
  }
  throw new Error('Render no marco el deploy como activo dentro del tiempo esperado.');
}

async function waitHealth(publicUrl) {
  const deadline = Date.now() + 7 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${publicUrl.replace(/\/+$/, '')}/health`);
      const payload = await readJsonResponse(response);
      if (response.ok && payload?.ok) return payload;
    } catch {}
    await sleep(10000);
  }
  throw new Error('Render no responde OK en /health tras el deploy.');
}

function readCronSecret() {
  const envFile = path.join(root, '.env');
  const text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const match = text.match(/^\s*CRON_SECRET\s*=\s*("?)([^"\r\n]+)\1\s*$/m);
  return getEnv('CRON_SECRET') || match?.[2] || '';
}

async function runBackfill(publicUrl, cronSecret) {
  if (!cronSecret) {
    return { skipped: true, reason: 'missing_cron_secret' };
  }
  const base = publicUrl.replace(/\/+$/, '');
  const status = await request('GET', `${base}/api/cron/supabase-status`, {
    token: cronSecret
  });
  const backfill = await request('POST', `${base}/api/cron/supabase-backfill`, {
    token: cronSecret,
    body: {}
  });
  return { status, backfill };
}

function writeProjectInfo(info) {
  const outPath = path.join(root, 'supabase', 'project.local.json');
  const safe = {
    projectRef: info.projectRef,
    projectName: info.projectName,
    projectUrl: info.projectUrl,
    organization: info.organization,
    region: info.region,
    renderServiceId: info.renderServiceId,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(outPath, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
  return outPath;
}

async function main() {
  const supabaseToken = getEnv('SUPABASE_ACCESS_TOKEN');
  const renderToken = getEnv('RENDER_API_KEY');
  const renderServiceId = getEnv('RENDER_SERVICE_ID', DEFAULT_RENDER_SERVICE_ID);
  const publicUrl = getEnv('PUBLIC_BASE_URL', DEFAULT_PUBLIC_URL);

  if (!supabaseToken) {
    throw new Error('Falta SUPABASE_ACCESS_TOKEN. Genera un Personal Access Token de Supabase y pasalo solo como variable de entorno.');
  }
  if (!renderToken) {
    throw new Error('Falta RENDER_API_KEY. Debe venir del secreto local cifrado o variable de entorno.');
  }

  log('1/8 Probando Supabase y seleccionando organizacion...');
  const organization = await getOrganization(supabaseToken);
  log('Organizacion seleccionada:', {
    id: organization.id,
    slug: organization.slug || null,
    name: organization.name || null
  });

  log('2/8 Localizando o creando proyecto Supabase...');
  const existingProject = await findExistingProject(supabaseToken, organization);
  const created = existingProject
    ? { project: existingProject, dbPassword: null }
    : await createProject(supabaseToken, organization);
  const { project, dbPassword } = created;
  const ref = projectRef(project);
  if (!ref) {
    throw new Error(`Supabase creo el proyecto, pero no devolvio ref/id reconocible: ${JSON.stringify(project)}`);
  }
  log(existingProject ? 'Proyecto existente reutilizado:' : 'Proyecto creado:', {
    ref,
    name: project.name || getEnv('SUPABASE_PROJECT_NAME', 'suleia-command-center'),
    dbPassword: dbPassword ? mask(dbPassword) : '[existing-project]'
  });

  log('3/8 Esperando a que Supabase termine de preparar el proyecto...');
  const readyProject = await waitForProject(supabaseToken, ref, project.name);
  const readyRef = projectRef(readyProject) || ref;
  const projectUrl = getEnv('SUPABASE_URL_OVERRIDE') || `https://${readyRef}.supabase.co`;

  log('4/8 Leyendo claves internas de Supabase...');
  const keys = await getProjectApiKeys(supabaseToken, readyRef);
  log('Claves localizadas:', {
    serviceRoleKey: mask(keys.serviceRoleKey),
    anonKey: mask(keys.anonKey)
  });

  log('5/8 Aplicando esquema central de Suleia...');
  await applySchema(supabaseToken, readyRef);
  log('Esquema aplicado.');

  log('6/8 Conectando Render con Supabase...');
  const envVars = {
    SUPABASE_ENABLED: 'true',
    SUPABASE_URL: projectUrl,
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
    SUPABASE_SCHEMA: 'public'
  };
  for (const [key, value] of Object.entries(envVars)) {
    await setRenderEnvVar(renderToken, renderServiceId, key, value);
    log(`Render variable OK: ${key}`);
  }

  log('7/8 Desplegando Render para activar Supabase...');
  const deploy = await startRenderDeploy(renderToken, renderServiceId);
  const id = deployId(deploy);
  if (id) log('Deploy solicitado:', { id });
  await waitRenderDeploy(renderToken, renderServiceId, id);
  await waitHealth(publicUrl);

  log('8/8 Volcando datos actuales a Supabase...');
  const cronSecret = readCronSecret();
  const backfill = await runBackfill(publicUrl, cronSecret);

  const projectInfoPath = writeProjectInfo({
    projectRef: readyRef,
    projectName: readyProject.name || project.name || 'suleia-command-center',
    projectUrl,
    organization: {
      id: organization.id,
      slug: organization.slug || null,
      name: organization.name || null
    },
    region: getEnv('SUPABASE_PROJECT_REGION', 'eu-west-1'),
    renderServiceId
  });

  log('Supabase central conectado correctamente.', {
    projectRef: readyRef,
    projectUrl,
    renderServiceId,
    localProjectInfo: path.relative(workspaceRoot, projectInfoPath),
    backfill
  });
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

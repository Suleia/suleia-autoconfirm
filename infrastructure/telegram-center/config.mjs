export function loadConfig(env = process.env) {
  const required = (key) => {
    if (!env[key]) throw new Error(`Falta ${key}`);
    return env[key];
  };
  const ids = required('TELEGRAM_ALLOWED_USER_IDS').split(',').map((id) => id.trim());
  if (!ids.length || ids.some((id) => !/^[1-9]\d*$/.test(id))) throw new Error('TELEGRAM_ALLOWED_USER_IDS debe contener IDs numéricos');
  const accountId = required('META_AD_ACCOUNT_ID').replace(/^act_/, '');
  if (!/^\d+$/.test(accountId)) throw new Error('META_AD_ACCOUNT_ID inválido');
  const apiVersion = required('META_API_VERSION');
  if (!/^v\d+\.0$/.test(apiVersion)) throw new Error('META_API_VERSION inválida');
  const writesEnabled = env.META_WRITES_ENABLED === 'true';
  const adsEnabled = env.ADS_INTELLIGENCE_TELEGRAM_ENABLED === 'true';
  if(adsEnabled && writesEnabled) throw new Error('ADS_INTELLIGENCE requires legacy META_WRITES_ENABLED=false');
  if(adsEnabled && (!env.ADS_INTELLIGENCE_API_URL || !env.ADS_INTELLIGENCE_BRIDGE_TOKEN))throw new Error('Falta configurar el servicio compartido de Ads Intelligence');
  const maxBudget = Number(env.META_MAX_DAILY_BUDGET_EUR);
  const maxChange = Number(env.META_MAX_BUDGET_CHANGE_PERCENT || 20);
  if (writesEnabled && (!Number.isFinite(maxBudget) || maxBudget <= 0)) throw new Error('Las escrituras requieren META_MAX_DAILY_BUDGET_EUR');
  if (!Number.isFinite(maxChange) || maxChange <= 0 || maxChange > 100) throw new Error('Límite de cambio inválido');
  return {
    adsEnabled, adsApiUrl:env.ADS_INTELLIGENCE_API_URL,adsApiToken:env.ADS_INTELLIGENCE_BRIDGE_TOKEN,
    botToken: required('TELEGRAM_BOT_TOKEN'),
    expectedBotUsername: required('TELEGRAM_EXPECTED_BOT_USERNAME').replace(/^@/, '').toLowerCase(),
    allowedUserIds: ids, accountId: `act_${accountId}`,
    metaToken: required('META_ACCESS_TOKEN'), apiVersion,
    stateDir: env.STATE_DIRECTORY || '/var/lib/suleia-telegram',
    timezone: env.TZ || 'Europe/Madrid', writesEnabled,
    maxBudgetCents: Number.isFinite(maxBudget) ? Math.round(maxBudget * 100) : null,
    maxChangePercent: maxChange, proposalTtlMs: 5 * 60 * 1000
  };
}

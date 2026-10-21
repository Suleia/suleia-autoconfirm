import { randomBytes } from 'node:crypto';
import { amount, dateRange, previousRange, reportText, comparisonText } from './reports.mjs';
import { parseSpanish, matchingCampaigns, cleanSelector } from './spanish.mjs';
import { createAdsGateway } from './ads-gateway.mjs';

export const help = [
  'Suleia Command Center · Meta Ads',
  'Puedes escribirme con frases:',
  '«¿Cómo van las campañas hoy?»',
  '«Pon la campaña CollaGum a 35 euros al día»',
  '«Baja el presupuesto de CollaGum un 10 %»',
  '«Pausa la campaña NIDA» · «Sí, hazlo» · «No, cancela»',
  'Si hay varias campañas con ese nombre te preguntaré cuál.',
  '',
  'También admito comandos:',
  '/resumen hoy | ayer | 7d | 30d',
  '/meta AAAA-MM-DD AAAA-MM-DD',
  '/campanas — estado y presupuesto actual',
  '/analizar — compara los últimos 7 días completos con los 7 anteriores',
  '/presupuesto ID 40,00 — propone presupuesto diario en EUR',
  '/pausar ID — propone pausar una campaña',
  '/confirmar CÓDIGO · /cancelar CÓDIGO',
  '/reconciliar CÓDIGO — comprueba una acción de resultado incierto, sin reenviarla',
  '/historial — últimas acciones · /estado — estado del bot',
  'Cada cambio requiere confirmación; caduca en 5 minutos. Este servicio gestiona Meta; los flujos logísticos conservan su ejecución existente.'
].join('\n');

export class Controller {
  constructor({ config, api, store, now = () => Date.now() }) {
    Object.assign(this, { config, api, store, now });
    this.adsGateway = config.adsEnabled ? createAdsGateway(config) : null;
  }
  authorized(message = {}, sender = message.from) {
    return message?.chat?.type === 'private' && sender && !sender.is_bot &&
      String(message.chat.id) === String(sender.id) && this.config.allowedUserIds.includes(String(sender.id));
  }
  async target(id) {
    if (!/^\d+$/.test(id || '')) throw new Error('Indica el ID numérico exacto de /campanas.');
    const row = await this.api.campaign(id);
    if (`act_${row.account_id}` !== this.config.accountId) throw new Error('La campaña no pertenece a la cuenta permitida.');
    return row;
  }
  snapshot(row) { return { status: row.status, daily_budget: row.daily_budget || null, lifetime_budget: row.lifetime_budget || null }; }
  unresolved(id) { return Object.values(this.store.state.proposals).some((p) => p.campaignId === id && ['EXECUTING', 'UNKNOWN'].includes(p.state)); }
  async propose(kind, id, value, userId, chatId, relative = null) {
    if (this.unresolved(id)) throw new Error('Hay una acción pendiente de reconciliación para esta campaña.');
    const row = await this.target(id);
    const account = await this.api.account();
    if (String(account.id) !== this.config.accountId) throw new Error('Cuenta inesperada.');
    if (!['ACTIVE', 'PAUSED'].includes(row.status)) throw new Error('Estado de campaña no admitido.');
    let changes;
    if (kind === 'budget') {
      if (account.currency !== 'EUR') throw new Error('Los cambios de presupuesto de esta versión requieren una cuenta EUR.');
      if (relative) {
        const delta = Number(relative.value.replace(',', '.'));
        const oldCents = Number(row.daily_budget);
        if (!Number.isFinite(delta) || delta <= 0) throw new Error('El incremento o reducción debe ser positivo.');
        const difference = relative.unit === 'percent' ? oldCents * delta / 100 : delta * 100;
        value = ((oldCents + (relative.mode === 'decrease' ? -difference : difference)) / 100).toFixed(2);
      }
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(value || '')) throw new Error('Importe inválido: usa, por ejemplo, 40,00.');
      const cents = Math.round(Number(value.replace(',', '.')) * 100);
      const old = Number(row.daily_budget);
      if (!Number.isSafeInteger(old) || old <= 0 || Number(row.lifetime_budget) > 0) throw new Error('La campaña no tiene presupuesto diario propio; puede usar presupuesto por conjunto o total.');
      if (!Number.isSafeInteger(cents) || cents <= 0 || cents === old) throw new Error('Indica un presupuesto positivo diferente del actual.');
      if (!this.config.maxBudgetCents || cents > this.config.maxBudgetCents) throw new Error('El importe supera el límite diario configurado o falta configurar ese límite.');
      if (Math.abs(cents - old) / old * 100 > this.config.maxChangePercent + 1e-8) throw new Error(`Cambio superior al límite de ${this.config.maxChangePercent}% por propuesta.`);
      changes = { daily_budget: String(cents) };
    } else {
      if (row.status !== 'ACTIVE') throw new Error('La campaña ya está pausada o no está activa.');
      changes = { status: 'PAUSED' };
    }
    const code = randomBytes(8).toString('hex');
    this.supersede(userId, chatId);
    const proposal = { code, userId: String(userId), chatId: String(chatId), campaignId: id, campaignName: row.name,
      kind, changes, before: this.snapshot(row), state: 'PENDING', simulation: !this.config.writesEnabled, createdAt: this.now(), expiresAt: this.now() + this.config.proposalTtlMs };
    this.store.state.proposals[code] = proposal;
    this.store.state.conversations ||= {};
    this.store.state.conversations[`${userId}:${chatId}`] = { lastCampaignId: id, lastCampaignAt: this.now() };
    this.store.record({ event: 'PROPOSED', code, campaignId: id, kind });
    const change = kind === 'budget' ? `${amount(Number(row.daily_budget) / 100)} → ${amount(Number(changes.daily_budget) / 100)}/día` : 'ACTIVA → PAUSADA';
    return { text: `${this.config.writesEnabled ? 'Confirmar cambio' : 'SIMULACIÓN: escrituras desactivadas'}\n${row.name} · ID ${id}\n${change}\nCaduca en 5 minutos. Responde «sí, hazlo» o «no, cancela», o utiliza los botones.\n/confirmar ${code}\n/cancelar ${code}`,
      markup: { inline_keyboard: [[{ text: 'Confirmar', callback_data: `confirm:${code}` }, { text: 'Cancelar', callback_data: `cancel:${code}` }]] } };
  }
  supersede(userId, chatId) {
    for (const p of Object.values(this.store.state.proposals)) {
      if (p.userId === String(userId) && p.chatId === String(chatId) && p.state === 'PENDING') p.state = 'SUPERSEDED';
    }
  }
  async natural(text, userId, chatId) {
    const intent = parseSpanish(text);
    const key = `${userId}:${chatId}`;
    this.store.state.conversations ||= {};
    const context = this.store.state.conversations[key] || {};
    if (['confirm', 'cancel'].includes(intent.type)) {
      if (intent.type === 'cancel' && context.draft) {
        delete context.draft; this.supersede(userId, chatId); this.store.save();
        return { text: 'Petición cancelada. No se ha enviado ningún cambio a Meta.' };
      }
      if (context.draft) return { text: 'Primero dime qué campaña quieres modificar; todavía no hay un cambio concreto para confirmar.' };
      const pending = Object.values(this.store.state.proposals).filter((p) => p.userId === String(userId) && p.chatId === String(chatId) && p.state === 'PENDING');
      if (pending.length !== 1) return { text: 'No hay una propuesta única pendiente. Dime la campaña y el cambio que quieres hacer.' };
      return this.command(`/${intent.type === 'confirm' ? 'confirmar' : 'cancelar'} ${pending[0].code}`, userId, chatId);
    }
    if (intent.type === 'command') return this.command(intent.command, userId, chatId);
    if (intent.type === 'unsupportedPeriod') return { text: 'Para evitar confundir el mes o semana natural con los últimos días, dime «últimos 7 días», «últimos 30 días» o dos fechas AAAA-MM-DD.' };
    if (intent.type === 'unsupported') {
      this.supersede(userId, chatId); delete context.draft; this.store.save();
      return { text: 'No he preparado ningún cambio. Indica una sola acción inmediata y concreta, por ejemplo «pon la campaña CollaGum a 35 euros al día». Las condiciones y programaciones necesitan configurarse por separado.' };
    }
    let action = intent;
    let candidates;
    if (intent.type === 'unknown' && context.draft) {
      if (this.now() > context.draft.expiresAt) { delete context.draft; this.store.save(); return { text: 'La selección ha caducado. Dime de nuevo el cambio que quieres hacer.' }; }
      const rows = (await this.api.campaigns()).filter((r) => context.draft.candidates.includes(String(r.id)));
      const selector = cleanSelector(text);
      candidates = matchingCampaigns(rows, selector);
      if (!candidates.length && /^[1-9]\d*$/.test(selector)) {
        const chosen = context.draft.candidates[Number(selector) - 1];
        candidates = rows.filter((r) => String(r.id) === chosen);
      }
      action = context.draft.action;
    } else if (['budget', 'pause'].includes(intent.type)) {
      this.supersede(userId, chatId); delete context.draft; this.store.save();
      if (['esa', 'esta', 'la misma', 'misma'].includes(intent.selector)) {
        if (!context.lastCampaignId || this.now() - context.lastCampaignAt > this.config.proposalTtlMs) return { text: 'Dime el nombre de la campaña; no tengo una referencia reciente y segura.' };
        candidates = [await this.target(context.lastCampaignId)];
      } else candidates = matchingCampaigns(await this.api.campaigns(), intent.selector);
    } else return { text: `No he interpretado la petición con seguridad. Puedes decir «cómo van las campañas hoy», «pon la campaña CollaGum a 35 euros al día» o «baja el presupuesto de CollaGum un 10 %».` };
    if (!candidates.length) return { text: 'No encuentro esa campaña. Dime su nombre completo o escribe «muéstrame las campañas».' };
    if (candidates.length !== 1) {
      context.draft = { action, candidates: candidates.map((r) => String(r.id)), expiresAt: this.now() + this.config.proposalTtlMs };
      this.store.state.conversations[key] = context; this.store.save();
      return { text: `Hay varias campañas. ¿Cuál quieres modificar? Responde con su nombre completo, ID o número de esta lista:\n${candidates.map((r, i) => `${i + 1}. ${r.name} · ID ${r.id}`).join('\n')}` };
    }
    delete context.draft; this.store.save();
    return this.propose(action.type === 'budget' ? 'budget' : 'pause', String(candidates[0].id), action.value, userId, chatId,
      action.type === 'budget' && action.mode !== 'set' ? action : null);
  }
  proposal(code, userId, chatId) {
    const p = this.store.state.proposals[code];
    if (!p || p.userId !== String(userId) || p.chatId !== String(chatId)) throw new Error('Propuesta inexistente o no autorizada.');
    return p;
  }
  async confirm(code, userId, chatId) {
    const p = this.proposal(code, userId, chatId);
    if (p.state !== 'PENDING') return `La propuesta está en estado ${p.state}. No se vuelve a ejecutar.`;
    if (this.now() > p.expiresAt) { p.state = 'EXPIRED'; this.store.save(); return 'La propuesta ha caducado. Solicita una nueva.'; }
    if (!this.config.writesEnabled || p.simulation === true) {
      p.state = 'SIMULATED';
      this.store.record({ event: 'SIMULATED', code, campaignId: p.campaignId });
      return 'Simulación: no se ha enviado ningún cambio a Meta.';
    }
    if (this.unresolved(p.campaignId)) throw new Error('La campaña tiene una acción sin reconciliar.');
    const current = await this.target(p.campaignId);
    if (JSON.stringify(this.snapshot(current)) !== JSON.stringify(p.before)) {
      p.state = 'STALE'; this.store.save(); return 'La campaña ha cambiado desde la propuesta. Solicita una nueva.';
    }
    // Recheck policy after restarts/config changes, before the durable execution claim.
    if (p.kind === 'budget') {
      const account = await this.api.account();
      const cents = Number(p.changes.daily_budget), old = Number(current.daily_budget);
      if (account.currency !== 'EUR' || !this.config.maxBudgetCents || cents > this.config.maxBudgetCents || Math.abs(cents - old) / old * 100 > this.config.maxChangePercent + 1e-8) throw new Error('La propuesta ya no cumple los límites actuales.');
    }
    if (this.now() > p.expiresAt) { p.state = 'EXPIRED'; this.store.save(); return 'La propuesta ha caducado durante la comprobación. Solicita una nueva.'; }
    p.state = 'EXECUTING'; p.executedAt = this.now();
    this.store.record({ event: 'EXECUTING', code, campaignId: p.campaignId, changes: p.changes, before: p.before, userId: p.userId });
    try {
      const result = await this.api.mutate(p.campaignId, p.changes);
      if (result?.success !== true) throw new Error('META_WRITE_UNCONFIRMED');
      const after = await this.target(p.campaignId);
      if (!Object.entries(p.changes).every(([key, value]) => String(after[key]) === value)) throw new Error('META_READBACK_MISMATCH');
      p.state = 'VERIFIED'; p.after = this.snapshot(after);
      this.store.record({ event: 'VERIFIED', code, campaignId: p.campaignId, after: p.after });
      return `Cambio aplicado y verificado en Meta: ${p.campaignName}.\nCódigo ${code}`;
    } catch {
      p.state = 'UNKNOWN'; this.store.record({ event: 'UNKNOWN', code, campaignId: p.campaignId });
      return `Resultado incierto para ${p.campaignName}. No se reintentará. Usa /reconciliar ${code} para consultar Meta.`;
    }
  }
  async reconcile(code, userId, chatId) {
    const p = this.proposal(code, userId, chatId);
    if (!['EXECUTING', 'UNKNOWN'].includes(p.state)) return `Estado: ${p.state}.`;
    const current = await this.target(p.campaignId);
    if (Object.entries(p.changes).every(([key, value]) => String(current[key]) === value)) {
      p.state = 'VERIFIED'; p.after = this.snapshot(current);
      this.store.record({ event: 'RECONCILED', code, campaignId: p.campaignId, after: p.after });
      return 'Meta muestra ahora el estado solicitado. Reconciliado sin reenviar la acción; no prueba quién realizó el cambio.';
    }
    return 'Meta no muestra el estado solicitado. La acción sigue bloqueada para revisión del operador; no se reenvía.';
  }
  async command(text, userId, chatId) {
    if (!text.trim().startsWith('/')) return this.natural(text, userId, chatId);
    const parts = text.trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    if (['/start', '/help', '/ayuda'].includes(cmd)) return { text: help };
    if (['/meta', '/resumen', 'meta'].includes(cmd)) {
      const account = await this.api.account();
      const range = dateRange(parts.join(' '), account.timezone_name);
      return { text: reportText(account, range, await this.api.insights(range.since, range.until)) };
    }
    if (cmd === '/analizar') {
      const account = await this.api.account();
      const range = dateRange('7d', account.timezone_name); const prior = previousRange(range);
      const [rows, before] = await Promise.all([this.api.insights(range.since, range.until), this.api.insights(prior.since, prior.until)]);
      return { text: comparisonText(account, range, prior, rows, before) };
    }
    if (cmd === '/campanas') {
      const account = await this.api.account(); const rows = await this.api.campaigns();
      return { text: [`Campañas · ${account.name}`, ...rows.map((r) => `${r.name} · ID ${r.id}\nEstado ${r.status} · Entrega ${r.effective_status}\n${account.currency !== 'EUR' ? 'Consulta el presupuesto en Meta (moneda no admitida en esta versión)' : Number(r.daily_budget) > 0 ? `${amount(Number(r.daily_budget) / 100, account.currency)}/día` : Number(r.lifetime_budget) > 0 ? `${amount(Number(r.lifetime_budget) / 100, account.currency)} total` : 'Presupuesto en conjuntos o no disponible'}`), ...(!rows.length ? ['Sin campañas.'] : [])].join('\n\n') };
    }
    if (cmd === '/presupuesto' && parts.length === 2) return this.propose('budget', parts[0], parts[1], userId, chatId);
    if (cmd === '/pausar' && parts.length === 1) return this.propose('pause', parts[0], null, userId, chatId);
    if (cmd === '/confirmar' && parts.length === 1) return { text: await this.confirm(parts[0], userId, chatId) };
    if (cmd === '/reconciliar' && parts.length === 1) return { text: await this.reconcile(parts[0], userId, chatId) };
    if (cmd === '/cancelar' && parts.length === 1) {
      const p = this.proposal(parts[0], userId, chatId);
      if (p.state !== 'PENDING') return { text: `Estado ${p.state}; no se puede cancelar.` };
      p.state = 'CANCELLED'; this.store.record({ event: 'CANCELLED', code: p.code }); return { text: 'Propuesta cancelada.' };
    }
    if (cmd === '/historial') return { text: this.store.state.audit.slice(-15).map((a) => `${a.at} · ${a.event} · ${a.campaignId || ''} · ${a.code}`).join('\n') || 'Sin acciones.' };
    if (cmd === '/estado') return { text: `Servicio Telegram VPS\nMeta: ${this.config.writesEnabled ? 'cambios con confirmación' : 'solo consulta y simulación'}\nPropuestas sin reconciliar: ${Object.values(this.store.state.proposals).filter((p) => ['EXECUTING', 'UNKNOWN'].includes(p.state)).length}` };
    return { text: `Comando no reconocido.\n${help}` };
  }
  async handle(update) {
    const callback = update.callback_query;
    const message = callback?.message || update.message;
    const sender = callback?.from || message?.from;
    if (!this.authorized(message, sender)) return; // No replies or logs for unknown senders.
    let text = message.text || '';
    if (callback) {
      await this.api.telegram('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
      const match = /^(confirm|cancel):([a-f0-9]{16})$/.exec(callback.data || '');
      if (!match) return;
      text = `/${match[1] === 'confirm' ? 'confirmar' : 'cancelar'} ${match[2]}`;
    }
    // Old backlog messages may be reported but must never initiate/confirm writes.
    if (!callback && (!message.date || this.now() / 1000 - message.date > 300 || message.date - this.now() / 1000 > 60)) {
      await this.api.send(message.chat.id, 'La orden es antigua. Envía una nueva.'); return;
    }
    let result;
    try { result = this.adsGateway ? await this.adsGateway.handle(text,{user:String(sender.id),chat:String(message.chat.id)},update.update_id) : await this.command(text, sender.id, message.chat.id); }
    catch (error) {
      result = { text: error.service ? `No se pudo consultar ${error.service}. Código ${error.status}; inténtalo más tarde.` : error.message };
    }
    await this.api.send(message.chat.id, result.text, result.markup);
    return { authorized: true, replied: true };
  }
}

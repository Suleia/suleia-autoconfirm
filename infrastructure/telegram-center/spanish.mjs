export const normalize = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

// Deterministic, anchored intents. Unrecognized/conditional instructions never
// become provider writes. Names and external content are data, never executable.
export function parseSpanish(input) {
  const text = normalize(input).replace(/^[¿¡]+|[?!.]+$/g, '').replace(/^(?:por favor,? |puedes |podrias )/, '').replace(/,? por favor$/, '').trim();
  if (/^(?:si|si,? (?:confirmo|hazlo|adelante)|confirmo|confirmar|hazlo|adelante)$/.test(text)) return { type: 'confirm' };
  if (/^(?:no|no,? (?:cancelalo|cancela)|cancela|cancelalo|cancelar|dejalo)$/.test(text)) return { type: 'cancel' };
  if (/\b(?:no|nunca|sin|si|cuando|manana|luego|despues|automaticamente|cada|todas|todos)\b/.test(text)) return { type: 'unsupported' };
  if (/^(?:hola|buenas|ayuda|que puedes hacer|como te uso)$/.test(text)) return { type: 'command', command: '/ayuda' };
  if (/^(?:estado|como estas|estado del bot|como esta el bot)$/.test(text)) return { type: 'command', command: '/estado' };
  if (/^(?:historial|muestra(?:me)? (?:el )?historial|que cambios has hecho)$/.test(text)) return { type: 'command', command: '/historial' };
  if (/^(?:(?:muestra(?:me)?|dime|lista|ver) (?:las |mis )?)?campanas(?: activas)?$/.test(text) || text === 'que campanas tengo') return { type: 'command', command: '/campanas' };
  if (/^(?:analiza(?:me)?(?: las| mis)? campanas|compara(?: las| mis)? campanas|compara esta semana con la anterior|analiza los resultados)$/.test(text)) return { type: 'command', command: '/analizar' };
  const report = /^(?:(?:como van|como fueron|como han ido|como estan) (?:las |mis )?campanas|(?:dame |muestra(?:me)? )?(?:el )?resumen|cuanto (?:he |hemos )?gastado|cuanto (?:gastamos|gaste)|gasto(?: de meta)?|resultados(?: de meta)?|roas)(?: (?:de |en |durante )?(hoy|ayer|(?:los )?ultimos (?:7|siete|30|treinta) dias|esta semana|este mes|\d{4}-\d{2}-\d{2} (?:a |al )?\d{4}-\d{2}-\d{2}))?$/.exec(text);
  if (report) {
    const period = report[1] || 'hoy';
    // Calendar week/month need a separate date-range interpretation. Do not
    // silently replace them with rolling 7/30 day periods.
    if (['esta semana', 'este mes'].includes(period)) return { type: 'unsupportedPeriod' };
    const range = /(?:7|siete)/.test(period) && !/^\d{4}-/.test(period) ? '7d' : /(?:30|treinta)/.test(period) && !/^\d{4}-/.test(period) ? '30d' : period.replace(/ (?:a|al) /, ' ');
    return { type: 'command', command: `/resumen ${range}` };
  }
  const money = '(\\d+(?:[.,]\\d{1,2})?)';
  const unit = '(?:euros?|€)';
  const daily = '(?: (?:al dia|diarios?|por dia))?';
  let match = new RegExp(`^(?:pon(?:me)?|establece|fija|deja|cambia|sube|baja|aumenta|reduce) (.+?) (?:a|en) ${money} ?${unit}${daily}$`).exec(text);
  if (match) {
    // 'en' is relative only for change verbs; 'pon ... en' sets an absolute amount.
    const relative = /^(?:sube|baja|aumenta|reduce) .+ en /.test(text);
    return { type: 'budget', selector: cleanSelector(match[1]), mode: relative ? /^(?:baja|reduce)/.test(text) ? 'decrease' : 'increase' : 'set', value: match[2], unit: 'money' };
  }
  match = new RegExp(`^(?:pon(?:me)?|establece|fija|deja) ${money} ?${unit}${daily} (?:a|en|para) (.+)$`).exec(text);
  if (match) return { type: 'budget', selector: cleanSelector(match[2]), mode: 'set', value: match[1], unit: 'money' };
  match = new RegExp(`^(sube|baja|aumenta|reduce) (.+?) (?:en |un |en un )?${money} ?(%|por ciento|euros?|€)$`).exec(text);
  if (match) return { type: 'budget', selector: cleanSelector(match[2]), mode: ['baja', 'reduce'].includes(match[1]) ? 'decrease' : 'increase', value: match[3], unit: ['%', 'por ciento'].includes(match[4]) ? 'percent' : 'money' };
  match = new RegExp(`^(sube|baja|aumenta|reduce)(?:le|la|lo)? (?:en |un |en un )?${money} ?(%|por ciento|euros?|€)$`).exec(text);
  if (match) return { type: 'budget', selector: 'esa', mode: ['baja', 'reduce'].includes(match[1]) ? 'decrease' : 'increase', value: match[2], unit: ['%', 'por ciento'].includes(match[3]) ? 'percent' : 'money' };
  match = /^(?:pausa|pausame|deten|para) (.+)$/.exec(text);
  if (match) return { type: 'pause', selector: cleanSelector(match[1]) };
  return { type: 'unknown' };
}

export function cleanSelector(text) {
  return normalize(text).replace(/^(?:el )?presupuesto(?: diario)?(?: de| para)? /, '')
    .replace(/^(?:de |para )?(?:la |mi )?campana /, '').replace(/^la de /, '')
    .replace(/^id /, '').replace(/^["'«]|["'»]$/g, '').trim();
}

export function matchingCampaigns(rows, selector) {
  const clean = cleanSelector(selector);
  const exact = rows.filter((r) => String(r.id) === clean || normalize(r.name) === clean);
  if (exact.length) return exact;
  // Whole name fragments only. Do not choose by spend, active status or fuzzy
  // edit distance when several campaigns share a product name.
  return clean ? rows.filter((r) => normalize(r.name).includes(clean)) : [];
}

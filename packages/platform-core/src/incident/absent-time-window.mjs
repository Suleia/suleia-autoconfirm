// Pure, absence-only parsing. A clock without an explicit relation is not a
// start time. Missing dates remain missing; the policy cannot execute them.
export function absentTimeWindow(text, button = null) {
  const empty = { window:null, from:null, to:null, reason:'AMBIGUOUS_CUSTOMER_RESPONSE' };
  let slot = text;
  if (/\b(no|imposible|nunca)\b/.test(slot)) {
    const clauses = slot.split(/\s*(?:,|\bpero\b)\s*/);
    if (clauses.length !== 2 || !/\b(no|imposible)\b/.test(clauses[0])
        || !/\bsi\b/.test(clauses[1]) || /\b(no|imposible|nunca|o)\b/.test(clauses[1]))
      return {...empty,reason:'NEGATED_TIME_WINDOW'};
    slot = clauses[1];
  }
  if (/\b(o|quizas|tal vez|puede que)\b/.test(slot)) return empty;
  const clock = '(\\d{1,2})(?::(\\d{2}))?';
  const relations = [...slot.matchAll(new RegExp(`(?:hasta(?: las?)?|antes de(?: las?)?|a partir de(?: las?)?|despues de(?: las?)?)\\s+${clock}\\b`,'g'))];
  const range = slot.match(new RegExp(`\\b(?:de|entre(?: las?)?)\\s+${clock}\\s+(?:a|y)(?: las?)?\\s+${clock}\\b`));
  const asTime = (h,m) => Number(h)<=23 && Number(m || 0)<=59 ? `${h.padStart(2,'0')}:${m || '00'}` : null;
  const morning = button === 'ABSENT_TOMORROW_MORNING' || /por la manana/.test(slot);
  const afternoon = button === 'ABSENT_TOMORROW_AFTERNOON' || /por la tarde|esta tarde/.test(slot);
  const allDay = /todo el dia/.test(slot);
  const kinds = [morning,afternoon,allDay,Boolean(range),relations.length>0].filter(Boolean).length;
  if (kinds>1 || relations.length>1 || /\by\s+(?:despues|antes|a partir|hasta)\b/.test(slot)) return empty;
  if (range) {
    const from=asTime(range[1],range[2]),to=asTime(range[3],range[4]);
    if(!from || !to || from>=to)return empty;
    return {window:'TIME_RANGE',from,to,reason:'EXACT_CUSTOMER_SLOT'};
  }
  if (relations.length===1) {
    const m=relations[0], at=asTime(m[1],m[2]);
    // A bare 3/5 does not establish AM/PM. 15/18 are unambiguous 24h clocks.
    if(!at || (!m[2] && Number(m[1])<13))return empty;
    const until=/^(hasta|antes)/.test(m[0]);
    return {window:until?'UNTIL_TIME':'FROM_TIME',from:until?null:at,to:until?at:null,reason:'EXACT_CUSTOMER_SLOT'};
  }
  if (/\d/.test(slot)) return empty;
  const window=allDay?'ALL_DAY':morning?'MORNING':afternoon?'AFTERNOON':null;
  return {...empty,window,reason:window?'EXACT_CUSTOMER_SLOT':empty.reason};
}

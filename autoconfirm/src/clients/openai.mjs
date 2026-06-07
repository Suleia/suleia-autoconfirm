import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

function outputText(data, fallback = '') {
  return (
    data?.output?.flatMap((item) => item?.content || [])
      ?.map((chunk) => chunk?.text || '')
      .join('') ||
    data?.output_text ||
    data?.choices?.[0]?.message?.content ||
    fallback
  ).trim();
}

export async function classifyConversation(messages) {
  if (!config.openaiApiKey) throw new Error('Falta OPENAI_API_KEY.');

  const systemPrompt = `
Eres un asistente que clasifica la respuesta de un cliente a un mensaje de confirmacion de pedido contra reembolso (COD).
Devuelve SOLO un JSON con esta forma exacta:
{
  "intent": "CONFIRM" | "CANCEL" | "ADDRESS_CHANGE" | "UNCLEAR",
  "confidence": <entero 0-100>,
  "reason": "<explicacion breve en una frase>"
}
Reglas:
- CONFIRM: el cliente acepta o confirma el pedido de forma clara, por ejemplo "confirmo", "confirmado", "si lo quiero", "lo quiero", "confirmar mi pedido".
- ADDRESS_CHANGE: el cliente pide cambiar/modificar/corregir direccion, calle, numero, codigo postal, ciudad, provincia, telefono o datos de entrega.
- CANCEL: el cliente rechaza explicitamente, pide cancelarlo o dice que no lo quiere.
- UNCLEAR: cualquier otra cosa o si el cliente no ha respondido.
- El silencio nunca es CANCEL.
- Un cambio de direccion, cambio de datos o peticion de modificacion NO es confirmacion y siempre debe clasificarse como ADDRESS_CHANGE.
- Ante duda entre CONFIRM y UNCLEAR, elige UNCLEAR.
`.trim();

  const userPrompt = `Conversacion:\n${messages.map((message) => `[${message.role}] ${message.content}`).join('\n')}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0,
      text: { format: { type: 'json_object' } },
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI respondio ${response.status}: ${JSON.stringify(data)}`);
  }

  return JSON.parse(outputText(data, '{}'));
}

export async function chatWithOperationsAgent({ message, dashboard, memory = [] }) {
  if (!config.openaiApiKey) return null;

  const compactDashboard = {
    finance: dashboard?.finance || {},
    kpis: dashboard?.kpis || {},
    latestDecisions: (dashboard?.decisions || []).slice(0, 8),
    latestFeedback: (dashboard?.feedback || []).slice(0, 8),
    learnedRules: memory.slice(-20)
  };

  const systemPrompt = `
Eres el agente operativo interno de Suleia. Hablas con Samuel en espanol.
Tu trabajo es explicar decisiones de confirmacion de pedidos, aceptar feedback, convertirlo en reglas operativas y proponer mejoras concretas.
Reglas criticas:
- Nunca confirmes pedidos si el cliente pide cambiar direccion, cambiar datos, modificar entrega, corregir calle, numero, CP, ciudad o provincia.
- Si hay cambio de direccion o datos de entrega, la accion correcta es dejar el pedido pendiente por direccion y no confirmar hasta corregir en Dropea.
- Si una correccion de Samuel contradice una decision anterior, acepta el feedback y conviertelo en aprendizaje.
- Responde de forma breve, clara y accionable.
`.trim();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.2,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Contexto actual:\n${JSON.stringify(compactDashboard, null, 2)}\n\nMensaje de Samuel:\n${message}`
        }
      ]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI respondio ${response.status}: ${JSON.stringify(data)}`);
  }

  return outputText(data);
}

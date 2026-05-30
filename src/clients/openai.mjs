import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

export async function classifyConversation(messages) {
  if (!config.openaiApiKey) throw new Error('Falta OPENAI_API_KEY.');

  const systemPrompt = `
Eres un asistente que clasifica la respuesta de un cliente a un mensaje de confirmación de pedido contra reembolso (COD).
Devuelve SOLO un JSON con esta forma exacta:
{
  "intent": "CONFIRM" | "CANCEL" | "UNCLEAR",
  "confidence": <entero 0-100>,
  "reason": "<explicación breve en una frase>"
}
Reglas:
- CONFIRM: el cliente acepta o confirma el pedido.
- CANCEL: el cliente rechaza explícitamente o pide cancelarlo.
- UNCLEAR: cualquier otra cosa o si el cliente no ha respondido.
- El silencio nunca es CANCEL.
- Ante duda entre CONFIRM y UNCLEAR, elige UNCLEAR.
`.trim();

  const userPrompt = `Conversación:\n${messages.map((message) => `[${message.role}] ${message.content}`).join('\n')}`;

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
    throw new Error(`OpenAI respondió ${response.status}: ${JSON.stringify(data)}`);
  }

  const text =
    data?.output?.flatMap((item) => item?.content || [])
      ?.map((chunk) => chunk?.text || '')
      .join('') ||
    data?.output_text ||
    data?.choices?.[0]?.message?.content ||
    '{}';

  return JSON.parse(text);
}

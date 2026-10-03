import { llmConfig } from './settings.js';

/**
 * One function for every AI provider. Returns the model's text reply.
 * Providers: anthropic, openai, gemini, openrouter, custom (any OpenAI-compatible endpoint).
 */
export async function complete({ system, user, maxTokens = 4000 }, cfg = llmConfig()) {
  const { provider, model, apiKey, baseUrl } = cfg;
  if (!provider || provider === 'none') throw new Error('No AI provider selected');
  if (!model) throw new Error('No AI model set in Settings');
  if (!apiKey && provider !== 'custom') throw new Error(`No API key set for ${provider}`);

  if (provider === 'anthropic') {
    const res = await fetch(`${baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
    });
    const j = await jsonOrThrow(res, 'Anthropic');
    return j.content.map((c) => c.text || '').join('');
  }

  if (provider === 'gemini') {
    const url = `${baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      }),
    });
    const j = await jsonOrThrow(res, 'Gemini');
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }

  // OpenAI-compatible: openai, openrouter, custom
  const base =
    baseUrl || (provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1');
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const j = await jsonOrThrow(res, provider);
  return j.choices?.[0]?.message?.content || '';
}

async function jsonOrThrow(res, name) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} returned ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} returned something that isn't JSON: ${text.slice(0, 200)}`);
  }
}

/** Pull the first JSON object/array out of a model reply (handles ```json fences and chatter). */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('AI reply had no JSON');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}

export function aiEnabled(cfg = llmConfig()) {
  return cfg.provider && cfg.provider !== 'none' && cfg.model && (cfg.apiKey || cfg.provider === 'custom');
}

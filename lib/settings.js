import { getSetting } from './db.js';

export const PROVIDERS = {
  none: { label: 'No AI (built-in rules only)', defaultModel: '' },
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-5', env: 'ANTHROPIC_API_KEY' },
  openai: { label: 'OpenAI (GPT)', defaultModel: 'gpt-4.1', env: 'OPENAI_API_KEY' },
  gemini: { label: 'Google (Gemini)', defaultModel: 'gemini-2.5-pro', env: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter (any model)', defaultModel: 'anthropic/claude-sonnet-4.5', env: 'OPENROUTER_API_KEY' },
  custom: { label: 'Other OpenAI-compatible (Groq, Ollama, Azure…)', defaultModel: '' },
};

export function llmConfig() {
  const provider = getSetting('llm_provider', 'none');
  const p = PROVIDERS[provider] || PROVIDERS.none;
  return {
    provider,
    model: getSetting('llm_model', p.defaultModel),
    apiKey: getSetting(`llm_api_key_${provider}`, p.env ? process.env[p.env] || '' : ''), // one saved key per provider
    baseUrl: provider === 'custom' ? getSetting('llm_base_url', '') : '',
  };
}

export function brand() {
  return {
    companyName: getSetting('company_name', 'Avery LED'),
    tagline: getSetting('company_tagline', ''),
    contactLine: getSetting('contact_line', ''),
    intakeEmail: getSetting('intake_email', ''),
    brandColor: getSetting('brand_color', '#2F2F2F'),
    accentColor: getSetting('accent_color', '#D8A533'),
    priceBasis: getSetting('price_basis', 'pack'),
    disclaimer: getSetting(
      'summary_disclaimer',
      'Comparison is based on the competitor quote provided and current Avery LED pricing. Substitutes are suggested equivalents; please confirm specifications for your application.'
    ),
  };
}

export function mask(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

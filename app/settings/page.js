import { requireAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSetting, setSetting, setBlob, deleteBlob, getBlob } from '@/lib/db';
import { PROVIDERS, llmConfig, brand, mask } from '@/lib/settings';
import { complete } from '@/lib/llm';
import SubmitButton from '../submit-button';

const TEXT_KEYS = [
  'llm_provider', 'llm_model', 'llm_base_url',
  'intake_email', 'company_name', 'company_tagline', 'contact_line', 'brand_color', 'accent_color', 'summary_disclaimer',
  'price_basis', 'shopify_domain',
];

async function save(formData) {
  'use server';
  await requireAuth();
  const intent = String(formData.get('intent') || 'save');
  if (intent === 'remove_logo') {
    deleteBlob('logo');
    revalidatePath('/', 'layout');
    redirect('/settings?saved=1');
  }
  const prevProvider = getSetting('llm_provider', 'none');
  const prevModel = getSetting('llm_model', '');
  for (const k of TEXT_KEYS) if (formData.has(k)) setSetting(k, String(formData.get(k) ?? '').trim());
  // Switching provider without typing a new model name: fall back to the new provider's default model.
  if (String(formData.get('llm_provider')) !== prevProvider && String(formData.get('llm_model') || '') === prevModel) setSetting('llm_model', '');
  const provider = String(formData.get('llm_provider') || 'none');
  const key = String(formData.get('llm_api_key') || '').trim();
  if (key) setSetting(`llm_api_key_${provider}`, key);
  if (formData.get('clear_key')) setSetting(`llm_api_key_${provider}`, '');
  const shop = String(formData.get('shopify_token') || '').trim();
  if (shop) setSetting('shopify_token', shop);
  const logo = formData.get('logo');
  if (logo && logo.size) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(logo.type) || logo.size > 2 * 1024 * 1024) redirect('/settings?error=Use a PNG, JPG or WebP logo no larger than 2 MB');
    setBlob('logo', logo.type, Buffer.from(await logo.arrayBuffer()));
  }
  revalidatePath('/', 'layout');
  if (intent === 'test') {
    let msg;
    try {
      const reply = await complete({ system: 'Reply with the single word OK.', user: 'Say OK', maxTokens: 20 });
      msg = `ok:Connected. The model replied “${reply.trim().slice(0, 40)}”.`;
    } catch (e) {
      msg = `err:${String(e.message || e).slice(0, 300)}`;
    }
    redirect(`/settings?test=${encodeURIComponent(msg)}`);
  }
  redirect('/settings?saved=1');
}

export default async function SettingsPage({ searchParams }) {
  const sp = await searchParams;
  const cfg = llmConfig();
  const b = brand();
  const hasLogo = !!getBlob('logo');
  const test = sp?.test ? decodeURIComponent(sp.test) : null;

  return (
    <form action={save} encType="multipart/form-data">
      <div className="spread">
        <h1>Settings</h1>
        <SubmitButton label="Save settings" name="intent" value="save" />
      </div>
      {sp?.saved && <p className="ok">Saved.</p>}
      {sp?.error && <p className="error">{sp.error}</p>}
      {test && <p className={test.startsWith('ok:') ? 'ok' : 'error'}>{test.slice(test.indexOf(':') + 1)}</p>}

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="card">
          <h3>AI model</h3>
          <p className="small muted">
            Used to read quotes and search for substitutes. Switch providers any time. With &ldquo;No AI&rdquo;, the tool still works using built-in rules.
          </p>
          <label>
            Provider
            <select name="llm_provider" defaultValue={cfg.provider}>
              {Object.entries(PROVIDERS).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model name
            <input name="llm_model" defaultValue={getSetting('llm_model', '')} placeholder={PROVIDERS[cfg.provider]?.defaultModel || 'e.g. gpt-4.1, claude-sonnet-4-5, gemini-2.5-pro'} />
            <span className="small muted" style={{ fontWeight: 400 }}>
              Leave blank for the default ({PROVIDERS[cfg.provider]?.defaultModel || 'none'}). Check the provider&apos;s docs for current model names.
            </span>
          </label>
          <label>
            API key for {PROVIDERS[cfg.provider]?.label} {cfg.apiKey && <span className="muted">(saved: {mask(cfg.apiKey)})</span>}
            <input name="llm_api_key" type="password" placeholder={cfg.apiKey ? 'Leave blank to keep the saved key' : 'Paste key'} autoComplete="off" />
          </label>
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="checkbox" name="clear_key" /> Remove saved key
          </label>
          <label>
            Custom endpoint (only for &ldquo;Other OpenAI-compatible&rdquo;)
            <input name="llm_base_url" defaultValue={getSetting('llm_base_url', '')} placeholder="https://api.groq.com/openai/v1" />
          </label>
          <SubmitButton label="Save & test connection" className="" name="intent" value="test" pending="Testing…" />
        </section>

        <section className="card">
          <h3>Quote intake</h3>
          <label>
            Intake email address
            <input name="intake_email" type="email" defaultValue={b.intakeEmail} placeholder="quote@averyled.com" />
            <span className="small muted" style={{ fontWeight: 400 }}>Shown on every summary so customers know where to send their next quote.</span>
          </label>
          <h3 style={{ marginTop: 20 }}>Pricing</h3>
          <label>
            Compare our price as
            <select name="price_basis" defaultValue={b.priceBasis}>
              <option value="per_piece">Per-piece comparison estimate (assumes loose pieces can be supplied)</option>
              <option value="pack">Whole-pack purchase cost (round up pieces to cases / boxes)</option>
            </select>
          </label>
          <h3 style={{ marginTop: 20 }}>Shopify (Avery store)</h3>
          <label>
            Store domain
            <input name="shopify_domain" defaultValue={getSetting('shopify_domain', '')} placeholder="averyled.myshopify.com" />
          </label>
          <label>
            Admin API access token {getSetting('shopify_token') && <span className="muted">(saved: {mask(getSetting('shopify_token'))})</span>}
            <input name="shopify_token" type="password" placeholder="shpat_… (needs read_products and read_inventory)" autoComplete="off" />
          </label>
        </section>

        <section className="card">
          <h3>Summary branding</h3>
          <label>
            Logo
            <img src="/api/logo" alt="Current logo" style={{ height: 56, width: 'auto', alignSelf: 'start', margin: '6px 0' }} />
            <span className="small muted" style={{ fontWeight: 400 }}>{hasLogo ? 'Your uploaded logo.' : 'Built-in Avery LED logo. Upload a file to replace it.'}</span>
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
          </label>
          {hasLogo && <SubmitButton label="Go back to the built-in logo" className="" name="intent" value="remove_logo" />}
          <label style={{ marginTop: 12 }}>
            Company name
            <input name="company_name" defaultValue={b.companyName} />
          </label>
          <label>
            Tagline
            <input name="company_tagline" defaultValue={b.tagline} />
          </label>
          <label>
            Contact line (footer)
            <input name="contact_line" defaultValue={b.contactLine} placeholder="Kryz · (555) 555-0100 · averyled.com" />
          </label>
          <div className="grid2" style={{ gap: 8 }}>
            <label>
              Brand colour
              <input name="brand_color" type="color" defaultValue={b.brandColor} />
            </label>
            <label>
              Accent colour
              <input name="accent_color" type="color" defaultValue={b.accentColor} />
            </label>
          </div>
          <label>
            Small print on the summary
            <textarea name="summary_disclaimer" defaultValue={b.disclaimer} />
          </label>
        </section>
      </div>
      <div style={{ marginTop: 16 }}>
        <SubmitButton label="Save settings" name="intent" value="save" />
      </div>
    </form>
  );
}

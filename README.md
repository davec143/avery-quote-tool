# Avery Quote Tool (v0.8)

Internal tool for Avery LED. Upload a competitor quote (PDF). The tool reads the line items, finds the Avery LED
substitute for each one, and produces a branded savings summary: their item vs our item, savings per line, and the total.

Kryz (or anyone on the team) reviews every match before a summary goes out. That's on purpose for v0.8.

## How a quote is processed

1. **Read the PDF.** The AI pulls out each line: part number, description, quantity, unit price. If no AI is set up, a
   built-in reader handles the standard "Line / Item / Price / Qty / Final Price" layout (Elemental / Diode LED quotes).
2. **Match each line**, in this order:
   1. **Compatibility list.** Exact competitor SKU, or a wildcard like `DI-24V-VL8MN3-30K-*`.
   2. **AI substitute search** against the Avery catalog. The AI can only pick SKUs that exist in the catalog; anything
      else is thrown out and marked N/A.
   3. **Built-in rules** if no AI is configured (type, colour temperature, brightness class, wattage).
3. **Savings are calculated in code, not by the AI:** their price × their qty − our price × our qty.
4. **N/A lines** (channels, fixtures, controls, anything Avery doesn't carry), lines with no competitor price, and lines
   you untick are left out of the summary.
5. Matches Kryz changes can be saved back to the compatibility list ("Remember"), so the next quote gets them automatically.

## Pages

| Page | What it's for |
|---|---|
| Quotes | Upload PDFs, see history and savings |
| Quote review | Check and fix each match, enter missing competitor prices, then confirm |
| Summary | Branded, printable page (Print → Save as PDF), or copy as plain text |
| Compatibility list | Upload or download the CSV, add or remove single rows. Template at `/api/compat-template` |
| Catalog | Sync from the Avery Shopify store, or upload a Shopify product export CSV |
| Settings | AI provider/model/key, intake email, logo and colours, pricing basis, Shopify credentials |

## AI providers

Pick one on the Settings page. Switch any time; keys are saved per provider.

- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- OpenRouter (one key, many models)
- Any OpenAI-compatible endpoint (Groq, Together, Azure OpenAI, a local Ollama…) via "Custom endpoint"
- None (built-in rules only)

Model names change often. Type the current model name from the provider's docs into the Model field.

## Pricing

Avery sells by the case (10 pcs) or box (80 pcs). By default the tool compares **price per piece** (case price ÷ 10).
Change it to full pack price in Settings → Pricing.

## Run locally

```bash
npm install
cp .env.example .env.local   # set APP_PASSWORD
npm run dev                  # http://localhost:3000
```

Test all sample quotes from the command line:

```bash
DATA_DIR=/tmp/aq node scripts/run-samples.mjs "/path/to/sample quotes" "/path/to/products_export.csv"
```

## Deploy on Railway

1. Push this folder to a GitHub repo and create a Railway service from it. Railway detects Next.js.
2. Add a **Volume** mounted at `/data`.
3. Variables: `APP_PASSWORD=<team password>`, `DATA_DIR=/data`. AI keys can go here or in Settings.
4. Start command: `npm start` (build: `npm run build`).

Everything (quotes, uploaded PDFs, compatibility list, settings, logo) is stored in one SQLite file under `DATA_DIR`.
Back up the volume.

## Shopify sync

Settings → Shopify: store domain (`something.myshopify.com`) and an Admin API token from a custom app with
`read_products` and `read_inventory`. Then Catalog → Sync now. Only active, priced products are pulled; samples
and test items are skipped.

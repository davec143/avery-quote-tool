# Avery Quote Tool (v0.9)

A team-reviewed product comparison for Avery LED. Upload a competitor's text-based PDF, check its extracted lines, select suitable Avery products, and prepare a branded comparison. The output explains the compared scope, specification differences, purchase quantities, exclusions, and next step.

## Workflow

1. Load the Avery catalog through Shopify sync or a product export CSV.
2. Upload up to five PDFs, each at most 10 MB. Scanned PDFs need a text-based export; OCR and manual line creation are not included.
3. Check **every** extracted source line against the original PDF, including unit prices and quantities. Confirm USD: currency conversion is not supported.
4. Review suggested substitutes. Known type, voltage, wet-rating, connector-width and undersized-driver conflicts are rejected. Unknown or differing specifications require customer-facing notes. Check roll lengths, required length, brightness, cut increments, AC input, dimming and installation requirements against datasheets.
5. Avery quantities always mean **pieces required**, regardless of pricing mode. Edit them to reflect the actual system requirement. Click **Save** to refresh prices and controls after edits.
6. Enter the customer, project, specification notes and available terms. Unknown lead time, payment terms and validity are displayed as “To be confirmed.” Internal notes are separate from customer-facing notes.
7. Complete the USD and quantity review checks, then **Confirm & make summary**. Confirmation validates and freezes the displayed pricing, catalog descriptions, customer details and branding. Later catalog or settings changes do not change that document. Editing a confirmed comparison returns it to review.
8. Export the reviewed document with **Print / save as PDF** or **Copy as text**. Draft and expired summaries disable these buttons. Browser printing itself cannot be prevented; drafts carry a visible warning in the printed document.

## Honest pricing

- **Whole-pack purchase cost** is the default for new settings. Pieces of the same SKU across included lines are combined before rounding up to cases or boxes. Seven pieces needed in two source lines, in cases of ten, cost one case. The purchase schedule lists packs, pieces supplied, excess pieces, pack price and actual product cost.
- Shared pack cost is allocated across source lines in proportion to the required pieces, using exact cents. The line totals reconcile to the purchase schedule.
- **Per-piece comparison estimate** remains available for existing workflows. It assumes loose pieces can be supplied. It is explicitly labelled as an estimate and can understate a full-pack purchase; confirm Avery supply terms before ordering.
- Higher-cost Avery matches remain included by default. They appear as additional cost and reduce overall savings.
- Missing prices, invalid quantities, unknown pack counts and invalid catalog prices cannot enter the compared subtotals. Excluded source lines and their known source amounts are shown separately.
- Both compared subtotals exclude tax, freight, installation, controls and unlisted accessories. The comparison is not a complete installed-project budget or final sales order.

## Matching and learning

Exact and wildcard compatibility mappings are tried first, then the configured AI, then built-in rules. Every source goes through deterministic compatibility checks. AI may select only catalog SKUs. Saved mappings and AI suggestions still require review; an SKU mapping alone cannot prove system suitability.

“Remember” is opt-in, unchecked by default, and saved only at confirmation. It saves the SKU **and Avery pieces per source unit**. Compatibility CSVs accept `competitor_brand,competitor_sku,competitor_description,avery_sku,notes,units_per_line_item`. Old five-column files default the multiplier to one. Wildcards can span different lengths; verify each source line separately.

## Run and verify

Use Node.js 22, matching `.node-version` and the deployment configuration.

```bash
npm ci
cp .env.example .env.local
# Set APP_PASSWORD in .env.local.
npm run dev
npm test
npm run build
```

The automated tests use a disposable SQLite database and mock provider responses. They do not call real AI or Shopify services.

Optional isolated demonstration, using sample products and prices:

```bash
DATA_DIR=/tmp/avery-demo node scripts/seed-demo.mjs
APP_PASSWORD=choose-a-local-password DATA_DIR=/tmp/avery-demo npm run dev
```

The demo seeder refuses to run when the quote database already contains quotes. Never use a production data directory for demonstration or sample runs.

```bash
DATA_DIR=/tmp/avery-samples node scripts/run-samples.mjs "/path/to/source PDFs" "/path/to/products_export.csv"
```

Sample runs exit unsuccessfully if processing fails or the parsed line sum differs from the printed `Quote Total`. The printed total can include freight, tax or discounts, so investigate the source instead of assuming an arithmetic error. Human review remains necessary for every source PDF.

## Providers and Shopify

Settings supports Anthropic, OpenAI, Gemini, OpenRouter, a custom OpenAI-compatible endpoint, or no AI. Keys are saved per provider. The custom endpoint is used only with the custom provider. Calls time out instead of hanging indefinitely. Select a supported model from the provider's current documentation.

Shopify requires the store's `.myshopify.com` domain and an Admin API token with appropriate product/inventory read scopes. Sync uses Admin API `2026-07`. Empty results, duplicate SKUs, page limits and products with more than 100 variants fail before replacing the catalog; use a complete CSV export for larger catalogs. Unknown case/box piece counts remain visibly invalid until the catalog is corrected.

## Deployment and storage

Production requires `APP_PASSWORD`. Without it, protected routes return HTTP 503. Server actions and sensitive download routes also check authentication directly. Sessions use signed, unique tokens with a seven-day server-checked expiry; users must sign in again after upgrading from v0.8.

For Railway, mount a persistent volume at `/data`, set `DATA_DIR=/data`, use Node.js 22, build with `npm run build`, and start with `npm start`. Use one writable app instance per SQLite database. Back up the volume before upgrades. Database migrations add columns to existing tables.

Old “done” quotes without a saved v0.9 snapshot are shown as drafts until reviewed and confirmed again. Existing pricing-mode settings are preserved; check Settings and select whole-pack purchase cost if that matches Avery's selling terms.

SQLite stores quotes, uploads, catalog, mappings, settings and uploaded logos. Provider and Shopify keys are stored in settings; protect and restrict access to backups. This remains a shared team-password tool, without individual user roles, an approval audit trail, public customer links, automatic sending, order submission, or warranty/stock guarantees.

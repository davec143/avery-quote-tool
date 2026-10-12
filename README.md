# Avery Quote Tool

A team-reviewed product comparison for Avery LED. Upload a competitor's text-based PDF or JPEG/PNG screenshot, check its extracted lines, select suitable Avery products, and prepare a branded comparison. The output explains the compared scope, specification differences, purchase quantities, exclusions, and next step.

## Workflow

1. Load the Avery catalog through Shopify sync or a product export CSV.
2. Drag and drop or choose up to five PDF, JPEG or PNG files: at most 10 MB each and 18 MB combined. Images require a configured vision-capable AI model. Text PDFs also work with AI off. Scanned PDFs still need a text-based export or an image upload. Source products missed by extraction can be added during review.
3. Check **every** extracted source line against the original source, including unit prices and quantities. The review workspace shows the original image/PDF and searchable source text beside the editor. Correct SKUs and descriptions, add missing products, remove duplicate/non-product rows, and enter circuit groups. Original text and uploads remain intact; saved corrections appear in review history. Confirm USD: currency conversion is not supported.
4. Review suggested substitutes. Known type, voltage, unsuitable wet-rating, narrow-tape and unsupported-output conflicts are rejected. Each match is labelled **Exact on checked specs**, **Alternative — differences disclosed**, or **Option requiring review**. Differences are carried into the customer document automatically. Review options also require a customer-facing explanation and explicit per-line acceptance. Check roll lengths, required length, brightness, cut increments, AC input, dimming and installation requirements against datasheets.
5. Avery quantities always mean **pieces required**, regardless of pricing mode. Automatic quantities recalculate from source requirements and the selected Avery product. Select **Manual** to enter a reviewed override with a customer-facing explanation. Unknown length or wattage requires a manual quantity. Click **Save** to refresh prices and controls after edits; changed automatic quantities must be saved before confirmation.
6. Enter the customer, project, reviewer name, specification notes and available terms. Unknown lead time, payment terms and validity are displayed as “To be confirmed.” Internal notes are separate from customer-facing notes.
7. Record source freight, tax, discounts and other explained charges separately. Resolve or explain any remaining difference between the product-plus-charge total and the printed source total. Complete the USD, quantity and per-line review checks, then **Confirm & make summary**. Confirmation validates and freezes the displayed pricing, catalog descriptions, customer details and branding. Later catalog or settings changes do not change that document. Editing a confirmed comparison returns it to review.
8. Export the reviewed document with **Print / save as PDF**, **Copy as text**, or **Download purchase CSV**. The proposal opens with savings, purchase quantities and key conditions; detailed calculations appear in an appendix. Draft and expired summaries disable these buttons. Browser printing itself cannot be prevented; drafts carry a visible warning in the printed document.

## Flexible crossovers

- **Channel:** match profile and total footage, calculate one-metre sections (or an explicit catalog section length), then round to whole bundles. Joined sections, fit and cutting waste are disclosed. Unknown profiles require review; conflicting profiles are rejected.
- **Drivers:** source ratings at or below 60W suggest 60W; larger ratings suggest 100W. Compatible rows pool total rated source capacity and round up to whole drivers. Explicit source groups, voltage and dimming protocol keep groups separate. Ten 30W drivers suggest five 60W; eight 120W suggest ten 100W. Consolidation and splitting require a reviewed wiring plan, including actual loads and headroom.
- **Tape width:** common widths of 8mm and above may cross to Avery 10mm with a fit note. Widths of 6mm or less are excluded; 7mm or unknown widths require review.
- **Output:** normalize to lumens per foot. Available 200/300/500 options allow 100→200 and 600→500, with the increase/decrease disclosed. Source output at 700 lm/ft or above is excluded. Unknown or inferred output requires review; compatible dimming is a condition, not a guarantee.
- **Terminal blocks:** a width-changing connector match depends on included Avery replacement tape. The document says it does not fit the original tape. Confirmation rechecks that dependency, including after tape is changed or excluded.
- **Tape quantities:** preserve continuous cuts when calculating rolls; total footage alone cannot satisfy multiple uninterrupted cuts. Longer-than-roll source runs are explicitly reviewed footage estimates requiring a join/feed plan.

## Honest pricing

- **Whole-pack purchase cost** is the default for new settings. Pieces of the same SKU across included lines are combined before rounding up to cases, boxes or bundles. Seven pieces needed in two source lines, in cases of ten, cost one case. The purchase schedule lists packs, pieces supplied, excess pieces, pack price and actual product cost.
- Shared pack cost is allocated across source lines in proportion to required pieces, or quoted watts for pooled automatic driver quantities, using exact cents. The line totals reconcile to the purchase schedule.
- **Per-piece comparison estimate** remains available for existing workflows. It assumes loose pieces can be supplied. It is explicitly labelled as an estimate and can understate a full-pack purchase; confirm Avery supply terms before ordering.
- Higher-cost Avery matches remain included by default. They appear as additional cost and reduce overall savings.
- Missing prices, invalid quantities, unknown pack counts and invalid catalog prices cannot enter the compared subtotals. Excluded source lines and their known source amounts are shown separately.
- Both compared subtotals exclude tax, freight, installation, controls and unlisted accessories. The comparison is not a complete installed-project budget or final sales order.

## Matching and learning

Exact and wildcard compatibility mappings are tried first, then the configured AI, then built-in rules. Every source goes through deterministic compatibility checks. AI may select only catalog SKUs. Saved mappings and AI suggestions still require review; an SKU mapping alone cannot prove system suitability.

“Remember” is opt-in, unchecked by default, and saved only at confirmation. For tape, channel and drivers it saves the SKU and lets the requirement model recalculate quantities for each job. For other fixed-count accessories it also saves Avery pieces per source unit. It never learns a rounded job-specific roll or driver ratio. Compatibility CSVs accept `competitor_brand,competitor_sku,competitor_description,avery_sku,notes,units_per_line_item`. Old five-column files default the multiplier to one. Wildcards can span different lengths; verify each source line separately.

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

The automated tests use disposable SQLite databases and mock provider responses, including vision image content for all five provider adapters. They do not call real AI or Shopify services.

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

## Product specifications, installations and alternatives

Each catalog SKU has a **Verified specifications** form. Enter a product reference and reviewer, then check values against the actual datasheet. Structured values include voltage, width, output per foot, tape watts per foot, roll/section length, maximum run, usable channel width, connector pins, driver wattage and pieces per sold pack. Blank verified fields remain unknown rather than falling back to text guesses. Metadata changes mark old verification stale; price-only updates retain it. Concurrent specification edits and catalog reloads require reloading the form. Already confirmed customer documents retain their frozen specifications and prices.

Assign the same **Circuit / installation group** to products installed together. Known voltage, connector width/pins, usable channel width and driver-capacity conflicts in an assigned group block confirmation. Unknown values and missing components stay visible for installation review. Unassigned products are not treated as one circuit. Maximum-run limits trigger feed/segmentation review.

**Quoted driver capacity** remains the default and preserves the team's examples. Optional **Selected Avery tape load with reviewed headroom** computes required source tape footage × selected Avery watts per foot × (1 + entered percentage / 100). It requires explicit circuit groups, known matching voltages, known tape lengths/power, and one automatic driver option/control pool per group. It recalculates when tape changes. Missing inputs require correction or a documented manual quantity. This percentage is extra capacity above calculated load; it does not represent a maximum loading percentage or establish circuit distribution, cut increments, feed placement, controls or installed-system suitability.

**Compare suggested options** offers closest specifications, lowest purchase cost (or piece estimate), and a higher-output tape option when viable. Each suggestion recalculates the current quote, including shared packs, dependent connectors and installation checks. Costs reflect the whole compared quote. Save a selected option before verifying its resulting quantities. Reviewer decisions and customer outcomes are recorded internally; **Team learning** summarizes correction activity and decline reasons without claiming real-world accuracy or win rates.

## Human-reviewed benchmarks

Export reviewed expectations from a confirmed summary, attach the corresponding source file and a frozen catalog to a benchmark manifest, and review the expectations manually. Example manifest: `tests/fixtures/benchmark/manifest.json`. Its quotes and products are synthetic; a passing sample does not establish accuracy on customer quotes.

```bash
DATA_DIR=/tmp/avery-benchmark-new npm run benchmark -- tests/fixtures/benchmark/manifest.json /tmp/avery-benchmark-report.json
```

The runner refuses any existing `quotes.db`, reads TXT/PDF/JPEG/PNG cases, and reports line coverage, line accuracy, missing/unexpected lines, source quantity/price errors, Avery SKU/quantity errors and total errors. Any failing case produces a nonzero exit. Optional case `configuration` replays `driver_basis`, `design_headroom` and explicit `groups` (`sku`, optional `line_ref`, `group`). Reviewed include/exclude decisions are applied before pooling. Source corrections, manual product choices and manual quantities are expectations for the reader/matcher to meet, not silently applied as successes.

A manifest can use `catalog_csv` relative to itself or inline `catalog` import records. Optional `specifications` entries contain `sku`, `reference`, `reviewed_by`, and `values` using the specification-form field names; `dimmable` uses `yes`/`no`/blank. Provide all relevant verified values: omissions are explicitly unknown. Optional provider environment variables are `BENCHMARK_PROVIDER`, `BENCHMARK_MODEL` and `BENCHMARK_BASE_URL`, with the existing provider API-key environment variable. Use a supported vision model for image cases. Reports contain source identifiers and expected/actual values; keep real-customer corpora and reports private. The runner cannot produce human-reviewed expected truth itself.

## Backup and restore

Pause app writes/uploads before backup so the SQLite snapshot and referenced source uploads represent the same state. These commands require explicit directories and refuse an existing destination:

```bash
npm run backup -- create /path/to/app-data /path/to/new-backup
npm run backup -- restore /path/to/new-backup /path/to/new-restored-data
```

Backup uses SQLite's consistent snapshot API, checks database integrity, copies referenced uploads, and records SHA-256 checksums. Restore verifies files, checks the restored database, and updates upload paths for the new data directory. Settings, product verification, mappings, history, frozen proposals and logos live in the database and are included. A missing referenced source fails the backup. Backups must live outside the source data directory. Protect them: they include customer data and saved provider/Shopify settings. Restore does not merge into or overwrite a running app. Check the restored instance before switching deployment storage.

## Providers and Shopify

Settings supports Anthropic, OpenAI, Gemini, OpenRouter, a custom OpenAI-compatible endpoint, or no AI. Keys are saved per provider. The custom endpoint is used only with the custom provider. Calls time out instead of hanging indefinitely. Select a supported model from the provider's current documentation. Image intake requires image/vision support; provider selection alone does not prove a model can read images. Uploaded screenshots are sent to that configured provider for transcription and extraction. The original source remains available through the authenticated source link.

Shopify requires the store's `.myshopify.com` domain and an Admin API token with appropriate product/inventory read scopes. Sync uses Admin API `2026-07`. Empty results, duplicate SKUs, page limits and products with more than 100 variants fail before replacing the catalog; use a complete CSV export for larger catalogs. Unknown case/box piece counts remain visibly invalid until verified product specifications or the imported catalog supply the count.

## Deployment and storage

Production requires `APP_PASSWORD`. Without it, protected routes return HTTP 503. Server actions and sensitive download routes also check authentication directly. Sessions use signed, unique tokens with a seven-day server-checked expiry; users must sign in again after upgrading from v0.8.

For Railway, mount a persistent volume at `/data`, set `DATA_DIR=/data`, use Node.js 22, build with `npm run build`, and start with `npm start`. Use one writable app instance per SQLite database. Back up the volume before upgrades. Database migrations add columns to existing tables. Existing saved Avery quantities are preserved as manual quantities on upgrade and require a reviewed explanation before reconfirmation.

Old “done” quotes without a saved v0.9 snapshot are shown as drafts until reviewed and confirmed again. Existing pricing-mode settings are preserved; check Settings and select whole-pack purchase cost if that matches Avery's selling terms.

SQLite stores quote data, catalog, mappings, settings, product verification, review history, frozen summaries and uploaded logos. Original source files live in `DATA_DIR/uploads`. Provider and Shopify keys are stored in settings; protect and restrict access to backups. This remains a shared team-password tool, without individual user roles, public customer links, automatic sending, order submission, or warranty/stock guarantees. Review history records names entered by reviewers and before/after changes; those names are self-reported, not authenticated individual identities. Earlier changes cannot be reconstructed, and history is retained only while the quote exists.

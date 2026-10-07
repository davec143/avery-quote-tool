# Avery LED quote tool audit and changes

Reviewed October 3-4, 2026. Scope: the local `avery-quote-tool` Next.js application, its SQLite pipeline, quote review, catalog import/sync, matching, login, export pages and the existing `Sample summary - T-104157-01.pdf`.

The original tool had a useful workflow, but its exported savings were not a reliable purchase comparison. The most serious problems were scope selection, pack arithmetic, and unsuitable product substitutions. The revised v0.9 keeps team review central and makes the output understandable to a recipient.

## Findings and fixes

| Priority | Original finding | Result in v0.9 |
|---|---|---|
| P1 | Matching automatically excluded any line where Avery was more expensive, exaggerating the apparent savings. | Higher-cost matches stay included by default and appear as additional cost. |
| P1 | Full-pack mode changed unit price while keeping piece quantities, potentially multiplying the pack price by the number of pieces. Per-piece mode ignored actual case/box purchase requirements. | Piece quantities have one meaning. Whole-pack mode combines each SKU, rounds up once, and allocates cost in cents. Per-piece mode is explicitly an estimate. |
| P1 | Built-in rules and saved mappings could propose electrical or physical conflicts; the driver rule replaced a larger supply with multiple smaller supplies. | All automatic matching sources receive known-spec checks. Confirmation also checks manually selected products. Known voltage, type, wet-rating, connector-width and driver-capacity conflicts block included lines. |
| P1 | An existing sample export paired wet-location source strips with Avery COB tape without showing the location-rating difference, and three source 120W drivers became six 100W drivers. Its $2,063.30 / 66% saving relied on per-piece costs and omitted purchase-pack implications. | These patterns are explicitly rejected or require documented quantity/specification review. The old sample's claimed savings should be reassessed from the original source quote and verified catalog data. |
| P1 | Confirmed summaries recalculated from live catalog prices and current settings. Editing price or quantities could leave a line marked confirmed. | Confirmation freezes the customer document. Edited commercial inputs invalidate it; stale forms cannot overwrite another review. Legacy confirmations without snapshots require review again. |
| P1 | Quantity and price inputs accepted negatives, non-finite values, and silent fallback quantities. Empty extraction could become an apparently successful review. | The whole form validates before database writes. Confirmation requires a customer, USD and source-unit checks, valid included prices, and at least one compared line. Unreadable extraction fails visibly. |
| P1 | No production password meant the complete tool was open. Server actions relied entirely on middleware. Login allowed protocol-relative redirects. | Production fails closed, mutation/download endpoints check sessions directly, sessions are signed and expire server-side, and redirect destinations are restricted to local paths. |
| P2 | “Less than the quote you received” suggested full-project savings despite silently omitted lines. The PDF lacked purchasing detail and key commercial information. | Output specifies compared line count, exclusions, USD, both subtotals, actual packs/excess pieces, spec notes, validity, terms, availability, and a next step. |
| P2 | Any draft could be printed or copied without a clear draft label. Print tables could repeat totals across pages and split the table poorly. | Draft/expired export buttons are disabled, draft warnings remain printable, columns wrap correctly, rows stay together, headers repeat and totals appear at the end. |
| P2 | Remembering a manual match was automatically checked and discarded the replacement quantity multiplier. | Remember is explicitly selected and only writes after confirmation; the conversion factor is retained and exported. |
| P2 | Shopify sync could replace the catalog with empty or truncated results. It used API 2025-07 and accepted arbitrary store hosts. | Domain is restricted to `.myshopify.com`, API version is 2026-07, and incomplete/empty/duplicate results preserve the existing catalog. Larger variant lists require CSV export. |
| P2 | Provider requests had no timeout; malformed quantities and partial AI extraction were accepted. | Requests time out. Invalid extraction falls back to rules; a shorter AI extraction does not replace a fuller rules result. Invented SKUs cannot become matches. |
| P2 | PDF uploads and logo uploads lacked meaningful server validation. SVG logo content could be served from the application origin. | PDF count, size and signature are checked. Logos are limited to PNG/JPEG/WebP and 2 MB. Delete/re-read controls explain destructive effects before proceeding. |

## What a customer needs to see

A recipient should understand what they are getting, how it differs from the requested products, how many cases/boxes they must buy, how much the compared products cost, which parts still need a separate supplier, and how to proceed. Savings should be secondary to suitability and a clear buying decision. Unknown terms should be visibly “To be confirmed” instead of invented.

The document is deliberately called a **product comparison**. A final sales quotation would also require an agreed bill of materials, shipping/tax treatment, commercial terms, warranty/returns terms, delivery commitment and a seller-approved acceptance/order process. These cannot be inferred from the local code or sample PDF.

## Verification

- 23 automated tests pass against disposable SQLite data. Coverage includes pack consolidation, cent allocation, negative-cost lines, missing/invalid inputs, unsafe matches, atomic save failures, draft/confirmation rules, snapshot stability, edit invalidation, stale writes, quantity learning, catalog preservation, partial/malformed AI replies, source arithmetic conflicts, USD guards and signed-session expiry.
- All 23 tests and the optimized Next.js production build pass on Node.js 22.23.3, matching the project deployment target. The same checks also passed on the initial Node.js 26 runtime.
- Browser checks used an isolated local database and clearly labelled sample prices: sign-in, the reviewed summary, draft export restrictions, missing-review errors, successful confirmation, responsive width at 390px, and no framework error overlay or broken summary images.
- Unauthenticated compatibility download returned HTTP 401.
- A demonstration PDF was generated from the actual summary page and inspected visually after print-width adjustments.

## Remaining limits and rollout

Human review remains essential. Specification checks use the text and catalog metadata available; they cannot prove full system compatibility, connected load, compliance, or roll-length equivalence. Source parsing has no OCR and no full automatic source-total reconciliation across every PDF layout. Live AI credentials and live Shopify data were not available in this workspace and were tested with mocks.

The app retains SQLite, a shared team password, plaintext keys in the protected settings store, and a single-instance deployment model. Individual accounts, rate limiting, role permissions, durable background jobs for long batches, an approval history, automatic backups and a customer portal are separate future work. No quotes were sent and no hosted deployment was changed.

Before deployment, back up the persistent volume, set APP_PASSWORD, verify real catalog pack counts and selling terms, and compare a real source PDF against its final product list. Existing pricing settings persist, so explicitly select the correct pricing mode. Legacy reviewed quotes need confirmation again to acquire a frozen snapshot.

Implementation references: `lib/comparison.js` centralizes arithmetic; `lib/match-safety.js` centralizes known-spec checks; `lib/review.js` validates and saves reviews; `lib/session.js` and `lib/auth.js` handle authentication; `lib/quotes.js` manages extraction/matching and snapshots.

Platform references checked during the audit: [Next.js data security](https://nextjs.org/docs/app/guides/data-security) and [Shopify API versioning](https://shopify.dev/docs/api/usage/versioning).

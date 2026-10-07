# Claude Handoff: Avery LED Quote Tool

## Mission

Continue improving and preparing the Avery LED Quote Tool for safe production use. The audit and a substantial reliability pass are already complete. Preserve the current uncommitted changes, inspect them before editing, and do not revert or replace the worktree.

The tool receives a customer or competitor quote, maps its line items to Avery products, lets staff review the proposed matches, and generates a customer-facing comparison PDF. The main product requirement is that the resulting quotation be understandable and trustworthy to both the employee reviewing it and the customer receiving it.

## Repository

- Working repository: `/Users/inspgadget/Documents/Hitlights/avery-quote-tool`
- Git remote: `https://github.com/davec143/avery-quote-tool.git`
- Current HEAD: `3d54edd Pin Node 22 (better-sqlite3 and unpdf need it)`
- Node version: 22
- App version: `0.9.0`
- Audit report: `AUDIT.md`
- Demonstration PDF: `output/pdf/avery-comparison-demonstration.pdf`

The worktree is intentionally dirty. The audit improvements have not been committed, pushed, deployed, or sent to a customer. Begin with `git status`, `git diff --check`, and a review of the diff. Do not discard untracked files.

## Pricing decision and calculation

Catalog quantities are quantities of individual pieces. Under the current default setting, Avery pricing represents the amount the customer must purchase in whole cases or boxes.

For rows using the same Avery SKU, the tool now:

1. Combines the required piece quantities.
2. Divides the total requirement by the pack quantity.
3. Rounds up once to a whole number of packs.
4. Multiplies the pack count by the pack price.
5. Allocates cents across the related comparison rows without changing the total.

The demonstration row that was questioned requires 12 pieces. The Avery product is sold as 10 pieces per case at $176 per case. The current whole-pack basis is therefore:

- 2 cases × $176 = $352
- 20 pieces supplied
- 8 pieces left over

The loose-piece equivalent would be $211.20, but that is not the selected basis. A per-piece estimate remains available as an explicit setting. Do not silently change the basis. The owner still needs to decide whether customer comparisons should default to full case/box purchase cost or only the pieces required.

The customer PDF now labels the column simply `Cost` and explains the calculation as `2 cases × $176` with `20 pieces supplied (8 extra)`.

## Work already completed

### Honest comparison pricing

- Added centralized comparison calculations in `lib/comparison.js`.
- Full-pack calculations round by Avery SKU rather than independently per source row.
- Higher-cost Avery matches are no longer hidden automatically.
- Totals, savings, pack quantities, excess pieces, and row allocations use consistent rounding.

### Compatibility and review safety

- Added `lib/match-safety.js` and `lib/review.js`.
- All match sources now reject known conflicts involving voltage, product type, wet-location rating, connector width, and undersized power supplies.
- Manual selection uses the same safety checks as automatic matching.
- Compatibility gaps require customer-facing notes rather than being silently accepted.
- Review updates validate all rows and save atomically.
- Revision checks prevent stale browser tabs from overwriting newer edits.
- Confirmation freezes a quote snapshot so later catalog edits do not change an approved quotation.

### Authentication and direct-route protection

- Added signed, unique, seven-day sessions in `lib/session.js` and shared authorization helpers in `lib/auth.js`.
- Production fails closed when `APP_PASSWORD` is absent.
- Server actions and download/API routes enforce authentication directly instead of relying only on middleware.
- Do not put any password value in source control or documentation. Configure `APP_PASSWORD` through the runtime environment.

### Catalog and Shopify reliability

- Imports and Shopify synchronization validate the complete incoming catalog before replacing the current one.
- Empty, malformed, or apparently truncated input does not erase a working catalog.
- Shopify domains are restricted to valid `myshopify.com` stores.
- Shopify API version is `2026-07`.

### Customer-facing quotation

- The summary now makes scope, exclusions, product specifications, pack purchase schedule, terms, estimates, and next steps visible.
- Added this disclaimer to the comparison PDF: `This is an estimate. Contact our team for the final price before placing your order.`
- The demonstration PDF was rendered and visually checked on both pages after the latest wording and calculation changes.

### Operational safeguards

- `DATA_DIR` controls persistent application data.
- `scripts/seed-demo.mjs` is only for a disposable data directory and refuses to seed a nonempty database.
- Do not run the demo seed against real Avery data.

## Important historical finding

An older sample quotation, `Sample summary - T-104157-01.pdf`, contained unsafe or misleading mappings, including a wet-rated strip comparison and a 120W requirement mapped to two 100W drivers. The revised safety checks block these conflicts or force review. Do not reuse the old reported 66% savings as evidence that the current quote is correct.

## Verification already completed

- `npm test`: 23 reliability tests pass.
- Production build passes on Node `22.23.3`.
- `git diff --check` passes.
- Browser verification passed for login, upload/review, draft export, confirmation, and responsive mobile layout.
- Unauthenticated PDF download returns 401.
- A production instance without `APP_PASSWORD` returns 503.
- The two-page demonstration PDF passed visual inspection after the latest comments.

Rerun the appropriate checks after any further edit. Do not treat the mocked integration checks as proof that live Shopify or AI credentials work.

## Current limitations

- Every generated match still needs human review before customer use.
- There is no OCR fallback or manual source-line addition when PDF extraction misses content.
- Live AI and Shopify integrations have not been verified with production credentials.
- Shared-password authentication and SQLite suit a single trusted team or single-instance deployment; there are no user roles or durable audit trail.
- There is no customer portal, electronic approval, or order-submission workflow.
- Legacy completed quotes without a frozen snapshot should be reopened and reconfirmed before reuse.

## Rollout checklist

Before deploying or using the tool for a real customer:

1. Back up the existing persistent data volume.
2. Configure `APP_PASSWORD` and a persistent `DATA_DIR` outside the repository.
3. Confirm actual pack quantities, pack prices, warranty language, freight treatment, taxes, and validity period with the Avery team.
4. Have the owner choose the default comparison basis: whole case/box purchase cost or per-piece estimate.
5. Test a real Shopify sync and a representative set of real source PDFs in a staging copy.
6. Review all matches and customer-facing notes before confirming or distributing a quote.
7. Reconfirm legacy completed quotes so they receive a frozen snapshot.

## Recommended next steps

1. Review `AUDIT.md` and the complete uncommitted diff.
2. Ask the owner only for decisions that cannot be inferred, especially the default price basis and verified commercial terms.
3. Fix any issues found during the diff review without weakening compatibility or authentication safeguards.
4. Run `npm test`, the Node 22 production build, and `git diff --check`.
5. Render and inspect a representative comparison PDF whenever PDF layout or wording changes.
6. Summarize the final diff and test evidence before proposing a commit or deployment.

## Suggested kickoff prompt

> Read `CLAUDE_HANDOFF.md` and `AUDIT.md` in this repository. Inspect the existing uncommitted changes and continue the Avery quote-tool reliability work from that state. Preserve the whole-pack pricing behavior unless I explicitly choose the per-piece basis. Do not discard files, seed a real database, expose credentials, deploy, or send a quote without my instruction. Run the listed verification checks after edits and explain customer-facing pricing in plain language.

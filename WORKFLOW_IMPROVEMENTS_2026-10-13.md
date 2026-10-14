# Quote workflow improvements — October 13, 2026

## Delivered

- Saved-draft confirmation checklist with direct links to affected lines and review sections. Checklist and final confirmation share validation; submitted values are always revalidated on the server.
- Create an independent draft from a saved quote. Reuses source and selected products, recalculates automatic quantities using the current catalog, and uses current prices. Copies the uploaded source file so deleting one quote cannot break the other. Resets approvals, reviewer, expiry and customer outcome. Retains commercial terms and assumptions for explicit review. Records the source quote and revision in history; the original quote and frozen proposal remain intact.
- Dashboard search across quote/customer/project/filename/competitor/source SKU/Avery SKU, review-status and customer-outcome filters, expiry visibility, and 25-row pagination. Search reaches all quotes instead of stopping at the latest 200.
- Length parsing distinguishes section/run length from explicitly stated total footage, verifies quantity × length against that total, accepts equivalent metric/imperial representations and thousands separators, and ignores maximum-run/cut-increment dimensions. Lumens or watts “per foot” no longer imply a quantity sold by the foot. Total-only tape estimates require review and disclose missing cut/run information in the proposal and installation notes.
- Pinned the transitive PostCSS dependency to 8.5.30, resolving the dependency audit findings without a major framework upgrade. The [upstream advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) identifies the patched version boundary; the installed newer patch reports zero known vulnerabilities.
- Clarified per-piece pricing: the recommended purchase table and copied proposal label the piece estimate separately from the full-pack option and its total. Purchase CSV exports both amounts. Existing pricing mode and comparison totals remain unchanged.
- Unreadable uploads with null source text display their error and recovery checklist instead of failing to render.

## Verification

- 105 automated tests passed on Node 22, including existing six synthetic PDF scenarios and new workflow regressions.
- Dependency audit: zero known vulnerabilities after patch; all 105 tests repeated successfully.
- Optimized Next production build passed without warnings; git diff whitespace check passed.
- Local production-browser smoke test: PDF upload, driver pooling, unpriced proposal, checklist targets, blocked incomplete confirmation, successful reviewed confirmation, purchase CSV, live public spec-sheet PDF, draft copying, recalculation, original snapshot immutability, independent source-file deletion, filters and mobile layout.
- Additional browser checks: unreadable-source page, pagination, total-footage disclosure.
- Two representative customer PDFs rendered; all four pages visually inspected.
- Evidence and live deployment verification: ../quote-tool-workflow-test-20261013/ (see final release record).

## Scope and limitations

No schema migration, catalog replacement, pricing-mode change, credential change, or real customer-quote mutation is required. Production smoke testing uses clearly labelled synthetic quotes. Matching still requires verified source requirements and catalog specifications; blank metadata is not invented. Existing shared-login identity and synchronous upload processing remain outside this release.

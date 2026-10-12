# Quote review workbench improvements — 2026-10-12

Implemented locally on top of the audit fixes and team-feedback crossover changes described in `TEAM_FEEDBACK_2026-10-12.md`. This is the implementation record before release: local verification used isolated synthetic data. Production deployment and recovery verification are recorded separately. No customer quote corpus or provider credentials were needed for implementation.

## Delivered

### Source correction workspace

The original PDF/image and searchable source text appear beside editable quote lines. “Find in source” highlights the SKU. Reviewers can correct source SKUs/descriptions, quantities and prices; add missing products; remove duplicate/non-product rows; assign circuit groups; and record internal decision reasons. Original uploads/transcriptions remain intact. Source corrections, added/removed rows and quote-level changes have before/after history.

Freight, tax, discounts and explained other charges are recorded separately and included in source-total reconciliation. They are excluded from both compared product subtotals. Remaining source-total differences still require correction or an explicit verified explanation. All source/form changes validate atomically and protect against stale quote revisions.

### Verified catalog fields

Each SKU has a product-specification form with a datasheet/reference, reviewer name and explicit verification checkbox. Relevant fields cover voltage, tape/connector width, output per foot, tape watts per foot, roll/section length, maximum continuous run, channel usable width, connector pins, driver wattage, pack size, CCT, IP rating and dimming.

Verified blanks stay unknown. Changed catalog metadata invalidates previous verification; price-only updates preserve it. Stale product forms reject concurrent edits and metadata reloads. A verification label applies to entered fields and does not establish complete system suitability. Real Avery datasheets still need to be checked by the team.

### Installation calculations

Quoted driver rated capacity remains the default, preserving the team's 30W/120W examples. Optional tape-load sizing uses required source footage and selected Avery watts per foot, with an explicitly entered percentage of extra capacity above calculated load. It requires explicit circuit groups, known matching voltages, known lengths/power and one automatic driver/control pool per group.

Changing tape power recalculates drivers. Missing inputs require correction or a documented manual quantity. Installation checks block known grouped voltage, connector width/pin, usable-channel-width and driver-capacity conflicts. Maximum tape runs require feed/segmentation review. Groups without full metadata or selected power supplies remain visibly incomplete. These calculations are capacity estimates: circuit distribution, feed locations, cut increments and dimming/control suitability still require review.

### Alternative choices and customer proposal

“Compare suggested options” provides closest specifications, lowest purchase cost/piece estimate, and an eligible higher-output tape option. It recalculates the entire compared quote, including shared packs, dependencies and installation checks. A selection is saved before its new quantities are confirmed.

The proposal opens with savings, recommended purchase quantities and concise key conditions. Detailed comparisons, quantity working, installation assumptions, excluded products and source charges appear in an appendix. Confirmed purchase CSV export uses frozen prices, labels the pricing basis and protects spreadsheet formula cells. Draft/expired exports are blocked. Page count varies with quote size and disclosure length.

### Reviewer history and customer outcomes

Confirmation requires a reviewer name. Review events record corrections, confirmations, rematches and source reads. Customer status and feedback can be recorded separately without invalidating the frozen customer document. “Team learning” summarizes recorded outcomes, frequently corrected source SKUs and decline feedback.

Names are self-reported under the existing shared team login; individual account authentication/roles were not added. Earlier activity cannot be reconstructed. History is retained only while the quote exists. Counts describe activity, not a measured accuracy or win rate.

### Benchmarks and recovery

The benchmark runner compares human-reviewed expected lines, prices, chosen SKUs/quantities and totals against actual extraction/matching. It reports coverage, line accuracy and explicit missing/unexpected/field/total errors. It can replay reviewed grouping, driver basis and headroom, and import verified specification values. Reviewed summaries can export an expectations starting point. Real expected truth must still be checked by a human; reviewer corrections are not silently applied as successes.

The runner requires an isolated data directory with no existing database. The supplied manifest/source are clearly labelled synthetic. It supports TXT/PDF/JPEG/PNG; images require an actual configured vision model. See `README.md` for commands and manifest details.

Backup/restore tools use SQLite snapshots, copy referenced uploads, check database integrity and SHA-256 checksums, restrict filesystem permissions, refuse existing destinations and rebase upload paths on restore. Tests restore synthetic data and reject tampering/overwrite. Pause writes/uploads for a consistent database-and-file backup. No production backup was taken.

## Verification

- Automated regression suite: 83 tests passed in an isolated Node.js 22 workspace, including the prior audit and team-feedback cases.
- Optimized Next.js production build: passed.
- Synthetic benchmark CLI: default driver basis and reviewed tape-load configurations passed; reused databases are rejected.
- Synthetic backup/restore: database and source upload restored correctly; tampering and existing destinations rejected.
- Production browser flow, with isolated synthetic quote/product data: source text highlighting and original-image display passed; missing-line entry and source freight reconciliation passed; suggested-option selection passed; changing tape power recalculated drivers 2 → 6 → 2; the specification form and reviewer-name gate passed; confirmed CSV/expectations exports passed; customer acceptance preserved the frozen export; the team-learning view loaded. No browser page errors were recorded.
- Authenticated downloads: anonymous access returned 401; draft purchase export returned 409; confirmed export returned 200.
- Mobile review and summary at 390px: no page-level horizontal overflow. Wide tables remain scrollable within their panels.
- Printed synthetic proposal: three Letter pages, with a complete overview on page one and a two-page appendix. Every rendered page was inspected; no clipping or near-empty overflow page remained. Page count varies for larger jobs.
- Synthetic performance check: 60 source rows against 50 eligible tape options computed suggested alternatives in approximately 827ms on this device. This is not a hosted or live-catalog performance guarantee.
- Whitespace/diff checks passed. Tests/build ran in a scratch copy with Node.js 22 and isolated SQLite data; the production data directory was not opened.

## Remaining work that needs real inputs

1. Assemble representative, privately stored real PDF/screenshot quotes and human-reviewed expectations; run the benchmark before claiming extraction/matching accuracy.
2. Verify actual Avery product specifications, pack counts, power consumption and limits against authoritative product references. The feature is implemented; the live catalog was not populated with unverified values.
3. Exercise image extraction against the chosen real vision provider/model. Mock responses validate adapter formats, not OCR accuracy.
4. Validate saved data migration, storage, source downloads and exports on a protected hosted staging deployment, then deploy through the team's normal process.
5. Review grouped installation assumptions with the product/application team. The tool does not replace circuit engineering or a final sales order.

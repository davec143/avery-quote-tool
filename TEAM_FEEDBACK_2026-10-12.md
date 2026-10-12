# Team feedback implementation — October 12, 2026

Predeployment implementation status: implemented and verified locally against the audited v0.9 baseline `0156d77`. At the time of these local checks, nothing had been pushed or deployed. No live app database, customer quotes, saved credentials or Shopify catalog were opened or changed.

## Requested behavior

| Feedback | Implemented behavior | Verified example |
|---|---|---|
| Channel | Match profile and aggregate required length. Convert to one-metre sections (or explicit catalog section length), then whole bundles. Disclose joined sections, fit and cutting waste. Unknown profile requires review. | Ten 8ft channels → 80ft → 25 sections → 3 bundles of 10. |
| Drivers | Choose 60W for source ratings ≤60W, 100W above 60W. Pool compatible source groups by rated watts; round to drivers and actual packs. Consolidation/splitting is a review option with a wiring-plan condition. | Ten 30W → five 60W; eight 120W → ten 100W. 200W and 300W sources also tested. |
| Tape width | Allow common widths ≥8mm with a difference/fit note. Exclude ≤6mm; 7mm or unknown width requires review. | 8mm and 12mm → Avery 10mm; 6mm and 5mm excluded. |
| Output | Normalize lm/m to lm/ft. Select available 200/300/500 options, disclose output increase/decrease and dimming conditions. Exclude ≥700 lm/ft. | 100→200; 600→500 with 100 lm/ft lower disclosed; 700/800 excluded. |
| Terminal blocks | Follow included corresponding replacement tape, track dependency IDs and revalidate on save, confirmation and partial rematching. Explicitly state that the 10mm block does not fit original 8mm tape. | 8mm block → 10mm only alongside Avery 10mm tape; removing tape blocks confirmation. |
| Uploads | Drag/drop and native file picker for PDF/JPEG/PNG. Retain authenticated original source. Images use configured vision AI to transcribe and extract the quote. | PNG drop, JPEG picker and PDF picker tested in the production build. |

Customer summaries carry **Exact on checked specs**, **Alternative — differences disclosed**, or **Option requiring review**. Differences are automatic customer disclosures; review options need a specification note where information is unresolved and explicit per-line acceptance. Driver capacity calculations are estimates for reviewed system alternatives; they do not claim drop-in circuit equivalence.

## Audit corrections included

- F1: calculate feasible continuous tape cuts per roll; longer-than-roll runs require a reviewed join/feed plan.
- F2: recompute automatic quantities from requirements on source or SKU edits, rather than multiplying a rounded ratio. Explicit manual mode retains documented overrides.
- F3: unknown length/wattage requires a documented manual count before confirmation. Unknown/inferred output and width require review.
- F4: keep deterministic extraction warnings and blank prices where matched source arithmetic contradicts AI extraction.
- F5: recompute source-total reconciliation after edits; confirmation requires correction or a recorded scope/charge explanation, frozen in the customer document. A separate source-charge ledger and manual source-line creation are still future work.
- F6: disclose distinct environmental ratings and require review. Unsuitable wet-rating and voltage conflicts remain blocked.
- F7: enforce an explicit 18 MB aggregate upload limit below the 20 MB multipart request ceiling, plus five files and 10 MB per file.
- F8: preserve metre labels in quantity explanations.
- F9: horizontally scrollable summary tables on mobile, including excluded products; print layout retains all details.

Previous saved Avery quantities migrate to manual mode so the upgrade preserves reviewed decisions. Previously imported channels classified as “other” are read using retained channel/bundle metadata. Frozen confirmed documents remain unchanged. Rematching or changing pooled quantities/dependencies clears affected approvals. Learned tape, driver and channel mappings retain SKU selection, rather than a rounded job-specific quantity ratio.

## Verification

- **65/65 automated tests passed**, using Node 22.23.3 and disposable SQLite databases.
- Optimized Next.js production build passed; `git diff --check` passed.
- Mocked image wire formats tested for Anthropic, Gemini, OpenAI, OpenRouter and custom OpenAI-compatible providers.
- Browser: PNG drag/drop, JPEG picker, PDF picker, protected original-source route, correct original MIME types, draft export disabled, dependent connector confirmation blocked without tape, confirmed export enabled and no browser runtime errors.
- Synthetic seven-line example: compared source subtotal **$1,910**, Avery whole-pack subtotal **$580**, savings **$1,330**. Six lines included; the 6mm tape line remains explicitly excluded. These are test prices, not Avery commercial pricing.
- Mobile summary checked at 390px; document width remains 390px with tables scrolling inside their containers.
- Browser-printed PDF rendered and visually inspected across all pages for quantity calculations, purchase schedule and automatic disclosures.

Reproducible automated coverage is in `tests/crossovers.test.mjs`, `tests/migration.test.mjs` and the updated existing suites. Browser/print validation ran in the isolated scratch copy `/tmp/avery-audit-20261012-NHTAyt`; its provider returned controlled synthetic data. The earlier `AUDIT_2026-10-12.md` and diagnostic script describe the historical baseline, not the corrected application.

## Before rollout

Verify real screenshots and representative competitor PDFs with the team's selected vision-capable model and current Avery catalog in staging. Model selection alone does not establish image-reading support or extraction accuracy. Text PDFs remain available with AI off; JPEG/PNG reading needs vision AI. Uploaded images are sent to the configured provider. Verify channel profiles, bundle counts, section lengths, dimming/control compatibility and actual prices against current product data.

Live AI/Shopify integrations, real-quote accuracy and hosted deployment/storage/backup health remain unverified. This work does not add scanned-PDF OCR, individual reviewer accounts, background processing, manual source-line insertion or order submission.

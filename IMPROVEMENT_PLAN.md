# Avery Quote Tool — Improvement Plan (v0.9 → v1.0)

Prepared October 6, 2026 after taking over from `CLAUDE_HANDOFF.md`. Nothing in the worktree was changed except adding this file.

## 1. Where things stand (verified today)

- Worktree is the dirty v0.9 state described in the handoff: 26 modified files, 9 new paths (`AUDIT.md`, `lib/auth.js`, `lib/comparison.js`, `lib/match-safety.js`, `lib/review.js`, `lib/session.js`, `scripts/seed-demo.mjs`, `tests/`, handoff). HEAD is still `3d54edd`. **Nothing from the audit is committed or backed up outside this one laptop.**
- `git diff --check` passes. `npm ci` + `npm test` on Node 22 in a clean scratch copy: 23/23 pass. (Production build and browser checks were not re-run today; they were reported passing in the handoff.)
- The arithmetic engine (`lib/comparison.js`) is sound for what it models: combine pieces per SKU, round up once to whole packs, allocate cents. The safety/auth/freeze work is real and well tested.

## 2. Diagnosis: why it is not yet a *reliable* comparison tool

The v0.9 work made the tool honest about **arithmetic**. It is still unreliable about **what is being compared**. Ranked by how much wrong output each causes:

1. **Unit of measure is not modelled (biggest gap).** The old sample PDF shows competitor tape lines with custom lengths (86.44 in, 115.04 in, 215.13 in, 77.5 in, each "qty 2–4") mapped 1:1 to Avery "pieces" of 200 lm/ft tape. A tape line's real requirement is *length × brightness × wattage*, not a count. Today the tool carries a single `qty` and a `units_per_line_item` multiplier, so:
   - a compat wildcard like `DI-24V-VL8MN3-30K-*` maps every length to the same SKU with multiplier 1;
   - "Remember this match" stores `our_qty / qty` as a multiplier and reuses it on the next quote, even though the right multiplier depends on that quote's lengths;
   - the only protection is a customer note and a "verify roll length" gap. The totals are still wrong whenever lengths differ.
2. **No system-level checks.** Drivers are checked against one line's wattage only. Nothing sums connected tape watts per run against driver capacity (80% rule), checks run length/voltage drop, or proposes "2 × 100 W" for a 120 W need. Today the 120 W line just becomes N/A with a note, so the customer sees a gap in the comparison.
3. **Specs are scraped from titles with regexes.** `toItem` and `assessMatch` infer voltage, wattage, IP rating, CCT and dimming from free text. A product title change in Shopify silently changes safety decisions. Unknown pack counts become `pack_qty = 0` (flagged invalid, good), but missing specs become "gaps", not failures.
4. **Input coverage is one vendor deep.** The rules reader only understands the Elemental/Diode "Line | Item | Price | Qty | Final" layout. For any other competitor you depend entirely on the AI reader, whose output is not reconciled against the printed total (only the rules path is). No OCR, no way to add a missed line by hand.
5. **"Reviewed" is a blanket attestation.** Confirm sets every line `confirmed=1` after one "I verified quantities" checkbox. There is no per-line sign-off, no record of who confirmed, and no audit trail.
6. **Synchronous, single-request processing.** Upload loops over up to 5 PDFs inside one server action; each may make two AI calls with 60 s timeouts. Large batches can hit platform request limits and leave quotes stuck in `processing`.
7. **Operational fragility.** Shared password (compared with `!==`, no rate limit; the session HMAC key is derived from the password itself), API keys in plaintext SQLite, single SQLite writer on one volume with manual backups, browser "Print to PDF" as the only customer artifact (output varies by browser).
8. **No evidence of accuracy.** All 23 tests use synthetic data and mocks. There are no real competitor PDFs in the repo, so there is no regression corpus and no measured match accuracy. This is the main reason I would not yet trust it unattended.

## 3. Decisions only Dave/Joe can make

| # | Decision | My recommendation |
|---|---|---|
| D1 | Default price basis: whole case/box vs per-piece | **Recommended: whole pack** as the headline; per-piece only as a labelled secondary line. Open question for Joe: can a dealer buy fewer than a full case? If yes, price those at the break-case price. |
| D2 | Do we sell cut-to-length tape, or only fixed rolls? | **Resolved Oct 6: fixed-length rolls; roll length is in the product specs.** Phase 1 reads it from the catalog and refuses to guess when it can't. |
| D3 | Freight, tax, warranty, lead time, validity defaults | Store as editable defaults in Settings; unknown shows "To be confirmed" (already the behavior). |
| D4 | Who can confirm a quote (Kryz only? Joe approval above $X?) | Per-user login + `confirmed_by`; optional second approval over a threshold. |
| D5 | Is this "comparison" or a sendable "quotation"? | Keep "comparison" until D3 and an approval step exist. |
| D6 | Source of truth for compatibility: Dave/Joe's list vs AI | List first, AI proposes only, deterministic checks always veto. |

## 4. Plan

Each phase has an exit test. Do not start a phase until the previous exit test passes.

### Phase 0 — Lock the baseline (½ day)

1. Create a branch (e.g. `v0.9-reliability`) and commit the current worktree in logical commits; push to the remote. Do not push to the default branch or deploy without approval.
2. Back up the Railway persistent volume (if a deployed instance exists) before any schema change.
3. Collect **10–20 real competitor PDFs** (past quotes, including at least 3 non-Elemental vendors) plus the current Shopify product CSV into a private corpus folder outside the repo. Record the *correct answer* for each: lines, quantities, price total, and the Avery product(s) a human would pick.
4. Resolve D1 and D2.

**Exit:** work is committed and recoverable; corpus and expected answers exist.

### Phase 1 — Make quantities mean the right thing (core fix, ~3–4 days)

1. Add a **requirement model** per source line: `kind` (tape / driver / connector / other), `requirement_unit` (pieces | length_ft | watts) and `requirement_value`. Parse tape length (in/ft/m) and wattage from the description; store the raw string and the parsed value so the reviewer sees both.
2. Store **structured catalog attributes** (`roll_length_ft`, `watts_per_ft`, `lm_per_ft`, `voltage`, `ip`, `cct`, `dimmable`, `max_watts`) in the database. Source them from Shopify metafields where available; otherwise from a one-time reviewed attribute sheet, not regex. Missing required attributes block automated matching for that item.
3. Convert requirement → Avery pieces in one tested function: tape `ceil(length_ft / roll_length_ft)`, drivers `ceil(load_w / (rated_w × 0.8))` or an explicit multi-driver option, connectors by count. Show the working on the line ("86.44 in = 7.2 ft → 1 roll of 16.4 ft").
4. Stop storing a reusable multiplier in the compatibility list for length-based items. Learn **SKU mappings only**; recompute quantity from the new quote's lengths. Keep the multiplier for genuinely fixed ratios (1 driver = 1 driver).
5. Add a system-load check: group tape lines by driver/run, warn when connected watts exceed 80 % of the chosen driver, and offer "N × smaller driver" as an explicit, labelled alternative.

**Exit:** the old T-104157-01 sample, run from the *source* quote, produces length-driven roll counts a technician agrees with; wildcard mappings no longer produce piece counts unrelated to length; new unit tests cover tape, driver and connector conversions.

### Phase 2 — Make input trustworthy (~3 days)

1. **Reconcile every extraction** (rules or AI) against printed subtotals/totals; mismatches block confirmation until the reviewer resolves them, and are shown beside the PDF.
2. **Side-by-side review UI:** source PDF page next to the extracted lines (the `/api/quotes/[id]/pdf` route already serves it); click a line to jump to the page.
3. **Manual add/edit line**, which also covers PDFs where extraction missed items.
4. Add rules-reader layouts for the 2–3 other competitors in the corpus; treat any layout the rules reader can't parse as "AI-only, needs full line check".
5. OCR fallback for scanned PDFs (server-side, optional; keep the current clear error as the default).
6. Move extraction/matching to a **background job** with a status page (a `jobs` table polled by the quote page). Process PDFs one at a time; failed jobs are retryable and never leave quotes in `processing`.

**Exit:** every corpus PDF either reconciles to its printed total or is clearly flagged; a batch of 5 PDFs does not depend on a single HTTP request.

### Phase 3 — Make matching measurably good (~3–4 days)

1. Build an **evaluation script** over the corpus: for each line, compare tool output to the human answer and report precision (wrong matches) and recall (missed matches). Run it in CI. Target: **zero unsafe matches** in the corpus, and ≥90 % of non-N/A lines correct at "high/medium" confidence.
2. Pipeline order stays: compat list → deterministic rules → AI, but the AI only ranks candidates that pass the deterministic filter; it can no longer introduce a SKU outside that shortlist. This also shrinks prompts (today the whole catalog is sent every call).
3. Replace the single `low/medium/high` string with explicit reasons per axis (voltage, type, IP, CCT, brightness, wattage, dimming), so reviewers see *what* differs.
4. **Per-line confirmation**: lines with any gap or low confidence need an individual tick plus a customer note; "confirm all" is only available for lines with no gaps. Record `confirmed_by` and timestamp.
5. Compatibility list: add `valid_from`, `reviewed_by`, and conflict detection (two rows for the same competitor SKU with different Avery SKUs). Wildcards only allowed for items with a fixed requirement unit.

**Exit:** evaluation report committed; no unsafe corpus matches; reviewers can see why each line was matched.

### Phase 4 — Customer document you can send (~2 days)

1. Generate the PDF **server-side** (headless Chromium or a PDF library) from the frozen snapshot so output is identical on every machine; stop relying on browser print.
2. Version the document template; the snapshot records template version, catalog `updated_at`, price basis and settings used.
3. Terms (freight, tax, warranty, lead time, validity) come from Settings defaults with per-quote override (D3).
4. Add a "reviewer checklist" page (internal only) listing every gap, note and override for that quote.

**Exit:** the same quote renders byte-comparable PDFs twice; Joe signs off on wording.

### Phase 5 — Security and operations (~2–3 days)

1. Per-user accounts (even 3–5 users) with `created_by` / `confirmed_by` on quotes and an append-only `audit_log`. Replace the shared password; if it stays short-term: `crypto.timingSafeEqual`, login rate limiting, and a separate `SESSION_SECRET` (don't derive the HMAC key from the password).
2. Move API keys to Railway environment variables; remove them from the settings table and from backups.
3. Automated nightly backup of the SQLite volume (e.g. Litestream or scheduled snapshot) and a documented restore test.
4. Schema versioning: replace the "ALTER TABLE if column missing" pattern with numbered migrations.
5. Health endpoint, structured error logging, and a "last Shopify sync" banner when the catalog is more than N days old.
6. Staging environment (a second Railway service/volume) used for the first real Shopify sync and the corpus run before production.

**Exit:** restore from backup demonstrated; all confirmations attributable to a user.

### Phase 6 — After v1.0 (backlog)

Email intake via the quote mailbox, customer-facing approval link, order handoff to Shopify draft orders, analytics (win rate by competitor/product), OCR improvements, role-based approvals.

## 5. Quality gates (apply to every phase)

- `npm test` green on Node 22; `npm run build` green; `git diff --check` clean.
- Evaluation script on the real corpus has no regressions.
- Any change to PDF layout or wording: render a representative PDF and inspect every page.
- Never weaken a safety check to make a corpus case pass; add a human-review path instead.
- No real Avery data in demo seeds; no credentials in the repo.

## 6. Biggest risks

| Risk | Mitigation |
|---|---|
| Wrong-but-plausible savings sent to a customer | Phases 1–3 gates; keep "comparison, not quotation" wording until D3/D5 settled. |
| Catalog metadata too sparse for structured specs | Do Phase 0 attribute sheet early; block matching on missing attributes rather than guessing. |
| AI provider variation (customer data sent to third parties) | Shortlist-only prompts; document which provider is used; allow "no AI" mode. |
| Single-instance SQLite loss | Phase 5 backups before real use. |
| Scope creep into a full CPQ system | Hold the line at v1.0 = trustworthy comparison; everything else is Phase 6. |

## 7. Suggested first week

Day 1: Phase 0 (commit, corpus, D1/D2). Days 2–4: Phase 1 core (requirement model, attribute sheet, conversion, tests). Day 5: first corpus run and a gap list. Phases 2–5 follow in order, with a staged real-credential test before any customer use.

## 8. Progress log

**Oct 6 (first slice of Phase 1, uncommitted):**
- New `lib/requirements.js`: reads the tape length of a source line (ignores wire leads, brightness, wattage, width; refuses ambiguous or missing lengths) and the roll length from catalog specs, then computes whole rolls with the working shown on the line.
- `lib/quotes.js` (`rematch`): tape quantity now comes from length ÷ roll length instead of `qty × multiplier`. If a length can't be read, the line stays but drops to low confidence with a "set the roll count manually" note.
- `lib/review.js`: "Remember this match" no longer stores a quantity multiplier for tape.
- `lib/comparison.js`: default price basis is now whole pack if no basis is passed.
- Tests: 31 pass (23 existing + 8 new). Not yet run: production build, browser check, real catalog roll-length text (no catalog CSV was available; the roll-length parser is verified only on synthetic spec text).
- Assumption to confirm: each source tape line is rounded up to whole rolls on its own, then rolls of the same SKU are combined into cases.

**Oct 7 (stress test + fixes, uncommitted):** built 6 realistic competitor PDFs (now `tests/fixtures/`, regenerate with `make-fixtures.py`) covering boundary roll lengths, metric vs feet, per-foot pricing, wet-rated tape, 12V tape, RGBW, an undersized driver, an unpriced line, a freight/discount/CAD quote, a 60-line multipage quote, another vendor's layout and a unit-vs-extended price conflict. Problems found and fixed:
- Two 5 m lengths needed a phantom third 16.4 ft roll (metric/feet rounding). Added a 0.5% tolerance.
- Every matched line was "low" confidence and demanded a typed note, because standard datasheet checks were treated as gaps. Standard checks are now listed on the line without forcing low confidence; real unknowns (voltage, CCT, brightness, dimming protocol) still require a note.
- The rules matcher ignored an explicit "200 lm/ft" and picked the 100 lm/ft tape at medium confidence. Explicit brightness now wins; brightness gaps over 25% are flagged; unknown brightness is low confidence.
- Connectors were flagged "verify voltage". Removed.
- A quote in any layout other than Elemental's read zero lines. Added a generic single-row table reader (every row must satisfy qty × unit = amount).
- One unit/extended price conflict failed the whole quote. Now the line is kept with a blank price and a warning, and cannot enter totals until fixed.
- Extracted lines are reconciled to the printed quote total; mismatches show a banner (and mention freight/tax/discount when the quote has them).
- Tape length working is stored per line (`qty_basis`) and shown on the customer summary; tape quantities say "rolls".
- Sign-in: constant-time password check, 8-failure/15-minute rate limit, optional `SESSION_SECRET`.
Verification: 42 tests pass (23 original + 19 new); deliberate breakage of three fixes was caught by the new tests; production build passes; a headless-browser run of login, throttle, upload, review, confirm, frozen summary and anonymous-access block passed.
Still open: driver-load check against connected tape watts; real catalog and real competitor PDFs (all fixtures are synthetic); per-user accounts and audit trail; background jobs; server-side PDF; real Shopify/AI credentials untested.

// Member portal: Shopify proxy authentication, approved-tag access, per-customer isolation and publishing.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-portal-'));
process.env.DATA_DIR = folder;
const { db, setSetting } = await import('../lib/db.js');
const { replaceCatalog, toItem } = await import('../lib/catalog.js');
const { getQuote } = await import('../lib/quotes.js');
const { saveReview } = await import('../lib/review.js');
const { duplicateQuote } = await import('../lib/quote-drafts.js');
const portal = await import('../lib/shopify-portal.js');
const data = await import('../lib/portal.js');
const html = await import('../lib/portal-html.js');
after(() => { db().close(); fs.rmSync(folder, { recursive: true, force: true }); });

const config = { ...portal.portalConfig(), secret: 'hush', store: 'avery-test.myshopify.com', clientId: 'client', adminToken: '', approvedTag: 'approve', maxAgeSeconds: 600, storefront: 'https://averyled.com', proxyPath: '/apps/quote', appOrigin: 'https://app.example' };
const now = 1317327555 * 1000;
function signed(params, secret = 'hush') {
  const sp = new URLSearchParams(params);
  sp.set('signature', portal.proxySignature(sp, secret));
  return sp;
}
const base = { shop: 'avery-test.myshopify.com', logged_in_customer_id: '42', path_prefix: '/apps/quote', timestamp: '1317327555' };

test('proxy signature follows Shopify\'s documented sorted-parameter format', () => {
  const sp = new URLSearchParams('extra=1&extra=2&shop=avery-test.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555');
  const documented = 'extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviewsshop=avery-test.myshopify.comtimestamp=1317327555';
  assert.equal(portal.proxySignature(sp, 'hush'), crypto.createHmac('sha256', 'hush').update(documented).digest('hex'));
});

test('only correctly signed, fresh requests from the configured shop are trusted', () => {
  const ok = portal.verifyProxyRequest(signed(base), { config, now });
  assert.deepEqual(ok, { shop: 'avery-test.myshopify.com', customerId: '42', prefix: '/apps/quote' });
  const tampered = signed(base); tampered.set('logged_in_customer_id', '43');
  assert.equal(portal.verifyProxyRequest(tampered, { config, now }), null);
  assert.equal(portal.verifyProxyRequest(signed(base, 'wrong'), { config, now }), null);
  assert.equal(portal.verifyProxyRequest(signed(base), { config, now: now + 11 * 60 * 1000 }), null);
  assert.equal(portal.verifyProxyRequest(signed({ ...base, shop: 'other.myshopify.com' }), { config, now }), null);
  assert.equal(portal.verifyProxyRequest(new URLSearchParams(base), { config, now }), null);
  assert.equal(portal.verifyProxyRequest(signed(base), { config: { ...config, secret: '' }, now }), null);
  assert.equal(portal.verifyProxyRequest(signed({ ...base, logged_in_customer_id: '' }), { config, now }).customerId, '');
});

test('upload tokens are customer-bound, expire and cannot be altered', () => {
  const token = portal.uploadToken('42', { config, now });
  assert.equal(portal.verifyUploadToken(token, { config, now }), '42');
  assert.equal(portal.verifyUploadToken(token.replace(/^42\./, '43.'), { config, now }), null);
  assert.equal(portal.verifyUploadToken(token, { config, now: now + 7201 * 1000 }), null);
  assert.equal(portal.verifyUploadToken(token, { config: { ...config, secret: 'other' }, now }), null);
  assert.equal(portal.verifyUploadToken('garbage', { config, now }), null);
});

function shopifyMock(tags, { fail = false, profileFails = false } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, body: url.endsWith('/access_token') ? Object.fromEntries(new URLSearchParams(options.body)) : JSON.parse(options.body) });
    if (url.endsWith('/admin/oauth/access_token')) return Response.json({ access_token: 'token-1', expires_in: 86399 });
    if (fail) return new Response('nope', { status: 500 });
    const { query } = JSON.parse(options.body);
    if (query.includes('MemberProfile')) return profileFails ? Response.json({ errors: [{ message: 'Access denied' }] }) : Response.json({ data: { customer: { displayName: 'Dana Installer', defaultEmailAddress: { emailAddress: 'dana@example.com' }, defaultAddress: { company: 'Bright Electric' } } } });
    return Response.json({ data: { customer: tags === null ? null : { id: 'gid://shopify/Customer/42', tags } } });
  };
  return { fetcher, calls };
}

test('approval uses the same case-insensitive approve tag as the theme and fails closed', async () => {
  portal.clearMemberCache();
  const approved = shopifyMock(['Approve', 'wholesale']);
  const a = await portal.memberAccess('42', { config, fetcher: approved.fetcher, fresh: true });
  assert.equal(a.state, 'approved');
  assert.deepEqual(a.member, { id: '42', name: 'Dana Installer', email: 'dana@example.com', company: 'Bright Electric' });
  assert.deepEqual(approved.calls[0].body, { grant_type: 'client_credentials', client_id: 'client', client_secret: 'hush' });
  assert.equal(approved.calls[1].body.variables.id, 'gid://shopify/Customer/42');
  portal.clearMemberCache();
  assert.equal((await portal.memberAccess('42', { config, fetcher: shopifyMock(['approved-ish', 'approves']).fetcher, fresh: true })).state, 'pending');
  portal.clearMemberCache();
  assert.equal((await portal.memberAccess('42', { config, fetcher: shopifyMock([], { fail: true }).fetcher, fresh: true })).state, 'unavailable');
  portal.clearMemberCache();
  assert.equal((await portal.memberAccess('42', { config, fetcher: shopifyMock(null).fetcher, fresh: true })).state, 'unavailable');
  assert.equal((await portal.memberAccess('', { config })).state, 'guest');
  portal.clearMemberCache();
  const noProfile = await portal.memberAccess('42', { config, fetcher: shopifyMock(['approve'], { profileFails: true }).fetcher, fresh: true });
  assert.equal(noProfile.state, 'approved'); assert.equal(noProfile.member.email, '');
});

test('revoked approval takes effect on fresh checks', async () => {
  portal.clearMemberCache();
  await portal.memberAccess('42', { config, fetcher: shopifyMock(['approve']).fetcher, fresh: true });
  assert.equal((await portal.memberAccess('42', { config, fetcher: shopifyMock([]).fetcher })).state, 'approved', 'page views may use the one-minute cache');
  assert.equal((await portal.memberAccess('42', { config, fetcher: shopifyMock([]).fetcher, fresh: true })).state, 'pending', 'cart and upload checks are always fresh');
});

const driver = toItem({ sku: 'D60', title: '24V 60W non-dimmable driver', price: 100, options: ['Case (10 pcs)'], specs: 'IP20', source: 'test' });
replaceCatalog([driver], 'test'); setSetting('price_basis', 'pack');
function memberQuote(customerId = '42') {
  const id = Number(db().prepare("INSERT INTO quotes (customer,job_name,quote_number,competitor,raw_text,status,shopify_customer_id,portal_status,portal_customer_name) VALUES ('Bright Electric','Kitchen','WF-1','Rival Supply','Source USD','review',?,'submitted','Dana')").run(customerId).lastInsertRowid);
  db().prepare("INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price,our_sku,our_qty) VALUES (?,0,'1','SOURCE-D60','24V 60W non-dimmable driver',3,50,'D60',3)").run(id);
  return id;
}
function confirm(id) {
  const q = getQuote(id), f = new FormData();
  for (const [k, v] of Object.entries({ revision: q.revision, customer: q.customer, reviewer_name: 'Kryz', quantities_verified: 'on', currency_confirmed: 'on' })) f.set(k, String(v));
  for (const l of q.lines) for (const [k, v] of Object.entries({ qty: l.qty, oq: l.our_qty, price: l.comp_unit_price ?? '', sku: l.our_sku, mode: l.quantity_mode, inc: 'on', note: '' })) f.set(`${k}_${l.id}`, String(v));
  saveReview(id, f, true);
}

test('members see only their own quotes, and proposals only after the team publishes a confirmed summary', () => {
  const id = memberQuote(), other = memberQuote('77');
  assert.deepEqual(data.listMemberQuotes('42').map((q) => q.id), [id]);
  assert.equal(data.listMemberQuotes('42')[0].state.key, 'review');
  assert.equal(data.memberProposal('42', id).document, null);
  assert.equal(data.memberProposal('42', other), null, 'another customer\'s quote is not found');
  assert.throws(() => data.publishToMember(id, getQuote(id).revision, 'Kryz'), /Confirm the comparison/);
  confirm(id);
  assert.equal(data.memberProposal('42', id).document, null, 'confirmed but unpublished stays in review');
  assert.throws(() => data.publishToMember(id, getQuote(id).revision, ''), /Enter your name/);
  assert.throws(() => data.publishToMember(id, getQuote(id).revision - 1, 'Kryz'), /changed/);
  data.publishToMember(id, getQuote(id).revision, 'Kryz');
  const found = data.memberProposal('42', id);
  assert.equal(found.state.key, 'ready'); assert.equal(found.document.ready, true);
  assert.equal(found.document.quote.notes, undefined, 'internal notes are not in the customer document');
  assert.equal(data.memberProposal('77', id), null);
  assert.ok(data.listMemberSubmissions().every((q) => q.id !== id), 'published proposals leave the team queue');
  // Editing after publication hides it until confirmed again.
  db().prepare("UPDATE quotes SET status='review', summary_snapshot=NULL WHERE id=?").run(id);
  assert.equal(data.memberProposal('42', id).state.key, 'updating');
  assert.ok(data.listMemberSubmissions().some((q) => q.id === id));
  confirm(id);
  assert.equal(data.memberProposal('42', id).state.key, 'ready');
  data.unpublishFromMember(id, getQuote(id).revision, 'Kryz');
  assert.equal(data.memberProposal('42', id).document, null);
  const staffOnly = Number(db().prepare("INSERT INTO quotes (status,summary_snapshot) VALUES ('done','{}')").run().lastInsertRowid);
  assert.throws(() => data.publishToMember(staffOnly, 0, 'Kryz'), /not submitted by a member/);
});

test('expired proposals stay viewable but cannot be ordered', () => {
  const id = memberQuote(); confirm(id);
  const snap = JSON.parse(getQuote(id).summary_snapshot); snap.quote.valid_until = '2020-01-01';
  db().prepare("UPDATE quotes SET summary_snapshot=?, valid_until='2020-01-01' WHERE id=?").run(JSON.stringify(snap), id);
  data.publishToMember(id, getQuote(id).revision, 'Kryz');
  assert.equal(data.memberProposal('42', id).state.key, 'expired');
});

test('a revision of a member quote stays linked to the member as in review', () => {
  const id = memberQuote(); confirm(id);
  const file = path.join(folder, 'uploads', `${id}-src.pdf`); fs.writeFileSync(file, 'x');
  db().prepare('UPDATE quotes SET file_path=? WHERE id=?').run(file, id);
  const copy = getQuote(duplicateQuote(id, getQuote(id).revision));
  assert.equal(copy.shopify_customer_id, '42'); assert.equal(copy.portal_status, 'submitted'); assert.equal(copy.portal_customer_name, 'Dana');
});

test('member uploads are attributed, rate limited and keep extracted customers', async () => {
  const pdf = fs.readFileSync(new URL('./fixtures/stress-basic-elemental.pdf', import.meta.url));
  const before = data.memberSubmissionsToday('900');
  const [id] = await data.createMemberQuotes({ id: '900', name: 'Sam', email: 'sam@example.com', company: 'Sam Lighting' }, [{ name: 'rival.pdf', buffer: pdf }], { project: 'Lobby {{ shop.name }}', note: 'Dimmable please' });
  const q = getQuote(id);
  assert.equal(q.shopify_customer_id, '900'); assert.equal(q.portal_status, 'submitted'); assert.equal(q.portal_project, 'Lobby {{ shop.name }}');
  assert.equal(q.job_name, 'Lobby {{ shop.name }}'); assert.ok(q.customer);
  assert.equal(data.memberSubmissionsToday('900'), before + 1);
  assert.ok(db().prepare("SELECT 1 FROM quote_events WHERE quote_id=? AND event_type='member_submitted'").get(id));
});

test('rendered pages are Liquid-safe and escape customer text', () => {
  assert.equal(html.esc('{{ shop.secret }} {% if %}<script>'), '&#123;&#123; shop.secret &#125;&#125; &#123;% if %&#125;&lt;script&gt;');
  const quotes = data.listMemberQuotes('900');
  const dash = html.dashboardPage({ prefix: '/apps/quote', member: { name: '{{ customer.email }}' }, quotes, uploadUrl: 'https://app.example/portal-upload', token: 't', flash: 'submitted' });
  assert.ok(!/\{\{|\{%/.test(dash)); assert.match(dash, /received/); assert.match(dash, /enctype="multipart\/form-data"/);
  assert.ok(!html.dashboardPage({ prefix: '/apps/quote', member: {}, quotes: [], uploadUrl: 'u', token: 't', flash: '<b>arbitrary</b>' }).includes('arbitrary'), 'notices come from a fixed list');
  for (const s of ['guest', 'pending', 'unavailable']) assert.ok(!/\{\{|\{%/.test(html.gatePage(s, '/apps/quote')));
  assert.match(html.gatePage('guest', '/apps/quote'), /return_url=%2Fapps%2Fquote/);
  const id = memberQuote(); confirm(id); data.publishToMember(id, getQuote(id).revision, 'Kryz');
  const { document } = data.memberProposal('42', id);
  const ready = html.proposalPage({ prefix: '/apps/quote', id, document, specSheets: {}, purchase: { items: [{ variantId: 1, quantity: 1 }], total: 100 }, expired: false });
  assert.ok(!/\{\{|\{%/.test(ready)); assert.match(ready, /Add all to cart/); assert.match(ready, /Buy now/); assert.match(ready, /\/apps\/quote\/q\/\d+\/cart/);
  const blocked = html.proposalPage({ prefix: '/apps/quote', id, document, specSheets: {}, purchase: { items: [], message: 'D60 is not currently available to buy online.' }, expired: false });
  assert.ok(!blocked.includes('data-aq-cart="add"')); assert.match(blocked, /not currently available/);
  assert.ok(!html.proposalPage({ prefix: '/apps/quote', id, document, specSheets: {}, purchase: { items: [{ variantId: 1, quantity: 1 }] }, expired: true }).includes('data-aq-cart="buy"'));
});

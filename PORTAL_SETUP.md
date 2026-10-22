# Member portal — averyled.com/apps/quote

Approved Avery partners use the full Quote Tool with the same account they use on averyled.com. Each member's quotes, comparisons and proposals are tied to their Shopify customer profile, and only they can see them. Confirmed proposals are ordered with **Add all to cart** or **Buy now** on averyled.com.

## How access works

There is no separate member password. Members sign in on averyled.com with their normal Shopify customer account.

1. A member opens **averyled.com/apps/quote**, usually from a header link that only approved members see. Shopify forwards the request through the app proxy, signs it, and includes the signed-in customer's ID.
2. The tool checks the signature, then looks up the customer's tags with the Admin API. Only tags matching `approve` (case-insensitive, the same rule as the theme) get through:
   - Signed-out visitors see a sign-in prompt.
   - Signed-in customers without the tag see the theme's "pending partner approval" message.
   - If Shopify can't be reached, access is refused.
3. An approved member is handed straight into the full Quote Tool at **quote.averyled.com**:
   - The hand-off uses a five-minute link that works once and is tied to that customer.
   - It becomes a 12-hour member sign-in on quote.averyled.com, held in a signed, HttpOnly cookie.
   - The tool re-checks the `approve` tag with Shopify at least once a minute, so removing the tag ends access at once.
4. Members use the full tool: upload, draft summary, review and adjust, confirm. They can only see their own quotes.
   - Every quote is tied to the member's Shopify customer ID.
   - Every page, action, download and API route checks ownership. Another member's quote, or a team-only quote, returns "not found".
   - Admin pages (catalog, compatibility list, settings, team learning, the all-quotes list) are blocked for members.
5. A few things are hidden or blocked for members:
   - Internal notes, internal decision reasons, customer outcome and the review history are hidden.
   - "Remember" (writing to the shared compatibility list) is ignored for members.
6. **Admins** are Shopify customers that carry both `approve` and `quote-admin` (change the tag name with `PORTAL_ADMIN_TAG`). They sign in the same way and see every quote, the admin pages, and the internal notes, decision reasons and review history. Removing the tag in Shopify ends admin access within a minute. There is no separate team password.

## Ordering

On a confirmed, unexpired proposal, the member clicks one of two buttons:

- **Add all to cart:** opens `averyled.com/apps/quote/q/<id>/buy?mode=add`. It adds every recommended variant at full case, box or pack quantities, keeps what is already in the cart, then opens `/cart`.
- **Buy now:** opens `…/buy?mode=buy`. It replaces the cart with the proposal's items, then goes to `/checkout`.

These pages run on averyled.com, so the cart is the member's own and the wholesale apps (WSH Wholesale Pricing, BSS B2B) apply partner pricing. Before anything is added, the tool re-checks approval, ownership, confirmation, expiry and each variant's availability and pack size. If any check fails, nothing is added.

## Status (October 20, 2026)

- Shopify app **Avery Quote Tool** created in the Avery LED Dev Dashboard organization, with scope `read_customers` and the app proxy `apps/quote` → `https://quote.averyled.com/portal` (active version 3). It is installed on the Avery LED store (`irg1xr-px.myshopify.com`), which is in the same organization, so the client credentials grant applies.
- Still to do: set the Railway variables below, deploy this branch, add the theme link, and run the launch checklist. Until then `/apps/quote` returns an error page and nothing is exposed.

## One-time Shopify setup

1. In the **Shopify Dev Dashboard**, create an app for the Avery LED store. It must be in the same Shopify organization as averyled.com.
2. **Access scopes:** `read_customers`.
   - Optional: request **protected customer data** access for name and email. The team then sees who submitted each quote. Access does not depend on it; without it, the team sees the Shopify customer ID.
3. **App proxy:**
   - Subpath prefix: `apps`
   - Subpath: `quote`
   - Proxy URL: `https://quote.averyled.com/portal`
4. Release the version and **install the app** on the Avery store.
5. Copy the **Client ID** and **Client secret** into Railway (see the next section). The tool gets its Admin API token with Shopify's client credentials grant (24-hour tokens, refreshed automatically).
6. **Theme:** add a "Quote Tool" link for approved members. Example for `sections/header.liquid`, reusing the same check as the product page:

```liquid
{% assign aq_ok = false %}
{% if customer %}{% for tag in customer.tags %}{% assign t = tag | downcase %}{% if t == 'approve' %}{% assign aq_ok = true %}{% endif %}{% endfor %}{% endif %}
{% if aq_ok %}<a href="/apps/quote" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">Quote Tool</a>{% endif %}
```

   The link is navigation only. The portal enforces access itself. You can also add `/apps/quote` to your BSS lock rules for consistency.

## Railway variables

| Variable | Value |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `irg1xr-px.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | App Client ID |
| `SHOPIFY_API_SECRET` | App Client secret. Verifies Shopify's proxy signatures |
| `MEMBER_SESSION_SECRET` | Optional. A separate long random value for signing member sign-ins (defaults to the client secret) |
| `SHOPIFY_ADMIN_TOKEN` | Optional. A fixed Admin API token instead of the client credentials grant |
| `SHOPIFY_API_VERSION` | Optional. Default `2026-07` |
| `PORTAL_APPROVED_TAG` | Optional. Default `approve` |
| `PORTAL_STOREFRONT_URL` | Optional. Default `https://averyled.com` |
| `PORTAL_PROXY_PATH` | Optional. Default `/apps/quote` |
| `PORTAL_APP_ORIGIN` | Optional. Default `https://quote.averyled.com` |

Until `SHOPIFY_API_SECRET`, `SHOPIFY_STORE_DOMAIN` and a client ID or admin token are set, the portal routes return 404. Deploying this branch therefore exposes nothing until Shopify is configured.

## Launch checklist

- [ ] Signed out: `/apps/quote` shows sign-in, and no quote data appears.
- [ ] Signed in without `approve`: pending message. The cart button returns "approval required."
- [ ] Approved account: click Quote Tool on averyled.com. You land in the tool signed in as yourself. Upload a sample quote, see the draft, Review & adjust, then Confirm.
- [ ] Add all to cart, then check that partner pricing is applied. Buy now reaches checkout. Do not place an order unless intended.
- [ ] Remove `approve` from the test account. Ordering is refused immediately; pages stop within a minute.
- [ ] A second approved account cannot open the first account's quote URLs, and sees none of its quotes.
- [ ] Sign out on quote.averyled.com, then open a quote URL directly. You are sent back to averyled.com sign-in.

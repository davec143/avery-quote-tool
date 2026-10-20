# Member portal — averyled.com/apps/quote

Approved Avery partners submit competitor quotes on averyled.com. The team reviews them in this tool as usual, then publishes the confirmed proposal back to the member. The member sees Avery pricing, savings, spec sheets, and **Add all to cart** / **Buy now**.

## How access works

- The portal is served through a **Shopify App Proxy**. Shopify signs every request and adds the signed-in customer's ID. Cookies are not forwarded.
- The tool checks the signature, then reads the customer's tags with the Admin API. Only tags matching `approve` (case-insensitive, the same rule as the theme's product page and order form) get access.
- **Signed-out visitors** see a sign-in prompt. **Signed-in customers without the tag** see the theme's "pending partner approval" message. **If Shopify can't be reached**, access is refused.
- Page views can use a one-minute cache of the approval check. Uploads and the cart button always re-check approval with Shopify, so removing the tag takes effect at once for ordering.
- **Isolation:** each quote is stored with the member's Shopify customer ID. Members see only their own quotes, and only proposals the team has published. Unpublished drafts, internal notes, source files, and other customers' quotes are never sent.
- **Uploads go straight to the app**, not through the proxy. They use a two-hour signed token that is tied to the customer and issued by a verified portal page.
- The team password still protects every staff page. The portal routes `/portal/*` and `/portal-upload` accept only Shopify-signed requests or upload tokens.

## Team workflow (team-managed mode)

1. A member uploads a quote. It appears on the tool's home page under **Member submissions to review**, and in the quote list with a **Member** label. The member sees **In review**.
2. Review and **Confirm & make summary** exactly as today.
3. On the summary page, use the **Member portal** panel: enter your name, then click **Publish to member**. The member now sees **Proposal ready**.
4. **If you edit a published quote**, the member sees **Being updated** until you confirm it again. Confirming again republishes it automatically.
5. **Unpublish from member** hides the proposal again.
6. **New drafts made from a member's quote** stay linked to that member as **In review**.

Self-serve publishing, where the member sees results without team review, is not enabled. It would need an explicit rule for which matches skip review.

## Buying

The proposal page runs on averyled.com, so the buttons use Shopify's own cart:

- **Add all to cart** adds every recommended variant at full case, box or pack quantities, then opens `/cart`. Items already in the cart stay.
- **Buy now** clears the cart, adds the proposal's items, then goes to `/checkout`.

Before either action, the page asks the portal to re-check approval, ownership, publication, expiry, and each variant's availability and pack size. If anything is wrong, the button shows the reason, and nothing is added partially.

The cart then applies the store's wholesale apps (WSH Wholesale Pricing, BSS B2B) exactly as for any partner order. Confirm with one test order that the partner prices in the cart match what Avery expects to charge.

## Status (October 20, 2026)

- Shopify app **Avery Quote Tool** created in the Avery LED Dev Dashboard organization, with scope `read_customers` and the app proxy `apps/quote` → `https://quote.averyled.com/portal` (active version 3). It is installed on the Avery LED store (`avery-led.myshopify.com`), which is in the same organization, so the client credentials grant applies.
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
| `SHOPIFY_STORE_DOMAIN` | `avery-led.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | App Client ID |
| `SHOPIFY_API_SECRET` | App Client secret. Signs the proxy requests and upload tokens |
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
- [ ] Approved account: upload a sample quote, review it, confirm and publish it, then open it as the member.
- [ ] Add all to cart, then check that partner pricing is applied. Buy now reaches checkout. Do not place an order unless intended.
- [ ] Remove `approve` from the test account. Ordering is refused immediately; pages stop within a minute.
- [ ] A second approved account cannot open the first account's proposal URL.

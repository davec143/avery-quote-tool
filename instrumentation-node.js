// Confirms the Shopify credentials work and the app can read customer tags. Logs counts and flags only,
// never customer details. Visible in Railway deploy logs as [portal-check].
import { portalCheck } from './lib/shopify-portal.js';

setTimeout(() => portalCheck()
  .then((r) => console.log(`[portal-check] ${r}`))
  .catch((e) => console.log(`[portal-check] failed: ${e.message}`)), 3000);

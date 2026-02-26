// api/checkout.js
import { cors, requireEnv, squareFetch } from "./_square.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = requireEnv(res);
  if (!env) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { lineItems } = req.body || {};
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: "Missing lineItems" });
    }

    // Square wants quantities as strings
    const squareLineItems = lineItems.map(li => ({
      quantity: String(li.quantity || 1),
      ...(li.variationId ? { catalog_object_id: li.variationId } : {}),
      ...(li.name && !li.variationId ? { name: li.name } : {}),
      ...(li.base_price_money && !li.variationId ? { base_price_money: li.base_price_money } : {}),
    }));

    const body = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.locationId,
        line_items: squareLineItems,
      },
      checkout_options: {
        // change to true if you want shipping in Square checkout
        ask_for_shipping_address: false,
        // optional: redirect back to your site after payment
        // redirect_url: "https://friendsandfam.net/shop.html?paid=1"
      },
    };

    // Create a Payment Link (hosted checkout)
    const out = await squareFetch("/v2/online-checkout/payment-links", {
      token: env.token,
      method: "POST",
      body,
    });

    const url = out?.payment_link?.url;
    if (!url) throw new Error("No checkout url returned.");

    res.status(200).json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
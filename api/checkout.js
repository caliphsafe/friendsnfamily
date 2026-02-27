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

    // -----------------------------
    // ✅ INVENTORY GUARD (ALL LOCATIONS)
    // Blocks checkout when requested qty > total IN_STOCK across all locations.
    // -----------------------------
    const requestedByVar = new Map(); // variationId -> requestedQty (number)

    for (const li of lineItems) {
      const vid = li?.variationId;
      if (!vid) continue;
      const qty = Number(li?.quantity || 1);
      const safeQty = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
      requestedByVar.set(vid, (requestedByVar.get(vid) || 0) + safeQty);
    }

    if (requestedByVar.size > 0) {
      const variationIds = Array.from(requestedByVar.keys());

      // Batch retrieve inventory counts across ALL locations (no location_ids filter)
      const invOut = await squareFetch("/v2/inventory/batch-retrieve-counts", {
        token: env.token,
        method: "POST",
        body: {
          catalog_object_ids: variationIds,
          states: ["IN_STOCK"],
        },
      });

      const counts = invOut?.counts || [];

      // Sum IN_STOCK across all locations for each variation
      const availableByVar = new Map(); // variationId -> availableQty
      for (const c of counts) {
        const vid = c?.catalog_object_id;
        if (!vid) continue;
        const q = Number(c?.quantity || 0);
        const safeQ = Number.isFinite(q) ? q : 0;
        availableByVar.set(vid, (availableByVar.get(vid) || 0) + safeQ);
      }

      // Any missing variation gets treated as 0 available (sold out / not tracked / not stocked)
      const unavailable = [];
      for (const [vid, requestedQty] of requestedByVar.entries()) {
        const availableQty = availableByVar.get(vid) || 0;
        if (availableQty < requestedQty) {
          unavailable.push({
            variationId: vid,
            requested: requestedQty,
            available: availableQty,
          });
        }
      }

      if (unavailable.length) {
        return res.status(409).json({
          error: "Some items are sold out or don’t have enough stock.",
          unavailable,
        });
      }
    }

    // Square wants quantities as strings
    const squareLineItems = lineItems.map((li) => ({
      quantity: String(li.quantity || 1),
      ...(li.variationId ? { catalog_object_id: li.variationId } : {}),
      ...(li.name && !li.variationId ? { name: li.name } : {}),
      ...(li.base_price_money && !li.variationId ? { base_price_money: li.base_price_money } : {}),
    }));

    const body = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.locationId, // checkout must still be created at a location
        line_items: squareLineItems,
      },
      checkout_options: {
        ask_for_shipping_address: true,
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

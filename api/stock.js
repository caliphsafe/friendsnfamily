// api/stock.js
import { cors, requireEnv, squareFetch } from "./_square.js";

function parseQty(qtyStr) {
  const n = Number(qtyStr);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = requireEnv(res);
  if (!env) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  // Accept either ?ids=a,b,c or ?variationIds=a,b,c
  const raw = (req.query.ids || req.query.variationIds || "").toString().trim();
  const ids = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    return res.status(400).json({ error: "Missing ids (variationIds)" });
  }

  try {
    const invOut = await squareFetch("/v2/inventory/batch-retrieve-counts", {
      token: env.token,
      method: "POST",
      body: {
        catalog_object_ids: ids,
        // ✅ NO location_ids => we sum across ALL locations below (your request)
      },
    });

    const stock = {};
    (invOut.counts || []).forEach(c => {
      const id = c.catalog_object_id;
      if (!id) return;
      stock[id] = (stock[id] || 0) + parseQty(c.quantity);
    });

    // Ensure every requested id has a value
    ids.forEach(id => {
      if (typeof stock[id] !== "number") stock[id] = 0;
    });

    res.status(200).json({ stock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

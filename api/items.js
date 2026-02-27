// api/items.js
import { cors, requireEnv, squareFetch } from "./_square.js";

function moneyToText(m) {
  if (!m || typeof m.amount !== "number") return "";
  const dollars = (m.amount / 100).toFixed(2);
  return `$${dollars}`;
}

function parseQty(qtyStr) {
  const n = Number(qtyStr);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = requireEnv(res);
  if (!env) return;

  const categoryId = req.query.categoryId || null;

  try {
    // 1) Search items (optionally filter by category)
    const body = {
      limit: 60,
      include_related_objects: false,
      ...(categoryId ? { category_ids: [categoryId] } : {}),
    };

    const out = await squareFetch("/v2/catalog/search-catalog-items", {
      token: env.token,
      method: "POST",
      body,
    });

    const items = out.items || [];

    // Collect image ids + variation ids (for inventory)
    const imageIds = new Set();
    const variationIds = new Set();

    const mapped = items.map(it => {
      const item = it.item_data;

      const variations = (item.variations || []).map(v => {
        const vd = v.item_variation_data;

        // collect variation ids for inventory lookup
        if (v.id) variationIds.add(v.id);

        return {
          variationId: v.id,
          name: vd?.name || "Default",
          priceMoney: vd?.price_money || null,
          priceText: moneyToText(vd?.price_money),
          // NOTE: sellable=false definitely not for sale, but sellable=true can still be sold out.
          sellable: vd?.sellable !== false,
          // we’ll fill inventoryQty after we call Inventory API
          inventoryQty: null,
        };
      });

      (item.image_ids || []).forEach(id => imageIds.add(id));

      return {
        itemId: it.id,
        name: item.name,
        description: item.description || "",
        imageIds: item.image_ids || [],
        variations,
      };
    });

    // 2) Resolve images → URLs
    let imagesById = {};
    const imgIds = Array.from(imageIds);
    if (imgIds.length) {
      const imgOut = await squareFetch("/v2/catalog/batch-retrieve", {
        token: env.token,
        method: "POST",
        body: { object_ids: imgIds, include_related_objects: false },
      });

      (imgOut.objects || []).forEach(o => {
        if (o.type === "IMAGE") {
          imagesById[o.id] = o.image_data?.url || "";
        }
      });
    }

    // 3) Inventory counts for variations (this is the key “sold out” filter)
    let invByVarId = {};
    const varIds = Array.from(variationIds);

    if (varIds.length) {
      // Inventory endpoint: /v2/inventory/batch-retrieve-counts
      // We request counts for each variation (catalog_object_id)
      const invOut = await squareFetch("/v2/inventory/batch-retrieve-counts", {
        token: env.token,
        method: "POST",
        body: {
          catalog_object_ids: varIds,
          // If you want to restrict to a specific location, you can add:
          // location_ids: [process.env.SQUARE_LOCATION_ID]
        },
      });

      // invOut.counts: [{ catalog_object_id, quantity, ... }]
      (invOut.counts || []).forEach(c => {
        const id = c.catalog_object_id;
        if (!id) return;
        // quantity can be a string number
        invByVarId[id] = (invByVarId[id] || 0) + parseQty(c.quantity);
      });
    }

    // 4) Attach image + compute “available” based on inventory
    const finalItems = mapped
      .map(p => {
        const variationsWithQty = (p.variations || []).map(v => {
          const qty = invByVarId[v.variationId] ?? 0;
          return {
            ...v,
            inventoryQty: qty,
            // ✅ available only if sellable and has inventory
            available: !!v.sellable && qty > 0,
          };
        });

        // Keep only available variations
        const availableVars = variationsWithQty.filter(v => v.available);

        // Choose default variation as first available with a price (fallback first available)
        const defaultVar =
          availableVars.find(v => v.priceMoney) ||
          availableVars[0] ||
          null;

        return {
          itemId: p.itemId,
          name: p.name,
          description: p.description,
          imageIds: p.imageIds,
          imageUrl: p.imageIds[0] ? (imagesById[p.imageIds[0]] || "") : "",
          variations: availableVars,
          defaultVariationId: defaultVar?.variationId || null,
          priceText: defaultVar?.priceText || "",
          priceMoney: defaultVar?.priceMoney || null,
        };
      })
      // ✅ FINAL RULE: hide items that have no available variations
      .filter(p => (p.variations || []).length > 0);

    res.status(200).json({ items: finalItems });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
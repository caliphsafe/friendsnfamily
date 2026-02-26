// api/item.js
import { cors, requireEnv, squareFetch } from "./_square.js";

function moneyToText(m) {
  if (!m || typeof m.amount !== "number") return "";
  const dollars = (m.amount / 100).toFixed(2);
  return `$${dollars}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = requireEnv(res);
  if (!env) return;

  const itemId = req.query.itemId;
  if (!itemId) return res.status(400).json({ error: "Missing itemId" });

  try {
    // Get the item object
    const out = await squareFetch(`/v2/catalog/object/${encodeURIComponent(itemId)}`, {
      token: env.token,
      method: "GET",
    });

    const obj = out.object;
    if (!obj || obj.type !== "ITEM") {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = obj.item_data || {};
    const variations = (item.variations || []).map(v => {
      const vd = v.item_variation_data || {};
      return {
        variationId: v.id,
        name: vd.name || "Default",
        priceMoney: vd.price_money || null,
        priceText: moneyToText(vd.price_money),
        available: vd.sellable !== false,
      };
    });

    const defaultVar = variations.find(v => v.priceMoney) || variations[0] || null;

    // Resolve images (same approach you used)
    const imageIds = item.image_ids || [];
    let imageUrl = "";

    if (imageIds.length) {
      const imgOut = await squareFetch("/v2/catalog/batch-retrieve", {
        token: env.token,
        method: "POST",
        body: { object_ids: imageIds, include_related_objects: false },
      });

      const imagesById = {};
      (imgOut.objects || []).forEach(o => {
        if (o.type === "IMAGE") imagesById[o.id] = o.image_data?.url || "";
      });

      imageUrl = imagesById[imageIds[0]] || "";
    }

    return res.status(200).json({
      item: {
        itemId: obj.id,
        name: item.name || "Item",
        description: item.description || "",
        imageUrl,
        defaultVariationId: defaultVar?.variationId || null,
        priceText: defaultVar?.priceText || "",
        variations,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// api/items.js
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

  const categoryId = req.query.categoryId || null;

  try {
    // Search items (optionally filter by category)
    const body = {
      limit: 60,
      // return_related_objects helps sometimes, but we still batch-retrieve images below
      include_related_objects: false,
      ...(categoryId ? { category_ids: [categoryId] } : {}),
    };

    const out = await squareFetch("/v2/catalog/search-catalog-items", {
      token: env.token,
      method: "POST",
      body,
    });

    const items = out.items || [];

    // Collect image ids and variation ids
    const imageIds = new Set();
    const mapped = items.map(it => {
      const item = it.item_data;
      const variations = (item.variations || []).map(v => {
        const vd = v.item_variation_data;
        return {
          variationId: v.id,
          name: vd?.name || "Default",
          priceMoney: vd?.price_money || null,
          priceText: moneyToText(vd?.price_money),
          available: vd?.sellable !== false,
        };
      });

      const defaultVar = variations.find(v => v.priceMoney) || variations[0] || null;

      (item.image_ids || []).forEach(id => imageIds.add(id));

      return {
        itemId: it.id,
        name: item.name,
        description: item.description || "",
        imageIds: item.image_ids || [],
        defaultVariationId: defaultVar?.variationId || null,
        priceText: defaultVar?.priceText || "",
        priceMoney: defaultVar?.priceMoney || null,
        variations,
      };
    });

    // Resolve images → URLs via batch-retrieve
    let imagesById = {};
    const ids = Array.from(imageIds);
    if (ids.length) {
      const imgOut = await squareFetch("/v2/catalog/batch-retrieve", {
        token: env.token,
        method: "POST",
        body: { object_ids: ids, include_related_objects: false },
      });

      (imgOut.objects || []).forEach(o => {
        if (o.type === "IMAGE") {
          imagesById[o.id] = o.image_data?.url || "";
        }
      });
    }

    // Attach primary image
    const finalItems = mapped.map(p => ({
      ...p,
      imageUrl: p.imageIds[0] ? (imagesById[p.imageIds[0]] || "") : "",
    }));

    res.status(200).json({ items: finalItems });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
import { cors, requireEnv, squareFetch } from "./_square.js";

function moneyToText(m) {
  if (!m || typeof m.amount !== "number") return "";
  return `$${(m.amount / 100).toFixed(2)}`;
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

  const itemId = req.query.itemId;
  if (!itemId) return res.status(400).json({ error: "Missing itemId" });

  try {
    // 1) Get item + related image IDs
    const out = await squareFetch("/v2/catalog/batch-retrieve", {
      token: env.token,
      method: "POST",
      body: { object_ids: [itemId], include_related_objects: true },
    });

    const objects = out.objects || [];
    const related = out.related_objects || [];

    const itemObj = objects.find(o => o.type === "ITEM");
    if (!itemObj) return res.status(404).json({ error: "Item not found" });

    const item = itemObj.item_data;
    const imageIds = item.image_ids || [];

    // 2) Map variations + collect variation IDs
    const variationIds = (item.variations || []).map(v => v.id).filter(Boolean);

    // 3) Inventory counts
    let invByVarId = {};
    if (variationIds.length) {
      const invOut = await squareFetch("/v2/inventory/batch-retrieve-counts", {
        token: env.token,
        method: "POST",
        body: { catalog_object_ids: variationIds },
        // Optional strict location:
        // body: { catalog_object_ids: variationIds, location_ids: [process.env.SQUARE_LOCATION_ID] }
      });

      (invOut.counts || []).forEach(c => {
        const id = c.catalog_object_id;
        if (!id) return;
        invByVarId[id] = (invByVarId[id] || 0) + parseQty(c.quantity);
      });
    }

    const variations = (item.variations || []).map(v => {
      const vd = v.item_variation_data || {};
      const qty = invByVarId[v.id] ?? 0;
      const sellable = vd.sellable !== false;

      return {
        variationId: v.id,
        name: vd.name || "Default",
        priceMoney: vd.price_money || null,
        priceText: moneyToText(vd.price_money),
        inventoryQty: qty,
        available: !!sellable && qty > 0,
      };
    }).filter(v => v.available);

    // If nothing available, treat as sold out
    if (!variations.length) {
      return res.status(404).json({ error: "Item is sold out" });
    }

    const defaultVar = variations.find(v => v.priceMoney) || variations[0];

    // 4) Resolve first image URL (from related objects if present)
    let imageUrl = "";
    const relImages = related.filter(o => o.type === "IMAGE");
    const imageById = {};
    relImages.forEach(img => { imageById[img.id] = img.image_data?.url || ""; });
    if (imageIds[0]) imageUrl = imageById[imageIds[0]] || "";

    return res.status(200).json({
      item: {
        itemId,
        name: item.name,
        description: item.description || "",
        imageUrl,
        variations,
        defaultVariationId: defaultVar.variationId,
        priceText: defaultVar.priceText,
        priceMoney: defaultVar.priceMoney,
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
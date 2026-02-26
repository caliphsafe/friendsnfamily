// api/vendors.js
import { cors, requireEnv, squareFetch } from "./_square.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = requireEnv(res);
  if (!env) return;

  try {
    // Pull categories (vendors)
    const out = await squareFetch("/v2/catalog/list?types=CATEGORY", {
      token: env.token,
    });

    const vendors = (out.objects || [])
      .map(o => ({
        id: o.id,
        name: o.category_data?.name || "Unnamed",
      }))
      // optional: sort
      .sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ vendors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
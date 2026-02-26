// /api/vendors.js
export default async function handler(req, res) {
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const env = (process.env.SQUARE_ENV || "production").toLowerCase();

    if (!accessToken) {
      return res.status(500).json({ error: "Missing SQUARE_ACCESS_TOKEN" });
    }

    const base =
      env === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

    // Optional filters (use ONE or combine):
    // 1) Parent category id approach (recommended)
    const vendorParentId = (process.env.VENDOR_PARENT_CATEGORY_ID || "").trim();

    // 2) Name prefixes approach (comma-separated), e.g. "01,02,03,Vendor -"
    const prefixes = (process.env.VENDOR_CATEGORY_PREFIXES || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // 3) Allowlist approach (comma-separated exact category names)
    const allowlist = (process.env.VENDOR_CATEGORY_ALLOWLIST || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    // Common non-vendor categories to exclude by name (adjust if needed)
    const EXCLUDE = new Set(
      (process.env.VENDOR_CATEGORY_EXCLUDE || "all,featured,sale,new,clearance,gift card,gift cards")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    );

    // Fetch ALL CATEGORY objects (handle pagination)
    let cursor = undefined;
    const categories = [];

    while (true) {
      const url = new URL(`${base}/v2/catalog/list`);
      url.searchParams.set("types", "CATEGORY");
      if (cursor) url.searchParams.set("cursor", cursor);

      const r = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2025-02-20",
        },
      });

      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: data?.errors || data });
      }

      const objs = Array.isArray(data.objects) ? data.objects : [];
      for (const o of objs) {
        const name = o?.category_data?.name?.trim();
        if (!name) continue;

        categories.push({
          id: o.id,
          name,
          parentId: o?.category_data?.parent_category?.id || null,
        });
      }

      cursor = data.cursor;
      if (!cursor) break;
    }

    // Apply "vendor only" filter
    const vendorCategories = categories.filter(c => {
      const n = c.name.toLowerCase();

      // Always exclude known non-vendor names
      if (EXCLUDE.has(n)) return false;

      // If parent id is configured: ONLY those under that parent
      if (vendorParentId) {
        return c.parentId === vendorParentId;
      }

      // If allowlist configured: ONLY exact matches
      if (allowlist.length) {
        return allowlist.includes(n);
      }

      // If prefixes configured: match any prefix
      if (prefixes.length) {
        return prefixes.some(p => n.startsWith(p.toLowerCase()));
      }

      // Fallback (if you set none): return everything except excluded names
      return true;
    });

    vendorCategories.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      count: vendorCategories.length,
      vendors: vendorCategories,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
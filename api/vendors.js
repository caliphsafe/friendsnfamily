// /api/vendors.js
module.exports = async (req, res) => {
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const squareEnv = (process.env.SQUARE_ENV || "production").toLowerCase(); // "sandbox" or "production"

    if (!accessToken) {
      return res.status(500).json({ error: "Missing env var: SQUARE_ACCESS_TOKEN" });
    }

    const base =
      squareEnv === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";

    // Pull all CATEGORY objects (handles pagination cursor)
    let cursor = null;
    const categories = [];

    do {
      const url = new URL(base + "/v2/catalog/list");
      url.searchParams.set("types", "CATEGORY");
      if (cursor) url.searchParams.set("cursor", cursor);

      const r = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-12-18", // safe recent version string
        },
      });

      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }

      if (!r.ok) {
        return res.status(r.status).json({
          error: "Square API error (list categories)",
          status: r.status,
          details: data || text?.slice(0, 300),
        });
      }

      const objs = data?.objects || [];
      for (const obj of objs) {
        const name = obj?.category_data?.name || "";
        categories.push({ id: obj.id, name });
      }

      cursor = data?.cursor || null;
    } while (cursor);

    // ✅ If you only want "vendor categories", filter here.
    // Option A (recommended): only categories with a prefix like "VENDOR: "
    // const vendors = categories.filter(c => c.name.toUpperCase().startsWith("VENDOR: "))
    //   .map(c => ({ id: c.id, name: c.name.replace(/^VENDOR:\s*/i, "") }));

    // Option B: return all categories for now (no accidental exclusions)
    const vendors = categories
      .filter(c => c.name) // remove blanks
      .sort((a,b) => a.name.localeCompare(b.name));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ vendors });

  } catch (err) {
    // This is what prevents FUNCTION_INVOCATION_FAILED from being “mysterious”
    return res.status(500).json({
      error: "Server function crashed",
      message: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
};
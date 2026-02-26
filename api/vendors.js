// /api/vendors.js
import fetch from "node-fetch";

function norm(s = "") {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " "); // collapse multiple spaces
}

function parseAllowlist(raw = "") {
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const env = process.env.SQUARE_ENV || "production";
    const allowlistRaw = process.env.VENDOR_CATEGORY_ALLOWLIST || "";

    if (!accessToken) {
      return res.status(500).json({ error: "Missing SQUARE_ACCESS_TOKEN" });
    }

    const allowlist = parseAllowlist(allowlistRaw);
    const allowset = new Set(allowlist.map(norm));

    // ✅ IMPORTANT: Square Catalog API endpoint is the same; env is tied to token (sandbox vs prod)
    const url = "https://connect.squareup.com/v2/catalog/list?types=CATEGORY";

    const r = await fetch(url, {
      headers: {
        "Square-Version": "2025-01-23",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: "Square error", details: data });
    }

    const categories = (data.objects || [])
      .map((o) => ({
        id: o.id,
        name: o.category_data?.name || "",
        _n: norm(o.category_data?.name || ""),
      }))
      .filter((c) => c.name);

    // ✅ Only those that match allowlist
    const vendors = categories
      .filter((c) => allowset.has(c._n))
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // ✅ Debug: which allowlist entries didn’t match any category
    const categoryNameSet = new Set(categories.map((c) => c._n));
    const missingFromSquare = allowlist
      .filter((name) => !categoryNameSet.has(norm(name)))
      .sort((a, b) => a.localeCompare(b));

    // ✅ Debug: which categories exist but are not in allowlist (helps confirm you’re filtering correctly)
    const notInAllowlist = categories
      .filter((c) => !allowset.has(c._n))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      env,
      allowlistCount: allowlist.length,
      categoryCount: categories.length,
      vendorCount: vendors.length,
      vendors,
      debug: {
        missingFromSquare, // <-- this will show the 2 names that don't match
        sampleNotInAllowlist: notInAllowlist.slice(0, 25),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
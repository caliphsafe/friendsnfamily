// api/_square.js
export function squareBaseUrl() {
  // SQUARE_ENV can be 'production' or 'sandbox'
  // Both use the same connect endpoint; environment is controlled by token.
  return "https://connect.squareup.com";
}

export function cors(res) {
  // If your site and Vercel are different domains, this keeps calls working.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function requireEnv(res) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    res.status(500).json({ error: "Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in Vercel env." });
    return null;
  }
  return { token, locationId };
}

export async function squareFetch(path, { token, method = "GET", body } = {}) {
  const url = `${squareBaseUrl()}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2025-08-20" // safe recent-ish version; you can bump later
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!r.ok) {
    const msg = json?.errors?.[0]?.detail || json?.errors?.[0]?.category || r.statusText;
    throw new Error(`Square API error: ${msg}`);
  }
  return json;
}
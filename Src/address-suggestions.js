const photonUrl = process.env.INVOICE_PHOTON_URL || "https://photon.komoot.io/api";
const cache = new Map();
let lastRequest = 0;

function formatAddress(feature) {
  const { street, housenumber, name, type, city, locality, district, state, postcode, country } =
    feature.properties || {};
  const streetName = street || (type === "street" ? name : "");
  if (!streetName) return "";

  const parts = [
    [housenumber, streetName].filter(Boolean).join(" "),
    city || locality || district,
    [state, postcode].filter(Boolean).join(" "),
    country,
  ];
  return [...new Set(parts.filter(Boolean))].join(", ");
}

module.exports = async function suggestAddresses(req, res) {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 5 || query.length > 160) return res.json([]);
  const language = req.query.lang === "es" ? "es" : "en";
  const key = language + ":" + query.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return res.json(cached.addresses);
  if (now - lastRequest < 500) return res.sendStatus(429);
  lastRequest = now;

  const url = new URL(photonUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", language);
  url.searchParams.set("limit", "8");
  url.searchParams.append("layer", "house");
  const number = /^(\d+[a-z]?)\s/i.exec(query)?.[1].toLowerCase();
  if (!number) url.searchParams.append("layer", "street");

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return res.sendStatus(502);
    const { features } = await response.json();
    const candidates = features.filter((feature) => !number ||
      String(feature.properties?.housenumber || "").toLowerCase().startsWith(number));
    const addresses = [...new Set(candidates.map(formatAddress).filter(Boolean))].slice(0, 6);
    cache.delete(key);
    if (cache.size >= 80) cache.delete(cache.keys().next().value);
    cache.set(key, { addresses, expires: now + 300000 });
    res.json(addresses);
  } catch {
    res.sendStatus(502);
  }
};

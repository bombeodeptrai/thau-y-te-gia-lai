function compactSlug(value) {
  return String(value ?? "").trim();
}

export function tenderRegionSlugs(item = {}) {
  const values = [
    ...(Array.isArray(item.regionSlugs) ? item.regionSlugs : []),
    item.regionSlug,
  ];
  return [...new Set(values.map(compactSlug).filter(Boolean))];
}

export function mergeTenderRegionSlugs(...items) {
  return [...new Set(items.flatMap((item) => tenderRegionSlugs(item)))];
}

export function tenderBelongsToRegion(item, regionSlug) {
  const slug = compactSlug(regionSlug);
  return Boolean(slug) && tenderRegionSlugs(item).includes(slug);
}

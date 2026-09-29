function compactSlug(value) {
  return String(value ?? "").trim();
}

function normalizeLocationText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// Nguồn công khai có thể trả một TBMT đa tỉnh trong lượt quét của chỉ một
// vùng. Khi đó chưa có bản sao từ các vùng còn lại để merge theo regionSlug,
// nhưng trường location vẫn chứa tên tỉnh chính thức ("Tỉnh ..."). Suy ra
// membership từ tên tỉnh có tiền tố để tránh khớp nhầm địa danh cấp huyện.
export function inferTenderRegionSlugs(item = {}, regions = []) {
  const slugs = tenderRegionSlugs(item);
  const location = ` ${normalizeLocationText(item.location)} `;
  const locationProvinceCodes = new Set(
    (item.locationProvinceCodes || []).map((value) => String(value ?? "").trim()).filter(Boolean),
  );

  for (const region of regions || []) {
    const slug = compactSlug(region?.slug);
    if (!slug) continue;
    const matchesCode = (region.provinceCodes || [])
      .some((code) => locationProvinceCodes.has(String(code ?? "").trim()));
    const matchesProvinceName = [region.name, ...(region.locationTerms || [])]
      .map(normalizeLocationText)
      .map((term) => term.replace(/^(tinh|thanh pho)\s+/, ""))
      .filter(Boolean)
      .some((term) => location.includes(` tinh ${term} `)
        || location.includes(` thanh pho ${term} `));
    if (matchesCode || matchesProvinceName) slugs.push(slug);
  }

  return [...new Set(slugs)];
}

export function tenderBelongsToRegion(item, regionSlug) {
  const slug = compactSlug(regionSlug);
  return Boolean(slug) && tenderRegionSlugs(item).includes(slug);
}

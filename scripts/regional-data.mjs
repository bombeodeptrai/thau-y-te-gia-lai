import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function newestIso(values) {
  const newest = values
    .map((value) => new Date(value || 0))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right - left)[0];
  return newest?.toISOString() || "";
}

export async function loadRegionalCollection(dataDir, fileName, key, options = {}) {
  const config = await readJson(resolve(dataDir, "regions.json"));
  const regions = Array.isArray(config?.regions) ? config.regions : [];
  const rows = [];
  const fetchedTimes = [];
  let loadedRegionCount = 0;

  for (const region of regions) {
    const payload = await readJson(resolve(dataDir, "regions", region.slug, fileName));
    if (!payload || !Array.isArray(payload[key])) continue;
    loadedRegionCount += 1;
    if (payload.fetchedAt) fetchedTimes.push(payload.fetchedAt);
    rows.push(...payload[key].map((item) => ({
      ...item,
      regionSlug: item.regionSlug || region.slug,
      region: item.region || region.name,
    })));
  }

  if (loadedRegionCount > 0 || options.globalFallback === false) {
    return {
      [key]: rows,
      fetchedAt: newestIso(fetchedTimes),
      loadedRegionCount,
      source: "regional-files",
    };
  }

  // Chỉ dùng trong lúc chuyển đổi bản cũ. Các workflow mới không còn tạo lại
  // những tệp tổng hợp rất lớn này.
  const legacy = await readJson(resolve(dataDir, fileName));
  return legacy && Array.isArray(legacy[key])
    ? { ...legacy, loadedRegionCount: 0, source: "legacy-global-fallback" }
    : { [key]: [], fetchedAt: "", loadedRegionCount: 0, source: "missing" };
}

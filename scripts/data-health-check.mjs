import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dataDir = resolve(root, "data");

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(resolve(dataDir, name), "utf8"));
  } catch {
    return fallback;
  }
}

const tenders = await readJson("tenders.json", { tenders: [] });
const bidders = await readJson("bidders.json", { bidders: [] });
const equipment = await readJson("equipment.json", { equipment: [] });
const coverage = await readJson("region-coverage.json", { regions: [] });
const regionConfig = await readJson("regions.json", { regions: [] });
const giaLai = (regionConfig.regions || []).find((item) => item.slug === "gia-lai");

const requiredGiaLaiTerms = [
  "Gia Lai", "Bình Định", "Pleiku", "An Khê", "Ayun Pa", "Chư Păh", "Chư Prông",
  "Chư Sê", "Chư Pưh", "Đak Đoa", "Đak Pơ", "Đức Cơ", "Ia Grai", "Ia Pa",
  "Kbang", "Kông Chro", "Krông Pa", "Mang Yang", "Phú Thiện", "Quy Nhơn",
  "An Nhơn", "Hoài Nhơn", "Tuy Phước", "Phù Cát", "Phù Mỹ", "Tây Sơn",
  "Vân Canh", "Vĩnh Thạnh", "An Lão", "Hoài Ân",
];
const configuredTerms = new Set(giaLai?.locationTerms || []);
const missingGiaLaiTerms = requiredGiaLaiTerms.filter((term) => !configuredTerms.has(term));

const summary = {
  checkedAt: new Date().toISOString(),
  tenderCount: tenders.tenders?.length || 0,
  bidderCount: bidders.bidders?.length || 0,
  equipmentCount: equipment.equipment?.length || 0,
  initializedRegionCount: coverage.initializedRegionCount || 0,
  configuredRegionCount: coverage.configuredRegionCount || 0,
  coverageDays: coverage.completeCoverageDays || 0,
  giaLaiProvinceCodes: giaLai?.provinceCodes || [],
  giaLaiLocationTermCount: giaLai?.locationTerms?.length || 0,
  missingGiaLaiTerms,
};

console.log(JSON.stringify(summary));
if (!summary.tenderCount) throw new Error("Cơ sở dữ liệu không có gói thầu");
if (!giaLai?.provinceCodes?.includes("52") || !giaLai?.provinceCodes?.includes("64")) {
  throw new Error("Cấu hình Gia Lai thiếu mã tỉnh cũ Gia Lai 52 hoặc Bình Định 64");
}
if (missingGiaLaiTerms.length) {
  throw new Error(`Cấu hình Gia Lai thiếu địa danh: ${missingGiaLaiTerms.join(", ")}`);
}

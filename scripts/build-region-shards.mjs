import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const outputDataDir = resolve(root, "dist-pages/data");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Không đọc được ${path}: ${error.message}`);
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function regionSlugOf(item) {
  const direct = compact(item?.regionSlug);
  if (direct) return direct;

  const region = compact(item?.region).toLocaleLowerCase("vi-VN");
  if (region === "gia lai") return "gia-lai";
  return "";
}

function groupByRegion(items) {
  const grouped = new Map();
  for (const item of items || []) {
    const slug = regionSlugOf(item);
    if (!slug) continue;
    if (!grouped.has(slug)) grouped.set(slug, []);
    grouped.get(slug).push(item);
  }
  return grouped;
}

async function writePayload(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  // Ghi JSON nén để Apps Script tải nhanh hơn và tránh phản hồi quá lớn.
  await writeFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

const regionConfig = await readJson(resolve(dataDir, "regions.json"));
const coverage = await readJson(resolve(dataDir, "region-coverage.json"), { regions: [] });
const tenderPayload = await readJson(resolve(dataDir, "tenders.json"));
const bidderPayload = await readJson(resolve(dataDir, "bidders.json"), { bidders: [] });
const equipmentPayload = await readJson(resolve(dataDir, "equipment.json"), { equipment: [] });

const tendersByRegion = groupByRegion(tenderPayload.tenders || []);
const biddersByRegion = groupByRegion(bidderPayload.bidders || []);
const equipmentByRegion = groupByRegion(equipmentPayload.equipment || []);
const coverageBySlug = new Map((coverage.regions || []).map((item) => [item.slug, item]));

const manifest = [];
for (const region of regionConfig.regions || []) {
  const slug = region.slug;
  const tenders = tendersByRegion.get(slug) || [];
  const bidders = biddersByRegion.get(slug) || [];
  const equipment = equipmentByRegion.get(slug) || [];
  const expected = coverageBySlug.get(slug) || {};

  // Nếu báo cáo tổng hợp nói tỉnh đã có dữ liệu mà shard lại rỗng thì dừng triển khai,
  // không đưa các tệp rỗng lên GitHub Pages.
  if (Number(expected.tenderCount) > 0 && tenders.length === 0) {
    throw new Error(`Không tạo được shard ${region.name}: báo cáo có ${expected.tenderCount} gói nhưng kết quả lọc bằng 0`);
  }

  const outputDir = resolve(outputDataDir, "regions", slug);
  const fetchedAt = tenderPayload.fetchedAt || bidderPayload.fetchedAt || equipmentPayload.fetchedAt || "";

  await writePayload(resolve(outputDir, "tenders.json"), {
    schemaVersion: 1,
    regionSlug: slug,
    region: region.name,
    fetchedAt,
    tenders,
    count: tenders.length,
  });
  await writePayload(resolve(outputDir, "bidders.json"), {
    schemaVersion: 1,
    regionSlug: slug,
    region: region.name,
    fetchedAt,
    bidders,
    count: bidders.length,
  });
  await writePayload(resolve(outputDir, "equipment.json"), {
    schemaVersion: 1,
    regionSlug: slug,
    region: region.name,
    fetchedAt,
    equipment,
    count: equipment.length,
  });

  manifest.push({
    slug,
    name: region.name,
    tenderCount: tenders.length,
    bidderCount: bidders.length,
    equipmentCount: equipment.length,
  });
}

await writePayload(resolve(outputDataDir, "region-shards.json"), {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  regions: manifest,
});

process.stdout.write(
  `Đã tạo JSON riêng cho ${manifest.length} tỉnh: ${manifest.reduce((sum, item) => sum + item.tenderCount, 0)} gói, `
  + `${manifest.reduce((sum, item) => sum + item.bidderCount, 0)} nhà thầu, `
  + `${manifest.reduce((sum, item) => sum + item.equipmentCount, 0)} thiết bị/model.\n`,
);

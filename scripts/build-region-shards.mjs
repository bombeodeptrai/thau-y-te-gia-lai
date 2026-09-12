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

async function writePayload(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  // Ghi JSON nén để Apps Script tải nhanh hơn và tránh phản hồi quá lớn.
  await writeFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

const regionConfig = await readJson(resolve(dataDir, "regions.json"));
const coverage = await readJson(resolve(dataDir, "region-coverage.json"), { regions: [] });
const coverageBySlug = new Map((coverage.regions || []).map((item) => [item.slug, item]));

const manifest = [];
for (const region of regionConfig.regions || []) {
  const slug = region.slug;
  const sourceDir = resolve(dataDir, "regions", slug);
  const tenderPayload = await readJson(resolve(sourceDir, "tenders.json"), { tenders: [] });
  const bidderPayload = await readJson(resolve(sourceDir, "bidders.json"), { bidders: [] });
  const equipmentPayload = await readJson(resolve(sourceDir, "equipment.json"), { equipment: [] });
  const tenders = tenderPayload.tenders || [];
  const bidders = bidderPayload.bidders || [];
  const equipment = equipmentPayload.equipment || [];
  const expected = coverageBySlug.get(slug) || {};

  // Nếu báo cáo tổng hợp nói tỉnh đã có dữ liệu mà shard lại rỗng thì dừng triển khai,
  // không đưa các tệp rỗng lên GitHub Pages.
  if (Number(expected.tenderCount) > 0 && tenders.length === 0) {
    throw new Error(`Không tạo được shard ${region.name}: báo cáo có ${expected.tenderCount} gói nhưng kết quả lọc bằng 0`);
  }
  if (Number(expected.bidderCount) > 0 && bidders.length === 0) {
    throw new Error(`Không tạo được shard nhà thầu ${region.name}: dữ liệu nguồn bị rỗng`);
  }
  if (Number(expected.equipmentCount) > 0 && equipment.length === 0) {
    throw new Error(`Không tạo được shard thiết bị ${region.name}: dữ liệu nguồn bị rỗng`);
  }

  const outputDir = resolve(outputDataDir, "regions", slug);
  const fetchedAt = [tenderPayload.fetchedAt, bidderPayload.fetchedAt, equipmentPayload.fetchedAt]
    .filter(Boolean)
    .sort((left, right) => new Date(right) - new Date(left))[0] || "";

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

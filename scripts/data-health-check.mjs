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

const summary = {
  checkedAt: new Date().toISOString(),
  tenderCount: tenders.tenders?.length || 0,
  bidderCount: bidders.bidders?.length || 0,
  equipmentCount: equipment.equipment?.length || 0,
  initializedRegionCount: coverage.initializedRegionCount || 0,
  configuredRegionCount: coverage.configuredRegionCount || 0,
  coverageDays: coverage.completeCoverageDays || 0,
};

console.log(JSON.stringify(summary));
if (!summary.tenderCount) throw new Error("Cơ sở dữ liệu không có gói thầu");

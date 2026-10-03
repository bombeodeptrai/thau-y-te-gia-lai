import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferTenderRegionSlugs,
  mergeTenderRegionSlugs,
  tenderBelongsToRegion,
} from "./region-membership.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function compact(value) {
  return String(value ?? "").trim();
}

function tenderKey(tender = {}) {
  return compact(tender.notifyNo || tender.id);
}

function mergeTender(scanned, current) {
  if (!scanned) return current;
  const regionSlugs = mergeTenderRegionSlugs(scanned, current);
  return {
    ...scanned,
    ...current,
    regionSlug: current.regionSlug || scanned.regionSlug,
    regionSlugs: regionSlugs.length > 1 ? regionSlugs : undefined,
    provinceCodes: [...new Set([
      ...(scanned.provinceCodes || []),
      ...(current.provinceCodes || []),
    ])],
    winnerNames: [...new Set([...(scanned.winnerNames || []), ...(current.winnerNames || [])].filter(Boolean))],
    participantNames: [...new Set([...(scanned.participantNames || []), ...(current.participantNames || [])].filter(Boolean))],
    loserNames: [...new Set([...(scanned.loserNames || []), ...(current.loserNames || [])].filter(Boolean))],
    winningModels: [...new Set([...(scanned.winningModels || []), ...(current.winningModels || [])].filter(Boolean))],
    losingModels: [...new Set([...(scanned.losingModels || []), ...(current.losingModels || [])].filter(Boolean))],
    winningPrice: Number(current.winningPrice) || Number(scanned.winningPrice) || 0,
    price: Number(current.price) || Number(scanned.price) || 0,
  };
}

export function buildConcurrentTenderDelta(baseTenders = [], currentTenders = []) {
  const base = new Map(baseTenders.map((item) => [tenderKey(item), item]).filter(([key]) => key));
  const current = new Map(currentTenders.map((item) => [tenderKey(item), item]).filter(([key]) => key));
  const removed = new Set([...base.keys()].filter((key) => !current.has(key)));
  const upserts = [...current.entries()]
    .filter(([key, item]) => !base.has(key) || JSON.stringify(base.get(key)) !== JSON.stringify(item))
    .map(([, item]) => item);
  return { removed, upserts };
}

export function applyConcurrentTenderDelta(payload, region, regions, delta) {
  const tenderMap = new Map(
    (payload.tenders || []).map((item) => [tenderKey(item), item]).filter(([key]) => key),
  );
  let changed = 0;

  for (const key of delta.removed) {
    if (tenderMap.delete(key)) changed += 1;
  }

  for (const current of delta.upserts) {
    const key = tenderKey(current);
    const inferredRegionSlugs = inferTenderRegionSlugs(current, regions);
    const tagged = {
      ...current,
      regionSlugs: inferredRegionSlugs.length > 1 ? inferredRegionSlugs : current.regionSlugs,
    };
    if (!tenderBelongsToRegion(tagged, region.slug)) {
      if (tenderMap.delete(key)) changed += 1;
      continue;
    }
    const previous = tenderMap.get(key);
    const merged = mergeTender(previous, tagged);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) changed += 1;
    tenderMap.set(key, merged);
  }

  const tenders = [...tenderMap.values()].sort(
    (left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0),
  );
  return {
    payload: {
      ...payload,
      tenders,
    },
    changed,
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const [basePath, currentPath] = process.argv.slice(2);
  if (!basePath || !currentPath) {
    throw new Error("Cần truyền tệp tenders nền lúc bắt đầu quét và tenders hiện tại trên main");
  }

  const [base, current, config] = await Promise.all([
    readJson(resolve(root, basePath), { tenders: [] }),
    readJson(resolve(root, currentPath), { tenders: [] }),
    readJson(resolve(root, "data", "regions.json"), { regions: [] }),
  ]);
  const delta = buildConcurrentTenderDelta(base.tenders, current.tenders);
  let changedRegionCount = 0;
  let changedRecordCount = 0;

  for (const region of config.regions || []) {
    const path = resolve(root, "data", "regions", region.slug, "tenders.json");
    const payload = await readJson(path, null);
    if (!payload) continue;
    const applied = applyConcurrentTenderDelta(payload, region, config.regions || [], delta);
    if (!applied.changed) continue;
    await writeFile(path, `${JSON.stringify(applied.payload, null, 2)}\n`);
    changedRegionCount += 1;
    changedRecordCount += applied.changed;
  }

  process.stdout.write(
    `Đã bảo toàn ${delta.upserts.length} bản ghi thêm/sửa và ${delta.removed.size} bản ghi xóa `
    + `phát sinh trong lúc quét; cập nhật ${changedRecordCount} membership tại ${changedRegionCount} vùng.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

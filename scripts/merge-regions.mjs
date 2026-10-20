import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferTenderRegionSlugs,
  mergeTenderRegionSlugs,
  tenderBelongsToRegion,
} from "./region-membership.mjs";
import { detailFilesForManifest, isOfficialDetailFileName, normalizeTenderDisclosedNames, uniqueDisclosedNames } from "./official-detail-preservation.mjs";
import { medicalCategory } from "./medical-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const regionsDir = resolve(dataDir, "regions");
const config = JSON.parse(await readFile(resolve(dataDir, "regions.json"), "utf8"));

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function newestIso(values) {
  const dates = values
    .map((value) => new Date(value || 0))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right - left);
  return dates[0]?.toISOString() || new Date().toISOString();
}

function richness(value) {
  if (!value) return 0;
  return [
    value.inputResultId,
    value.bidOpenId,
    value.bidId,
    value.hasResult,
    value.winnerNames?.length,
    value.participantNames?.length,
    value.winningModels?.length,
    value.losingModels?.length,
    value.winningPrice,
    value.bidderCount,
  ].reduce((sum, item) => sum + (Array.isArray(item) ? item.length : item ? 1 : 0), 0);
}

function mergeTender(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  const preferred = richness(current) >= richness(previous) ? current : previous;
  const other = preferred === current ? previous : current;
  const regionSlugs = mergeTenderRegionSlugs(other, preferred);
  return {
    ...other,
    ...preferred,
    regionSlug: preferred.regionSlug || other.regionSlug,
    // Một TBMT có thể thực hiện tại nhiều tỉnh. Vẫn giữ regionSlug để tương
    // thích dữ liệu cũ, nhưng không được làm mất các vùng còn lại khi khử trùng.
    regionSlugs: regionSlugs.length > 1 ? regionSlugs : undefined,
    region: preferred.region || other.region,
    provinceCodes: [...new Set([...(other.provinceCodes || []), ...(preferred.provinceCodes || [])])],
    winnerNames: uniqueDisclosedNames([...(other.winnerNames || []), ...(preferred.winnerNames || [])]),
    participantNames: uniqueDisclosedNames([...(other.participantNames || []), ...(preferred.participantNames || [])]),
    loserNames: uniqueDisclosedNames([...(other.loserNames || []), ...(preferred.loserNames || [])]),
    winningModels: [...new Set([...(other.winningModels || []), ...(preferred.winningModels || [])].filter(Boolean))],
    losingModels: [...new Set([...(other.losingModels || []), ...(preferred.losingModels || [])].filter(Boolean))],
    winningPrice: Number(preferred.winningPrice) || Number(other.winningPrice) || 0,
    price: Number(preferred.price) || Number(other.price) || 0,
  };
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const legacyTenders = await readJson(resolve(dataDir, "tenders.json"), { tenders: [] });
const legacyHasData = Array.isArray(legacyTenders.tenders) && legacyTenders.tenders.length > 0;
const tenderMap = new Map();
const regionCoverage = [];
const fetchedTimes = [];
const detailSources = [];

for (const region of config.regions || []) {
  const regionDir = resolve(regionsDir, region.slug);
  const hasRegionDirectory = await directoryExists(regionDir);
  const regionalTenderPayload = hasRegionDirectory
    ? await readJson(resolve(regionDir, "tenders.json"), { tenders: [] })
    : { tenders: [] };
  const regionalHasData = Array.isArray(regionalTenderPayload.tenders)
    && regionalTenderPayload.tenders.length > 0;
  const useLegacy = region.slug === "gia-lai" && !regionalHasData && legacyHasData;
  const useRegional = regionalHasData;

  const tenderPayload = useRegional ? regionalTenderPayload : (useLegacy ? legacyTenders : { tenders: [] });
  const bidderPayload = useRegional
    ? await readJson(resolve(regionDir, "bidders.json"), { bidders: [] })
    : (useLegacy ? await readJson(resolve(dataDir, "bidders.json"), { bidders: [] }) : { bidders: [] });
  const equipmentPayload = useRegional
    ? await readJson(resolve(regionDir, "equipment.json"), { equipment: [] })
    : (useLegacy ? await readJson(resolve(dataDir, "equipment.json"), { equipment: [] }) : { equipment: [] });

  const biddersByNotice = new Map();
  for (const bidder of bidderPayload.bidders || []) {
    const rows = biddersByNotice.get(bidder.notifyNo) || [];
    rows.push(bidder);
    biddersByNotice.set(bidder.notifyNo, rows);
  }
  const normalizedTenders = (tenderPayload.tenders || []).map(tender => {
    const normalized = normalizeTenderDisclosedNames(tender, region.slug === "gia-lai" ? biddersByNotice.get(tender.notifyNo) || [] : []);
    // Sửa các gói thuốc đã lưu từ trước; không đổi membership, định danh,
    // thời điểm quét hay xóa dòng khi chuẩn hóa lại nhóm trên giao diện/Sheet.
    return medicalCategory(normalized.name) === "Dược phẩm"
      ? { ...normalized, category: "Dược phẩm" } : normalized;
  });
  if (JSON.stringify(normalizedTenders) !== JSON.stringify(tenderPayload.tenders || [])) {
    tenderPayload.tenders = normalizedTenders;
    if (useRegional) await writeFile(resolve(regionDir, "tenders.json"), `${JSON.stringify(tenderPayload, null, 2)}\n`);
  }

  const fetchedAt = tenderPayload.fetchedAt || equipmentPayload.fetchedAt || "";
  if (fetchedAt) fetchedTimes.push(fetchedAt);
  const coverageDays = Number(tenderPayload.collection?.days) || 0;
  const sourceDetailsDir = useRegional
    ? resolve(regionDir, "details")
    : (useLegacy ? resolve(dataDir, "details") : "");
  // Audit chỉ sở hữu danh sách gói, không sở hữu hồ sơ chi tiết. Bộ đếm
  // trong artifact có thể cũ hơn các tệp vừa được luồng khác bổ sung.
  if (sourceDetailsDir && await directoryExists(sourceDetailsDir)) {
    const detailCount = detailFilesForManifest(
      await readdir(sourceDetailsDir), tenderPayload.tenders || [],
    ).length;
    if (tenderPayload.detailTenderCount !== detailCount) {
      tenderPayload.detailTenderCount = detailCount;
      if (useRegional) {
        await writeFile(resolve(regionDir, "tenders.json"), `${JSON.stringify(tenderPayload, null, 2)}\n`);
      }
    }
  }

  regionCoverage.push({
    slug: region.slug,
    name: region.name,
    provinceCodes: region.provinceCodes,
    tenderCount: tenderPayload.tenders?.length || 0,
    bidderCount: bidderPayload.bidders?.length || 0,
    equipmentCount: equipmentPayload.equipment?.length || 0,
    detailTenderCount: Number(tenderPayload.detailTenderCount) || 0,
    coverageDays,
    fetchedAt,
    initialized: Boolean(tenderPayload.tenders?.length),
    source: useLegacy
      ? "legacy-gia-lai-fallback"
      : (useRegional ? "regional-scan" : (hasRegionDirectory ? "regional-scan-empty" : "not-started")),
  });

  for (const tender of tenderPayload.tenders || []) {
    const notifyNo = compact(tender.notifyNo || tender.id);
    if (!notifyNo) continue;
    const tagged = {
      ...tender,
      regionSlug: tender.regionSlug || region.slug,
      region: tender.region || region.name,
      provinceCodes: tender.provinceCodes || region.provinceCodes,
    };
    const inferredRegionSlugs = inferTenderRegionSlugs(tagged, config.regions || []);
    if (inferredRegionSlugs.length > 1) tagged.regionSlugs = inferredRegionSlugs;
    tenderMap.set(notifyNo, mergeTender(tenderMap.get(notifyNo), tagged));
  }

  if (sourceDetailsDir && await directoryExists(sourceDetailsDir)) {
    detailSources.push({ region, detailDir: sourceDetailsDir });
  }
}

const tenders = [...tenderMap.values()].sort((left, right) =>
  new Date(right.publicDate || 0) - new Date(left.publicDate || 0));
// tenderCount phục vụ giao diện phải phản ánh membership sau khử trùng, kể cả
// gói đa tỉnh chỉ được một workflow vùng phát hiện ở lượt hiện tại.
for (const coverage of regionCoverage) {
  coverage.tenderCount = tenders.filter((tender) =>
    tenderBelongsToRegion(tender, coverage.slug)).length;
}
const fetchedAt = newestIso(fetchedTimes);
const initializedRegions = regionCoverage.filter((item) => item.initialized);
const totalBidderCount = regionCoverage.reduce((sum, item) => sum + item.bidderCount, 0);
const totalEquipmentCount = regionCoverage.reduce((sum, item) => sum + item.equipmentCount, 0);
const completeCoverageDays = initializedRegions.length
  ? Math.min(...initializedRegions.map((item) => item.coverageDays || 0))
  : 0;

const detailsDir = resolve(dataDir, "details");
const stagingDir = resolve(dataDir, ".details-merge-staging");
await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

const stagedSources = [];
for (const source of detailSources) {
  const staged = resolve(stagingDir, source.region.slug);
  await cp(source.detailDir, staged, { recursive: true });
  stagedSources.push({ ...source, detailDir: staged });
}

await rm(detailsDir, { recursive: true, force: true });
await mkdir(detailsDir, { recursive: true });
const copiedDetails = new Map();
for (const { region, detailDir } of stagedSources) {
  const files = (await readdir(detailDir).catch(() => []))
    .filter(isOfficialDetailFileName)
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const fileName of files) {
    const sourcePath = resolve(detailDir, fileName);
    const current = copiedDetails.get(fileName);
    const sourceMtime = (await stat(sourcePath)).mtimeMs;
    if (current && current.mtime >= sourceMtime) continue;
    await cp(sourcePath, resolve(detailsDir, fileName));
    copiedDetails.set(fileName, { mtime: sourceMtime, regionSlug: region.slug });
  }
}
await rm(stagingDir, { recursive: true, force: true });

await mkdir(regionsDir, { recursive: true });
await writeFile(resolve(dataDir, "tenders.json"), `${JSON.stringify({
  tenders,
  fetchedAt,
  source: "muasamcong-public-api-central-region",
  detailTenderCount: copiedDetails.size,
  regions: regionCoverage,
  collection: {
    days: completeCoverageDays,
    strategy: "merged-current-central-region-provinces",
    configuredRegionCount: regionCoverage.length,
    initializedRegionCount: initializedRegions.length,
    scannedTenderCount: regionCoverage.reduce((sum, item) => sum + item.tenderCount, 0),
  },
}, null, 2)}\n`);
// Tệp theo vùng là nguồn chuẩn cho Pages và Google Sheets. Xóa bốn bản tổng hợp
// trùng lặp để tránh commit 60-100 MB và giảm bộ nhớ cho các lượt quét nền.
for (const fileName of [
  "bidders.json",
  "equipment.json",
  "requirements.json",
  "technical-requirements.json",
]) {
  await rm(resolve(dataDir, fileName), { force: true });
}
await writeFile(resolve(dataDir, "region-coverage.json"), `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  configuredRegionCount: regionCoverage.length,
  initializedRegionCount: initializedRegions.length,
  completeCoverageDays,
  totalTenderCount: tenders.length,
  totalBidderCount,
  totalEquipmentCount,
  fallbackActive: regionCoverage.some((item) => item.source === "legacy-gia-lai-fallback"),
  regions: regionCoverage,
}, null, 2)}\n`);

if (!tenders.length && legacyHasData) {
  throw new Error("Hợp nhất trả về 0 gói dù dữ liệu Gia Lai dự phòng đang có");
}

process.stdout.write(
  `Đã hợp nhất ${initializedRegions.length}/${regionCoverage.length} tỉnh thành: `
  + `${tenders.length} gói, ${totalBidderCount} nhà thầu, ${totalEquipmentCount} mặt hàng/model, ${copiedDetails.size} hồ sơ chi tiết.`
  + `${regionCoverage.some((item) => item.source === "legacy-gia-lai-fallback") ? " Đang dùng dữ liệu Gia Lai dự phòng." : ""}\n`,
);

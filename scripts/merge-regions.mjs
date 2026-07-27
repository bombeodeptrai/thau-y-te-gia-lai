import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  return {
    ...other,
    ...preferred,
    regionSlug: preferred.regionSlug || other.regionSlug,
    region: preferred.region || other.region,
    provinceCodes: [...new Set([...(other.provinceCodes || []), ...(preferred.provinceCodes || [])])],
    winnerNames: [...new Set([...(other.winnerNames || []), ...(preferred.winnerNames || [])].filter(Boolean))],
    participantNames: [...new Set([...(other.participantNames || []), ...(preferred.participantNames || [])].filter(Boolean))],
    loserNames: [...new Set([...(other.loserNames || []), ...(preferred.loserNames || [])].filter(Boolean))],
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

const legacy = {
  tenders: await readJson(resolve(dataDir, "tenders.json"), { tenders: [] }),
  bidders: await readJson(resolve(dataDir, "bidders.json"), { bidders: [] }),
  equipment: await readJson(resolve(dataDir, "equipment.json"), { equipment: [] }),
  requirements: await readJson(resolve(dataDir, "requirements.json"), { requirements: [] }),
  technicalRequirements: await readJson(resolve(dataDir, "technical-requirements.json"), { technicalRequirements: [] }),
};

const legacyHasData = Array.isArray(legacy.tenders.tenders) && legacy.tenders.tenders.length > 0;
const tenderMap = new Map();
const bidderMap = new Map();
const equipmentMap = new Map();
const requirementMap = new Map();
const technicalMap = new Map();
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

  const tenderPayload = useRegional ? regionalTenderPayload : (useLegacy ? legacy.tenders : { tenders: [] });
  const bidderPayload = useRegional
    ? await readJson(resolve(regionDir, "bidders.json"), { bidders: [] })
    : (useLegacy ? legacy.bidders : { bidders: [] });
  const equipmentPayload = useRegional
    ? await readJson(resolve(regionDir, "equipment.json"), { equipment: [] })
    : (useLegacy ? legacy.equipment : { equipment: [] });
  const requirementsPayload = useRegional
    ? await readJson(resolve(regionDir, "requirements.json"), { requirements: [] })
    : (useLegacy ? legacy.requirements : { requirements: [] });
  const technicalPayload = useRegional
    ? await readJson(resolve(regionDir, "technical-requirements.json"), { technicalRequirements: [] })
    : (useLegacy ? legacy.technicalRequirements : { technicalRequirements: [] });

  const fetchedAt = tenderPayload.fetchedAt || equipmentPayload.fetchedAt || "";
  if (fetchedAt) fetchedTimes.push(fetchedAt);
  const coverageDays = Number(tenderPayload.collection?.days) || 0;

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
    tenderMap.set(notifyNo, mergeTender(tenderMap.get(notifyNo), tagged));
  }

  for (const bidder of bidderPayload.bidders || []) {
    const key = compact(bidder.id || `${bidder.notifyNo}|${bidder.contractorCode || bidder.contractorName}|${bidder.lotNo || bidder.lotName}`);
    if (!key) continue;
    bidderMap.set(key, { ...bidder, regionSlug: region.slug, region: region.name });
  }

  for (const item of equipmentPayload.equipment || []) {
    const key = compact(item.id || `${item.notifyNo}|${item.name}|${item.model}|${item.unitPrice}|${item.lotNo || ""}`);
    if (!key) continue;
    equipmentMap.set(key, { ...item, regionSlug: region.slug, region: region.name });
  }

  for (const item of requirementsPayload.requirements || []) {
    const key = compact(item.id || `${item.notifyNo}|${item.lotNo}|${item.name}`);
    if (!key) continue;
    requirementMap.set(key, { ...item, regionSlug: region.slug, region: region.name });
  }

  for (const item of technicalPayload.technicalRequirements || []) {
    const key = compact(item.id || `${item.notifyNo}|${item.lotNo}|${item.name}|${item.code || ""}`);
    if (!key) continue;
    technicalMap.set(key, { ...item, regionSlug: region.slug, region: region.name });
  }

  const sourceDetailsDir = useRegional
    ? resolve(regionDir, "details")
    : (useLegacy ? resolve(dataDir, "details") : "");
  if (sourceDetailsDir && await directoryExists(sourceDetailsDir)) {
    detailSources.push({ region, detailDir: sourceDetailsDir });
  }
}

const tenders = [...tenderMap.values()].sort((left, right) =>
  new Date(right.publicDate || 0) - new Date(left.publicDate || 0));
const bidders = [...bidderMap.values()];
const equipment = [...equipmentMap.values()];
const requirements = [...requirementMap.values()];
const technicalRequirements = [...technicalMap.values()];
const fetchedAt = newestIso(fetchedTimes);
const initializedRegions = regionCoverage.filter((item) => item.initialized);
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
  const files = (await readdir(detailDir).catch(() => [])).filter((name) => /^IB\d{10}\.json$/.test(name));
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
await writeFile(resolve(dataDir, "bidders.json"), `${JSON.stringify({ bidders, fetchedAt }, null, 2)}\n`);
await writeFile(resolve(dataDir, "equipment.json"), `${JSON.stringify({ equipment, fetchedAt }, null, 2)}\n`);
await writeFile(resolve(dataDir, "requirements.json"), `${JSON.stringify({ requirements, fetchedAt }, null, 2)}\n`);
await writeFile(resolve(dataDir, "technical-requirements.json"), `${JSON.stringify({ technicalRequirements, fetchedAt }, null, 2)}\n`);
await writeFile(resolve(dataDir, "region-coverage.json"), `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  configuredRegionCount: regionCoverage.length,
  initializedRegionCount: initializedRegions.length,
  completeCoverageDays,
  totalTenderCount: tenders.length,
  totalBidderCount: bidders.length,
  totalEquipmentCount: equipment.length,
  fallbackActive: regionCoverage.some((item) => item.source === "legacy-gia-lai-fallback"),
  regions: regionCoverage,
}, null, 2)}\n`);

if (!tenders.length && legacyHasData) {
  throw new Error("Hợp nhất trả về 0 gói dù dữ liệu Gia Lai dự phòng đang có");
}

process.stdout.write(
  `Đã hợp nhất ${initializedRegions.length}/${regionCoverage.length} tỉnh thành: `
  + `${tenders.length} gói, ${bidders.length} nhà thầu, ${equipment.length} mặt hàng/model, ${copiedDetails.size} hồ sơ chi tiết.`
  + `${regionCoverage.some((item) => item.source === "legacy-gia-lai-fallback") ? " Đang dùng dữ liệu Gia Lai dự phòng." : ""}\n`,
);

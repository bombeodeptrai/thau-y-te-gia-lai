import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-pages");
const dataDir = resolve(root, "data");
const detailDir = resolve(dataDir, "details");

const compact = (value, maxLength = 1200) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const uniqueText = (values) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => compact(value, 500))
    .filter(Boolean),
)];

const equipmentSummary = (item) => ({
  name: compact(item?.name || item?.lotName || "Mặt hàng y tế", 500),
  lotName: compact(item?.lotName, 400),
  model: compact(item?.model || item?.code, 220),
  brand: compact(item?.brand, 220),
  manufacturer: compact(item?.manufacturer, 280),
  origin: compact(item?.origin, 180),
  quantity: Number(item?.quantity) || 0,
  unit: compact(item?.unit, 80),
  unitPrice: Number(item?.unitPrice) || 0,
  plannedPrice: Number(item?.plannedPrice) || 0,
});

const participantSummary = (bidder) => ({
  name: compact(bidder?.contractorName || bidder?.name, 500),
  status: compact(bidder?.status, 80),
  lotName: compact(bidder?.lotName, 350),
  bidPrice: Number(bidder?.bidPrice) || 0,
  finalPrice: Number(bidder?.finalPrice) || 0,
  winningPrice: Number(bidder?.winningPrice) || 0,
  models: uniqueText(bidder?.models).slice(0, 12),
});

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of [
  "index.html",
  "styles.css",
  "app.js",
  "layout-fix.css",
  "layout-fix.js",
  "ai-config.js",
  "ai-analysis.js",
  "ai-analysis.css",
  "competitor-analysis.js",
  "competitor-analysis.css",
  "competitor-count-fix.js",
  "favicon.svg",
  "assets",
  "data",
]) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

const equipmentData = JSON.parse(await readFile(resolve(dataDir, "equipment.json"), "utf8"));
const tenderData = JSON.parse(await readFile(resolve(dataDir, "tenders.json"), "utf8"));
let requirementsData = { requirements: [], fetchedAt: "" };
let technicalRequirementsData = { technicalRequirements: [], fetchedAt: "" };
let competitorHistoryData = { coverageDays: 0, generatedAt: "", records: [] };
try {
  requirementsData = JSON.parse(await readFile(resolve(dataDir, "requirements.json"), "utf8"));
} catch {
  // Bản dữ liệu cũ chưa có danh mục phần/lô mời thầu.
}
try {
  technicalRequirementsData = JSON.parse(await readFile(resolve(dataDir, "technical-requirements.json"), "utf8"));
} catch {
  // Bản dữ liệu cũ chưa có biểu mẫu kỹ thuật e-HSMT đã trích xuất.
}
try {
  competitorHistoryData = JSON.parse(await readFile(resolve(dataDir, "competitor-history.json"), "utf8"));
} catch {
  // Chưa có lần quét lịch sử đối thủ 3 năm.
}

const awardedEquipmentSearch = (equipmentData.equipment || [])
  .filter((item) => item.notifyNo)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: compact(item.name, 500),
    model: compact(item.model, 220),
    brand: compact(item.brand, 220),
    manufacturer: compact(item.manufacturer, 280),
    origin: compact(item.origin, 180),
    winnerNames: uniqueText(item.winnerNames || item.contractorNames || []),
    stage: "award",
  }));
const invitedEquipmentSearch = (requirementsData.requirements || [])
  .filter((item) => item.notifyNo && item.name)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: compact(item.name, 500),
    model: "",
    brand: "",
    manufacturer: "",
    origin: "",
    lotNo: compact(item.lotNo, 120),
    stage: "invitation",
  }));
const technicalEquipmentSearch = (technicalRequirementsData.technicalRequirements || [])
  .filter((item) => item.notifyNo && item.name)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: compact(item.name, 500),
    model: compact(item.code, 220),
    brand: compact(item.brand, 220),
    manufacturer: compact(item.manufacturer, 280),
    origin: compact(item.origin, 180),
    lotNo: compact(item.lotNo, 120),
    lotName: compact(item.lotName, 400),
    stage: "invitation-technical",
  }));
const equipmentSearch = [
  ...awardedEquipmentSearch,
  ...invitedEquipmentSearch,
  ...technicalEquipmentSearch,
];
await writeFile(
  resolve(output, "data/equipment-search.json"),
  `${JSON.stringify({
    equipment: equipmentSearch,
    fetchedAt: equipmentData.fetchedAt || requirementsData.fetchedAt
      || technicalRequirementsData.fetchedAt || "",
  })}\n`,
);

const equipmentByNotifyNo = new Map();
for (const item of equipmentData.equipment || []) {
  const notifyNo = compact(item.notifyNo, 100);
  if (!notifyNo) continue;
  if (!equipmentByNotifyNo.has(notifyNo)) equipmentByNotifyNo.set(notifyNo, []);
  equipmentByNotifyNo.get(notifyNo).push(equipmentSummary(item));
}

const availableDetailFiles = new Set(
  (await readdir(detailDir).catch(() => []))
    .filter((name) => name.endsWith(".json")),
);

async function readTenderDetail(notifyNo) {
  const fileName = `${notifyNo}.json`;
  if (!availableDetailFiles.has(fileName)) return null;
  try {
    return JSON.parse(await readFile(resolve(detailDir, fileName), "utf8"));
  } catch {
    return null;
  }
}

const currentCompetitorRecords = [];
for (const tender of tenderData.tenders || []) {
  const notifyNo = compact(tender.notifyNo, 100);
  if (!notifyNo) continue;

  const detail = await readTenderDetail(notifyNo);
  const participants = (detail?.bidders || [])
    .map(participantSummary)
    .filter((item) => item.name)
    .slice(0, 40);
  const detailWinners = participants
    .filter((item) => item.status === "won")
    .map((item) => item.name);
  const winnerNames = uniqueText([
    ...(tender.winnerNames || []),
    ...detailWinners,
  ]);

  if (!winnerNames.length && !tender.hasResult) continue;

  const equipment = (equipmentByNotifyNo.get(notifyNo) || []).length
    ? equipmentByNotifyNo.get(notifyNo)
    : (detail?.items || []).map(equipmentSummary);

  currentCompetitorRecords.push({
    notifyNo,
    tenderId: compact(tender.id, 180),
    name: compact(tender.name, 1200),
    investor: compact(tender.investor, 600),
    sourceInvestor: compact(tender.investor, 600),
    location: compact(tender.location, 300),
    category: compact(tender.category, 180),
    publicDate: compact(tender.publicDate, 80),
    decisionDate: compact(tender.decisionDate || tender.resultPublishedDate, 80),
    winningPrice: Number(tender.winningPrice) || 0,
    estimatedPrice: Number(tender.price) || 0,
    winnerNames,
    participants,
    equipment: equipment
      .filter((item) => item.name || item.model || item.brand)
      .slice(0, 35),
    sourceUrl: compact(tender.sourceUrl, 1800),
  });
}

function mergeCompetitorRecords(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  return {
    ...previous,
    ...current,
    investor: current.investor || previous.investor,
    sourceInvestor: previous.sourceInvestor || current.sourceInvestor || current.investor,
    winnerNames: uniqueText([...(previous.winnerNames || []), ...(current.winnerNames || [])]),
    participants: current.participants?.length ? current.participants : (previous.participants || []),
    equipment: current.equipment?.length ? current.equipment : (previous.equipment || []),
    winningPrice: Number(current.winningPrice) || Number(previous.winningPrice) || 0,
    estimatedPrice: Number(current.estimatedPrice) || Number(previous.estimatedPrice) || 0,
    decisionDate: current.decisionDate || previous.decisionDate || "",
    publicDate: current.publicDate || previous.publicDate || "",
  };
}

const cutoff = Date.now() - 3 * 365 * 86_400_000;
const competitorRecordMap = new Map();
for (const record of competitorHistoryData.records || []) {
  const time = new Date(record.decisionDate || record.publicDate || 0).getTime();
  if (!record.notifyNo || !Number.isFinite(time) || time < cutoff) continue;
  competitorRecordMap.set(record.notifyNo, record);
}
for (const record of currentCompetitorRecords) {
  competitorRecordMap.set(
    record.notifyNo,
    mergeCompetitorRecords(competitorRecordMap.get(record.notifyNo), record),
  );
}

const competitorRecords = [...competitorRecordMap.values()];
competitorRecords.sort((left, right) => {
  const rightTime = new Date(right.decisionDate || right.publicDate || 0).getTime() || 0;
  const leftTime = new Date(left.decisionDate || left.publicDate || 0).getTime() || 0;
  return rightTime - leftTime;
});

const coverageDays = Math.max(
  Number(competitorHistoryData.coverageDays) || 0,
  Number(tenderData.collection?.days) || 0,
);

await writeFile(
  resolve(output, "data/competitor-intelligence.json"),
  `${JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    fetchedAt: tenderData.fetchedAt || equipmentData.fetchedAt || "",
    historyGeneratedAt: competitorHistoryData.generatedAt || "",
    coverageDays,
    recordCount: competitorRecords.length,
    records: competitorRecords,
  })}\n`,
);

await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write(
  `Đã tạo GitHub Pages với ${equipmentSearch.length} dòng thiết bị/model và ${competitorRecords.length} hồ sơ đối thủ/trúng thầu, phủ ${coverageDays} ngày\n`,
);

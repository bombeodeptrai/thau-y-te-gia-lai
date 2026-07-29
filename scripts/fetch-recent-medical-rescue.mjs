import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalNotifyNo, isMedicalTender, medicalCategory } from "./medical-scope.mjs";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const RESCUE_DAYS = Math.max(7, Number(process.env.RESCUE_DAYS) || 21);
const PAGE_SIZE = Math.max(20, Math.min(100, Number(process.env.PAGE_SIZE) || 100));
const MAX_ATTEMPTS = 6;
const PAGE_CONCURRENCY = 2;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionsPath = resolve(root, "data/regions.json");
const slug = String(process.argv[2] || process.env.REGION_SLUG || "").trim();
if (!slug) throw new Error("Thiếu REGION_SLUG hoặc đối số tên tỉnh/thành");

const FORCED_BY_REGION = {
  "gia-lai": [
    "IB2600349751",
    "IB2600348377",
    "IB2600347689",
    "IB2600346897",
    "IB2600378695",
  ],
};

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function compact(value, maxLength = 1500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function mapLimited(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function postJson(body, timeoutMs = 30_000) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "Content-Type": "application/json",
          Origin: "https://muasamcong.mpi.gov.vn",
          Referer: "https://muasamcong.mpi.gov.vn/",
          "User-Agent": `thau-y-te-medical-rescue-${slug}/1.0`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
        throw new Error("Nguồn không trả JSON");
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  throw lastError;
}

function provincePayload(pageNumber, from, to, provinceCodes) {
  return [{
    pageSize: PAGE_SIZE,
    pageNumber,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: "",
      matchType: "exact",
      matchFields: ["notifyNo", "bidName", "investorName"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
        { fieldName: "locations.provCode", searchType: "in", fieldValues: provinceCodes },
        { fieldName: "publicDate", searchType: "range", from, to },
      ],
    }],
  }];
}

function notifyPayload(value) {
  return [{
    pageSize: 20,
    pageNumber: 0,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: value,
      matchType: "exact",
      matchFields: ["notifyNo"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
      ],
    }],
  }];
}

async function fetchProvince(from, to, provinceCodes) {
  const first = await postJson(provincePayload(0, from, to, provinceCodes));
  const totalPages = Math.max(1, Number(first.page?.totalPages) || 1);
  const pages = Array.from({ length: totalPages - 1 }, (_, index) => index + 1);
  const remaining = await mapLimited(pages, PAGE_CONCURRENCY, (pageNumber) =>
    postJson(provincePayload(pageNumber, from, to, provinceCodes)));
  const items = [first, ...remaining].flatMap((payload) => payload.page?.content || []);
  process.stdout.write(`Cứu hộ ${slug}: ${items.length} bản ghi nguồn/${totalPages} trang/${RESCUE_DAYS} ngày\n`);
  return items;
}

async function fetchForced(notifyNo) {
  const base = canonicalNotifyNo(notifyNo);
  const variants = unique([base, `${base}-00`]);
  const groups = [];
  for (const variant of variants) {
    const payload = await postJson(notifyPayload(variant));
    groups.push(...(payload.page?.content || []));
  }
  const items = groups.filter((item) => canonicalNotifyNo(item.notifyNo) === base);
  process.stdout.write(`Tìm bắt buộc ${base}: ${items.length} bản ghi\n`);
  return items;
}

function statusOf(item) {
  const sourceStatus = String(item.statusForNotify || item.status || "").toUpperCase();
  if (sourceStatus.includes("HUY") || sourceStatus === "CANCELLED") return "cancelled";
  if (item.inputResultId || item.contractorName?.length || sourceStatus === "CNTTT") return "awarded";
  if (sourceStatus === "DXT" || String(item.status || "").toUpperCase() === "OPEN_BID") return "evaluating";
  const closeTime = new Date(item.bidCloseDate || item.closeDate || 0).getTime();
  const remaining = closeTime - Date.now();
  if (remaining > 0 && remaining <= 3 * 86_400_000) return "urgent";
  if (remaining > 0) return "open";
  if (closeTime) return item.bidOpenId ? "evaluating" : "closed";
  return "closed";
}

function sourceUrl(item) {
  const params = new URLSearchParams({
    p_p_id: "egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2",
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    _egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render: "detail-v2",
    type: item.type || "es-notify-contractor",
    stepCode: item.stepCode || "notify-contractor-step-1-tbmt",
    id: item.id || "",
    notifyId: item.notifyId || item.id || "",
    inputResultId: item.inputResultId || "",
    bidOpenId: item.bidOpenId || "",
    processApply: item.processApply || "LDT",
    bidMode: item.bidMode || "",
    notifyNo: item.notifyNo || "",
    planNo: item.planNo || "",
    step: "tbmt",
    isInternet: String(item.isInternet ?? ""),
    bidForm: item.bidForm || "",
  });
  return `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?${params}`;
}

function normalizeItem(item, region) {
  const notifyNo = canonicalNotifyNo(item.notifyNo || item.notifyId || item.id);
  const name = compact(item.bidName?.join(" ") || "Gói thầu chưa có tên");
  const locations = (item.locations || [])
    .map((location) => location.districtName || location.provName)
    .filter(Boolean);
  const winnerNames = unique(item.contractorName || []);
  const winningPrice = (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    id: compact(item.notifyId || item.id || notifyNo, 180),
    notifyId: compact(item.notifyId || item.id, 180),
    bidId: compact(item.bidId, 180),
    bidOpenId: compact(item.bidOpenId, 180),
    inputResultId: compact(item.inputResultId, 180),
    bidForm: compact(item.bidForm, 80),
    processApply: compact(item.processApply || "LDT", 80),
    stepCode: compact(item.stepCode, 120),
    notifyNo,
    name,
    regionSlug: region.slug,
    region: region.name,
    provinceCodes: region.provinceCodes,
    investor: compact(item.investorName || item.procuringEntityName, 600),
    location: compact(locations.join(", ") || region.name, 300),
    closeDate: compact(item.bidCloseDate || item.closeDate, 80),
    publicDate: compact(item.publicDate, 80),
    price: (item.bidPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    category: medicalCategory(name),
    status: statusOf(item),
    sourceStatus: compact(item.status || "", 80),
    statusForNotify: compact(item.statusForNotify, 80),
    bidderCount: item.numBidderJoin == null ? null : Number(item.numBidderJoin),
    sourceUrl: sourceUrl(item),
    winnerNames,
    winningPrice,
    decisionDate: compact(item.decisionDate || item.publicDateKqlcnt, 80),
    resultPublishedDate: compact(item.publicDateKqlcnt, 80),
    hasResult: Boolean(item.inputResultId || winnerNames.length || winningPrice),
    participantNames: [],
    loserNames: [],
    loserDetails: [],
    winningModels: [],
    losingModels: [],
    losingModelDisclosure: "",
  };
}

function richness(value) {
  if (!value) return 0;
  return [
    value.inputResultId, value.bidOpenId, value.hasResult, value.winnerNames?.length,
    value.participantNames?.length, value.winningModels?.length, value.winningPrice,
    value.bidderCount,
  ].reduce((sum, item) => sum + (Array.isArray(item) ? item.length : item ? 1 : 0), 0);
}

function mergeTender(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  const preferred = richness(previous) >= richness(current) ? previous : current;
  const other = preferred === previous ? current : previous;
  return {
    ...other,
    ...preferred,
    notifyNo: canonicalNotifyNo(preferred.notifyNo || other.notifyNo),
    winnerNames: unique([...(other.winnerNames || []), ...(preferred.winnerNames || [])]),
    participantNames: unique([...(other.participantNames || []), ...(preferred.participantNames || [])]),
    loserNames: unique([...(other.loserNames || []), ...(preferred.loserNames || [])]),
    winningModels: unique([...(other.winningModels || []), ...(preferred.winningModels || [])]),
    losingModels: unique([...(other.losingModels || []), ...(preferred.losingModels || [])]),
    winningPrice: Number(preferred.winningPrice) || Number(other.winningPrice) || 0,
    price: Number(preferred.price) || Number(other.price) || 0,
  };
}

const config = await readJson(regionsPath, { regions: [] });
const region = (config.regions || []).find((item) => item.slug === slug);
if (!region) throw new Error(`Không có cấu hình khu vực: ${slug}`);

const regionDir = resolve(root, "data/regions", slug);
const outputPath = resolve(regionDir, "tenders.json");
let previous = await readJson(outputPath, { tenders: [] });
if ((!previous.tenders || !previous.tenders.length) && slug === "gia-lai") {
  previous = await readJson(resolve(root, "data/tenders.json"), { tenders: [] });
}

const now = new Date();
const from = new Date(now.getTime() - RESCUE_DAYS * 86_400_000).toISOString();
const to = now.toISOString();
const provinceItems = await fetchProvince(from, to, region.provinceCodes || []);
const forcedNotifyNos = FORCED_BY_REGION[slug] || [];
const forcedGroups = await mapLimited(forcedNotifyNos, 2, fetchForced);
const sourceItems = [...provinceItems, ...forcedGroups.flat()];

const sourceMap = new Map();
for (const item of sourceItems) {
  const key = canonicalNotifyNo(item.notifyNo || item.notifyId || item.id);
  if (!key || !isMedicalTender(item)) continue;
  sourceMap.set(key, item);
}

const previousMap = new Map();
for (const item of previous.tenders || []) {
  const key = canonicalNotifyNo(item.notifyNo || item.id);
  if (!key) continue;
  previousMap.set(key, { ...item, notifyNo: key });
}

const missingForced = forcedNotifyNos.filter((notifyNo) => {
  const key = canonicalNotifyNo(notifyNo);
  return !sourceMap.has(key) && !previousMap.has(key);
});
if (missingForced.length) {
  throw new Error(`Chưa lấy được các gói bắt buộc: ${missingForced.join(", ")}`);
}

const beforeCount = previousMap.size;
for (const [key, item] of sourceMap) {
  previousMap.set(key, mergeTender(previousMap.get(key), normalizeItem(item, region)));
}

const tenders = [...previousMap.values()]
  .sort((left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0));
const fetchedAt = new Date().toISOString();
const newCount = Math.max(0, tenders.length - beforeCount);

const payload = {
  ...previous,
  tenders,
  fetchedAt,
  source: previous.source || "muasamcong-public-api-central-region",
  collection: {
    ...(previous.collection || {}),
    rescueStrategy: "recent-province-unfiltered-then-medical-classifier-v2",
    lastMedicalRescueAt: fetchedAt,
    lastMedicalRescueDays: RESCUE_DAYS,
    lastMedicalRescueSourceCount: provinceItems.length,
    lastMedicalRescueMedicalCount: sourceMap.size,
    lastMedicalRescueNewCount: newCount,
    lastMedicalRescueForcedNotifyNos: forcedNotifyNos,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(resolve(regionDir, "medical-rescue-summary.json"), `${JSON.stringify({
  schemaVersion: 1,
  regionSlug: slug,
  region: region.name,
  rescuedAt: fetchedAt,
  rescueDays: RESCUE_DAYS,
  sourceCount: provinceItems.length,
  medicalCount: sourceMap.size,
  beforeCount,
  afterCount: tenders.length,
  newCount,
  forcedNotifyNos,
  missingForced: [],
}, null, 2)}\n`);

process.stdout.write(
  `Cứu hộ ${region.name}: ${sourceMap.size} gói y tế, thêm ${newCount}, tổng ${tenders.length}; mã bắt buộc đạt ${forcedNotifyNos.length}/${forcedNotifyNos.length}.\n`,
);

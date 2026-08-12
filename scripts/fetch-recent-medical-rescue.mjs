import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalNotifyNo,
  classifyMedicalTender,
  medicalCategory,
} from "./medical-scope.mjs";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const RESCUE_DAYS = Math.max(7, Number(process.env.RESCUE_DAYS) || 21);
// API tìm kiếm công khai chỉ ổn định với 10 bản ghi/trang. Giá trị 50/100 gây HTTP 400.
const PAGE_SIZE = Math.max(1, Math.min(10, Number(process.env.PAGE_SIZE) || 10));
const MAX_ATTEMPTS = 6;
const PAGE_CONCURRENCY = 2;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionsPath = resolve(root, "data/regions.json");
const slug = String(process.argv[2] || process.env.REGION_SLUG || "").trim();
if (!slug) throw new Error("Thiếu REGION_SLUG hoặc đối số tên tỉnh/thành");

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

function isManualTender(item) {
  return Boolean(
    item?.manualTenderOverride
    || String(item?.id || "").startsWith("manual-")
    || String(item?.sourceStage || "").startsWith("manual"),
  );
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
          "User-Agent": `thau-y-te-medical-rescue-${slug}/4.0`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${compact(text, 300)}`);
      }
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
        throw new Error(`Nguồn không trả JSON: ${compact(text, 200)}`);
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  throw lastError;
}

function extractSearchPage(payload) {
  const pages = [];
  const visited = new Set();

  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (Array.isArray(value.content)) {
      pages.push({
        content: value.content,
        totalPages: Number(value.totalPages) || 1,
        totalElements: Number(value.totalElements) || value.content.length,
      });
    }

    if (value.page) visit(value.page);
    for (const key of ["data", "result", "results", "responses", "body"]) {
      if (value[key] !== undefined) visit(value[key]);
    }
  };

  visit(payload);
  return {
    content: pages.flatMap((page) => page.content),
    totalPages: Math.max(1, ...pages.map((page) => page.totalPages)),
    totalElements: Math.max(0, ...pages.map((page) => page.totalElements)),
  };
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

function locationPayload(pageNumber, from, to, locationTerm) {
  return [{
    pageSize: PAGE_SIZE,
    pageNumber,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: locationTerm,
      matchType: "exact",
      matchFields: ["investorName", "procuringEntityName", "bidName"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
        { fieldName: "publicDate", searchType: "range", from, to },
      ],
    }],
  }];
}

async function fetchAllPages(payloadFactory, label) {
  const firstPayload = await postJson(payloadFactory(0));
  const first = extractSearchPage(firstPayload);
  const pages = Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => index + 1);
  const remainingPayloads = await mapLimited(pages, PAGE_CONCURRENCY, (pageNumber) =>
    postJson(payloadFactory(pageNumber)));
  const remaining = remainingPayloads.map(extractSearchPage);
  const items = [first, ...remaining].flatMap((page) => page.content);
  process.stdout.write(`${label}: ${items.length} bản ghi/${first.totalPages} trang\n`);
  return items;
}

async function runStrategy(name, task, strategyResults) {
  try {
    const items = await task();
    strategyResults.push({ name, success: true, count: items.length, error: "" });
    return items;
  } catch (error) {
    strategyResults.push({ name, success: false, count: 0, error: compact(error.message, 500) });
    process.stderr.write(`${name} thất bại: ${error.message}\n`);
    return [];
  }
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
  const name = compact(item.bidName?.join?.(" ") || item.bidName || item.name || "Gói thầu chưa có tên");
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
    sourceStage: "official-public-search",
  };
}

function mergeTender(previous, current) {
  if (!previous) return current;
  const merged = {
    ...previous,
    ...current,
    notifyNo: canonicalNotifyNo(current.notifyNo || previous.notifyNo),
    winnerNames: unique([...(previous.winnerNames || []), ...(current.winnerNames || [])]),
    participantNames: unique([...(previous.participantNames || []), ...(current.participantNames || [])]),
    loserNames: unique([...(previous.loserNames || []), ...(current.loserNames || [])]),
    winningModels: unique([...(previous.winningModels || []), ...(current.winningModels || [])]),
    losingModels: unique([...(previous.losingModels || []), ...(current.losingModels || [])]),
    winningPrice: Number(current.winningPrice) || Number(previous.winningPrice) || 0,
    price: Number(current.price) || Number(previous.price) || 0,
  };
  delete merged.manualTenderOverride;
  delete merged.manualTenderVerifiedAt;
  delete merged.sourceNotifyNo;
  return merged;
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
const strategyResults = [];
const sourceGroups = [];

const provinceCodes = unique(region.provinceCodes || []);
if (provinceCodes.length) {
  sourceGroups.push(await runStrategy(
    `Mã tỉnh ${provinceCodes.join(",")}`,
    () => fetchAllPages(
      (pageNumber) => provincePayload(pageNumber, from, to, provinceCodes),
      `Quét mã tỉnh ${slug}`,
    ),
    strategyResults,
  ));

  // Nếu nguồn không chấp nhận nhiều mã trong một điều kiện, quét riêng từng mã.
  if (!sourceGroups.at(-1)?.length && provinceCodes.length > 1) {
    for (const code of provinceCodes) {
      sourceGroups.push(await runStrategy(
        `Mã tỉnh riêng ${code}`,
        () => fetchAllPages(
          (pageNumber) => provincePayload(pageNumber, from, to, [code]),
          `Quét mã ${code}`,
        ),
        strategyResults,
      ));
    }
  }
}

const locationTerms = unique([
  region.name,
  region.shortName,
  ...(region.locationTerms || []),
]);
for (const term of locationTerms) {
  sourceGroups.push(await runStrategy(
    `Địa danh ${term}`,
    () => fetchAllPages(
      (pageNumber) => locationPayload(pageNumber, from, to, term),
      `Quét địa danh ${term}`,
    ),
    strategyResults,
  ));
}

const successfulStrategyCount = strategyResults.filter((item) => item.success).length;
if (!successfulStrategyCount) {
  throw new Error(`Mọi đường lấy dữ liệu ${region.name} đều thất bại; không thay đổi dữ liệu đang lưu`);
}

const sourceUnique = new Map();
for (const item of sourceGroups.flat()) {
  const key = canonicalNotifyNo(item.notifyNo || item.notifyId || item.id);
  if (key) sourceUnique.set(key, item);
}
if (!sourceUnique.size) {
  throw new Error(`Nguồn trả 0 ứng viên cho ${region.name}; giữ nguyên dữ liệu gần nhất`);
}

const accepted = new Map();
const acceptedDiagnostics = [];
const rejectedDiagnostics = [];
const rejectedReasons = new Map();
for (const [key, item] of sourceUnique) {
  const result = classifyMedicalTender(item);
  const diagnostic = {
    notifyNo: key,
    name: compact(item.bidName?.join?.(" ") || item.bidName || item.name, 500),
    investor: compact(item.investorName || item.procuringEntityName, 300),
    accepted: result.accepted,
    score: result.score,
    reason: result.reason,
    matched: result.matched,
  };
  if (result.accepted) {
    accepted.set(key, normalizeItem(item, region));
    if (acceptedDiagnostics.length < 40) acceptedDiagnostics.push(diagnostic);
  } else {
    rejectedReasons.set(result.reason, (rejectedReasons.get(result.reason) || 0) + 1);
    if (rejectedDiagnostics.length < 40) rejectedDiagnostics.push(diagnostic);
  }
}

const previousRows = previous.tenders || [];
const officialPreviousRows = previousRows.filter((item) => !isManualTender(item));
const removedManualCount = previousRows.length - officialPreviousRows.length;
const previousKeys = new Set(officialPreviousRows
  .map((item) => canonicalNotifyNo(item.notifyNo || item.id))
  .filter(Boolean));
const rejectedSourceKeys = new Set(
  [...sourceUnique.keys()].filter((key) => !accepted.has(key)),
);
const revalidatedPreviousRows = officialPreviousRows.filter((item) => {
  const key = canonicalNotifyNo(item.notifyNo || item.id);
  return key && !rejectedSourceKeys.has(key);
});
const removedRejectedStoredCount = officialPreviousRows.length - revalidatedPreviousRows.length;
const merged = new Map();
for (const item of revalidatedPreviousRows) {
  const key = canonicalNotifyNo(item.notifyNo || item.id);
  if (key) merged.set(key, { ...item, notifyNo: key });
}
const beforeCount = previousKeys.size;
const newCount = [...accepted.keys()].filter((key) => !previousKeys.has(key)).length;
for (const [key, item] of accepted) merged.set(key, mergeTender(merged.get(key), item));
const tenders = [...merged.values()].sort(
  (left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0),
);
const fetchedAt = new Date().toISOString();

const collection = { ...(previous.collection || {}) };
delete collection.manualTenderOverrideCount;
delete collection.lastManualTenderOverrideAt;
Object.assign(collection, {
  rescueStrategy: "province-codes-plus-all-location-terms-unified-medical-scope-v5",
  lastMedicalRescueAt: fetchedAt,
  lastMedicalRescueDays: RESCUE_DAYS,
  lastMedicalRescueCandidateCount: sourceUnique.size,
  lastMedicalRescueMedicalCount: accepted.size,
  lastMedicalRescueNewCount: newCount,
  lastRemovedManualTenderCount: removedManualCount,
  lastRemovedRejectedStoredCount: removedRejectedStoredCount,
});

const payload = {
  ...previous,
  tenders,
  fetchedAt,
  collection,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(resolve(regionDir, "medical-rescue-summary.json"), `${JSON.stringify({
  schemaVersion: 5,
  regionSlug: slug,
  region: region.name,
  rescuedAt: fetchedAt,
  rescueDays: RESCUE_DAYS,
  pageSize: PAGE_SIZE,
  strategyResults,
  successfulStrategyCount,
  candidateCount: sourceUnique.size,
  acceptedCount: accepted.size,
  rejectedCount: sourceUnique.size - accepted.size,
  rejectedReasons: Object.fromEntries([...rejectedReasons].sort((a, b) => b[1] - a[1])),
  acceptedDiagnostics,
  rejectedDiagnostics,
  removedManualCount,
  removedRejectedStoredCount,
  beforeCount,
  afterCount: tenders.length,
  newCount,
  filterStrategy: "unified-medical-scope-v5",
}, null, 2)}\n`);

process.stdout.write(
  `Quét bù thật ${region.name}: ${sourceUnique.size} ứng viên, nhận ${accepted.size}, `
  + `bỏ ${removedManualCount} bản ghi thủ công và ${removedRejectedStoredCount} bản ghi sai phạm vi, `
  + `tổng ${tenders.length}.\n`,
);

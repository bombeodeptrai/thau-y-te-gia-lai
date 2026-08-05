import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalNotifyNo,
  classifyMedicalTender,
  medicalCategory,
} from "./medical-scope.mjs";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const PAGE_SIZE = 10;
const MAX_ATTEMPTS = 6;
const CONCURRENCY = 2;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slug = String(process.argv[2] || process.env.REGION_SLUG || "gia-lai").trim();
const regionsPath = resolve(root, "data/regions.json");
const regionDir = resolve(root, "data/regions", slug);
const tendersPath = resolve(regionDir, "tenders.json");
const summaryPath = resolve(regionDir, "official-identity-repair-summary.json");

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
          "User-Agent": `thau-y-te-official-identity-repair-${slug}/1.0`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${compact(text, 300)}`);
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

function extractItems(payload) {
  const items = [];
  const visited = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (Array.isArray(value.content)) items.push(...value.content);
    if (value.page) visit(value.page);
    for (const key of ["data", "result", "results", "responses", "body"]) {
      if (value[key] !== undefined) visit(value[key]);
    }
  };
  visit(payload);
  return items;
}

function notifyPayload(notifyNo) {
  return [{
    pageSize: PAGE_SIZE,
    pageNumber: 0,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: notifyNo,
      matchType: "exact",
      matchFields: ["notifyNo"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
      ],
    }],
  }];
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

function normalizeOfficial(item, region) {
  const notifyNo = canonicalNotifyNo(item.notifyNo || item.notifyId || item.id);
  const name = compact(item.bidName?.join?.(" ") || item.bidName || item.name || "Gói thầu chưa có tên");
  const locations = (item.locations || [])
    .map((location) => location.districtName || location.provName)
    .filter(Boolean);
  const winnerNames = unique(item.contractorName || []);
  const winningPrice = (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    id: compact(item.notifyId || item.id, 180),
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
    sourceStage: "official-direct-notify-repair",
  };
}

function mergeOfficial(previous, current) {
  const merged = {
    ...previous,
    ...current,
    winnerNames: unique([...(previous?.winnerNames || []), ...(current.winnerNames || [])]),
    participantNames: unique([...(previous?.participantNames || []), ...(current.participantNames || [])]),
    loserNames: unique([...(previous?.loserNames || []), ...(current.loserNames || [])]),
    winningModels: unique([...(previous?.winningModels || []), ...(current.winningModels || [])]),
    losingModels: unique([...(previous?.losingModels || []), ...(current.losingModels || [])]),
    winningPrice: Number(current.winningPrice) || Number(previous?.winningPrice) || 0,
    price: Number(current.price) || Number(previous?.price) || 0,
  };
  delete merged.manualTenderOverride;
  delete merged.manualTenderVerifiedAt;
  delete merged.sourceNotifyNo;
  delete merged.repairPending;
  return merged;
}

async function findOfficial(target, region) {
  const base = canonicalNotifyNo(target.notifyNo || target.sourceNotifyNo || target.id);
  const variants = unique([base, `${base}-00`, target.sourceNotifyNo]);
  const errors = [];
  for (const variant of variants) {
    try {
      const payload = await postJson(notifyPayload(variant));
      const candidates = extractItems(payload)
        .filter((item) => canonicalNotifyNo(item.notifyNo || item.notifyId || item.id) === base);
      for (const item of candidates) {
        const result = classifyMedicalTender(item);
        if (!result.accepted) continue;
        const normalized = normalizeOfficial(item, region);
        if (!normalized.notifyId || String(normalized.id).startsWith("manual-")) continue;
        return { notifyNo: base, official: normalized, error: "" };
      }
    } catch (error) {
      errors.push(`${variant}: ${error.message}`);
    }
  }
  return { notifyNo: base, official: null, error: errors.join(" | ") || "Nguồn chưa trả bản ghi chính thức" };
}

const config = await readJson(regionsPath, { regions: [] });
const region = (config.regions || []).find((item) => item.slug === slug);
if (!region) throw new Error(`Không có cấu hình khu vực: ${slug}`);

const payload = await readJson(tendersPath, { tenders: [] });
const rows = payload.tenders || [];
const targets = rows.filter(isManualTender);
if (!targets.length) {
  process.stdout.write(`${region.name}: không còn bản ghi gói thầu thủ công cần sửa.\n`);
  process.exit(0);
}

process.stdout.write(`${region.name}: tìm bản ghi chính thức cho ${targets.length} gói đang mang dữ liệu thủ công.\n`);
const results = await mapLimited(targets, CONCURRENCY, (target) => findOfficial(target, region));
const unresolved = results.filter((item) => !item.official);
const repairedAt = new Date().toISOString();

await mkdir(dirname(summaryPath), { recursive: true });
await writeFile(summaryPath, `${JSON.stringify({
  schemaVersion: 1,
  regionSlug: slug,
  repairedAt,
  targetCount: targets.length,
  repairedCount: results.length - unresolved.length,
  unresolvedCount: unresolved.length,
  repairedNotifyNos: results.filter((item) => item.official).map((item) => item.notifyNo),
  unresolved: unresolved.map(({ notifyNo, error }) => ({ notifyNo, error })),
  pageSize: PAGE_SIZE,
  strategy: "dynamic-direct-notify-search",
}, null, 2)}\n`);

if (unresolved.length) {
  throw new Error(`Chưa lấy được bản ghi chính thức cho: ${unresolved.map((item) => item.notifyNo).join(", ")}. Dữ liệu cũ được giữ nguyên.`);
}

const byNotifyNo = new Map();
for (const row of rows) {
  const key = canonicalNotifyNo(row.notifyNo || row.sourceNotifyNo || row.id);
  if (key) byNotifyNo.set(key, { ...row, notifyNo: key });
}
for (const result of results) {
  byNotifyNo.set(result.notifyNo, mergeOfficial(byNotifyNo.get(result.notifyNo), result.official));
}
const tenders = [...byNotifyNo.values()].sort(
  (left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0),
);
const remainingManual = tenders.filter(isManualTender);
if (remainingManual.length) {
  throw new Error(`Sau sửa vẫn còn ${remainingManual.length} bản ghi thủ công; từ chối ghi dữ liệu.`);
}

const collection = { ...(payload.collection || {}) };
delete collection.manualTenderOverrideCount;
delete collection.lastManualTenderOverrideAt;
collection.lastOfficialIdentityRepairAt = repairedAt;
collection.lastOfficialIdentityRepairCount = results.length;

await writeFile(tendersPath, `${JSON.stringify({
  ...payload,
  tenders,
  fetchedAt: repairedAt,
  collection,
}, null, 2)}\n`);

process.stdout.write(`Đã thay ${results.length}/${targets.length} bản ghi thủ công bằng dữ liệu chính thức của nguồn công khai.\n`);

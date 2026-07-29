import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalNotifyNo,
  classifyMedicalTender,
  medicalCategory,
} from "./medical-scope.mjs";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const AUDIT_DAYS = Math.max(7, Number(process.env.AUDIT_DAYS) || 30);
const PAGE_SIZE = Math.max(10, Math.min(100, Number(process.env.PAGE_SIZE) || 50));
const MAX_ATTEMPTS = 6;
const TERM_CONCURRENCY = 2;

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
          "User-Agent": `thau-y-te-location-audit-${slug}/3.0`,
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

function searchPayload(pageNumber, from, to, locationTerm) {
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

async function fetchLocationTerm(locationTerm, from, to, index, total) {
  const first = await postJson(searchPayload(0, from, to, locationTerm));
  const totalPages = Math.max(1, Number(first.page?.totalPages) || 1);
  const pages = Array.from({ length: totalPages - 1 }, (_, pageIndex) => pageIndex + 1);
  const remaining = await mapLimited(pages, 2, (pageNumber) =>
    postJson(searchPayload(pageNumber, from, to, locationTerm)));
  const items = [first, ...remaining].flatMap((payload) => payload.page?.content || []);
  if (items.length || index + 1 === total) {
    process.stdout.write(`Đối chiếu ${index + 1}/${total}: ${locationTerm} = ${items.length}\n`);
  }
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
  return closeTime ? "closed" : "closed";
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
    winnerNames: unique(item.contractorName || []),
    winningPrice: (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    decisionDate: compact(item.decisionDate || item.publicDateKqlcnt, 80),
    resultPublishedDate: compact(item.publicDateKqlcnt, 80),
    hasResult: Boolean(item.inputResultId || item.contractorName?.length),
    participantNames: [],
    loserNames: [],
    loserDetails: [],
    winningModels: [],
    losingModels: [],
    losingModelDisclosure: "",
  };
}

function mergeTender(previous, current) {
  if (!previous) return current;
  return {
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
const from = new Date(now.getTime() - AUDIT_DAYS * 86_400_000).toISOString();
const to = now.toISOString();
const terms = unique(region.locationTerms || [region.name]);
const groups = await mapLimited(terms, TERM_CONCURRENCY, (term, index) =>
  fetchLocationTerm(term, from, to, index, terms.length));
const sourceItems = groups.flat();
const sourceUnique = new Map();
for (const item of sourceItems) {
  const key = canonicalNotifyNo(item.notifyNo || item.notifyId || item.id);
  if (key) sourceUnique.set(key, item);
}

const accepted = new Map();
const rejectedReasons = new Map();
for (const [key, item] of sourceUnique) {
  const result = classifyMedicalTender(item);
  if (result.accepted) {
    accepted.set(key, normalizeItem(item, region));
  } else {
    rejectedReasons.set(result.reason, (rejectedReasons.get(result.reason) || 0) + 1);
  }
}

const merged = new Map();
for (const item of previous.tenders || []) {
  const key = canonicalNotifyNo(item.notifyNo || item.id);
  if (key) merged.set(key, { ...item, notifyNo: key });
}
const beforeCount = merged.size;
for (const [key, item] of accepted) merged.set(key, mergeTender(merged.get(key), item));
const tenders = [...merged.values()].sort(
  (left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0),
);
const fetchedAt = new Date().toISOString();

const payload = {
  ...previous,
  tenders,
  fetchedAt,
  collection: {
    ...(previous.collection || {}),
    lastLocationAuditAt: fetchedAt,
    lastLocationAuditDays: AUDIT_DAYS,
    lastLocationAuditCandidateCount: sourceUnique.size,
    lastLocationAuditMedicalCount: accepted.size,
    lastLocationAuditNewCount: Math.max(0, tenders.length - beforeCount),
    filterStrategy: "unified-medical-scope-v3",
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(resolve(regionDir, "location-audit-summary.json"), `${JSON.stringify({
  schemaVersion: 2,
  regionSlug: slug,
  auditedAt: fetchedAt,
  auditDays: AUDIT_DAYS,
  candidateCount: sourceUnique.size,
  acceptedCount: accepted.size,
  rejectedCount: sourceUnique.size - accepted.size,
  rejectedReasons: Object.fromEntries([...rejectedReasons].sort((a, b) => b[1] - a[1])),
  beforeCount,
  afterCount: tenders.length,
  filterStrategy: "unified-medical-scope-v3",
}, null, 2)}\n`);

process.stdout.write(
  `Đối chiếu ${region.name}: ${sourceUnique.size} ứng viên, nhận ${accepted.size}, `
  + `thêm ${Math.max(0, tenders.length - beforeCount)}, tổng ${tenders.length}.\n`,
);

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { muasamcongDateRange } from "./source-time.mjs";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const COVERAGE_DAYS = 3 * 365;
const CACHE_HOURS = 20;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_TERM = 12;
const CONCURRENCY = 3;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tendersPath = resolve(root, "data/tenders.json");
const equipmentPath = resolve(root, "data/equipment.json");
const outputPath = resolve(root, "data/competitor-history.json");

function compact(value, maxLength = 1200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalize(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function postJson(body, timeoutMs = 30_000) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "Content-Type": "application/json",
          Origin: "https://muasamcong.mpi.gov.vn",
          Referer: "https://muasamcong.mpi.gov.vn/",
          "User-Agent": "thau-y-te-gia-lai-competitor-history/1.0",
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
      if (attempt < 4) await delay(attempt * 1500);
    }
  }
  throw lastError;
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

function isMedicalInvestor(name) {
  const value = normalize(name);
  return /(benh vien|trung tam y te|so y te|phong kham|benh xa|trung tam kiem soat benh tat|cdc|trung tam kiem nghiem|trung tam phap y)/.test(value);
}

const GENERIC_INVESTOR_WORDS = new Set([
  "benh", "vien", "trung", "tam", "y", "te", "so", "phong", "kham", "tinh",
  "thanh", "pho", "co", "so", "gia", "lai", "binh", "dinh", "pleiku", "quy", "nhon",
  "da", "khoa", "thuoc", "bo", "nganh", "chi", "nhanh", "cong", "lap",
]);

function investorCoreTokens(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !GENERIC_INVESTOR_WORDS.has(token));
}

function investorMatch(targetName, sourceName) {
  const target = normalize(targetName);
  const source = normalize(sourceName);
  if (!target || !source) return false;
  if (target === source) return true;

  const targetTokens = investorCoreTokens(targetName);
  const sourceTokens = investorCoreTokens(sourceName);
  if (!targetTokens.length || !sourceTokens.length) return false;

  const sourceSet = new Set(sourceTokens);
  const common = targetTokens.filter((token) => sourceSet.has(token)).length;
  if (targetTokens.length === 1) return common === 1;

  const union = new Set([...targetTokens, ...sourceTokens]).size;
  const score = common / Math.max(1, union);
  return common >= 2 && score >= 0.5;
}

function searchTermsForInvestor(name) {
  const original = compact(name, 500);
  let core = original
    .replace(/^\s*(bệnh\s+viện|trung\s+tâm\s+y\s+tế|sở\s+y\s+tế|phòng\s+khám\s+đa\s+khoa|phòng\s+khám)\s*/i, "")
    .replace(/\s+(tỉnh|thành\s+phố)\s+(gia\s+lai|bình\s+định)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (investorCoreTokens(core).length < 1 || core.length < 4) core = original;
  return unique([core, original]).slice(0, 2);
}

function searchPayload(pageNumber, from, to, term) {
  return [{
    pageSize: PAGE_SIZE,
    pageNumber,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: term,
      matchType: "exact",
      matchFields: ["investorName", "procuringEntityName"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
        { fieldName: "publicDate", searchType: "range", from, to },
      ],
    }],
  }];
}

async function fetchTerm(term, from, to) {
  const first = await postJson(searchPayload(0, from, to, term));
  const totalPages = Math.min(
    MAX_PAGES_PER_TERM,
    Math.max(1, Number(first.page?.totalPages) || 1),
  );
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 1);
  const remaining = await mapLimited(remainingPages, 2, (pageNumber) =>
    postJson(searchPayload(pageNumber, from, to, term)));
  return [first, ...remaining].flatMap((payload) => payload.page?.content || []);
}

function hasPublishedResult(item) {
  return Boolean(
    item?.inputResultId
    || item?.contractorName?.length
    || item?.bidWinningPrice?.some?.((value) => Number(value) > 0)
    || String(item?.statusForNotify || "").toUpperCase() === "CNTTT",
  );
}

function categoryOf(name) {
  const text = String(name || "").toLocaleLowerCase("vi-VN");
  return /(vật tư|hóa chất|hoá chất|sinh phẩm|dụng cụ|thuốc|dược phẩm|kit|test|gạc|găng|kim|stent|catheter)/.test(text)
    ? "Vật tư & hóa chất"
    : "Thiết bị y tế";
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
  });
  return `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?${params}`;
}

function locationOf(item) {
  return (item.locations || [])
    .map((location) => location.districtName || location.provName)
    .filter(Boolean)
    .join(", ");
}

function normalizeRecord(item, canonicalInvestor, equipmentByNotifyNo) {
  const notifyNo = compact(item.notifyNo, 100);
  const equipment = equipmentByNotifyNo.get(notifyNo) || [];
  return {
    notifyNo,
    tenderId: compact(item.notifyId || item.id || notifyNo, 180),
    name: compact(item.bidName?.join(" ") || "Gói thầu chưa có tên", 1200),
    investor: compact(canonicalInvestor, 600),
    sourceInvestor: compact(item.investorName, 600),
    location: compact(locationOf(item), 300),
    category: categoryOf(item.bidName?.join(" ") || ""),
    publicDate: compact(item.publicDate, 80),
    decisionDate: compact(item.decisionDate || item.publicDateKqlcnt, 80),
    winningPrice: (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    estimatedPrice: (item.bidPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    winnerNames: unique((item.contractorName || []).map((value) => compact(value, 500))),
    participants: [],
    equipment: equipment.slice(0, 35),
    sourceUrl: sourceUrl(item),
  };
}

async function fetchInvestorHistory(investor, from, to, equipmentByNotifyNo) {
  const terms = searchTermsForInvestor(investor);
  const groups = [];
  for (const term of terms) {
    try {
      groups.push(...await fetchTerm(term, from, to));
    } catch (error) {
      process.stderr.write(`Lịch sử ${investor} (${term}): ${error.message}\n`);
    }
  }

  const uniqueItems = new Map();
  for (const item of groups) {
    const notifyNo = compact(item.notifyNo, 100);
    if (!notifyNo || !hasPublishedResult(item)) continue;
    if (!investorMatch(investor, item.investorName)) continue;
    uniqueItems.set(notifyNo, item);
  }

  const records = [...uniqueItems.values()]
    .sort((left, right) => {
      const rightTime = new Date(right.decisionDate || right.publicDateKqlcnt || right.publicDate || 0).getTime() || 0;
      const leftTime = new Date(left.decisionDate || left.publicDateKqlcnt || left.publicDate || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 10)
    .map((item) => normalizeRecord(item, investor, equipmentByNotifyNo));

  process.stdout.write(`Lịch sử ${investor}: tìm thấy ${records.length}/10 gói có kết quả\n`);
  return records;
}

const tenderData = await readJson(tendersPath, { tenders: [] });
const equipmentData = await readJson(equipmentPath, { equipment: [] });
const existing = await readJson(outputPath, null);

const investors = unique((tenderData.tenders || [])
  .map((tender) => compact(tender.investor, 600))
  .filter(isMedicalInvestor))
  .sort((left, right) => left.localeCompare(right, "vi"));

const investorSignature = sha256(investors.map(normalize).join("|"));
const existingTime = new Date(existing?.generatedAt || 0).getTime();
const cacheFresh = existing
  && Number(existing.coverageDays) >= COVERAGE_DAYS
  && existing.investorSignature === investorSignature
  && Number.isFinite(existingTime)
  && Date.now() - existingTime < CACHE_HOURS * 60 * 60 * 1000;

if (cacheFresh && process.env.FORCE_COMPETITOR_HISTORY !== "1") {
  process.stdout.write(`Lịch sử đối thủ 3 năm còn hiệu lực; đang có ${existing.records?.length || 0} gói.\n`);
  process.exit(0);
}

const equipmentByNotifyNo = new Map();
for (const item of equipmentData.equipment || []) {
  const notifyNo = compact(item.notifyNo, 100);
  if (!notifyNo) continue;
  if (!equipmentByNotifyNo.has(notifyNo)) equipmentByNotifyNo.set(notifyNo, []);
  equipmentByNotifyNo.get(notifyNo).push({
    name: compact(item.name || item.lotName || "Mặt hàng y tế", 500),
    lotName: compact(item.lotName, 400),
    model: compact(item.model || item.code, 220),
    brand: compact(item.brand, 220),
    manufacturer: compact(item.manufacturer, 280),
    origin: compact(item.origin, 180),
    quantity: Number(item.quantity) || 0,
    unit: compact(item.unit, 80),
    unitPrice: Number(item.unitPrice) || 0,
    plannedPrice: Number(item.plannedPrice) || 0,
  });
}

const now = new Date();
const { from, to } = muasamcongDateRange(now, COVERAGE_DAYS * 86_400_000);
process.stdout.write(`Quét lịch sử 3 năm cho ${investors.length} đơn vị y tế; mỗi đơn vị lấy tối đa 10 gói có kết quả.\n`);

const groups = await mapLimited(investors, CONCURRENCY, (investor) =>
  fetchInvestorHistory(investor, from, to, equipmentByNotifyNo));
const records = groups.flat();

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  coverageDays: COVERAGE_DAYS,
  from,
  to,
  investorCount: investors.length,
  investorSignature,
  records,
}, null, 2)}\n`);

process.stdout.write(`Đã lưu ${records.length} gói lịch sử của ${investors.length} đơn vị vào data/competitor-history.json.\n`);

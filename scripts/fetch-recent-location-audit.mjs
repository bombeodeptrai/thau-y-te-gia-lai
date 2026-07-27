import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function normalizeText(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
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
          "User-Agent": `thau-y-te-location-audit-${slug}/1.1`,
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
      matchFields: ["investorName", "procuringEntityName", "bidName"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
        { fieldName: "publicDate", searchType: "range", from, to },
      ],
    }],
  }];
}

function notifyNoPayload(notifyNo) {
  return [{
    pageSize: 10,
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

async function fetchTerm(term, from, to) {
  const first = await postJson(searchPayload(0, from, to, term));
  const totalPages = Math.max(1, Number(first.page?.totalPages) || 1);
  const pages = Array.from({ length: totalPages - 1 }, (_, index) => index + 1);
  const remaining = await mapLimited(pages, 2, (pageNumber) =>
    postJson(searchPayload(pageNumber, from, to, term)));
  const items = [first, ...remaining].flatMap((payload) => payload.page?.content || []);
  process.stdout.write(`Kiểm tra địa danh ${term}: ${items.length} bản ghi/${totalPages} trang\n`);
  return items;
}

async function fetchCanary(notifyNo) {
  const payload = await postJson(notifyNoPayload(notifyNo));
  const items = payload.page?.content || [];
  if (!items.some((item) => item.notifyNo === notifyNo)) {
    throw new Error(`Canary ${notifyNo} không được nguồn trả về`);
  }
  process.stdout.write(`Canary ${notifyNo}: đạt\n`);
  return items;
}

const excludedTerms = [
  "xay lap", "xay dung", "cai tao", "sua chua", "tu van", "bao tri", "kiem dinh",
  "suat an", "thuc pham", "bao ve", "ve sinh", "van phong pham", "xang dau",
  "cay xanh", "rac thai", "chat thai", "in an", "trang phuc", "bao hiem",
  "may tinh", "may in", "cong nghe thong tin", "may chu", "thang may", "may phat dien",
  "dieu hoa", "phan bon", "bao ve thuc vat", "thu y", "thuoc dieu tri", "duoc pham",
];
const explicitMedicalTerms = [
  "thiet bi y te", "trang thiet bi y te", "vat tu y te", "vat tu tieu hao",
  "vat tu phau thuat", "hoa chat xet nghiem", "hoa chat y te", "hoa chat khu khuan",
  "sinh pham", "chan doan in vitro", "dung cu y te", "y cu", "khi y te", "oxy y te",
  "may xet nghiem", "may sieu am", "may tho", "may dien tim", "may theo doi benh nhan",
  "may loc mau", "may chay than", "may chup", "x quang", "noi soi", "phau thuat",
  "catheter", "stent", "implant", "bom tiem", "kim tiem", "gang tay y te",
  "bong y te", "gac y te", "khau trang y te", "kit test", "test nhanh",
];
const medicalInvestorTerms = [
  "so y te", "benh vien", "trung tam y te", "tram y te", "phong kham", "benh xa",
  "trung tam kiem soat benh tat", "cdc", "trung tam kiem nghiem", "trung tam phap y",
];

function isMedical(item) {
  const title = normalizeText(item.bidName?.join(" ") || "");
  const investor = normalizeText(item.investorName || item.procuringEntityName || "");
  if (!title || excludedTerms.some((term) => title.includes(term))) return false;
  if (explicitMedicalTerms.some((term) => title.includes(term))) return true;

  const hasMedicalInvestor = medicalInvestorTerms.some((term) => investor.includes(term));
  const hasSupply = ["vat tu", "hoa chat", "sinh pham", "dung cu", "may", "thiet bi"]
    .some((term) => title.includes(term));
  const hasClinicalContext = ["xet nghiem", "chan doan", "kham", "chua benh", "dieu tri", "phong mo"]
    .some((term) => title.includes(term));
  return hasMedicalInvestor && hasSupply && hasClinicalContext;
}

function categoryOf(name) {
  const text = String(name || "").toLocaleLowerCase("vi-VN");
  return /(vật tư|hóa chất|hoá chất|sinh phẩm|dụng cụ|kit|test|gạc|găng|kim|stent|catheter)/.test(text)
    ? "Vật tư & hóa chất"
    : "Thiết bị y tế";
}

function statusOf(item) {
  const sourceStatus = String(item.statusForNotify || item.status || "").toUpperCase();
  if (sourceStatus.includes("HUY") || sourceStatus === "CANCELLED") return "cancelled";
  if (item.inputResultId || item.contractorName?.length || sourceStatus === "CNTTT") return "awarded";
  const closeTime = new Date(item.bidCloseDate || item.closeDate || 0).getTime();
  if (!closeTime) return "closed";
  const remaining = closeTime - Date.now();
  if (remaining > 0 && remaining <= 3 * 86_400_000) return "urgent";
  if (remaining > 0) return "open";
  return item.bidOpenId ? "evaluating" : "closed";
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
  const name = compact(item.bidName?.join(" ") || "Gói thầu chưa có tên");
  const locations = (item.locations || [])
    .map((location) => location.districtName || location.provName)
    .filter(Boolean);
  const winners = unique(item.contractorName || []);
  const winningPrice = (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    id: compact(item.id || item.notifyId || item.notifyNo, 180),
    notifyId: compact(item.notifyId || item.id, 180),
    bidId: compact(item.bidId, 180),
    bidOpenId: compact(item.bidOpenId, 180),
    inputResultId: compact(item.inputResultId, 180),
    bidForm: compact(item.bidForm, 80),
    processApply: compact(item.processApply, 80),
    stepCode: compact(item.stepCode, 120),
    notifyNo: compact(item.notifyNo, 100),
    name,
    regionSlug: region.slug,
    region: region.name,
    provinceCodes: region.provinceCodes,
    investor: compact(item.investorName || item.procuringEntityName, 600),
    location: compact(locations.join(", ") || region.name, 300),
    closeDate: compact(item.bidCloseDate || item.closeDate, 80),
    publicDate: compact(item.publicDate, 80),
    price: (item.bidPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    category: categoryOf(name),
    status: statusOf(item),
    sourceStatus: compact(item.statusForNotify || item.status, 80),
    statusForNotify: compact(item.statusForNotify, 80),
    bidderCount: item.bidderCount == null ? null : Number(item.bidderCount),
    sourceUrl: sourceUrl(item),
    winnerNames: winners,
    winningPrice,
    decisionDate: compact(item.decisionDate || item.publicDateKqlcnt, 80),
    resultPublishedDate: compact(item.publicDateKqlcnt, 80),
    hasResult: Boolean(item.inputResultId || winners.length || winningPrice),
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
const from = new Date(now.getTime() - AUDIT_DAYS * 86_400_000).toISOString();
const to = now.toISOString();
const terms = unique(region.locationTerms || []);
if (!terms.length) throw new Error(`${region.name} chưa có danh sách địa danh kiểm tra`);

const failedTerms = [];
const groups = await mapLimited(terms, TERM_CONCURRENCY, async (term) => {
  try {
    return await fetchTerm(term, from, to);
  } catch (error) {
    failedTerms.push(`${term}: ${error.message}`);
    return [];
  }
});
if (failedTerms.length) {
  throw new Error(`Kiểm tra địa danh chưa hoàn tất (${failedTerms.length}/${terms.length} lỗi): ${failedTerms.join(" | ")}`);
}

const canaryNotifyNos = slug === "gia-lai" ? ["IB2600378695"] : [];
const canaryItems = (await mapLimited(canaryNotifyNos, 1, fetchCanary)).flat();
const sourceMap = new Map();
for (const item of [...groups.flat(), ...canaryItems]) {
  const key = compact(item.notifyNo || item.notifyId || item.id, 180);
  if (!key || !isMedical(item)) continue;
  sourceMap.set(key, item);
}

const previousRecentCount = (previous.tenders || []).filter((item) => {
  const time = new Date(item.publicDate || 0).getTime();
  return Number.isFinite(time) && time >= new Date(from).getTime();
}).length;
if (!sourceMap.size && previousRecentCount > 0) {
  throw new Error(`Nguồn kiểm tra chéo trả 0 gói nhưng dữ liệu đang có ${previousRecentCount} gói/${AUDIT_DAYS} ngày`);
}

const previousMap = new Map((previous.tenders || [])
  .map((item) => [compact(item.notifyNo || item.id, 180), item])
  .filter(([key]) => key));
const beforeCount = previousMap.size;
for (const [key, item] of sourceMap) {
  previousMap.set(key, mergeTender(previousMap.get(key), normalizeItem(item, region)));
}

const tenders = [...previousMap.values()]
  .sort((left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0));
const newCount = Math.max(0, tenders.length - beforeCount);
const fetchedAt = new Date().toISOString();
const previousCoverageDays = Number(previous.collection?.days) || 0;
const payload = {
  ...previous,
  tenders,
  fetchedAt,
  source: previous.source || "muasamcong-public-api-central-region",
  collection: {
    ...(previous.collection || {}),
    days: previousCoverageDays || AUDIT_DAYS,
    auditStrategy: "province-code-scan-plus-independent-location-cross-check",
    lastLocationAuditAt: fetchedAt,
    lastLocationAuditDays: AUDIT_DAYS,
    lastLocationAuditTermCount: terms.length,
    lastLocationAuditSourceCount: sourceMap.size,
    lastLocationAuditNewCount: newCount,
    lastLocationAuditCanaryCount: canaryNotifyNos.length,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(resolve(regionDir, "location-audit-summary.json"), `${JSON.stringify({
  regionSlug: slug,
  region: region.name,
  auditedAt: fetchedAt,
  auditDays: AUDIT_DAYS,
  termCount: terms.length,
  sourceMedicalCount: sourceMap.size,
  beforeCount,
  afterCount: tenders.length,
  newCount,
  canaryNotifyNos,
  failedTerms: [],
}, null, 2)}\n`);

process.stdout.write(
  `Kiểm tra chéo ${region.name}: ${terms.length} địa danh, ${sourceMap.size} gói y tế/${AUDIT_DAYS} ngày, bổ sung ${newCount}, tổng ${tenders.length}.\n`,
);

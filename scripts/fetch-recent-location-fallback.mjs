import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const LOOKBACK_HOURS = 72;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_QUERY = 6;
const CONCURRENCY = 4;

// Quét bù nhẹ cho dữ liệu mới khi trường locations.provCode chưa được nguồn lập chỉ mục kịp thời.
const LOCATION_TERMS = [
  "Gia Lai",
  "Bình Định",
  "Pleiku",
  "Quy Nhơn",
  "An Nhơn",
  "Hoài Nhơn",
  "Tuy Phước",
  "Phù Cát",
  "Phù Mỹ",
  "Tây Sơn",
  "Vĩnh Thạnh",
  "An Lão",
  "Hoài Ân",
  "Phú Thiện",
  "Chư Păh",
  "Chư Prông",
  "Chư Sê",
  "Đức Cơ",
  "Ia Grai",
  "Kbang",
];

const TITLE_TERMS = [
  "thiết bị y tế",
  "vật tư y tế",
  "hóa chất",
  "hoá chất",
  "sinh phẩm",
  "xét nghiệm",
  "khí y tế",
  "dụng cụ y tế",
  "phẫu thuật",
  "máy",
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tendersPath = resolve(root, "data/tenders.json");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
          "User-Agent": "thau-y-te-gia-lai-recent-fallback/1.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(attempt * 1_500);
    }
  }
  throw lastError;
}

async function mapLimited(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function searchPayload(pageNumber, from, to, locationTerm, titleTerm) {
  const filters = [
    { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
    { fieldName: "publicDate", searchType: "range", from, to },
  ];

  return [{
    pageSize: PAGE_SIZE,
    pageNumber,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [
      {
        index: "es-contractor-selection",
        keyWord: titleTerm,
        matchType: "exact",
        matchFields: ["bidName"],
        filters,
      },
      {
        index: "es-contractor-selection",
        keyWord: locationTerm,
        matchType: "exact",
        matchFields: ["investorName", "procuringEntityName", "locations.provName", "locations.districtName"],
        filters,
      },
    ],
  }];
}

function isMedical(item) {
  const originalTitle = compactText(item.bidName?.join(" ") || "").toLocaleLowerCase("vi-VN");
  const title = normalizeText(originalTitle);
  const investor = normalizeText(item.investorName);

  const excludedTerms = [
    "xay lap", "xay dung", "cai tao", "sua chua", "bao tri", "bao duong",
    "tu van", "tham dinh", "lap e-hsmt", "danh gia e-hsdt", "giam sat thi cong",
    "may tinh", "may in", "tin hoc", "cong nghe thong tin", "may chu",
    "van phong pham", "thuc pham", "suat an", "bao ve", "ve sinh cong nghiep",
    "vat tu dien", "vat tu nuoc", "dien nuoc", "xang dau", "phan bon",
    "bao ve thuc vat", "benh dong vat", "thang may", "may phat dien", "dieu hoa khong khi",
  ];
  if (excludedTerms.some((term) => title.includes(term))) return false;

  const explicitTerms = [
    "thiết bị y tế", "trang thiết bị y tế", "vật tư y tế", "vật tư xét nghiệm",
    "dụng cụ y tế", "y cụ", "hóa chất y tế", "hoá chất y tế", "hóa chất xét nghiệm",
    "hoá chất xét nghiệm", "hóa chất khử khuẩn", "hoá chất khử khuẩn",
    "sinh phẩm y tế", "sinh phẩm xét nghiệm", "khí y tế", "oxy y tế",
    "máy siêu âm", "máy xét nghiệm", "máy thở", "máy điện tim", "máy theo dõi bệnh nhân",
    "dụng cụ phẫu thuật", "vật tư phẫu thuật", "nội soi", "lọc máu", "chạy thận",
    "catheter", "stent", "implant", "đinh, nẹp, vít", "đinh nẹp vít",
    "bơm tiêm", "kim tiêm", "gạc phẫu thuật", "găng tay y tế", "khẩu trang y tế",
  ];
  if (explicitTerms.some((term) => originalTitle.includes(term))) return true;

  const medicalInvestors = [
    "so y te", "benh vien", "trung tam y te", "tram y te", "cdc", "phong kham",
    "benh xa", "y khoa", "y duoc", "da khoa", "chuyen khoa", "trung tam kiem nghiem",
  ];
  const isMedicalInvestor = medicalInvestors.some((term) => investor.includes(term));
  if (!isMedicalInvestor) return false;

  const hasMedicalSupply = ["vat tu", "hoa chat", "sinh pham", "dung cu", "khi y te"]
    .some((term) => title.includes(term));
  const hasClinicalContext = ["kham benh", "chua benh", "dieu tri", "xet nghiem", "phau thuat"]
    .some((term) => title.includes(term));
  const hasBundle = title.includes("mua sam")
    && title.includes("vat tu")
    && (title.includes("hoa chat") || title.includes("sinh pham"));

  return hasBundle || (hasMedicalSupply && hasClinicalContext);
}

function categoryOf(name) {
  const text = String(name || "").toLocaleLowerCase("vi-VN");
  return ["vật tư", "hóa chất", "hoá chất", "sinh phẩm", "dụng cụ", "gạc", "găng", "kim", "stent", "khớp"]
    .some((term) => text.includes(term))
    ? "Vật tư & hóa chất"
    : "Thiết bị y tế";
}

function statusOf(item) {
  const sourceStatus = String(item.status || "").toUpperCase();
  const notifyStatus = String(item.statusForNotify || "").toUpperCase();
  const hasResult = Boolean(item.inputResultId || item.contractorName?.length);
  if (sourceStatus === "CANCEL_BID" || ["DHT", "DHTBMT"].includes(notifyStatus)) return "cancelled";
  if (hasResult || notifyStatus === "CNTTT") return "awarded";
  if (notifyStatus === "DXT" || sourceStatus === "OPEN_BID") return "evaluating";
  const remaining = new Date(item.bidCloseDate || 0).getTime() - Date.now();
  if (remaining <= 0) return Number(item.numBidderJoin) === 0 ? "no_bidder" : "closed";
  if (remaining <= 3 * 86_400_000) return "urgent";
  return "open";
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

function normalizeTender(item) {
  const name = compactText(item.bidName?.join(" ") || "Gói thầu chưa có tên");
  const bidderCount = item.numBidderJoin === null || item.numBidderJoin === undefined
    ? null
    : Number(item.numBidderJoin);
  return {
    id: item.notifyId || item.id || item.notifyNo,
    notifyId: item.notifyId || item.id || "",
    bidId: item.bidId || "",
    bidOpenId: item.bidOpenId || "",
    inputResultId: item.inputResultId || "",
    bidForm: item.bidForm || "",
    processApply: item.processApply || "LDT",
    stepCode: item.stepCode || "",
    notifyNo: item.notifyNo || "—",
    name,
    investor: item.investorName || "Chưa công bố",
    location: item.locations?.map((location) => location.districtName || location.provName).filter(Boolean).join(", ") || "Tỉnh Gia Lai",
    closeDate: item.bidCloseDate || "",
    publicDate: item.publicDate || "",
    price: (item.bidPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    category: categoryOf(name),
    status: statusOf(item),
    sourceStatus: item.status || "",
    statusForNotify: item.statusForNotify || "",
    bidderCount: Number.isFinite(bidderCount) ? bidderCount : null,
    sourceUrl: sourceUrl(item),
    winnerNames: [...new Set((item.contractorName || []).filter(Boolean))],
    winningPrice: (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    decisionDate: item.decisionDate || "",
    resultPublishedDate: item.publicDateKqlcnt || "",
    hasResult: Boolean(item.inputResultId || item.contractorName?.length),
  };
}

async function fetchPair(pair, from, to) {
  const first = await postJson(searchPayload(0, from, to, pair.locationTerm, pair.titleTerm));
  const totalPages = Math.min(MAX_PAGES_PER_QUERY, Math.max(1, Number(first.page?.totalPages) || 1));
  const pages = [first];
  for (let pageNumber = 1; pageNumber < totalPages; pageNumber += 1) {
    pages.push(await postJson(searchPayload(pageNumber, from, to, pair.locationTerm, pair.titleTerm)));
  }
  return pages.flatMap((payload) => payload.page?.content || []);
}

const manifest = JSON.parse(await readFile(tendersPath, "utf8"));
const now = new Date();
const from = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
const to = now.toISOString();
const pairs = LOCATION_TERMS.flatMap((locationTerm) =>
  TITLE_TERMS.map((titleTerm) => ({ locationTerm, titleTerm })));

process.stdout.write(`Quét bù nhanh ${LOOKBACK_HOURS} giờ bằng ${pairs.length} cặp địa danh/từ khóa\n`);

const resultGroups = await mapLimited(pairs, CONCURRENCY, async (pair) => {
  try {
    return await fetchPair(pair, from, to);
  } catch (error) {
    process.stderr.write(`Bỏ qua ${pair.locationTerm} + ${pair.titleTerm}: ${error.message}\n`);
    return [];
  }
});

const rawUnique = new Map();
resultGroups.flat().forEach((item) => {
  const key = item.notifyId || item.id || item.notifyNo;
  if (key) rawUnique.set(key, item);
});

const recentMedical = [...rawUnique.values()]
  .filter(isMedical)
  .map(normalizeTender);

const merged = new Map((manifest.tenders || []).map((tender) => [tender.notifyNo || tender.id, tender]));
let newCount = 0;
for (const tender of recentMedical) {
  const key = tender.notifyNo || tender.id;
  if (!merged.has(key)) newCount += 1;
  merged.set(key, { ...(merged.get(key) || {}), ...tender });
}

manifest.tenders = [...merged.values()]
  .sort((a, b) => new Date(b.publicDate || 0) - new Date(a.publicDate || 0));
manifest.fetchedAt = new Date().toISOString();
manifest.collection = {
  ...(manifest.collection || {}),
  recentFallbackHours: LOOKBACK_HOURS,
  recentFallbackScannedAt: manifest.fetchedAt,
  recentFallbackRawCount: rawUnique.size,
  recentFallbackMedicalCount: recentMedical.length,
  recentFallbackNewCount: newCount,
};

await writeFile(tendersPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Quét bù nhanh: ${rawUnique.size} bản ghi thô, ${recentMedical.length} gói y tế, thêm mới ${newCount} gói\n`,
);

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const WINNING_PRICE_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-winning-bid-data/services/smart/search_prc";
const PROVINCE_CODE = "52";
const DAYS = 90;
const PAGE_SIZE = 10;
const MAX_PAGES = 3;
const DETAIL_TENDER_LIMIT = 25;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/tenders.json");

function startOfWindow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - DAYS);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function searchPayload(keyword, pageNumber) {
  return [{
    pageSize: PAGE_SIZE,
    pageNumber,
    sortBy: "publicDate",
    sortType: "DESC",
    query: [{
      index: "es-contractor-selection",
      keyWord: keyword,
      matchType: "exact",
      matchFields: ["notifyNo", "bidName", "investorName"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["es-notify-contractor"] },
        { fieldName: "locations.provCode", searchType: "in", fieldValues: [PROVINCE_CODE] },
        { fieldName: "publicDate", searchType: "range", from: startOfWindow(), to: new Date().toISOString() },
      ],
    }],
  }];
}

async function postJson(url, body, timeoutMs = 20_000) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "thau-y-te-gia-lai-public-data/1.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} phản hồi HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim().startsWith("{")) throw new Error(`${url} không trả về JSON`);
  return JSON.parse(text);
}

async function fetchKeyword(keyword) {
  const first = await postJson(SEARCH_URL, searchPayload(keyword, 0));
  const totalPages = Math.min(first.page?.totalPages || 1, MAX_PAGES);
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => postJson(SEARCH_URL, searchPayload(keyword, index + 1))),
  );
  return [first, ...remaining].flatMap((payload) => payload.page?.content || []);
}

function isMedical(item) {
  const title = item.bidName?.join(" ") || "";
  return /(thi[eế]t b[iị]|v[aậ]t t[uư]|d[uụ]ng c[uụ]|x[eé]t nghi[eệ]m|h[oó]a ch[aấ]t|ho[aá] ch[aấ]t|sinh ph[aẩ]m|m[aá]y\s|h[eệ] th[oố]ng|ct scanner|mri|x-?quang|n[oộ]i soi|si[eê]u [aâ]m|ch[aẩ]n [dđ]o[aá]n|ph[oò]ng m[oổ]|t[aạ]o nh[iị]p|thu[oố]c|d[uư][oợ]c|oxy|y t[eế]|[dđ]inh|n[eẹ]p|v[ií]t|kh[oớ]p|ph[aẫ]u thu[aậ]t)/i.test(title);
}

function categoryOf(name) {
  if (/(b[aả]o tr[iì]|b[aả]o d[uư][oỡ]ng|s[uử]a ch[uữ]a|hi[eệ]u chu[aẩ]n)/i.test(name)) return "Dịch vụ kỹ thuật";
  if (/(thu[oố]c|d[uư][oợ]c ph[aẩ]m)/i.test(name)) return "Dược phẩm";
  if (/(v[aậ]t t[uư]|h[oó]a ch[aấ]t|ho[aá] ch[aấ]t|sinh ph[aẩ]m|d[uụ]ng c[uụ]|[dđ]inh|n[eẹ]p|v[ií]t)/i.test(name)) return "Vật tư & hóa chất";
  return "Thiết bị y tế";
}

function statusOf(item) {
  if (item.status === "CANCEL_BID") return "cancelled";
  const remaining = new Date(item.bidCloseDate || 0).getTime() - Date.now();
  if (remaining <= 0) return "closed";
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
    techReqId: item.techReqId || "",
    bidPreNotifyResultId: item.bidPreNotifyResultId || "",
    bidPreOpenId: item.bidPreOpenId || "",
    processApply: item.processApply || "LDT",
    bidMode: item.bidMode || "",
    notifyNo: item.notifyNo || "",
    planNo: item.planNo || "",
    pno: item.pno || "",
    step: "tbmt",
    isInternet: String(item.isInternet ?? ""),
    caseKHKQ: String(item.caseKHKQ ?? ""),
    bidForm: item.bidForm || "",
  });
  return `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?${params}`;
}

function normalizeTender(item) {
  const name = (item.bidName?.join(" ") || "Gói thầu chưa có tên").replace(/\s+/g, " ").trim();
  return {
    id: item.notifyId || item.id || item.notifyNo,
    notifyNo: item.notifyNo || "—",
    name,
    investor: item.investorName || "Chưa công bố",
    location: item.locations?.map((location) => location.districtName || location.provName).filter(Boolean).join(", ") || "Tỉnh Gia Lai",
    closeDate: item.bidCloseDate || "",
    publicDate: item.publicDate || "",
    price: (item.bidPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    category: categoryOf(name),
    status: statusOf(item),
    sourceUrl: sourceUrl(item),
    winnerNames: [...new Set((item.contractorName || []).filter(Boolean))],
    winningPrice: (item.bidWinningPrice || []).reduce((sum, value) => sum + (Number(value) || 0), 0),
    decisionDate: item.decisionDate || "",
    resultPublishedDate: item.publicDateKqlcnt || "",
    hasResult: Boolean(item.inputResultId || item.contractorName?.length),
  };
}

function pricingQuery(notifyNo, tab) {
  return {
    pageSize: 20,
    pageNumber: 0,
    query: [{
      index: "es-smart-pricing",
      keyWord: "",
      keyWordNotMatch: "",
      matchType: "all-1",
      matchFields: tab === "HANG_HOA" ? ["danh_muc_hang_hoa"] : ["ten_thiet_bi"],
      filters: [
        { fieldName: "type", searchType: "in", fieldValues: ["HANG_HOA"] },
        { fieldName: "tab", searchType: "in", fieldValues: [tab] },
        { fieldName: "ma_tbmt", searchType: "in", fieldValues: [notifyNo] },
      ],
    }],
  };
}

function normalizeEquipment(item) {
  return {
    id: item.id || crypto.randomUUID(),
    name: item.tenThietBi || item.danhMucHangHoa || "Hàng hóa chưa có tên",
    model: item.kyMaHieu || "",
    brand: item.nhanHieu || "",
    manufacturer: item.hangSanXuat || "",
    origin: item.xuatXu || "",
    manufactureYear: item.namSanXuat || "",
    specification: (item.cauHinh || "").replace(/^\s*[\"']|[\"']\s*$/g, "").trim(),
    unit: item.donViTinh || "",
    quantity: Number(item.khoiLuongDouble) || 0,
    unitPrice: Number(item.donGia ?? item.donGiaDuThau) || 0,
    winnerNames: [...new Set((item.winningName || []).filter(Boolean))],
    decisionNo: item.soQuyetDinh || "",
    decisionDate: item.ngayBanHanhQuyetDinh || "",
    resultPublishedDate: item.ngayDangTaiKqlcnt || "",
  };
}

async function fetchDetails(notifyNo) {
  const payload = await postJson(WINNING_PRICE_URL, [pricingQuery(notifyNo, "THIET_BI_VAT_TU_Y_TE"), pricingQuery(notifyNo, "HANG_HOA")]);
  const items = (payload.page?.content || []).map(normalizeEquipment);
  return { total: payload.page?.totalElements || items.length, items, fetchedAt: new Date().toISOString() };
}

async function previousData() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return { tenders: [], detailsByNotifyNo: {} };
  }
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

async function main() {
  const previous = await previousData();
  const searches = await Promise.allSettled(["y tế", "bệnh viện", "xét nghiệm"].map(fetchKeyword));
  const successful = searches.filter((result) => result.status === "fulfilled");
  if (!successful.length) throw new Error(searches.map((result) => result.reason?.message).filter(Boolean).join("; ") || "Không tải được dữ liệu");

  const unique = new Map();
  successful.flatMap((result) => result.value).filter(isMedical).forEach((item) => {
    const key = item.notifyId || item.id || item.notifyNo;
    if (key) unique.set(key, item);
  });
  const tenders = [...unique.values()].map(normalizeTender).sort((a, b) => new Date(b.publicDate) - new Date(a.publicDate));
  if (!tenders.length && previous.tenders?.length) throw new Error("Nguồn trả về 0 gói; giữ nguyên bản dữ liệu gần nhất");

  const detailsByNotifyNo = { ...(previous.detailsByNotifyNo || {}) };
  const awarded = tenders.filter((tender) => tender.hasResult).slice(0, DETAIL_TENDER_LIMIT);
  await mapLimited(awarded, 3, async (tender) => {
    try {
      detailsByNotifyNo[tender.notifyNo] = await fetchDetails(tender.notifyNo);
      process.stdout.write(`Chi tiết ${tender.notifyNo}: ${detailsByNotifyNo[tender.notifyNo].items.length} mặt hàng\n`);
    } catch (error) {
      process.stderr.write(`Bỏ qua chi tiết ${tender.notifyNo}: ${error.message}\n`);
    }
  });

  const activeNumbers = new Set(tenders.map((tender) => tender.notifyNo));
  for (const notifyNo of Object.keys(detailsByNotifyNo)) {
    if (!activeNumbers.has(notifyNo)) delete detailsByNotifyNo[notifyNo];
  }
  const payload = {
    tenders,
    detailsByNotifyNo,
    fetchedAt: new Date().toISOString(),
    source: "muasamcong-public-api",
    provinceCode: PROVINCE_CODE,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Đã lưu ${tenders.length} gói thầu vào ${outputPath}\n`);
}

await main();

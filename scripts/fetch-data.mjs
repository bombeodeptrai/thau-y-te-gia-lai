import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEARCH_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-home/services/smart/search";
const WINNING_PRICE_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-winning-bid-data/services/smart/search_prc";
const PROVINCE_CODE = "52";
const DAYS = 365;
const INCREMENTAL_DAYS = 14;
const STATUS_SCHEMA_VERSION = 2;
const WINDOW_DAYS = 7;
const PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 20;
const SEARCH_KEYWORDS = [
  "thiết bị y tế",
  "vật tư tiêu hao",
  "vật tư y tế",
  "dụng cụ y tế",
  "vật tư phẫu thuật",
  "hóa chất xét nghiệm",
  "sinh phẩm chẩn đoán",
  "chẩn đoán in vitro",
  "máy xét nghiệm",
  "máy siêu âm",
  "máy thở",
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/tenders.json");
const detailsDir = resolve(root, "data/details");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function dateWindows(days = DAYS) {
  const now = new Date();
  const windows = [];
  for (let offset = 0; offset < days; offset += WINDOW_DAYS) {
    const to = new Date(now.getTime() - offset * 86_400_000);
    const from = new Date(now.getTime() - Math.min(offset + WINDOW_DAYS, days) * 86_400_000);
    windows.push({ from: from.toISOString(), to: to.toISOString() });
  }
  return windows;
}

function searchPayload(pageNumber, from, to) {
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
        { fieldName: "locations.provCode", searchType: "in", fieldValues: [PROVINCE_CODE] },
        { fieldName: "publicDate", searchType: "range", from, to },
      ],
    }],
  }];
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function postJson(url, body, timeoutMs = 25_000) {
  let lastError;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "Content-Type": "application/json",
          Origin: "https://muasamcong.mpi.gov.vn",
          Referer: "https://muasamcong.mpi.gov.vn/",
          "User-Agent": "thau-y-te-gia-lai-public-data/2.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${url} phản hồi HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim().startsWith("{")) {
        throw new Error(`${url} không trả về JSON (lần ${attempt}/${maxAttempts})`);
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await delay(attempt * 2_000);
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

async function fetchWindow(window, windowIndex, totalWindows) {
  const first = await postJson(SEARCH_URL, searchPayload(0, window.from, window.to));
  const totalPages = Math.max(1, Number(first.page?.totalPages) || 1);
  const pageNumbers = Array.from({ length: totalPages - 1 }, (_, index) => index + 1);
  const remaining = await mapLimited(pageNumbers, 2, (pageNumber) =>
    postJson(SEARCH_URL, searchPayload(pageNumber, window.from, window.to)),
  );
  const items = [first, ...remaining].flatMap((payload) => payload.page?.content || []);
  process.stdout.write(
    `Khoảng ${windowIndex + 1}/${totalWindows}: ${items.length} bản ghi, ${totalPages} trang\n`,
  );
  return items;
}

function isMedical(item) {
  const originalTitle = String(item.bidName?.join(" ") || "").toLocaleLowerCase("vi-VN");
  const title = normalizeText(originalTitle);
  const investor = normalizeText(item.investorName);
  const excludedTerms = [
    // Xây dựng, vận hành và mua sắm hành chính.
    "xay lap", "xay dung", "cai tao", "sua chua nha", "suat an", "thuc pham", "bao ve",
    "ve sinh cong nghiep", "van phong pham", "xang dau", "cay xanh", "rac thai", "chat thai",
    "in an", "bien ten", "trang phuc", "bao ho lao dong", "giay bao ho", "quan ao", "drap",
    "boi duong doc hai", "boi duong hien vat", "hang hoa thuc hien che do", "phu cap doc hai",
    "ban, ghe", "ban ghe", "tu dung ho so", "xe ban tai", "xe day sieu thi", "bao hiem",
    "binh ac quy", "vat tu dien", "vat tu nuoc", "dien, nuoc", "dien nuoc",
    "dich vu sua chua", "sua chua", "dich vu bao tri", "bao tri, bao duong",
    "dich vu kiem dinh", "kiem dinh, hieu chuan", "kiem dinh va hieu chuan",
    // Công nghệ thông tin và thiết bị hạ tầng không phải thiết bị y tế.
    "may tinh", "may in", "tin hoc", "cong nghe thong tin", "may chu", "thiet bi tuong lua",
    "bao mat du lieu", "luu tru san", "thang may", "may phat dien", "dieu hoa khong khi",
    // Nông nghiệp, cao su và thú y.
    "phan bon", "thuoc bvtv", "bao ve thuc vat", "vuon cay", "cay cao su", "cay ca phe",
    "kich thich mu", "phun thuoc", "thuoc phong tri", "thuoc phun tri", "benh dong vat",
    "trau, bo", "cho, meo", "gia cam", "lo mom long mong", "viem da noi cuc",
    "phuc vu che bien", "san xuat phan vi sinh",
  ];
  if (excludedTerms.some((term) => title.includes(term))) return false;

  // Chỉ các cụm từ tự thân xác định rõ thiết bị/vật tư y tế mới được giữ lại.
  const explicitMedicalTerms = [
    ...SEARCH_KEYWORDS,
    "trang thiết bị y tế", "y cụ", "y dụng cụ", "hóa chất y tế", "hoá chất y tế",
    "sinh phẩm y tế", "sinh phẩm xét nghiệm", "khí y tế", "oxy y tế",
    "hóa chất khử khuẩn", "hoá chất khử khuẩn", "hóa chất định nhóm máu",
    "hoá chất định nhóm máu", "vật tư xét nghiệm", "vật tư nha khoa",
  ];
  if (explicitMedicalTerms.some((term) => originalTitle.includes(term))) return true;

  // Tên riêng của máy móc, vật tư và sinh phẩm chuyên môn.
  const medicalProductTerms = [
    "máy thở", "máy siêu âm", "đầu dò siêu âm", "máy điện tim", "máy theo dõi bệnh nhân",
    "monitor bệnh nhân", "máy hút dịch", "bơm tiêm điện", "máy tim phổi", "máy lọc máu",
    "máy chạy thận", "máy xét nghiệm", "máy phân tích huyết học", "máy sinh hóa",
    "máy sinh hoá", "máy chụp", "x-quang", "x quang", "ct scanner", "mri",
    "máy hấp nhiệt độ thấp", "máy tiệt khuẩn", "máy tập cơ sàn chậu", "micropipet",
    "tủ bảo quản máu", "bình nitơ lưu trữ mẫu", "lọc nước ro cho phòng xét nghiệm",
    "dụng cụ phẫu thuật", "dao phẫu thuật", "gạc phẫu thuật", "găng tay phẫu thuật",
    "bơm tiêm", "kim tiêm", "kim nha khoa", "kim châm cứu", "dây truyền dịch",
    "truyền máu", "catheter", "stent", "implant", "đinh, nẹp, vít", "đinh nẹp vít",
    "nẹp chấn thương", "khớp gối", "khớp háng", "nội soi", "dây dao siêu âm",
    "bộ bơm cản quang", "máy bơm cản quang", "ampu bóp bóng", "túi đựng oxy",
    "bông y tế", "găng tay y tế", "khẩu trang y tế", "test nhanh chẩn đoán",
    "kit test", "dịch nhầy dùng trong phẫu thuật mắt", "chẩn thương chỉnh hình",
    "chấn thương chỉnh hình", "lọc máu liên tục", "chạy thận nhân tạo",
    "vật tư thận niệu", "vật tư tim mạch can thiệp", "vật tư can thiệp mạch não",
    "áo, khăn phẫu thuật", "que đè lưỡi", "dây garo",
  ];
  if (medicalProductTerms.some((term) => originalTitle.includes(term))) return true;

  // Hóa chất/sinh phẩm chỉ được giữ khi gắn với xét nghiệm hoặc chẩn đoán y khoa.
  const laboratoryTerms = [
    "xét nghiệm", "chẩn đoán", "in vitro", "huyết học", "sinh hóa", "sinh hoá",
    "vi sinh", "bệnh phẩm", "định nhóm máu", "máy huyết học", "máy sinh hóa", "máy sinh hoá",
  ];
  const laboratorySupplies = ["hóa chất", "hoá chất", "sinh phẩm", "vật tư", "chủng vi sinh"];
  if (laboratoryTerms.some((term) => originalTitle.includes(term))
    && laboratorySupplies.some((term) => originalTitle.includes(term))) return true;

  // Tiêu đề chung chỉ được nhận khi vừa có vật tư/hóa chất, vừa có ngữ cảnh khám chữa bệnh,
  // và chủ đầu tư rõ ràng là cơ sở y tế. Không dùng tên chủ đầu tư làm điều kiện duy nhất.
  const medicalInvestors = [
    "so y te", "benh vien", "trung tam y te", "tram y te", "trung tam kiem soat benh tat",
    "cdc", "phong kham", "benh xa", "y khoa", "y duoc", "da khoa", "chuyen khoa",
    "trung tam phap y", "trung tam kiem nghiem",
  ];
  const genericSupplyTerms = ["vat tu", "hoa chat", "sinh pham", "dung cu"];
  const clinicalTerms = ["kham chua benh", "kham benh", "chua benh", "dieu tri", "phong mo"];
  return medicalInvestors.some((term) => investor.includes(term))
    && genericSupplyTerms.some((term) => title.includes(term))
    && clinicalTerms.some((term) => title.includes(term));
}

function categoryOf(name) {
  const original = String(name || "").toLocaleLowerCase("vi-VN");
  const normalized = normalizeText(original);
  const supplyTerms = [
    "vật tư", "hóa chất", "hoá chất", "sinh phẩm", "dụng cụ", "đinh", "nẹp", "vít",
    "gạc", "găng tay", "bộ bơm tiêm", "bơm tiêm các loại", "dây nối bơm tiêm", "kim ",
    "dây truyền", "stent", "khớp", "test nhanh", "dao phẫu thuật", "dây garo",
    "áo, khăn phẫu thuật", "bông y tế", "khẩu trang", "hơi oxy y tế", "oxy y tế",
    "dịch nhầy", "chuẩn đối chiếu", "chủng vi sinh", "tay dao", "dây dao", "ampu bóp bóng",
  ];
  if (supplyTerms.some((term) => original.includes(term))) return "Vật tư & hóa chất";
  if (original === normalized && [
    "vat tu", "hoa chat", "sinh pham", "dung cu", "dinh", "nep", "vit", "gac",
    "gang tay", "bo bom tiem", "bom tiem cac loai", "day noi bom tiem", "kim ",
    "day truyen", "stent", "khop", "test nhanh", "dao phau thuat", "day garo",
    "ao, khan phau thuat", "bong y te", "khau trang", "hoi oxy y te", "oxy y te",
    "dich nhay", "chuan doi chieu", "chung vi sinh", "tay dao", "day dao", "ampu bop bong",
  ].some((term) => normalized.includes(term))) return "Vật tư & hóa chất";
  return "Thiết bị y tế";
}

function statusOf(item) {
  const sourceStatus = String(item.sourceStatus || item.status || "").toUpperCase();
  const notifyStatus = String(item.statusForNotify || "").toUpperCase();
  const hasResult = Boolean(
    item.hasResult || item.inputResultId || item.contractorName?.length || item.winnerNames?.length,
  );
  if (sourceStatus === "CANCEL_BID" || ["DHT", "DHTBMT"].includes(notifyStatus)) return "cancelled";
  if (hasResult || notifyStatus === "CNTTT") return "awarded";
  if (notifyStatus === "DXT" || sourceStatus === "OPEN_BID") return "evaluating";
  const closeDate = item.bidCloseDate || item.closeDate || 0;
  const remaining = new Date(closeDate).getTime() - Date.now();
  const rawBidderCount = item.numBidderJoin ?? item.bidderCount;
  if (remaining <= 0 && rawBidderCount !== null && rawBidderCount !== undefined
    && Number(rawBidderCount) === 0) return "no_bidder";
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
  const bidderCount = item.numBidderJoin === null || item.numBidderJoin === undefined
    ? null
    : Number(item.numBidderJoin);
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

function pricingQuery(notifyNo, tab, pageNumber) {
  return {
    pageSize: DETAIL_PAGE_SIZE,
    pageNumber,
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

async function fetchDetailPage(notifyNo, pageNumber) {
  return postJson(
    WINNING_PRICE_URL,
    [pricingQuery(notifyNo, "THIET_BI_VAT_TU_Y_TE", pageNumber), pricingQuery(notifyNo, "HANG_HOA", pageNumber)],
    30_000,
  );
}

async function fetchDetails(notifyNo) {
  const first = await fetchDetailPage(notifyNo, 0);
  const total = Number(first.page?.totalElements) || (first.page?.content || []).length;
  const totalPages = Number(first.page?.totalPages) || Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));
  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 1);
  const remaining = await mapLimited(pageNumbers, 2, (pageNumber) => fetchDetailPage(notifyNo, pageNumber));
  const unique = new Map();
  [first, ...remaining].flatMap((payload) => payload.page?.content || []).forEach((item) => {
    const key = item.id || `${item.tenThietBi || item.danhMucHangHoa}-${item.donGia || item.donGiaDuThau}`;
    unique.set(key, item);
  });
  const items = [...unique.values()].map(normalizeEquipment);
  return { total: Math.max(total, items.length), items, fetchedAt: new Date().toISOString() };
}

async function previousData() {
  try {
    const manifest = JSON.parse(await readFile(outputPath, "utf8"));
    const detailsByNotifyNo = { ...(manifest.detailsByNotifyNo || {}) };
    try {
      const files = (await readdir(detailsDir)).filter((name) => /^IB\d{10}\.json$/.test(name));
      await mapLimited(files, 10, async (name) => {
        detailsByNotifyNo[name.replace(/\.json$/, "")] = JSON.parse(await readFile(resolve(detailsDir, name), "utf8"));
      });
    } catch {
      // Bản dữ liệu cũ có thể chưa được tách thành từng tệp chi tiết.
    }
    return { ...manifest, detailsByNotifyNo };
  } catch {
    return { tenders: [], detailsByNotifyNo: {} };
  }
}

function shouldRefreshDetails(tender, cached) {
  if (!cached) return true;
  const fetchedAt = new Date(cached.fetchedAt || 0).getTime();
  if (!fetchedAt) return true;
  const resultPublishedAt = new Date(tender.resultPublishedDate || 0).getTime();
  if (resultPublishedAt > fetchedAt) return true;
  const refreshAfter = cached.items?.length ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return Date.now() - fetchedAt >= refreshAfter;
}

async function main() {
  const previous = await previousData();
  const previousDays = Number(previous.collection?.days) || 0;
  const previousStatusSchema = Number(previous.collection?.statusSchemaVersion) || 0;
  const fullRefresh = !previous.tenders?.length
    || previousDays < DAYS
    || previousStatusSchema < STATUS_SCHEMA_VERSION;
  const scanDays = fullRefresh ? DAYS : INCREMENTAL_DAYS;
  const windows = dateWindows(scanDays);
  process.stdout.write(fullRefresh
    ? `Quét bù toàn bộ ${DAYS} ngày lần đầu\n`
    : `Cập nhật tăng dần ${INCREMENTAL_DAYS} ngày gần nhất\n`);
  const windowConcurrency = fullRefresh ? 1 : 2;
  const allItems = (await mapLimited(windows, windowConcurrency, (window, index) =>
    fetchWindow(window, index, windows.length))).flat();
  const allUnique = new Map();
  allItems.forEach((item) => {
    const key = item.notifyId || item.id || item.notifyNo;
    if (key) allUnique.set(key, item);
  });

  const medicalUnique = new Map();
  [...allUnique.values()].filter(isMedical).forEach((item) => {
    const key = item.notifyId || item.id || item.notifyNo;
    if (key) medicalUnique.set(key, item);
  });
  const freshTenders = [...medicalUnique.values()].map(normalizeTender);
  const now = Date.now();
  const cutoff = now - DAYS * 86_400_000;
  const refreshedFrom = now - scanDays * 86_400_000;
  const historicalTenders = fullRefresh ? [] : (previous.tenders || [])
    .filter((tender) => {
      const publishedAt = new Date(tender.publicDate || 0).getTime();
      return publishedAt >= cutoff && publishedAt < refreshedFrom;
    })
    .map((tender) => ({
      ...tender,
      category: categoryOf(tender.name),
      status: statusOf(tender),
    }));
  const mergedTenders = new Map();
  [...historicalTenders, ...freshTenders].forEach((tender) => {
    const key = tender.notifyNo || tender.id;
    if (key) mergedTenders.set(key, tender);
  });
  const tenders = [...mergedTenders.values()]
    .sort((a, b) => new Date(b.publicDate) - new Date(a.publicDate));
  if (!tenders.length && previous.tenders?.length) throw new Error("Nguồn trả về 0 gói; giữ nguyên bản dữ liệu gần nhất");
  process.stdout.write(
    `Đã rà ${allUnique.size} gói trong ${scanDays} ngày cập nhật, đang lưu ${tenders.length} gói y tế/${DAYS} ngày\n`,
  );

  const detailsByNotifyNo = { ...(previous.detailsByNotifyNo || {}) };
  const awarded = tenders.filter((tender) => tender.hasResult);
  const detailsToRefresh = awarded.filter((tender) => shouldRefreshDetails(tender, detailsByNotifyNo[tender.notifyNo]));
  process.stdout.write(`Chi tiết: làm mới ${detailsToRefresh.length}/${awarded.length} gói đã có kết quả\n`);
  await mapLimited(detailsToRefresh, 3, async (tender) => {
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
    fetchedAt: new Date().toISOString(),
    source: "muasamcong-public-api",
    provinceCode: PROVINCE_CODE,
    detailTenderCount: Object.keys(detailsByNotifyNo).length,
    collection: {
      days: DAYS,
      strategy: "incremental-province-date-windows",
      refreshDays: INCREMENTAL_DAYS,
      statusSchemaVersion: STATUS_SCHEMA_VERSION,
      lastScanDays: scanDays,
      lastScanTenderCount: allUnique.size,
      scannedTenderCount: fullRefresh
        ? allUnique.size
        : (Number(previous.collection?.scannedTenderCount) || allUnique.size),
      keywords: SEARCH_KEYWORDS,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(detailsDir, { recursive: true, force: true });
  await mkdir(detailsDir, { recursive: true });
  await mapLimited(Object.entries(detailsByNotifyNo), 10, ([notifyNo, detail]) =>
    writeFile(resolve(detailsDir, `${notifyNo}.json`), `${JSON.stringify(detail, null, 2)}\n`),
  );
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Đã lưu ${tenders.length} gói thầu vào ${outputPath}\n`);
}

await main();

const DATA_URL = "./data/tenders.json";
const EQUIPMENT_SEARCH_URL = "./data/equipment-search.json";
const SAVED_KEY = "gia-lai-medical-tender-watchlist";
const TENDERS_PER_PAGE = 10;

const state = {
  tenders: [],
  equipmentByNotifyNo: new Map(),
  searchMatchesByNotifyNo: new Map(),
  detailsByNotifyNo: {},
  fetchedAt: "",
  query: "",
  category: "all",
  days: 1095,
  status: "all",
  investor: "",
  page: 1,
  expandedId: null,
  detailLoading: null,
  detailErrors: {},
  saved: loadSaved(),
};

const statusLabels = {
  open: "Đang mở",
  urgent: "Sắp đóng",
  evaluating: "Đang xét thầu",
  closed: "Đã đóng – chưa có KQ",
  no_bidder: "Không có nhà thầu",
  cancelled: "Đã hủy/không lựa chọn",
  awarded: "Đã có kết quả",
};

const elements = {
  form: document.querySelector("#search-form"),
  keyword: document.querySelector("#keyword"),
  category: document.querySelector("#category"),
  days: document.querySelector("#days"),
  statusFilter: document.querySelector("#status-filter"),
  list: document.querySelector("#tender-list"),
  pagination: document.querySelector("#pagination"),
  resultCount: document.querySelector("#result-count"),
  refresh: document.querySelector("#refresh-button"),
  dataState: document.querySelector("#data-state"),
  sourceLabel: document.querySelector("#source-label"),
  updatedLabel: document.querySelector("#updated-label"),
  warning: document.querySelector("#source-warning"),
  metricTotal: document.querySelector("#metric-total"),
  metricOpen: document.querySelector("#metric-open"),
  metricUrgent: document.querySelector("#metric-urgent"),
  metricValue: document.querySelector("#metric-value"),
  openPercent: document.querySelector("#open-percent"),
  averageValue: document.querySelector("#average-value"),
  investorRanking: document.querySelector("#investor-ranking"),
  savedCount: document.querySelector("#saved-count"),
  savedList: document.querySelector("#saved-list"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bx\s+quang\b/g, "xquang")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(value) {
  return normalizeSearch(value).split(" ").filter(Boolean);
}

function textIncludesTerm(text, term) {
  return term.length <= 2
    ? ` ${text} `.includes(` ${term} `)
    : text.includes(term);
}

function orderedTermsWithin(text, terms, maxGap = 2) {
  const tokens = text.split(" ").filter(Boolean);
  let previousIndex = -1;
  for (const term of terms) {
    const start = previousIndex + 1;
    const end = previousIndex < 0 ? tokens.length : Math.min(tokens.length, start + maxGap + 1);
    let foundIndex = -1;
    for (let index = start; index < end; index += 1) {
      const matches = term.length <= 2 ? tokens[index] === term : tokens[index].includes(term);
      if (matches) {
        foundIndex = index;
        break;
      }
    }
    if (foundIndex < 0) return false;
    previousIndex = foundIndex;
  }
  return true;
}

function searchTextMatches(text, terms) {
  if (!terms.length) return true;
  if (terms[0] === "may" && terms.length > 1) return orderedTermsWithin(text, terms);
  return terms.every((term) => textIncludesTerm(text, term));
}

function equipmentSearchText(item) {
  return normalizeSearch([
    item.name,
    item.model,
    item.brand,
    item.manufacturer,
    item.origin,
    item.lotNo,
    item.lotName,
  ].filter(Boolean).join(" "));
}

function indexEquipment(items) {
  const byNotifyNo = new Map();
  for (const item of items) {
    const notifyNo = String(item.notifyNo || "").trim();
    if (!notifyNo) continue;
    const indexedItem = { ...item, searchText: equipmentSearchText(item) };
    if (!byNotifyNo.has(notifyNo)) byNotifyNo.set(notifyNo, []);
    byNotifyNo.get(notifyNo).push(indexedItem);
  }
  return byNotifyNo;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function tenderSearchText(tender) {
  return normalizeSearch([
    tender.name,
    tender.investor,
    tender.notifyNo,
    tender.location,
    ...asList(tender.winnerNames),
    ...asList(tender.loserNames),
    ...asList(tender.participantNames),
  ].filter(Boolean).join(" "));
}

function tenderModelSearchTexts(tender) {
  return [
    ...asList(tender.winningModels),
    ...asList(tender.losingModels),
  ].map(normalizeSearch).filter(Boolean);
}

function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "muasamcong.mpi.gov.vn"
      ? escapeHtml(url.href)
      : "https://muasamcong.mpi.gov.vn/";
  } catch {
    return "https://muasamcong.mpi.gov.vn/";
  }
}

function loadSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    localStorage.removeItem(SAVED_KEY);
    return [];
  }
}

function formatMoney(value, compact = true) {
  const amount = Number(value) || 0;
  if (!amount) return "Chưa công bố";
  if (compact && amount >= 1_000_000_000) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(amount / 1_000_000_000)} tỷ`;
  }
  if (compact && amount >= 1_000_000) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(amount / 1_000_000)} triệu`;
  }
  return `${new Intl.NumberFormat("vi-VN").format(amount)} đ`;
}

function formatDate(value, withTime = false) {
  if (!value) return "Chưa công bố";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa công bố";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

// ==========================================
// CẬP NHẬT: XUẤT FILE EXCEL (.xlsx)
// Đã thay thế chức năng tải file CSV bằng thư viện ExcelJS
// File Excel xuất ra chỉ gồm 4 cột: Số lượng máy, Tên loại máy, Thông số kỹ thuật, Đơn vị sử dụng.
// Có định dạng kẻ ô, font Times New Roman, wrap text và cố định hàng tiêu đề.
// ==========================================
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js";
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => reject(new Error("Không tải được thư viện ExcelJS"));
    document.head.appendChild(script);
  });
}

async function downloadTechnicalXlsx(tender, button) {
  const items = state.detailsByNotifyNo[tender.notifyNo]?.technicalRequirements?.items || [];
  if (!items.length) return;
  
  const originalText = button.textContent;
  button.textContent = "Đang tạo file...";
  button.disabled = true;

  try {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Thong_so_ky_thuat");
    
    // Cố định hàng tiêu đề
    sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    
    // Khai báo cột
    sheet.columns = [
      { header: "Số lượng máy", key: "quantity", width: 15 },
      { header: "Tên loại máy", key: "name", width: 30 },
      { header: "Thông số kỹ thuật", key: "specification", width: 70 },
      { header: "Đơn vị sử dụng", key: "place", width: 30 }
    ];
    
    // Bật Auto Filter cho toàn bộ vùng
    sheet.autoFilter = 'A1:D1';
    
    const borderStyle = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
    const fontStyle = { name: 'Times New Roman', size: 12 };

    // Header style
    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Times New Roman', size: 12, bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.border = borderStyle;
    });
    
    // Đổ dữ liệu toàn bộ item (không giới hạn 40 dòng)
    items.forEach(item => {
      const row = sheet.addRow({
        quantity: item.quantity || "",
        name: item.name || "",
        specification: item.specification || "",
        place: item.projectPlace || tender.investor || ""
      });
      row.eachCell((cell, colNumber) => {
        cell.font = fontStyle;
        cell.border = borderStyle;
        cell.alignment = colNumber === 3 
          ? { wrapText: true, vertical: 'top' } 
          : { vertical: 'top' };
      });
    });
    
    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${tender.notifyNo}-thong-so-ky-thuat.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 100);
  } catch (error) {
    alert("Có lỗi xảy ra khi tạo file Excel. Vui lòng thử lại.");
    console.error(error);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

function withinDays(tender) {
  const published = new Date(tender.publicDate).getTime();
  if (!published) return true;
  return published >= Date.now() - state.days * 86_400_000;
}

function periodTenders() {
  return state.tenders.filter(
    (tender) => withinDays(tender) && (state.category === "all" || tender.category === state.category),
  );
}

function filteredTenders() {
  const terms = searchTerms(state.query);
  state.searchMatchesByNotifyNo.clear();
  return periodTenders().filter((tender) => {
    const tenderText = tenderSearchText(tender);
    const equipment = state.equipmentByNotifyNo.get(tender.notifyNo) || [];
    const equipmentMatches = terms.length
      ? equipment.filter((item) => searchTextMatches(item.searchText, terms))
      : [];
    const modelMatches = terms.length
      && tenderModelSearchTexts(tender).some((modelText) => searchTextMatches(modelText, terms));
    const queryMatches = !terms.length
      || searchTextMatches(tenderText, terms)
      || modelMatches
      || equipmentMatches.length > 0;
    const statusMatches =
      state.status === "all" ||
      (state.status === "awarded"
        ? Boolean(tender.hasResult || tender.winnerNames?.length)
        : tender.status === state.status);
    const investorMatches = !state.investor || tender.investor === state.investor;
    const matches = queryMatches && statusMatches && investorMatches;
    if (matches && equipmentMatches.length) {
      state.searchMatchesByNotifyNo.set(tender.notifyNo, equipmentMatches);
    }
    return matches;
  });
}

function savedTenderMarkup(tender) {
  return `<article class="saved-tender">
    <div><span>${escapeHtml(tender.notifyNo)}</span><strong>${escapeHtml(tender.name)}</strong><small>${escapeHtml(tender.investor)} · ${escapeHtml(statusLabels[tender.status] || tender.status)}</small></div>
    <button type="button" data-saved-open="${escapeHtml(tender.id)}">Mở gói thầu <span>→</span></button>
  </article>`;
}

function renderSavedList() {
  const savedTenders = state.saved
    .map((id) => state.tenders.find((tender) => String(tender.id) === id))
    .filter(Boolean);
  elements.savedCount.textContent = String(savedTenders.length);
  elements.savedList.innerHTML = savedTenders.length
    ? savedTenders.map(savedTenderMarkup).join("")
    : '<div class="saved-empty">Chưa có gói thầu nào được lưu. Bấm dấu ☆ tại một gói để thêm vào đây.</div>';
}

function renderMetrics(tenders = periodTenders()) {
  const open = tenders.filter((tender) => tender.status === "open" || tender.status === "urgent").length;
  const urgent = tenders.filter((tender) => tender.status === "urgent").length;
  const totalValue = tenders.reduce((sum, tender) => sum + (Number(tender.price) || 0), 0);
  elements.metricTotal.textContent = String(tenders.length);
  elements.metricOpen.textContent = String(open);
  elements.metricUrgent.textContent = String(urgent);
  elements.metricValue.textContent = formatMoney(totalValue);
  elements.openPercent.textContent = `${Math.round((open / Math.max(tenders.length, 1)) * 100)}%`;
  elements.averageValue.textContent = formatMoney(totalValue / Math.max(tenders.length, 1));

  const investors = new Map();
  for (const tender of tenders) {
    investors.set(tender.investor, (investors.get(tender.investor) || 0) + 1);
  }
  elements.investorRanking.innerHTML = [...investors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count], index) => `<button type="button" data-investor="${escapeHtml(name)}" class="${state.investor === name ? "selected" : ""}" aria-pressed="${state.investor === name}"><span>${index + 1}</span><p>${escapeHtml(name)}</p><strong>${count}</strong></button>`)
    .join("");
  renderSavedList();
}

function bidderMarkup(detail, tender) {
  const bidders = detail?.bidders || [];
  if (!bidders.length) {
    const message = ["open", "urgent"].includes(tender.status)
      ? "Tên nhà thầu chỉ được công bố sau thời điểm mở thầu."
      : "Nguồn công khai chưa trả danh sách nhà thầu của gói này.";
    return `<div class="detail-notice">${escapeHtml(message)}</div>`;
  }

  const statusText = {
    participating: "Đang tham dự",
    won: "Trúng thầu",
    lost: "Không trúng",
  };
  const rows = bidders.map((bidder, index) => {
    const models = bidder.models?.length
      ? bidder.models.join("; ")
      : (bidder.status === "lost"
        ? "Nguồn công khai chưa công bố model của hồ sơ không trúng"
        : (bidder.status === "participating" ? "Chờ công bố sau khi có kết quả" : "Chưa công bố"));
    const price = Number(bidder.winningPrice) || Number(bidder.finalPrice) || Number(bidder.bidPrice) || 0;
    const facts = [
      bidder.lotName ? `<span><b>Lô/phần:</b> ${escapeHtml(bidder.lotName)}</span>` : "",
      bidder.reason ? `<span><b>Lý do:</b> ${escapeHtml(bidder.reason)}</span>` : "",
      `<span><b>Model/loại máy:</b> ${escapeHtml(models)}</span>`,
    ].filter(Boolean).join("");
    return `<article class="bidder-item">
      <span class="equipment-index">${index + 1}</span>
      <div class="bidder-copy"><div class="bidder-title"><h4>${escapeHtml(bidder.contractorName)}</h4><span class="bidder-status ${escapeHtml(bidder.status)}">${escapeHtml(statusText[bidder.status] || bidder.status)}</span></div><div class="bidder-facts">${facts}</div></div>
      <div class="bidder-price"><strong title="${escapeHtml(formatMoney(price, false))}">${escapeHtml(formatMoney(price))}</strong><span>${bidder.status === "won" ? "Giá trúng" : "Giá dự thầu/sau giảm"}</span></div>
    </article>`;
  }).join("");
  const uniqueCount = new Set(bidders.map((bidder) => bidder.contractorCode || bidder.contractorName)).size;
  return `<div class="bidder-list"><div class="equipment-heading"><div><span>DANH SÁCH NHÀ THẦU</span><strong>${uniqueCount} nhà thầu được công bố</strong></div><span>Trạng thái và giá dự thầu</span></div>${rows}</div>`;
}

function equipmentMarkup(detail, tender) {
  if (!detail?.items?.length) {
    const message = ["open", "urgent"].includes(tender.status)
      ? "Model, hãng và đơn giá trúng thầu sẽ được bổ sung sau khi có kết quả lựa chọn nhà thầu. Danh mục đang mời được hiển thị phía trên."
      : tender.status === "evaluating"
      ? "Model và cấu hình chào thầu thường chỉ được nguồn công khai công bố sau khi có kết quả lựa chọn nhà thầu."
      : "Chưa có danh mục model/đơn giá chi tiết trong dữ liệu công khai. Kết quả có thể được bổ sung sau.";
    return `<div class="detail-notice">${escapeHtml(message)}</div>`;
  }

  const items = detail.items.map((item, index) => {
    const facts = [
      ["Model/Ký mã", item.model],
      ["Nhãn hiệu", item.brand],
      ["Hãng", item.manufacturer],
      ["Xuất xứ", item.origin],
      ["Năm SX", item.manufactureYear],
      ["Nhà thầu", item.winnerNames?.join("; ")],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `<span><b>${label}:</b> ${escapeHtml(value)}</span>`)
      .join("");
    const specification = item.specification
      ? `<details class="technical-spec"><summary>Hồ sơ/cấu hình kỹ thuật</summary><p>${escapeHtml(item.specification)}</p></details>`
      : "";
    const quantity = Number(item.quantity)
      ? `${new Intl.NumberFormat("vi-VN").format(item.quantity)} ${escapeHtml(item.unit || "")}`
      : escapeHtml(item.unit || "Đơn giá");
    return `<article class="equipment-item">
      <span class="equipment-index">${index + 1}</span>
      <div class="equipment-copy"><h4>${escapeHtml(item.name)}</h4><div class="equipment-facts">${facts}</div>${specification}</div>
      <div class="equipment-price"><strong title="${escapeHtml(formatMoney(item.unitPrice, false))}">${escapeHtml(formatMoney(item.unitPrice))}</strong><span>${quantity}</span></div>
    </article>`;
  }).join("");

  const limitNote = detail.total > detail.items.length
    ? `<p class="result-limit-note">Đang hiển thị ${detail.items.length}/${detail.total} mặt hàng. Xem nguồn chính thức để tra cứu toàn bộ.</p>`
    : "";
  return `<div class="equipment-list"><div class="equipment-heading"><div><span>HÀNG HÓA TRÚNG THẦU</span><strong>${detail.total} mặt hàng được công bố</strong></div><span>Đơn giá đã công bố</span></div>${items}${limitNote}</div>`;
}

function requirementsMarkup(detail, tender) {
  const requirements = detail?.requirements;
  const items = requirements?.items || [];
  if (!items.length) {
    if (!["open", "urgent", "evaluating"].includes(tender.status)) return "";
    const message = requirements?.disclosure === "temporarily-unavailable"
      ? "Tạm thời chưa tải được danh mục phần/lô mời thầu từ dữ liệu kế hoạch công khai. Hệ thống sẽ tự thử lại ở lần cập nhật tiếp theo."
      : "Nguồn kế hoạch chưa tách danh mục phần/lô cho gói này. Hãy mở E-HSMT chính thức để xem yêu cầu kỹ thuật chi tiết.";
    return `<div class="requirements-list"><div class="equipment-heading"><div><span>DANH MỤC MỜI THẦU</span><strong>Yêu cầu kỹ thuật và thiết bị được mời</strong></div><a class="official-document-link" href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer">Mở E-HSMT ↗</a></div><div class="detail-notice">${escapeHtml(message)}</div></div>`;
  }

  const rows = items.map((item, index) => {
    const facts = [
      item.lotNo ? `<span><b>Mã phần/lô:</b> ${escapeHtml(item.lotNo)}</span>` : "",
      Number(item.quantity) ? `<span><b>Khối lượng:</b> ${escapeHtml(new Intl.NumberFormat("vi-VN").format(item.quantity))} ${escapeHtml(item.unit || "")}</span>` : "",
    ].filter(Boolean).join("");
    const specification = item.specification
      ? `<details class="technical-spec"><summary>Yêu cầu/tiêu chuẩn kỹ thuật</summary><p>${escapeHtml(item.specification)}</p></details>`
      : "";
    return `<article class="equipment-item requirement-item">
      <span class="equipment-index">${index + 1}</span>
      <div class="equipment-copy"><h4>${escapeHtml(item.name)}</h4><div class="equipment-facts">${facts}</div>${specification}</div>
      <div class="equipment-price requirement-price"><strong title="${escapeHtml(formatMoney(item.plannedPrice, false))}">${escapeHtml(formatMoney(item.plannedPrice))}</strong><span>Giá kế hoạch phần/lô</span></div>
    </article>`;
  }).join("");
  const summary = requirements.summary
    ? `<p class="requirement-summary"><b>Phạm vi:</b> ${escapeHtml(requirements.summary)}</p>`
    : "";
  return `<div class="requirements-list"><div class="equipment-heading"><div><span>DANH MỤC MỜI THẦU</span><strong>${items.length} phần/lô từ kế hoạch công khai</strong></div><a class="official-document-link" href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer">Mở E-HSMT ↗</a></div>${summary}${rows}<p class="requirement-source-note">Tên phần/lô và giá kế hoạch lấy từ KHLCNT công khai. Cấu hình chi tiết chỉ hiển thị khi nguồn chính thức công bố không qua CAPTCHA; E-HSMT vẫn là tài liệu đối chiếu cuối cùng.</p></div>`;
}

function technicalRequirementsMarkup(detail, tender) {
  const technical = detail?.technicalRequirements;
  const items = technical?.items || [];
  if (!items.length) {
    if (!["open", "urgent", "evaluating"].includes(tender.status)) return "";
    const message = technical?.disclosure === "temporarily-unavailable"
      ? "Nguồn biểu mẫu e-HSMT đang tạm thời chưa phản hồi; hệ thống sẽ tự thử lại ở lần cập nhật tiếp theo."
      : "Gói này yêu cầu xác nhận reCAPTCHA trên cổng chính thức trước khi xem toàn bộ biểu mẫu e-HSMT. Website không tự giải CAPTCHA.";
    return `<div class="technical-requirements-list"><div class="equipment-heading"><div><span>THÔNG SỐ KỸ THUẬT E-HSMT</span><strong>Hồ sơ đầy đủ trên nguồn chính thức</strong></div><a class="official-document-link" href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer">Xác nhận và mở hồ sơ ↗</a></div><div class="detail-notice">${escapeHtml(message)}</div></div>`;
  }

  const visibleItems = items.slice(0, 40);
  const rows = visibleItems.map((item, index) => {
    const facts = [
      item.lotName ? `<span><b>Phần/lô:</b> ${escapeHtml(item.lotName)}</span>` : "",
      item.code ? `<span><b>Mã/Ký hiệu:</b> ${escapeHtml(item.code)}</span>` : "",
      item.brand ? `<span><b>Nhãn hiệu:</b> ${escapeHtml(item.brand)}</span>` : "",
      item.manufacturer ? `<span><b>Hãng:</b> ${escapeHtml(item.manufacturer)}</span>` : "",
      item.origin ? `<span><b>Xuất xứ:</b> ${escapeHtml(item.origin)}</span>` : "",
      item.manufactureYear ? `<span><b>Năm SX:</b> ${escapeHtml(item.manufactureYear)}</span>` : "",
    ].filter(Boolean).join("");
    const specification = item.specification
      ? `<details class="technical-spec"><summary>Xem thông số kỹ thuật</summary><p>${escapeHtml(item.specification)}</p></details>`
      : "";
    const otherRequirement = item.otherRequirement
      ? `<details class="technical-spec"><summary>Yêu cầu khác</summary><p>${escapeHtml(item.otherRequirement)}</p></details>`
      : "";
    const quantity = Number(item.quantity)
      ? `${new Intl.NumberFormat("vi-VN").format(item.quantity)} ${escapeHtml(item.unit || "")}`
      : escapeHtml(item.unit || "Chưa nêu");
    return `<article class="equipment-item technical-requirement-item">
      <span class="equipment-index">${index + 1}</span>
      <div class="equipment-copy"><h4>${escapeHtml(item.name)}</h4><div class="equipment-facts">${facts}</div>${specification}${otherRequirement}</div>
      <div class="equipment-price technical-quantity"><strong>${quantity}</strong><span>${escapeHtml(item.position ? `STT ${item.position}` : "Khối lượng mời thầu")}</span></div>
    </article>`;
  }).join("");
  const limitNote = items.length > visibleItems.length
    ? `<p class="result-limit-note">Đang hiển thị nhanh ${visibleItems.length}/${items.length} mặt hàng. Tệp Excel chứa đầy đủ toàn bộ dữ liệu.</p>`
    : "";
  return `<div class="technical-requirements-list"><div class="equipment-heading"><div><span>THÔNG SỐ KỸ THUẬT E-HSMT</span><strong>${items.length} mặt hàng trích trực tiếp từ biểu mẫu công khai</strong></div><button class="technical-download-button" data-action="download-tech" data-id="${escapeHtml(tender.id)}" type="button">Tải bảng Excel ↧</button></div><p class="technical-source-note">Tệp XLSX cố định hàng tiêu đề, wrap text thông số và có thể lọc dữ liệu. Bao gồm số lượng, tên máy, thông số kỹ thuật và đơn vị sử dụng.</p>${rows}${limitNote}</div>`;
}

function detailMarkup(tender) {
  const detail = state.detailsByNotifyNo[tender.notifyNo];
  const winners = tender.winnerNames?.length ? tender.winnerNames.join("; ") : "Chưa công bố kết quả";
  const bidders = detail?.bidders || [];
  const uniqueBidderCount = new Set(bidders.map((bidder) => bidder.contractorCode || bidder.contractorName)).size
    || Number(tender.bidderCount) || 0;
  const lowestBid = bidders.reduce((lowest, bidder) => {
    const price = Number(bidder.finalPrice) || Number(bidder.bidPrice) || 0;
    return price && (!lowest || price < lowest) ? price : lowest;
  }, 0);
  const invitedCount = Number(detail?.requirements?.total) || detail?.requirements?.items?.length || 0;
  const summary = tender.hasResult
    ? `<div><span>Đơn vị trúng thầu</span><strong>${escapeHtml(winners)}</strong></div>
      <div><span>Giá trúng thầu</span><strong>${escapeHtml(formatMoney(tender.winningPrice))}</strong></div>
      <div><span>Ngày quyết định</span><strong>${escapeHtml(formatDate(tender.decisionDate))}</strong></div>`
    : `<div><span>Danh mục mời thầu</span><strong>${invitedCount ? `${invitedCount} phần/lô` : "Chưa tách danh mục"}</strong></div>
      <div><span>Giá dự thầu thấp nhất</span><strong>${escapeHtml(formatMoney(lowestBid))}</strong></div>
      <div><span>Giai đoạn</span><strong>${escapeHtml(statusLabels[tender.status] || tender.status)}</strong></div>`;
  let detailBody = `${requirementsMarkup(detail, tender)}${technicalRequirementsMarkup(detail, tender)}${bidderMarkup(detail, tender)}${equipmentMarkup(detail, tender)}`;
  if (state.detailLoading === tender.id) {
    detailBody = '<div class="detail-loading"><span></span>Đang tải danh mục mời thầu, yêu cầu kỹ thuật, nhà thầu và kết quả…</div>';
  } else if (state.detailErrors[tender.id]) {
    detailBody = `<div class="detail-notice error">${escapeHtml(state.detailErrors[tender.id])}</div>`;
  }
  return `<section class="tender-detail-panel" id="detail-${escapeHtml(tender.id)}">
    <div class="result-summary">
      ${summary}
    </div>
    ${detailBody}
    <div class="detail-footer"><span>Dữ liệu được đối chiếu từ KHLCNT, biểu mẫu e-HSMT, biên bản mở thầu và kết quả công khai.</span><a href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer">Xem hồ sơ chính thức ↗</a></div>
  </section>`;
}

async function toggleDetails(tender) {
  if (state.expandedId === tender.id) {
    state.expandedId = null;
    render();
    return;
  }
  state.expandedId = tender.id;
  render();
  const hasPublicDetail = tender.hasResult || ["open", "urgent", "evaluating", "closed"].includes(tender.status);
  if (!hasPublicDetail || state.detailsByNotifyNo[tender.notifyNo]) return;

  state.detailLoading = tender.id;
  delete state.detailErrors[tender.id];
  render();
  try {
    const response = await fetch(`./data/details/${encodeURIComponent(tender.notifyNo)}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.detailsByNotifyNo[tender.notifyNo] = await response.json();
  } catch {
    state.detailErrors[tender.id] = "Chưa tải được dữ liệu chi tiết của gói này. Vui lòng thử lại sau.";
  } finally {
    state.detailLoading = null;
    render();
  }
}

function displayEquipmentValue(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return /^[.;,:/-]*$/.test(text) ? "" : text;
}

function equipmentSearchMatchMarkup(tender) {
  if (!state.query.trim()) return "";
  const matches = state.searchMatchesByNotifyNo.get(tender.notifyNo) || [];
  if (!matches.length) return "";
  const visible = matches.slice(0, 2).map((item) => {
    const model = displayEquipmentValue(item.model);
    const brand = displayEquipmentValue(item.brand);
    const stage = item.stage === "invitation-technical"
      ? "Thông số e-HSMT"
      : (item.stage === "invitation" ? "Đang mời thầu" : "Đã có kết quả");
    const facts = [stage, item.lotNo ? `Lô: ${item.lotNo}` : "", model ? `Model: ${model}` : "", brand ? `Nhãn hiệu: ${brand}` : ""]
      .filter(Boolean)
      .join(" · ");
    return `<div class="equipment-search-match-item"><strong>${escapeHtml(displayEquipmentValue(item.name) || "Mặt hàng thiết bị")}</strong>${facts ? `<span>${escapeHtml(facts)}</span>` : ""}</div>`;
  }).join("");
  const remainder = matches.length > 2
    ? `<span class="equipment-search-more">+${matches.length - 2} mặt hàng khác</span>`
    : "";
  return `<div class="equipment-search-match"><div class="equipment-search-match-heading"><span>Khớp danh mục e-HSMT/thiết bị/model</span><b>${matches.length} mặt hàng</b></div>${visible}${remainder}</div>`;
}

function tenderMarkup(tender) {
  const expanded = state.expandedId === tender.id;
  const saved = state.saved.includes(String(tender.id));
  const hasResult = Boolean(tender.hasResult || tender.winnerNames?.length);
  const price = Number(tender.winningPrice) || Number(tender.price) || 0;
  return `<article class="tender-row">
    <button class="save-button${saved ? " saved" : ""}" data-action="save" data-id="${escapeHtml(tender.id)}" type="button" aria-label="${saved ? "Bỏ lưu" : "Lưu"} gói thầu">${saved ? "★" : "☆"}</button>
    <div class="tender-main"><div class="tender-meta"><span>${escapeHtml(tender.notifyNo)}</span><span>${escapeHtml(tender.category)}</span>${hasResult ? '<span class="result-meta">Có kết quả</span>' : ""}${Number(tender.bidderCount) ? `<span>${escapeHtml(tender.bidderCount)} nhà thầu</span>` : ""}</div><h3>${escapeHtml(tender.name)}</h3><p>${escapeHtml(tender.investor)} · ${escapeHtml(tender.location)}</p>${equipmentSearchMatchMarkup(tender)}</div>
    <div class="tender-status"><span class="status-pill ${escapeHtml(tender.status)}">${escapeHtml(statusLabels[tender.status] || tender.status)}</span><span>Đóng ${escapeHtml(formatDate(tender.closeDate, true))}</span></div>
    <div class="tender-price"><strong title="${escapeHtml(formatMoney(price, false))}">${escapeHtml(formatMoney(price))}</strong><span>${tender.winningPrice ? "Giá trúng thầu" : "Giá dự toán"}</span></div>
    <div class="tender-actions"><button class="expand-button${expanded ? " expanded" : ""}" data-action="expand" data-id="${escapeHtml(tender.id)}" type="button" aria-expanded="${expanded}"><span>${expanded ? "Thu gọn" : "Mở rộng"}</span><span>⌄</span></button><a class="detail-link" href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer"><span>↗</span><span>Nguồn</span></a></div>
    ${expanded ? detailMarkup(tender) : ""}
  </article>`;
}

function paginationMarkup(currentPage, totalPages) {
  const pages = new Set([1, totalPages, currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]);
  const visible = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const parts = [];
  parts.push(`<button type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Trang trước">‹</button>`);
  visible.forEach((page, index) => {
    if (index > 0 && page - visible[index - 1] > 1) parts.push('<span aria-hidden="true">…</span>');
    parts.push(`<button type="button" data-page="${page}" class="${page === currentPage ? "selected" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`);
  });
  parts.push(`<button type="button" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""} aria-label="Trang sau">›</button>`);
  return parts.join("");
}

function render() {
  const tenders = filteredTenders();
  renderMetrics(tenders);
  const totalPages = Math.max(1, Math.ceil(tenders.length / TENDERS_PER_PAGE));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const firstIndex = (state.page - 1) * TENDERS_PER_PAGE;
  const visibleTenders = tenders.slice(firstIndex, firstIndex + TENDERS_PER_PAGE);
  const equipmentMatchCount = tenders.reduce(
    (sum, tender) => sum + (state.searchMatchesByNotifyNo.get(tender.notifyNo)?.length || 0),
    0,
  );
  elements.resultCount.textContent = `${tenders.length} gói thầu${equipmentMatchCount ? ` · ${equipmentMatchCount} mặt hàng/model khớp` : ""} · trang ${state.page}/${totalPages}${state.investor ? ` · ${state.investor}` : ""}`;
  elements.list.innerHTML = tenders.length
    ? visibleTenders.map(tenderMarkup).join("")
    : '<div class="empty-state"><span class="icon-text">⌕</span><h3>Chưa tìm thấy gói thầu phù hợp</h3><p>Hãy thử từ khóa ngắn hơn hoặc mở rộng khoảng thời gian.</p></div>';
  elements.list.setAttribute("aria-busy", "false");
  elements.pagination.hidden = !tenders.length;
  elements.pagination.innerHTML = tenders.length ? paginationMarkup(state.page, totalPages) : "";
}

async function loadData(cacheBust = false) {
  elements.refresh.disabled = true;
  elements.dataState.dataset.state = "loading";
  elements.sourceLabel.textContent = "Đang tải dữ liệu";
  elements.warning.hidden = true;
  try {
    const suffix = cacheBust ? `?t=${Date.now()}` : "";
    const [response, equipmentResponse] = await Promise.all([
      fetch(`${DATA_URL}${suffix}`, { cache: cacheBust ? "reload" : "default" }),
      fetch(`${EQUIPMENT_SEARCH_URL}${suffix}`, { cache: cacheBust ? "reload" : "default" })
        .catch(() => null),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.tenders)) throw new Error("Tệp dữ liệu không hợp lệ");
    let equipment = [];
    if (equipmentResponse?.ok) {
      try {
        const equipmentData = await equipmentResponse.json();
        if (Array.isArray(equipmentData.equipment)) equipment = equipmentData.equipment;
      } catch {
        equipment = [];
      }
    }
    state.tenders = data.tenders;
    state.equipmentByNotifyNo = indexEquipment(equipment);
    state.searchMatchesByNotifyNo.clear();
    state.detailsByNotifyNo = data.detailsByNotifyNo || {};
    state.fetchedAt = data.fetchedAt || "";
    state.page = 1;
    elements.dataState.dataset.state = "live";
    elements.sourceLabel.textContent = equipment.length
      ? "Dữ liệu & model đã đồng bộ"
      : "Dữ liệu đã đồng bộ";
    elements.updatedLabel.textContent = state.fetchedAt
      ? `Cập nhật ${formatDate(state.fetchedAt, true)}`
      : "Từ Hệ thống mạng đấu thầu quốc gia";
    render();
  } catch (error) {
    elements.dataState.dataset.state = "error";
    elements.sourceLabel.textContent = "Không tải được dữ liệu";
    elements.updatedLabel.textContent = "Vui lòng thử lại sau";
    elements.warning.hidden = false;
    elements.warning.textContent = `Không đọc được bản dữ liệu đã đồng bộ (${error.message}).`;
    elements.list.innerHTML = '<div class="empty-state"><h3>Nguồn dữ liệu tạm thời chưa sẵn sàng</h3><p>Vui lòng bấm cập nhật hoặc quay lại sau.</p></div>';
    elements.pagination.hidden = true;
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = elements.keyword.value;
  state.page = 1;
  state.expandedId = null;
  state.investor = "";
  render();
  document.querySelector("#goi-thau")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.category.addEventListener("change", () => {
  state.category = elements.category.value;
  state.page = 1;
  state.expandedId = null;
  render();
});

elements.days.addEventListener("change", () => {
  state.days = Number(elements.days.value) || 30;
  state.page = 1;
  state.expandedId = null;
  render();
});

elements.statusFilter.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  state.status = button.dataset.status;
  state.page = 1;
  state.expandedId = null;
  elements.statusFilter.querySelectorAll("button[data-status]").forEach((item) => {
    item.classList.toggle("selected", item === button);
  });
  render();
});

elements.investorRanking.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-investor]");
  if (!button) return;
  state.investor = state.investor === button.dataset.investor ? "" : button.dataset.investor;
  state.query = "";
  elements.keyword.value = "";
  state.page = 1;
  state.expandedId = null;
  render();
  document.querySelector("#goi-thau")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.savedList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-saved-open]");
  if (!button) return;
  const tender = state.tenders.find((item) => String(item.id) === button.dataset.savedOpen);
  if (!tender) return;
  state.query = "";
  state.category = "all";
  state.days = 3650;
  state.status = "all";
  state.investor = "";
  state.page = 1;
  state.expandedId = null;
  elements.keyword.value = "";
  elements.category.value = "all";
  elements.days.value = "3650";
  elements.statusFilter.querySelectorAll("button[data-status]").forEach((item) => {
    item.classList.toggle("selected", item.dataset.status === "all");
  });
  const tenderIndex = filteredTenders().findIndex((item) => item.id === tender.id);
  state.page = Math.floor(Math.max(0, tenderIndex) / TENDERS_PER_PAGE) + 1;
  void toggleDetails(tender);
  document.querySelector("#goi-thau")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === "save") {
    state.saved = state.saved.includes(id) ? state.saved.filter((item) => item !== id) : [...state.saved, id];
    localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
  } else if (button.dataset.action === "download-tech") {
    const tender = state.tenders.find((item) => String(item.id) === id);
    if (tender) downloadTechnicalXlsx(tender, button);
    return;
  } else if (button.dataset.action === "expand") {
    const tender = state.tenders.find((item) => String(item.id) === id);
    if (tender) void toggleDetails(tender);
    return;
  }
  render();
});

elements.pagination.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page) || 1;
  state.expandedId = null;
  render();
  document.querySelector("#goi-thau")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.refresh.addEventListener("click", () => loadData(true));
loadData();

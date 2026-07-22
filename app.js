const DATA_URL = "./data/tenders.json";
const SAVED_KEY = "gia-lai-medical-tender-watchlist";
const TENDERS_PER_PAGE = 10;

const state = {
  tenders: [],
  detailsByNotifyNo: {},
  fetchedAt: "",
  query: "",
  category: "all",
  days: 365,
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
  const query = state.query.trim().toLocaleLowerCase("vi-VN");
  return periodTenders().filter((tender) => {
    const haystack = `${tender.name} ${tender.investor} ${tender.notifyNo}`.toLocaleLowerCase("vi-VN");
    const statusMatches =
      state.status === "all" ||
      (state.status === "awarded"
        ? Boolean(tender.hasResult || tender.winnerNames?.length)
        : tender.status === state.status);
    const investorMatches = !state.investor || tender.investor === state.investor;
    return (!query || haystack.includes(query)) && statusMatches && investorMatches;
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

function renderMetrics() {
  const tenders = periodTenders();
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
    const message = tender.status === "evaluating"
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
  const summary = tender.hasResult
    ? `<div><span>Đơn vị trúng thầu</span><strong>${escapeHtml(winners)}</strong></div>
      <div><span>Giá trúng thầu</span><strong>${escapeHtml(formatMoney(tender.winningPrice))}</strong></div>
      <div><span>Ngày quyết định</span><strong>${escapeHtml(formatDate(tender.decisionDate))}</strong></div>`
    : `<div><span>Nhà thầu tham dự</span><strong>${uniqueBidderCount ? `${uniqueBidderCount} nhà thầu` : "Chưa công bố"}</strong></div>
      <div><span>Giá dự thầu thấp nhất</span><strong>${escapeHtml(formatMoney(lowestBid))}</strong></div>
      <div><span>Giai đoạn</span><strong>${escapeHtml(statusLabels[tender.status] || tender.status)}</strong></div>`;
  let detailBody = `${bidderMarkup(detail, tender)}${equipmentMarkup(detail, tender)}`;
  if (state.detailLoading === tender.id) {
    detailBody = '<div class="detail-loading"><span></span>Đang tải danh sách nhà thầu, model thiết bị và kết quả đánh giá…</div>';
  } else if (state.detailErrors[tender.id]) {
    detailBody = `<div class="detail-notice error">${escapeHtml(state.detailErrors[tender.id])}</div>`;
  }
  return `<section class="tender-detail-panel" id="detail-${escapeHtml(tender.id)}">
    <div class="result-summary">
      ${summary}
    </div>
    ${detailBody}
    <div class="detail-footer"><span>Dữ liệu kỹ thuật chỉ hiển thị khi đã được công bố công khai.</span><a href="${officialUrl(tender.sourceUrl)}" target="_blank" rel="noreferrer">Xem hồ sơ chính thức ↗</a></div>
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
  const hasPublicDetail = tender.hasResult || ["evaluating", "closed"].includes(tender.status);
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

function tenderMarkup(tender) {
  const expanded = state.expandedId === tender.id;
  const saved = state.saved.includes(String(tender.id));
  const hasResult = Boolean(tender.hasResult || tender.winnerNames?.length);
  const price = Number(tender.winningPrice) || Number(tender.price) || 0;
  return `<article class="tender-row">
    <button class="save-button${saved ? " saved" : ""}" data-action="save" data-id="${escapeHtml(tender.id)}" type="button" aria-label="${saved ? "Bỏ lưu" : "Lưu"} gói thầu">${saved ? "★" : "☆"}</button>
    <div class="tender-main"><div class="tender-meta"><span>${escapeHtml(tender.notifyNo)}</span><span>${escapeHtml(tender.category)}</span>${hasResult ? '<span class="result-meta">Có kết quả</span>' : ""}${Number(tender.bidderCount) ? `<span>${escapeHtml(tender.bidderCount)} nhà thầu</span>` : ""}</div><h3>${escapeHtml(tender.name)}</h3><p>${escapeHtml(tender.investor)} · ${escapeHtml(tender.location)}</p></div>
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
  renderMetrics();
  const tenders = filteredTenders();
  const totalPages = Math.max(1, Math.ceil(tenders.length / TENDERS_PER_PAGE));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const firstIndex = (state.page - 1) * TENDERS_PER_PAGE;
  const visibleTenders = tenders.slice(firstIndex, firstIndex + TENDERS_PER_PAGE);
  elements.resultCount.textContent = `${tenders.length} kết quả · trang ${state.page}/${totalPages}${state.investor ? ` · ${state.investor}` : ""}`;
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
    const response = await fetch(`${DATA_URL}${suffix}`, { cache: cacheBust ? "reload" : "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.tenders)) throw new Error("Tệp dữ liệu không hợp lệ");
    state.tenders = data.tenders;
    state.detailsByNotifyNo = data.detailsByNotifyNo || {};
    state.fetchedAt = data.fetchedAt || "";
    state.page = 1;
    elements.dataState.dataset.state = "live";
    elements.sourceLabel.textContent = "Dữ liệu đã đồng bộ";
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

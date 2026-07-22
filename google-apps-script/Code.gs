const TENDER_DATA_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/tenders.json";
const BIDDER_DATA_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/bidders.json";
const EQUIPMENT_DATA_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/equipment.json";
const TENDER_SHEET = "Gói thầu";
const BIDDER_SHEET = "Nhà thầu";
const EQUIPMENT_SHEET = "Danh mục thiết bị";
const CONFIG_SHEET = "Cấu hình";
const KNOWN_IDS_KEY = "KNOWN_TENDER_IDS";
const INITIALIZED_KEY = "INITIALIZED";
const TENDER_HEADER_ROW = 2;
const TENDER_DATA_START_ROW = 3;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Thầu Y tế Gia Lai")
    .addItem("Cài đặt cập nhật mỗi giờ", "setupAutomation")
    .addItem("Cập nhật ngay", "syncTenders")
    .addItem("Gửi email thử", "sendTestEmail")
    .addToUi();
}

function setupAutomation() {
  ensureConfigSheet_();
  syncTenders();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "syncTenders")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("syncTenders").timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast("Đã cài cập nhật tự động mỗi giờ.", "Thầu Y tế Gia Lai", 6);
}

function syncTenders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const version = Date.now();
    const urls = [TENDER_DATA_URL, BIDDER_DATA_URL, EQUIPMENT_DATA_URL];
    const responses = UrlFetchApp.fetchAll(urls.map((url) => ({
      url: `${url}?v=${version}`,
      muteHttpExceptions: true,
      headers: { Accept: "application/json" },
    })));
    responses.forEach((response, index) => {
      if (response.getResponseCode() !== 200) {
        throw new Error(`${urls[index]} phản hồi HTTP ${response.getResponseCode()}`);
      }
    });
    const payload = JSON.parse(responses[0].getContentText());
    const bidderPayload = JSON.parse(responses[1].getContentText());
    const equipmentPayload = JSON.parse(responses[2].getContentText());
    const tenders = Array.isArray(payload.tenders) ? payload.tenders : [];
    const bidders = Array.isArray(bidderPayload.bidders) ? bidderPayload.bidders : [];
    const equipment = Array.isArray(equipmentPayload.equipment) ? equipmentPayload.equipment : [];
    const properties = PropertiesService.getScriptProperties();
    const initialized = properties.getProperty(INITIALIZED_KEY) === "1";
    const knownIds = new Set(JSON.parse(properties.getProperty(KNOWN_IDS_KEY) || "[]"));
    const currentIds = tenders.map((tender) => String(tender.notifyNo || tender.id || "")).filter(Boolean);
    const newTenders = initialized
      ? tenders.filter((tender) => !knownIds.has(String(tender.notifyNo || tender.id || "")))
      : [];

    writeTenderSheet_(tenders, equipment, payload.fetchedAt);
    writeBidderSheet_(bidders, payload.fetchedAt);
    writeEquipmentSheet_(equipment, payload.fetchedAt);
    properties.setProperty(KNOWN_IDS_KEY, JSON.stringify(currentIds));
    properties.setProperty(INITIALIZED_KEY, "1");
    updateLastSync_(payload.fetchedAt, tenders.length, newTenders.length);
    if (newTenders.length && alertsEnabled_()) sendNewTenderEmail_(newTenders, payload.fetchedAt);
  } finally {
    lock.releaseLock();
  }
}

function writeTenderSheet_(tenders, equipment, fetchedAt) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(TENDER_SHEET);
  const isNewSheet = !sheet;
  if (isNewSheet) sheet = spreadsheet.insertSheet(TENDER_SHEET);
  const headers = [
    "Mã TBMT", "Ngày đăng", "Tên gói thầu", "Nhóm", "Chủ đầu tư", "Địa điểm",
    "Giá dự toán", "Hạn đóng thầu", "Trạng thái", "Số nhà thầu tham dự",
    "Nhà thầu tham dự", "Đơn vị trúng thầu", "Nhà thầu không trúng",
    "Model/loại máy trúng", "Model bên không trúng", "Giá trúng thầu",
    "Ngày quyết định", "Có kết quả", "Nguồn chính thức", "Dữ liệu cập nhật lúc",
  ];
  const equipmentByTender = equipment.reduce((groups, item) => {
    const key = String(item.notifyNo || "");
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
  const rows = tenders.map((tender) => [
    tender.notifyNo || "",
    toDate_(tender.publicDate),
    tender.name || "",
    tender.category || "",
    tender.investor || "",
    tender.location || "",
    Number(tender.price) || 0,
    toDate_(tender.closeDate),
    statusLabel_(tender.status),
    tender.bidderCount === null || tender.bidderCount === undefined ? "" : Number(tender.bidderCount),
    (tender.participantNames || []).join("; "),
    (tender.winnerNames || []).join("; "),
    (tender.loserDetails || []).map((item) =>
      `${item.contractorName || ""}${item.reason ? ` (${item.reason})` : ""}`).join("; "),
    summarizeWinningEquipment_(equipmentByTender[String(tender.notifyNo || "")] || [], tender.winningModels || []),
    (tender.losingModels || []).join("; ") || tender.losingModelDisclosure || "",
    moneyText_(tender.winningPrice),
    toDate_(tender.decisionDate),
    tender.hasResult ? "Có" : "Chưa",
    tender.sourceUrl || "",
    toDate_(fetchedAt),
  ]);

  // Các bản cũ đặt tiêu đề cột ở hàng 1. Chỉ chèn thêm hàng tiêu đề lớn
  // khi chưa có bố cục hai hàng, tránh đụng vào trang đã được chỉnh tay.
  if (!isNewSheet && String(sheet.getRange(1, 1).getValue()).trim() === "Mã TBMT") {
    sheet.insertRowBefore(1);
  }
  if (isNewSheet) initializeTenderSheet_(sheet, headers.length);

  const filter = sheet.getFilter();
  if (filter) filter.remove();

  // Chỉ xóa vùng dữ liệu do script quản lý. Hàng tiêu đề lớn, định dạng,
  // độ rộng cột, đường viền và các cột ghi chú bên phải vẫn được giữ nguyên.
  const oldLastRow = sheet.getLastRow();
  if (oldLastRow >= TENDER_DATA_START_ROW) {
    sheet
      .getRange(TENDER_DATA_START_ROW, 1, oldLastRow - TENDER_DATA_START_ROW + 1, headers.length)
      .clearContent();
  }
  sheet.getRange(TENDER_HEADER_ROW, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(TENDER_DATA_START_ROW, 1, rows.length, headers.length).setValues(rows);
  }

  const lastRow = Math.max(TENDER_DATA_START_ROW, rows.length + TENDER_HEADER_ROW);
  sheet.setFrozenRows(TENDER_HEADER_ROW);
  sheet.setFrozenColumns(2);
  sheet.getRange(TENDER_HEADER_ROW, 1, lastRow - TENDER_HEADER_ROW + 1, headers.length).createFilter();
  // Không ép định dạng số tại đây. Google Sheets Table có cột được định kiểu
  // sẽ báo lỗi nếu Apps Script đổi định dạng của một phần cột.
  sheet.getRange(TENDER_DATA_START_ROW, 3, Math.max(1, rows.length), 4).setWrap(true).setVerticalAlignment("top");
}

function initializeTenderSheet_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount).merge();
  sheet
    .getRange(1, 1)
    .setValue("Bảng tổng hợp gói thầu thiết bị y tế khu vực Gia Lai năm 2025-2026")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontWeight("bold")
    .setFontSize(16);
  sheet.setRowHeight(1, 34);
  sheet
    .getRange(TENDER_HEADER_ROW, 1, 1, columnCount)
    .setBackground("#0f513f")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  sheet.setColumnWidth(1, 125);
  sheet.setColumnWidth(2, 135);
  sheet.setColumnWidth(3, 430);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(6, 190);
  sheet.setColumnWidth(7, 135);
  sheet.setColumnWidth(8, 135);
  sheet.setColumnWidth(9, 110);
  sheet.setColumnWidth(10, 125);
  sheet.setColumnWidth(11, 320);
  sheet.setColumnWidth(12, 280);
  sheet.setColumnWidth(13, 320);
  sheet.setColumnWidth(14, 300);
  sheet.setColumnWidth(15, 280);
  sheet.setColumnWidth(16, 135);
  sheet.setColumnWidth(17, 120);
  sheet.setColumnWidth(18, 100);
  sheet.setColumnWidth(19, 280);
  sheet.setColumnWidth(20, 145);
}

function writeBidderSheet_(bidders, fetchedAt) {
  const headers = [
    "Mã TBMT", "Tên gói thầu", "Tên nhà thầu", "Mã nhà thầu", "Mã số thuế",
    "Lô/phần", "Trạng thái", "Giá dự thầu", "Giá sau giảm", "Giá trúng thầu",
    "Lý do không trúng", "Model/loại máy", "Nguồn chính thức", "Dữ liệu cập nhật lúc",
  ];
  const rows = bidders.map((bidder) => [
    bidder.notifyNo || "",
    bidder.tenderName || "",
    bidder.contractorName || "",
    bidder.contractorCode || "",
    bidder.taxCode || "",
    bidder.lotName || bidder.lotNo || "",
    bidderStatusLabel_(bidder.status),
    optionalNumber_(bidder.bidPrice),
    optionalNumber_(bidder.finalPrice),
    optionalNumber_(bidder.winningPrice),
    bidder.reason || "",
    summarizeModelList_(bidder.models || []) || (bidder.status === "lost" ? "Nguồn công khai chưa công bố" : ""),
    bidder.sourceUrl || "",
    toDate_(fetchedAt),
  ]);
  writeManagedSheet_(BIDDER_SHEET, headers, rows, [2, 3, 6, 11, 12]);
}

function writeEquipmentSheet_(equipment, fetchedAt) {
  const headers = [
    "Mã TBMT", "Tên gói thầu", "Nhà thầu trúng", "Lô/phần", "Tên thiết bị/hàng hóa",
    "Model/ký mã", "Nhãn hiệu", "Hãng sản xuất", "Xuất xứ", "Năm sản xuất",
    "Thông số kỹ thuật", "Đơn vị tính", "Số lượng", "Đơn giá", "Thành tiền",
    "Nguồn chính thức", "Dữ liệu cập nhật lúc",
  ];
  const rows = equipment.map((item) => [
    item.notifyNo || "",
    item.tenderName || "",
    (item.winnerNames || []).join("; "),
    item.lotNo || "",
    item.name || "",
    item.model || "",
    item.brand || "",
    item.manufacturer || "",
    item.origin || "",
    item.manufactureYear || "",
    item.specification || "",
    item.unit || "",
    optionalNumber_(item.quantity),
    optionalNumber_(item.unitPrice),
    optionalNumber_(item.amount),
    item.sourceUrl || "",
    toDate_(fetchedAt),
  ]);
  writeManagedSheet_(EQUIPMENT_SHEET, headers, rows, [2, 3, 5, 6, 7, 8, 11]);
}

function writeManagedSheet_(sheetName, headers, rows, wrapColumns) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  const oldLastRow = sheet.getLastRow();
  if (oldLastRow) sheet.getRange(1, 1, oldLastRow, headers.length).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#0f513f").setFontColor("#ffffff").setFontWeight("bold");
  wrapColumns.forEach((column) => {
    sheet.getRange(2, column, Math.max(1, rows.length), 1).setWrap(true).setVerticalAlignment("top");
  });
  const lastRow = Math.max(2, rows.length + 1);
  sheet.getRange(1, 1, lastRow, headers.length).createFilter();
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
}

function ensureConfigSheet_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(CONFIG_SHEET) || spreadsheet.insertSheet(CONFIG_SHEET);
  if (!sheet.getRange("A1").getValue()) {
    sheet.getRange("A1:B6").setValues([
      ["CẤU HÌNH THÔNG BÁO", "Giá trị"],
      ["Email nhận thông báo", Session.getEffectiveUser().getEmail() || ""],
      ["Bật thông báo", true],
      ["Nguồn dữ liệu", TENDER_DATA_URL],
      ["Lần đồng bộ gần nhất", "Chưa chạy"],
      ["Trạng thái", "Chưa cài đặt"],
    ]);
    sheet.getRange("A1:B1").setBackground("#0f513f").setFontColor("#ffffff").setFontWeight("bold");
    sheet.getRange("B3").insertCheckboxes();
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 420);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function updateLastSync_(fetchedAt, total, newCount) {
  const sheet = ensureConfigSheet_();
  const syncedAt = toDate_(fetchedAt) || new Date();
  sheet.getRange("B5").setValue(Utilities.formatDate(syncedAt, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss"));
  sheet.getRange("B6").setValue(`Đang lưu ${total} gói; phát hiện ${newCount} gói mới trong lần này`);
}

function alertsEnabled_() {
  return ensureConfigSheet_().getRange("B3").getValue() === true;
}

function notificationEmail_() {
  return String(ensureConfigSheet_().getRange("B2").getValue() || "").trim();
}

function sendNewTenderEmail_(tenders, fetchedAt) {
  const recipient = notificationEmail_();
  if (!recipient) return;
  const visible = tenders.slice(0, 30);
  const items = visible.map((tender) => `
    <li style="margin-bottom:12px">
      <b>${escapeHtml_(tender.notifyNo || "")}</b> – ${escapeHtml_(tender.name || "")}<br>
      <span style="color:#59665f">${escapeHtml_(tender.investor || "")} · Hạn: ${formatDate_(tender.closeDate)}</span><br>
      <a href="${escapeHtml_(tender.sourceUrl || TENDER_DATA_URL)}">Mở hồ sơ chính thức</a>
    </li>`).join("");
  const remainder = tenders.length > visible.length
    ? `<p>Và ${tenders.length - visible.length} gói mới khác trong Google Sheet.</p>`
    : "";
  MailApp.sendEmail({
    to: recipient,
    subject: `[Thầu Y tế Gia Lai] Có ${tenders.length} gói thầu mới`,
    htmlBody: `<h2>Có ${tenders.length} gói thiết bị/vật tư y tế mới</h2><ol>${items}</ol>${remainder}<p>Dữ liệu nguồn cập nhật: ${formatDate_(fetchedAt)}</p>`,
    name: "Thầu Y tế Gia Lai",
  });
}

function sendTestEmail() {
  const recipient = notificationEmail_();
  if (!recipient) throw new Error("Hãy nhập email tại sheet Cấu hình, ô B2.");
  MailApp.sendEmail(recipient, "[Thầu Y tế Gia Lai] Kiểm tra thông báo", "Thông báo Gmail đã được cấu hình thành công.");
  SpreadsheetApp.getActive().toast(`Đã gửi email thử đến ${recipient}.`, "Thầu Y tế Gia Lai", 6);
}

function statusLabel_(status) {
  return ({
    open: "Đang mở",
    urgent: "Sắp đóng",
    evaluating: "Đang xét thầu",
    closed: "Đã đóng – chưa có kết quả",
    no_bidder: "Đã đóng – không có nhà thầu",
    cancelled: "Đã hủy/không lựa chọn",
    awarded: "Đã có kết quả",
  })[status] || status || "";
}

function bidderStatusLabel_(status) {
  return ({
    participating: "Đang tham dự/đang xét",
    won: "Trúng thầu",
    lost: "Không trúng thầu",
  })[status] || status || "";
}

function optionalNumber_(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : "";
}

function moneyText_(value) {
  const number = optionalNumber_(value);
  return number === "" ? "" : `${Number(number).toLocaleString("vi-VN")} đ`;
}

function summarizeModelList_(models) {
  const unique = [...new Set((models || [])
    .map((model) => String(model || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))];
  const visible = unique.slice(0, 4).map((model) =>
    model.length > 160 ? `${model.slice(0, 157)}…` : model);
  const remainder = unique.length - visible.length;
  return `${visible.join("; ")}${remainder > 0 ? `; … còn ${remainder} model (xem tab Danh mục thiết bị)` : ""}`;
}

function summarizeWinningEquipment_(items, fallbackModels) {
  const unique = [];
  const seen = new Set();
  items.forEach((item) => {
    const name = String(item.name || "").replace(/\s+/g, " ").trim();
    const model = String(item.model || "").replace(/\s+/g, " ").trim();
    const shortName = name.length > 90 ? `${name.slice(0, 87)}…` : name;
    const shortModel = model.length > 160 ? `${model.slice(0, 157)}…` : model;
    const text = [shortName, shortModel].filter(Boolean).join(" — ");
    if (text && !seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }
  });
  if (!unique.length) {
    (fallbackModels || []).forEach((model) => {
      const text = String(model || "").replace(/\s+/g, " ").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        unique.push(text);
      }
    });
  }
  if (!unique.length) return "";
  const visible = unique.slice(0, 3);
  const remainder = unique.length - visible.length;
  return `${visible.join("; ")}${remainder > 0 ? `; … còn ${remainder} mặt hàng (xem tab Danh mục thiết bị)` : ""}`;
}

function toDate_(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date;
}

function formatDate_(value) {
  const date = toDate_(value);
  return date ? Utilities.formatDate(date, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm") : "Chưa công bố";
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

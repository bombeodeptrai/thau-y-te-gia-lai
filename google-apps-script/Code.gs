const TENDER_DATA_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/tenders.json";
const TENDER_SHEET = "Gói thầu";
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
    const response = UrlFetchApp.fetch(`${TENDER_DATA_URL}?v=${Date.now()}`, {
      muteHttpExceptions: true,
      headers: { Accept: "application/json" },
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`Nguồn dữ liệu phản hồi HTTP ${response.getResponseCode()}`);
    }
    const payload = JSON.parse(response.getContentText());
    const tenders = Array.isArray(payload.tenders) ? payload.tenders : [];
    const properties = PropertiesService.getScriptProperties();
    const initialized = properties.getProperty(INITIALIZED_KEY) === "1";
    const knownIds = new Set(JSON.parse(properties.getProperty(KNOWN_IDS_KEY) || "[]"));
    const currentIds = tenders.map((tender) => String(tender.notifyNo || tender.id || "")).filter(Boolean);
    const newTenders = initialized
      ? tenders.filter((tender) => !knownIds.has(String(tender.notifyNo || tender.id || "")))
      : [];

    writeTenderSheet_(tenders, payload.fetchedAt);
    properties.setProperty(KNOWN_IDS_KEY, JSON.stringify(currentIds));
    properties.setProperty(INITIALIZED_KEY, "1");
    updateLastSync_(payload.fetchedAt, tenders.length, newTenders.length);
    if (newTenders.length && alertsEnabled_()) sendNewTenderEmail_(newTenders, payload.fetchedAt);
  } finally {
    lock.releaseLock();
  }
}

function writeTenderSheet_(tenders, fetchedAt) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(TENDER_SHEET);
  const isNewSheet = !sheet;
  if (isNewSheet) sheet = spreadsheet.insertSheet(TENDER_SHEET);
  const headers = [
    "Mã TBMT", "Ngày đăng", "Tên gói thầu", "Nhóm", "Chủ đầu tư", "Địa điểm",
    "Giá dự toán", "Hạn đóng thầu", "Trạng thái", "Số nhà thầu tham dự",
    "Đơn vị trúng thầu", "Giá trúng thầu", "Ngày quyết định", "Có kết quả",
    "Nguồn chính thức", "Dữ liệu cập nhật lúc",
  ];
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
    (tender.winnerNames || []).join("; "),
    Number(tender.winningPrice) || 0,
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
  sheet.setColumnWidth(11, 260);
  sheet.setColumnWidth(12, 135);
  sheet.setColumnWidth(13, 120);
  sheet.setColumnWidth(14, 100);
  sheet.setColumnWidth(15, 280);
  sheet.setColumnWidth(16, 145);
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

const MT_BASE_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/";

function setupMienTrungSheets() {
  syncMienTrungSheets();
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return trigger.getHandlerFunction() === "syncMienTrungSheets"; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger("syncMienTrungSheets").timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast("Đã tạo trang tính riêng và cài cập nhật mỗi giờ.", "Thầu Y tế Miền Trung", 7);
}

function syncMienTrungSheets() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const version = Date.now();
    const names = ["tenders.json", "bidders.json", "equipment.json", "regions.json", "region-coverage.json"];
    const responses = UrlFetchApp.fetchAll(names.map(function(name) {
      return { url: MT_BASE_URL + name + "?v=" + version, muteHttpExceptions: true };
    }));
    responses.forEach(function(response, index) {
      if (response.getResponseCode() !== 200) throw new Error(names[index] + " HTTP " + response.getResponseCode());
    });

    const tenderPayload = JSON.parse(responses[0].getContentText());
    const bidderPayload = JSON.parse(responses[1].getContentText());
    const equipmentPayload = JSON.parse(responses[2].getContentText());
    const regionPayload = JSON.parse(responses[3].getContentText());
    const coveragePayload = JSON.parse(responses[4].getContentText());
    const tenders = tenderPayload.tenders || [];
    const bidders = bidderPayload.bidders || [];
    const equipment = equipmentPayload.equipment || [];
    const regions = regionPayload.regions || [];
    const ss = SpreadsheetApp.getActive();

    mtWriteSummary_(ss, regions, coveragePayload, tenderPayload.fetchedAt);
    regions.forEach(function(region) {
      mtWriteTenderSheet_(ss, region, tenders.filter(function(item) { return item.regionSlug === region.slug; }), tenderPayload.fetchedAt);
    });
    mtWriteBidderSheet_(ss, bidders, tenderPayload.fetchedAt);
    mtWriteEquipmentSheet_(ss, equipment, tenderPayload.fetchedAt);
    ss.toast("Đã đồng bộ " + tenders.length + " gói của " + regions.length + " tỉnh thành.", "Thầu Y tế Miền Trung", 7);
  } finally {
    lock.releaseLock();
  }
}

function mtWriteSummary_(ss, regions, coverage, fetchedAt) {
  const bySlug = {};
  (coverage.regions || []).forEach(function(item) { bySlug[item.slug] = item; });
  const headers = ["Tỉnh/thành", "Mã nguồn", "Số gói", "Nhà thầu", "Thiết bị/model", "Hồ sơ chi tiết", "Số ngày dữ liệu", "Cập nhật", "Trạng thái"];
  const rows = regions.map(function(region) {
    const item = bySlug[region.slug] || {};
    return [region.name, (region.provinceCodes || []).join(", "), Number(item.tenderCount) || 0,
      Number(item.bidderCount) || 0, Number(item.equipmentCount) || 0, Number(item.detailTenderCount) || 0,
      Number(item.coverageDays) || 0, mtDate_(item.fetchedAt || fetchedAt), item.initialized ? "Đã có dữ liệu" : "Đang khởi tạo"];
  });
  mtWriteTable_(mtSheet_(ss, "Miền Trung - Tổng hợp"), "Cơ sở dữ liệu đấu thầu y tế khu vực miền Trung", headers, rows);
}

function mtWriteTenderSheet_(ss, region, tenders, fetchedAt) {
  const headers = ["Mã TBMT", "Ngày đăng", "Tên gói thầu", "Nhóm", "Chủ đầu tư", "Địa điểm", "Giá dự toán",
    "Hạn đóng", "Trạng thái", "Số nhà thầu", "Nhà thầu tham dự", "Đơn vị trúng", "Nhà thầu không trúng",
    "Model trúng", "Model không trúng", "Giá trúng", "Ngày quyết định", "Có kết quả", "Nguồn", "Cập nhật"];
  const rows = tenders.map(function(item) {
    return [item.notifyNo || "", mtDate_(item.publicDate), item.name || "", item.category || "", item.investor || "",
      item.location || "", Number(item.price) || 0, mtDate_(item.closeDate), mtStatus_(item.status),
      item.bidderCount == null ? "" : Number(item.bidderCount), (item.participantNames || []).join("; "),
      (item.winnerNames || []).join("; "), (item.loserNames || []).join("; "), (item.winningModels || []).join("; "),
      (item.losingModels || []).join("; "), Number(item.winningPrice) || 0, mtDate_(item.decisionDate),
      item.hasResult ? "Có" : "Chưa", item.sourceUrl || "", mtDate_(fetchedAt)];
  });
  const sheet = mtSheet_(ss, mtSheetName_("MT - " + (region.shortName || region.name)));
  mtWriteTable_(sheet, "Gói thầu thiết bị y tế - " + region.name + " - 3 năm gần nhất", headers, rows);
  sheet.setFrozenColumns(2);
  sheet.setColumnWidth(3, 420);
  sheet.setColumnWidths(5, 2, 230);
  sheet.setColumnWidths(11, 5, 260);
}

function mtWriteBidderSheet_(ss, bidders, fetchedAt) {
  const headers = ["Tỉnh/thành", "Mã TBMT", "Tên gói", "Nhà thầu", "Mã nhà thầu", "Mã số thuế", "Lô/phần",
    "Trạng thái", "Giá dự thầu", "Giá sau giảm", "Giá trúng", "Lý do", "Model", "Nguồn", "Cập nhật"];
  const rows = bidders.map(function(item) {
    return [item.region || "", item.notifyNo || "", item.tenderName || "", item.contractorName || "",
      item.contractorCode || "", item.taxCode || "", item.lotName || item.lotNo || "", mtBidderStatus_(item.status),
      mtNumber_(item.bidPrice), mtNumber_(item.finalPrice), mtNumber_(item.winningPrice), item.reason || "",
      (item.models || []).join("; "), item.sourceUrl || "", mtDate_(fetchedAt)];
  });
  mtWriteTable_(mtSheet_(ss, "Miền Trung - Nhà thầu"), "Nhà thầu khu vực miền Trung", headers, rows);
}

function mtWriteEquipmentSheet_(ss, equipment, fetchedAt) {
  const headers = ["Tỉnh/thành", "Mã TBMT", "Tên gói", "Tên thiết bị/hàng hóa", "Model", "Nhãn hiệu", "Hãng",
    "Xuất xứ", "Năm sản xuất", "Thông số kỹ thuật", "Đơn vị", "Số lượng", "Đơn giá", "Thành tiền", "Đơn vị trúng", "Nguồn", "Cập nhật"];
  const rows = equipment.map(function(item) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return [item.region || "", item.notifyNo || "", item.tenderName || "", item.name || item.lotName || "",
      item.model || item.code || "", item.brand || "", item.manufacturer || "", item.origin || "",
      item.manufactureYear || "", item.specification || "", item.unit || "", quantity, unitPrice, quantity * unitPrice,
      (item.winnerNames || []).join("; "), item.sourceUrl || "", mtDate_(fetchedAt)];
  });
  mtWriteTable_(mtSheet_(ss, "Miền Trung - Thiết bị"), "Thiết bị, hóa chất, model và giá trúng", headers, rows);
}

function mtWriteTable_(sheet, title, headers, rows) {
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).merge().setValue(title).setHorizontalAlignment("center")
    .setFontWeight("bold").setFontSize(15).setBackground("#e8f2eb").setFontColor("#173c32");
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setBackground("#173c32")
    .setFontColor("#ffffff").setFontWeight("bold").setWrap(true);
  if (rows.length) sheet.getRange(3, 1, rows.length, headers.length).setValues(rows).setVerticalAlignment("top").setWrap(true);
  sheet.setFrozenRows(2);
  sheet.getRange(2, 1, Math.max(2, rows.length + 1), headers.length).createFilter();
}

function mtSheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function mtSheetName_(name) { return String(name).replace(/[\\/?*\[\]:]/g, " ").slice(0, 99); }
function mtDate_(value) { const date = new Date(value || 0); return isNaN(date.getTime()) ? "" : date; }
function mtNumber_(value) { const number = Number(value); return isFinite(number) && number !== 0 ? number : ""; }
function mtStatus_(value) { return ({ open: "Đang mở", urgent: "Sắp đóng", evaluating: "Đang xét thầu", closed: "Chưa có kết quả", no_bidder: "Không có nhà thầu", awarded: "Đã có kết quả", cancelled: "Đã hủy" })[value] || value || ""; }
function mtBidderStatus_(value) { return ({ won: "Trúng thầu", lost: "Không trúng", participating: "Tham dự" })[value] || value || ""; }

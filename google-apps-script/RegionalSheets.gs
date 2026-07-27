const MT_BASE_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/";
const MT_SHEET_PREFIX = "DBMT - ";
const MT_OWNER_KEY = "KIEU_VIET_MT_SYNC";
const MT_OWNER_VALUE = "2";
const MT_DEFAULT_REGION_SLUG = "gia-lai";
const MT_CURSOR_KEY = "MT_REGION_CURSOR_V2";
const MT_LAST_SYNC_PREFIX = "MT_LAST_SYNC_";
const MT_BATCH_ROWS = 1500;

function setupMienTrungSheets() {
  mtRemoveSyncTriggers_();
  mtWithLock_(function() {
    const metadata = mtLoadMetadata_();
    mtWriteSummary_(SpreadsheetApp.getActive(), metadata.regions, metadata.coverage, metadata.fetchedAt);
    const giaLai = metadata.regions.filter(function(region) { return region.slug === MT_DEFAULT_REGION_SLUG; })[0];
    if (!giaLai) throw new Error("Không tìm thấy cấu hình Gia Lai");
    mtSyncRegion_(SpreadsheetApp.getActive(), giaLai);
    PropertiesService.getScriptProperties().setProperty(MT_CURSOR_KEY, "0");
  });
  ScriptApp.newTrigger("syncMienTrungSheets").timeBased().everyMinutes(15).create();
  SpreadsheetApp.getActive().toast(
    "Đã đồng bộ Gia Lai. Các tỉnh khác sẽ tự cập nhật lần lượt mỗi 15 phút vào tab riêng.",
    "Thầu Y tế Miền Trung",
    10
  );
}

function syncGiaLaiSheets() {
  mtWithLock_(function() {
    const metadata = mtLoadMetadata_();
    mtWriteSummary_(SpreadsheetApp.getActive(), metadata.regions, metadata.coverage, metadata.fetchedAt);
    const region = metadata.regions.filter(function(item) { return item.slug === MT_DEFAULT_REGION_SLUG; })[0];
    if (!region) throw new Error("Không tìm thấy cấu hình Gia Lai");
    mtSyncRegion_(SpreadsheetApp.getActive(), region);
  });
  SpreadsheetApp.getActive().toast("Đã cập nhật riêng dữ liệu Gia Lai.", "Thầu Y tế Miền Trung", 7);
}

function syncMienTrungSheets() {
  mtWithLock_(function() {
    const metadata = mtLoadMetadata_();
    const ss = SpreadsheetApp.getActive();
    mtWriteSummary_(ss, metadata.regions, metadata.coverage, metadata.fetchedAt);

    const queue = metadata.regions.filter(function(region) {
      return region.slug !== MT_DEFAULT_REGION_SLUG;
    });
    if (!queue.length) return;

    const properties = PropertiesService.getScriptProperties();
    let cursor = Number(properties.getProperty(MT_CURSOR_KEY)) || 0;
    cursor = Math.max(0, cursor % queue.length);
    const region = queue[cursor];
    mtSyncRegion_(ss, region);
    properties.setProperty(MT_CURSOR_KEY, String((cursor + 1) % queue.length));
    ss.toast(
      "Đã cập nhật " + region.name + ". Lượt tiếp theo sẽ xử lý tỉnh kế tiếp.",
      "Thầu Y tế Miền Trung",
      7
    );
  });
}

function stopMienTrungSheets() {
  mtRemoveSyncTriggers_();
  SpreadsheetApp.getActive().toast("Đã dừng cập nhật tự động.", "Thầu Y tế Miền Trung", 6);
}

function mtRemoveSyncTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return trigger.getHandlerFunction() === "syncMienTrungSheets"; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
}

function mtWithLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Một lượt đồng bộ khác đang chạy. Hãy thử lại sau.");
  try {
    callback();
  } finally {
    lock.releaseLock();
  }
}

function mtLoadMetadata_() {
  const version = Date.now();
  const responses = UrlFetchApp.fetchAll([
    { url: MT_BASE_URL + "regions.json?v=" + version, muteHttpExceptions: true },
    { url: MT_BASE_URL + "region-coverage.json?v=" + version, muteHttpExceptions: true }
  ]);
  const regionPayload = mtParseResponse_(responses[0], "regions.json");
  const coveragePayload = mtParseResponse_(responses[1], "region-coverage.json");
  return {
    regions: regionPayload.regions || [],
    coverage: coveragePayload,
    fetchedAt: coveragePayload.generatedAt || ""
  };
}

function mtSyncRegion_(ss, region) {
  const version = Date.now();
  const base = MT_BASE_URL + "regions/" + encodeURIComponent(region.slug) + "/";
  const files = ["tenders.json", "bidders.json", "equipment.json"];
  const responses = UrlFetchApp.fetchAll(files.map(function(name) {
    return { url: base + name + "?v=" + version, muteHttpExceptions: true };
  }));

  // Phải phân tích xong toàn bộ JSON trước khi chạm vào Sheet. Nếu một tệp lỗi hoặc
  // bị cắt giữa chừng, dữ liệu cũ vẫn được giữ nguyên.
  const tenderPayload = mtParseResponse_(responses[0], region.name + "/tenders.json");
  const bidderPayload = mtParseResponse_(responses[1], region.name + "/bidders.json");
  const equipmentPayload = mtParseResponse_(responses[2], region.name + "/equipment.json");
  const fetchedAt = tenderPayload.fetchedAt || bidderPayload.fetchedAt || equipmentPayload.fetchedAt || new Date().toISOString();

  mtWriteTenderSheet_(ss, region, tenderPayload.tenders || [], fetchedAt);
  mtWriteBidderSheet_(ss, region, bidderPayload.bidders || [], fetchedAt);
  mtWriteEquipmentSheet_(ss, region, equipmentPayload.equipment || [], fetchedAt);
  PropertiesService.getScriptProperties().setProperty(MT_LAST_SYNC_PREFIX + region.slug, new Date().toISOString());
}

function mtParseResponse_(response, label) {
  const code = response.getResponseCode();
  if (code !== 200) throw new Error(label + " HTTP " + code);
  const text = response.getContentText("UTF-8");
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.charAt(0) !== "{" || trimmed.charAt(trimmed.length - 1) !== "}") {
    throw new Error(label + " tải chưa đầy đủ hoặc bị cắt giữa chừng; dữ liệu cũ được giữ nguyên");
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(label + " không phải JSON hoàn chỉnh: " + error.message);
  }
}

function mtWriteSummary_(ss, regions, coverage, fetchedAt) {
  const bySlug = {};
  (coverage.regions || []).forEach(function(item) { bySlug[item.slug] = item; });
  const properties = PropertiesService.getScriptProperties();
  const headers = ["Tỉnh/thành", "Mã nguồn", "Số gói", "Nhà thầu", "Thiết bị/model", "Hồ sơ chi tiết", "Số ngày dữ liệu", "Cập nhật nguồn", "Đồng bộ Sheet", "Trạng thái"];
  const rows = regions.map(function(region) {
    const item = bySlug[region.slug] || {};
    return [
      region.name,
      (region.provinceCodes || []).join(", "),
      Number(item.tenderCount) || 0,
      Number(item.bidderCount) || 0,
      Number(item.equipmentCount) || 0,
      Number(item.detailTenderCount) || 0,
      Number(item.coverageDays) || 0,
      mtDate_(item.fetchedAt || fetchedAt),
      mtDate_(properties.getProperty(MT_LAST_SYNC_PREFIX + region.slug)),
      item.initialized ? "Đã có dữ liệu" : "Đang khởi tạo"
    ];
  });
  mtWriteTable_(mtManagedSheet_(ss, "Tổng hợp"), "Cơ sở dữ liệu đấu thầu y tế khu vực miền Trung", headers, rows, 0);
}

function mtWriteTenderSheet_(ss, region, tenders, fetchedAt) {
  const headers = ["Mã TBMT", "Ngày đăng", "Tên gói thầu", "Nhóm", "Chủ đầu tư", "Địa điểm", "Giá dự toán",
    "Hạn đóng", "Trạng thái", "Số nhà thầu", "Nhà thầu tham dự", "Đơn vị trúng", "Nhà thầu không trúng",
    "Model trúng", "Model không trúng", "Giá trúng", "Ngày quyết định", "Có kết quả", "Nguồn", "Cập nhật"];
  const rows = tenders.map(function(item) {
    return [
      mtCell_(item.notifyNo, 100), mtDate_(item.publicDate), mtCell_(item.name, 5000), mtCell_(item.category, 300),
      mtCell_(item.investor, 1500), mtCell_(item.location, 800), Number(item.price) || 0, mtDate_(item.closeDate),
      mtStatus_(item.status), item.bidderCount == null ? "" : Number(item.bidderCount),
      mtList_(item.participantNames), mtList_(item.winnerNames), mtList_(item.loserNames),
      mtList_(item.winningModels), mtList_(item.losingModels), Number(item.winningPrice) || 0,
      mtDate_(item.decisionDate), item.hasResult ? "Có" : "Chưa", mtCell_(item.sourceUrl, 3000), mtDate_(fetchedAt)
    ];
  });
  const sheet = mtManagedSheet_(ss, region.shortName || region.name);
  mtWriteTable_(sheet, "Gói thầu thiết bị y tế - " + region.name + " - 3 năm gần nhất", headers, rows, 2);
  sheet.setColumnWidth(3, 420);
  sheet.setColumnWidths(5, 2, 230);
  sheet.setColumnWidths(11, 5, 260);
}

function mtWriteBidderSheet_(ss, region, bidders, fetchedAt) {
  const headers = ["Mã TBMT", "Tên gói", "Nhà thầu", "Mã nhà thầu", "Mã số thuế", "Lô/phần",
    "Trạng thái", "Giá dự thầu", "Giá sau giảm", "Giá trúng", "Lý do", "Model", "Nguồn", "Cập nhật"];
  const rows = bidders.map(function(item) {
    return [
      mtCell_(item.notifyNo, 100), mtCell_(item.tenderName, 5000), mtCell_(item.contractorName, 1500),
      mtCell_(item.contractorCode, 300), mtCell_(item.taxCode, 100), mtCell_(item.lotName || item.lotNo, 1500),
      mtBidderStatus_(item.status), mtNumber_(item.bidPrice), mtNumber_(item.finalPrice), mtNumber_(item.winningPrice),
      mtCell_(item.reason, 5000), mtList_(item.models), mtCell_(item.sourceUrl, 3000), mtDate_(fetchedAt)
    ];
  });
  mtWriteTable_(
    mtManagedSheet_(ss, (region.shortName || region.name) + " - Nhà thầu"),
    "Nhà thầu - " + region.name,
    headers,
    rows,
    1
  );
}

function mtWriteEquipmentSheet_(ss, region, equipment, fetchedAt) {
  const headers = ["Mã TBMT", "Tên gói", "Tên thiết bị/hàng hóa", "Model", "Nhãn hiệu", "Hãng",
    "Xuất xứ", "Năm sản xuất", "Thông số kỹ thuật", "Đơn vị", "Số lượng", "Đơn giá", "Thành tiền", "Đơn vị trúng", "Nguồn", "Cập nhật"];
  const rows = equipment.map(function(item) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return [
      mtCell_(item.notifyNo, 100), mtCell_(item.tenderName, 5000), mtCell_(item.name || item.lotName, 5000),
      mtCell_(item.model || item.code, 1000), mtCell_(item.brand, 1000), mtCell_(item.manufacturer, 1500),
      mtCell_(item.origin, 500), mtCell_(item.manufactureYear, 100), mtCell_(item.specification, 30000),
      mtCell_(item.unit, 100), quantity, unitPrice, quantity * unitPrice, mtList_(item.winnerNames),
      mtCell_(item.sourceUrl, 3000), mtDate_(fetchedAt)
    ];
  });
  mtWriteTable_(
    mtManagedSheet_(ss, (region.shortName || region.name) + " - Thiết bị"),
    "Thiết bị, hóa chất, model và giá trúng - " + region.name,
    headers,
    rows,
    1
  );
}

function mtWriteTable_(sheet, title, headers, rows, frozenColumns) {
  if (!mtIsManagedSheet_(sheet)) {
    throw new Error("Từ chối ghi đè tab không thuộc bộ đồng bộ DBMT: " + sheet.getName());
  }

  const frozen = Math.max(0, Math.min(Number(frozenColumns) || 0, Math.max(0, headers.length - 1)));
  const requiredRows = Math.max(3, rows.length + 2);
  mtEnsureSheetSize_(sheet, requiredRows, headers.length);

  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.setFrozenColumns(0);
  sheet.setFrozenRows(0);
  sheet.getDataRange().breakApart();
  sheet.clear();
  mtMarkManagedSheet_(sheet);

  function styleTitle_(range) {
    return range.setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setFontWeight("bold")
      .setFontSize(15)
      .setBackground("#e8f2eb")
      .setFontColor("#173c32");
  }

  if (frozen > 0) {
    styleTitle_(sheet.getRange(1, 1, 1, frozen).merge().setValue("Cột nhận diện"));
    styleTitle_(sheet.getRange(1, frozen + 1, 1, headers.length - frozen).merge().setValue(title));
  } else {
    styleTitle_(sheet.getRange(1, 1, 1, headers.length).merge().setValue(title));
  }

  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setBackground("#173c32")
    .setFontColor("#ffffff").setFontWeight("bold").setWrap(true);

  for (let start = 0; start < rows.length; start += MT_BATCH_ROWS) {
    const batch = rows.slice(start, start + MT_BATCH_ROWS);
    sheet.getRange(3 + start, 1, batch.length, headers.length)
      .setValues(batch)
      .setVerticalAlignment("top")
      .setWrap(true);
  }

  sheet.setFrozenRows(2);
  if (frozen > 0) sheet.setFrozenColumns(frozen);
  sheet.getRange(2, 1, Math.max(2, rows.length + 1), headers.length).createFilter();
}

function mtEnsureSheetSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function mtManagedSheet_(ss, label) {
  const preferredName = mtSheetName_(MT_SHEET_PREFIX + label);
  const preferred = ss.getSheetByName(preferredName);
  if (preferred && mtIsManagedSheet_(preferred)) return preferred;

  if (preferred && !mtIsManagedSheet_(preferred)) {
    let index = 1;
    while (true) {
      const candidateName = mtSheetName_(preferredName + " - tự động" + (index > 1 ? " " + index : ""));
      const candidate = ss.getSheetByName(candidateName);
      if (!candidate) {
        const created = ss.insertSheet(candidateName);
        mtMarkManagedSheet_(created);
        return created;
      }
      if (mtIsManagedSheet_(candidate)) return candidate;
      index += 1;
    }
  }

  const created = ss.insertSheet(preferredName);
  mtMarkManagedSheet_(created);
  return created;
}

function mtIsManagedSheet_(sheet) {
  try {
    return sheet.getDeveloperMetadata().some(function(item) {
      return item.getKey() === MT_OWNER_KEY && (item.getValue() === MT_OWNER_VALUE || item.getValue() === "1");
    });
  } catch (error) {
    return false;
  }
}

function mtMarkManagedSheet_(sheet) {
  if (!mtIsManagedSheet_(sheet)) sheet.addDeveloperMetadata(MT_OWNER_KEY, MT_OWNER_VALUE);
}

function mtCell_(value, maxLength) {
  const text = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  const limit = Math.max(1, Number(maxLength) || 30000);
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function mtList_(values) {
  return mtCell_((Array.isArray(values) ? values : []).filter(Boolean).join("; "), 30000);
}

function mtSheetName_(name) { return String(name).replace(/[\/?*\[\]:]/g, " ").slice(0, 99); }
function mtDate_(value) { const date = new Date(value || 0); return isNaN(date.getTime()) ? "" : date; }
function mtNumber_(value) { const number = Number(value); return isFinite(number) && number !== 0 ? number : ""; }
function mtStatus_(value) { return ({ open: "Đang mở", urgent: "Sắp đóng", evaluating: "Đang xét thầu", closed: "Chưa có kết quả", no_bidder: "Không có nhà thầu", awarded: "Đã có kết quả", cancelled: "Đã hủy" })[value] || value || ""; }
function mtBidderStatus_(value) { return ({ won: "Trúng thầu", lost: "Không trúng", participating: "Tham dự" })[value] || value || ""; }

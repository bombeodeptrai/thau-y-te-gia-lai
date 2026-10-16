import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../google-apps-script/RegionalSheets.gs", import.meta.url),
  "utf8",
);
const coreSource = await readFile(
  new URL("../google-apps-script/Code.gs", import.meta.url),
  "utf8",
);

for (const [name, code] of [["mtDate_", source], ["toDate_", coreSource]]) {
  test(`${name} đọc giờ nguồn Việt Nam độc lập múi giờ runtime`, () => {
    const context = {};
    vm.runInNewContext(code, context);
    for (const value of ["2026-10-15T16:21:12", "2026-10-15 16:21:12", "2026-10-15T16:21:12+07:00", "2026-10-15T09:21:12Z"]) {
      assert.equal(context[name](value).toISOString(), "2026-10-15T09:21:12.000Z");
    }
    for (const value of [null, undefined, "", "invalid"]) assert.equal(context[name](value), "");
  });
}

test("tổng hợp không báo Sheet khỏe chỉ vì dữ liệu nguồn đã khởi tạo", () => {
  let rows;
  const context = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => "2026-07-29T07:24:00Z" }) } };
  vm.runInNewContext(source, context);
  context.mtManagedSheet_ = () => ({});
  context.mtWriteTable_ = (_sheet, _title, _headers, values) => { rows = values; };
  context.mtWriteSummary_({}, [{slug: "gia-lai", name: "Gia Lai"}], {regions: [{slug: "gia-lai", initialized: true}]}, "2026-10-16T00:00:00Z");
  assert.equal(rows[0][9], "Sheet chưa đồng bộ hoặc đã trễ");
});

test("cài trigger riêng để Gia Lai tiếp tục tự đồng bộ sau lần khởi tạo", () => {
  assert.match(
    source,
    /newTrigger\("syncGiaLaiSheets"\)\.timeBased\(\)\.everyHours\(1\)\.create\(\)/,
  );
  assert.match(
    source,
    /newTrigger\("syncMienTrungSheets"\)\.timeBased\(\)\.everyMinutes\(15\)\.create\(\)/,
  );
});

test("cài đặt lại hoặc dừng đồng bộ xóa cả hai trigger cũ", () => {
  const cleanup = source.match(
    /function mtRemoveSyncTriggers_\(\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(cleanup, "không tìm thấy hàm dọn trigger");
  assert.match(cleanup[1], /syncGiaLaiSheets/);
  assert.match(cleanup[1], /syncMienTrungSheets/);
});

test("trigger xoay vòng tự cứu Gia Lai khi trigger riêng bị thiếu", () => {
  const sync = source.match(
    /function syncMienTrungSheets\(\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(sync, "không tìm thấy hàm đồng bộ xoay vòng");
  assert.match(sync[1], /mtRegionSyncIsStale_\(defaultLastSync, Date\.now\(\)\)/);
  assert.match(sync[1], /mtSyncRegion_\(ss, defaultRegion\)/);

  const context = {};
  vm.runInNewContext(
    `${source}\nglobalThis.__stale = mtRegionSyncIsStale_;`,
    context,
  );
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  assert.equal(context.__stale("", now), true);
  assert.equal(
    context.__stale(new Date(now - 91 * 60 * 1000).toISOString(), now),
    true,
  );
  assert.equal(
    context.__stale(new Date(now - 89 * 60 * 1000).toISOString(), now),
    false,
  );
});

for (const handler of ["setupMienTrungSheets", "syncGiaLaiSheets", "syncMienTrungSheets"]) {
  test(`${handler} ghi mốc tổng hợp sau khi đồng bộ dữ liệu thành công`, () => {
    const events = [];
    const context = {
      SpreadsheetApp: { getActive: () => ({ toast() {} }) },
      ScriptApp: { newTrigger: () => ({ timeBased() { return this; }, everyHours() { return this; }, everyMinutes() { return this; }, create() {} }) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => "2026-10-11T00:00:00Z", setProperty() {} }) },
    };
    vm.runInNewContext(source, context);
    context.mtWithLock_ = callback => callback();
    context.mtRemoveSyncTriggers_ = () => {};
    context.mtLoadMetadata_ = () => ({ regions: [{slug: "gia-lai"}, {slug: "hue"}], coverage: {} });
    context.mtSyncRegion_ = () => events.push("sync");
    context.mtWriteSummary_ = () => events.push("summary");
    context[handler]();
    assert.equal(events.at(-1), "summary");
    assert.ok(events.includes("sync"));
  });
}

test("mốc lần đồng bộ dùng thời điểm ghi Sheet, không dùng lại thời điểm nguồn", () => {
  const update = coreSource.match(
    /function updateLastSync_\(fetchedAt, total, newCount\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(update, "không tìm thấy hàm cập nhật mốc đồng bộ");
  assert.match(update[1], /const syncedAt = new Date\(\)/);
  assert.match(update[1], /const sourceUpdatedAt = toDate_\(fetchedAt\)/);
  assert.doesNotMatch(update[1], /const syncedAt = toDate_\(fetchedAt\)/);
});

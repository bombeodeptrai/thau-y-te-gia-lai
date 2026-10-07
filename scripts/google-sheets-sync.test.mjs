import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../google-apps-script/RegionalSheets.gs", import.meta.url),
  "utf8",
);

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

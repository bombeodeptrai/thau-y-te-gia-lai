import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

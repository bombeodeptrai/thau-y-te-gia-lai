import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tenderBelongsToRegion } from "./region-membership.mjs";

const require = createRequire(import.meta.url);
const { sourceDateTimestamp, withinSnapshotDays } = require("../display-time.js");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("đọc publicDate của Mua sắm công theo giờ Việt Nam ở mọi trình duyệt", () => {
  assert.equal(
    new Date(sourceDateTimestamp("2023-09-27T14:46:58.533")).toISOString(),
    "2023-09-27T07:46:58.533Z",
  );
  assert.equal(
    new Date(sourceDateTimestamp("2023-09-27T07:46:58.533Z")).toISOString(),
    "2023-09-27T07:46:58.533Z",
  );
});

test("lọc thời gian theo mốc chụp dữ liệu thay vì đồng hồ người xem", () => {
  const fetchedAt = "2026-09-26T05:11:39.694Z";
  assert.equal(withinSnapshotDays("2023-09-27T14:46:58.533", 1095, fetchedAt), true);
  assert.equal(withinSnapshotDays("2023-09-27T00:00:00.000", 1095, fetchedAt), true);
  assert.equal(withinSnapshotDays("2023-09-26T23:59:59.999", 1095, fetchedAt), false);
});

test("giữ gói ở ngày biên của phạm vi Gia Lai 1.095 ngày", () => {
  const fetchedAt = "2026-09-28T11:33:50.318Z";
  assert.equal(
    withinSnapshotDays("2023-09-29T16:32:23.196", 1095, fetchedAt),
    true,
    "IB2300243206 không được biến mất khỏi giao diện Gia Lai",
  );
  assert.equal(withinSnapshotDays("2023-09-28T23:59:59.999", 1095, fetchedAt), false);
});

test("số Gia Lai mặc định trên giao diện khớp dữ liệu vùng", async () => {
  const [merged, coverage, app, html] = await Promise.all([
    readFile(resolve(root, "data/tenders.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "data/region-coverage.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "app.js"), "utf8"),
    readFile(resolve(root, "index.html"), "utf8"),
  ]);
  const defaultDays = Number(app.match(/\bdays:\s*(\d+)/)?.[1]);
  assert.equal(defaultDays, 3650, "Mặc định phải hiện toàn bộ dữ liệu đang lưu, không làm mất gói lịch sử ở ngày biên");
  assert.match(html, /value="3650" selected/);
  const giaLai = coverage.regions.find((item) => item.slug === "gia-lai");
  const visible = (merged.tenders || []).filter((tender) =>
    tenderBelongsToRegion(tender, "gia-lai")
      && withinSnapshotDays(tender.publicDate, defaultDays, merged.fetchedAt));

  assert.ok(giaLai, "Thiếu vùng Gia Lai trong báo cáo phủ dữ liệu");
  assert.equal(visible.length, giaLai.tenderCount);
});

test("gói lịch sử không biến mất khi nguồn được quét sang ngày mới", () => {
  const fetchedAt = "2026-10-17T00:44:33.105Z";
  const historicDate = "2023-10-17T10:02:00";
  assert.equal(withinSnapshotDays(historicDate, 3650, fetchedAt), true);
  assert.equal(withinSnapshotDays("2023-10-16T10:02:00", 1095, fetchedAt), false);
});

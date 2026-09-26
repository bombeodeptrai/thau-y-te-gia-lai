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
  assert.equal(withinSnapshotDays("2023-09-27T12:11:39.693", 1095, fetchedAt), false);
});

test("số Gia Lai mặc định trên giao diện khớp dữ liệu vùng", async () => {
  const [merged, coverage] = await Promise.all([
    readFile(resolve(root, "data/tenders.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "data/region-coverage.json"), "utf8").then(JSON.parse),
  ]);
  const giaLai = coverage.regions.find((item) => item.slug === "gia-lai");
  const visible = (merged.tenders || []).filter((tender) =>
    tenderBelongsToRegion(tender, "gia-lai")
      && withinSnapshotDays(tender.publicDate, 1095, merged.fetchedAt));

  assert.ok(giaLai, "Thiếu vùng Gia Lai trong báo cáo phủ dữ liệu");
  assert.equal(visible.length, giaLai.tenderCount);
});

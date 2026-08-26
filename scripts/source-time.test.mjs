import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMuasamcongDateTime,
  muasamcongDateRange,
} from "./source-time.mjs";

test("đổi mốc UTC sang giờ Việt Nam không kèm hậu tố múi giờ", () => {
  assert.equal(
    formatMuasamcongDateTime(new Date("2026-08-26T07:08:00.123Z")),
    "2026-08-26T14:08:00.123",
  );
});

test("cửa sổ nguồn không loại nhầm gói đăng 10 giờ vì mốc UTC 7 giờ", () => {
  const now = new Date("2026-08-26T07:08:00.000Z");
  const range = muasamcongDateRange(now, 21 * 86_400_000);

  assert.equal(range.from, "2026-08-05T14:08:00.000");
  assert.equal(range.to, "2026-08-26T14:08:00.000");
  assert.ok("2026-08-26T10:00:10.482" <= range.to);
  assert.ok("2026-08-26T10:00:10.482" > now.toISOString());
  assert.doesNotMatch(range.to, /Z$/);
});

test("báo lỗi rõ ràng khi nhận mốc thời gian không hợp lệ", () => {
  assert.throws(() => formatMuasamcongDateTime("không-phải-ngày"), /không hợp lệ/);
});


import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapLimitedSettled } from "./resilient-source-scan.mjs";

test("tiếp tục quét các truy vấn còn lại khi một truy vấn nguồn lỗi", async () => {
  let active = 0;
  let peak = 0;
  const rejected = [];
  const { results, failures } = await mapLimitedSettled(
    ["a", "b", "c", "d"],
    2,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (value === "b") throw new Error("source timeout");
      return [value.toUpperCase()];
    },
    { onRejected: (failure) => rejected.push(failure.index) },
  );

  assert.deepEqual(results.flat(), ["A", "C", "D"]);
  assert.deepEqual(failures, [{ index: 1, value: "b", message: "source timeout" }]);
  assert.deepEqual(rejected, [1]);
  assert.ok(peak <= 2);
});

test("xử lý mảng rỗng mà không tạo worker lỗi", async () => {
  assert.deepEqual(await mapLimitedSettled([], 3, async () => []), {
    results: [],
    failures: [],
  });
});

test("quét toàn phần giữ dữ liệu hợp lệ khi truy vấn bù tạm lỗi", async () => {
  const source = await readFile(new URL("./fetch-data.mjs", import.meta.url), "utf8");
  assert.match(source, /const historicalTenders = \(previous\.tenders \|\| \[\]\)/);
  assert.match(source, /lastHistoricalFallbackFailureCount: historicalFallbackFailures\.length/);
  assert.match(source, /lastHistoricalFallbackComplete: historicalFallbackFailures\.length === 0/);
  assert.doesNotMatch(source, /const historicalTenders = fullRefresh \? \[\] :/);
});

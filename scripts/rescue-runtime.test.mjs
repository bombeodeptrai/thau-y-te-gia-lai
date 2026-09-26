import assert from "node:assert/strict";
import test from "node:test";
import {
  createRescueRuntime,
  readRescueRuntimeConfig,
} from "./rescue-runtime.mjs";

test("cấu hình runtime dùng mặc định an toàn và chặn giá trị quá mức", () => {
  assert.deepEqual(readRescueRuntimeConfig({}), {
    maxAttempts: 3,
    requestTimeoutMs: 15_000,
    maxRuntimeMs: 1_200_000,
  });
  assert.deepEqual(readRescueRuntimeConfig({
    RESCUE_MAX_ATTEMPTS: "99",
    RESCUE_REQUEST_TIMEOUT_MS: "100",
    RESCUE_MAX_RUNTIME_MS: "99999999",
  }), {
    maxAttempts: 6,
    requestTimeoutMs: 5_000,
    maxRuntimeMs: 2_400_000,
  });
});

test("mỗi request không được vượt quá ngân sách còn lại", () => {
  let current = 1_000;
  const runtime = createRescueRuntime({
    RESCUE_REQUEST_TIMEOUT_MS: "15000",
    RESCUE_MAX_RUNTIME_MS: "60000",
  }, () => current);

  assert.equal(runtime.nextRequestTimeoutMs(), 15_000);
  current = 59_000;
  assert.equal(runtime.nextRequestTimeoutMs(), 2_000);
  current = 61_000;
  assert.throws(() => runtime.nextRequestTimeoutMs(), /hết ngân sách/);
});

test("không chờ retry nếu thời gian chờ vượt ngân sách", () => {
  let current = 5_000;
  const runtime = createRescueRuntime({ RESCUE_MAX_RUNTIME_MS: "60000" }, () => current);
  current = 64_000;
  assert.throws(() => runtime.assertCanWait(2_000), /Không còn đủ ngân sách/);
});

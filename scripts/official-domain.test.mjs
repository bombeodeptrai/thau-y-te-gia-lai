import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildOfficialSourceUrl, repairOfficialSourceUrl } from "./official-source.mjs";

const origin = "https://muasamcong.mof.gov.vn";
const legacy = "https://muasamcong.mpi.gov.vn";
const item = { id: "47909154-4639-4539-84f7-f53dffb64d6b", notifyNo: "IB2600518070", inputResultId: "489842f8-45bf-4bce-bcea-32ce2cac0e91" };
const current = buildOfficialSourceUrl(item);
const old = current.replace(origin, legacy);

test("API công khai gọi trực tiếp tên miền MOF, tránh chuyển POST thành GET", () => {
  for (const name of ["fetch-data", "fetch-recent-medical-rescue", "fetch-recent-location-audit", "fetch-recent-location-fallback", "fetch-competitor-history", "refresh-official-tender-details", "repair-official-tender-identities"]) {
    const source = fs.readFileSync(new URL(`./${name}.mjs`, import.meta.url), "utf8");
    assert.ok(source.includes(origin), name);
    assert.equal(source.includes(legacy), false, name);
  }
});

test("workflow chi tiết không báo xanh khi chỉ tái dùng hồ sơ cũ và quét nguồn lỗi", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/regional-detail-backfill.yml", import.meta.url), "utf8");
  assert.match(workflow, /steps\.detail_scan\.outcome != 'success'/);
  assert.match(workflow, /không ghi nhận đồng bộ mới từ dữ liệu cũ\.["\s]+exit 1/);
});

test("IB2600518070 giữ định danh và tab kết quả khi chuyển link MPI sang MOF", () => {
  assert.equal(new URL(current).origin, origin);
  const repaired = new URL(repairOfficialSourceUrl(old));
  assert.equal(repaired.origin, origin);
  assert.equal(repaired.searchParams.get("notifyNo"), item.notifyNo);
  assert.equal(repaired.searchParams.get("id"), item.id);
  assert.equal(repaired.searchParams.get("step"), "kqlcnt");
  assert.equal(new URL(repairOfficialSourceUrl(old.replace("muasamcong.mpi.gov.vn", "muasamcong.mpi.gov.vn.example.com"))).pathname, "/");
});

test("website chuyển link lịch sử sang MOF mà không làm mất đường dẫn hồ sơ", () => {
  const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const context = { URL };
  vm.runInNewContext(`const OFFICIAL_HOME_URL = '${origin}/web/guest/home';\n` + source.slice(source.indexOf("function isUuid("), source.indexOf("function officialLinkMarkup(")), context);
  const result = context.officialLinkInfo(old);
  assert.equal(new URL(result.href).origin, origin);
  assert.equal(new URL(result.href).searchParams.get("notifyNo"), item.notifyNo);
  assert.equal(result.direct, true);
});

test("hai luồng Apps Script chuyển link lịch sử sang MOF và giữ nguyên định danh", () => {
  for (const [file, name] of [["RegionalSheets.gs", "mtOfficialTenderUrl_"], ["Code.gs", "officialTenderUrl_"]]) {
    const context = {};
    vm.runInNewContext(fs.readFileSync(new URL(`../google-apps-script/${file}`, import.meta.url), "utf8"), context);
    const url = new URL(context[name](old));
    assert.equal(url.origin, origin);
    assert.equal(url.searchParams.get("id"), item.id);
    assert.equal(url.searchParams.get("step"), "kqlcnt");
  }
});

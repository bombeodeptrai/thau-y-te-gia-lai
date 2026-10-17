import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("tải trang lần đầu lấy snapshot mới như nút Cập nhật, không dùng JSON cache cũ", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("async function loadData("), source.indexOf('elements.form.addEventListener("submit"'));
  const calls = [];
  const state = { searchMatchesByNotifyNo: new Map(), contractorMatchesByNotifyNo: new Map() };
  const elements = Object.fromEntries(["refresh", "dataState", "sourceLabel", "warning", "updatedLabel", "list", "pagination"].map(k => [k, { dataset: {} }]));
  const context = vm.createContext({
    state, elements, Date, DATA_URL: "tenders.json", EQUIPMENT_SEARCH_URL: "equipment.json", CONTRACTOR_SEARCH_URL: "contractors.json",
    indexEquipment: () => new Map(), indexContractors: () => new Map(), formatDate: v => v, render() {},
    fetch: async (url, options) => {
      calls.push({ url, cache: options.cache });
      const fresh = url.includes("?t=") && options.cache === "reload";
      return { ok: true, json: async () => url.startsWith("tenders")
        ? { tenders: [{ notifyNo: "IB2600580813" }], fetchedAt: fresh ? "2026-10-17T11:37:28Z" : "2026-10-17T07:07:57Z" }
        : {} };
    },
  });
  vm.runInContext(code, context);
  await context.loadData();
  assert.equal(state.fetchedAt, "2026-10-17T11:37:28Z");
  assert.equal(state.tenders[0].notifyNo, "IB2600580813");
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(call.url, /\?t=\d+$/);
    assert.equal(call.cache, "reload");
  }
  assert.equal(elements.dataState.dataset.state, "live");
});

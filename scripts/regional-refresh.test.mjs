import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("số vùng và tổng gói theo snapshot mới dù tải chậm; giữ IB2600518070 đa tỉnh", async () => {
  const select = { innerHTML: "", value: "", addEventListener() {} };
  const strip = { innerHTML: "" };
  const state = {
    fetchedAt: "2026-10-15T09:30:34Z",
    tenders: [
      { notifyNo: "IB2600518070", regionSlug: "lam-dong", regionSlugs: ["gia-lai", "lam-dong"] },
      { notifyNo: "IB2300271879", regionSlug: "gia-lai" },
    ],
  };
  const regions = [{ slug: "gia-lai", name: "Gia Lai" }, { slug: "lam-dong", name: "Lâm Đồng" }];
  let coverageRequests = 0;
  let finishMetadata;
  const context = vm.createContext({
    state,
    document: {
      readyState: "complete",
      querySelector: (selector) => ({ "#region-filter": select, "#regional-coverage-strip": strip })[selector] || null,
    },
    location: { search: "" },
    localStorage: { getItem: () => null },
    URLSearchParams,
    console,
    elements: {},
    render() {}, periodTenders: () => state.tenders, filteredTenders: () => state.tenders,
    tenderMarkup: () => '<div class="tender-meta">',
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
    fetch: async (url) => {
      if (url.includes("regions.json")) return { ok: true, json: async () => ({ regions }) };
      coverageRequests++;
      if (coverageRequests <= 2) return { ok: true, json: async () => ({ totalTenderCount: 2, totalEquipmentCount: 10 }) };
      return new Promise((resolve) => { finishMetadata = () => resolve({ ok: true, json: async () => ({ totalTenderCount: 1, totalEquipmentCount: 11 }) }); });
    },
  });
  vm.runInContext(await readFile(new URL("../regional-mode.js", import.meta.url), "utf8"), context);
  await new Promise(setImmediate);
  assert.match(select.innerHTML, /Gia Lai \(2\)/);
  assert.match(select.innerHTML, /Lâm Đồng \(1\)/);
  // The old click timer has long since elapsed; the response arrives afterwards.
  state.tenders = [state.tenders[0]];
  state.fetchedAt = "2026-10-15T11:47:08Z";
  context.render();
  assert.match(select.innerHTML, /Gia Lai \(1\)/);
  assert.match(select.innerHTML, /Toàn miền Trung \(1\)/);
  assert.match(select.innerHTML, /Lâm Đồng \(1\)/);
  assert.match(strip.innerHTML, /<b>1<\/b> gói/);
  finishMetadata();
  await new Promise(setImmediate);
  assert.match(strip.innerHTML, /<b>11<\/b> thiết bị/);
  assert.equal(select.value, "gia-lai");
});

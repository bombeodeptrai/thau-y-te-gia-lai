import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadRegionalCollection } from "./regional-data.mjs";

test("đọc và gắn vùng từ các JSON nhỏ thay cho tệp tổng hợp", async (t) => {
  const dataDir = await mkdtemp(resolve(tmpdir(), "regional-data-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(resolve(dataDir, "regions.json"), JSON.stringify({
    regions: [
      { slug: "gia-lai", name: "Gia Lai" },
      { slug: "da-nang", name: "Đà Nẵng" },
    ],
  }));
  for (const slug of ["gia-lai", "da-nang"]) {
    await mkdir(resolve(dataDir, "regions", slug), { recursive: true });
  }
  await writeFile(resolve(dataDir, "regions/gia-lai/equipment.json"), JSON.stringify({
    fetchedAt: "2026-09-12T01:00:00.000Z",
    equipment: [{ notifyNo: "IB1", name: "Máy X-quang" }],
  }));
  await writeFile(resolve(dataDir, "regions/da-nang/equipment.json"), JSON.stringify({
    fetchedAt: "2026-09-12T02:00:00.000Z",
    equipment: [{ notifyNo: "IB2", name: "Máy siêu âm", regionSlug: "da-nang" }],
  }));

  const result = await loadRegionalCollection(dataDir, "equipment.json", "equipment");
  assert.equal(result.source, "regional-files");
  assert.equal(result.loadedRegionCount, 2);
  assert.equal(result.equipment.length, 2);
  assert.deepEqual(result.equipment.map((item) => item.regionSlug), ["gia-lai", "da-nang"]);
  assert.equal(result.fetchedAt, "2026-09-12T02:00:00.000Z");
});

test("chỉ dùng tệp tổng hợp làm dự phòng khi chưa có tệp vùng", async (t) => {
  const dataDir = await mkdtemp(resolve(tmpdir(), "regional-data-legacy-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(resolve(dataDir, "regions.json"), JSON.stringify({ regions: [] }));
  await writeFile(resolve(dataDir, "bidders.json"), JSON.stringify({
    bidders: [{ id: "legacy" }],
    fetchedAt: "2026-09-11T00:00:00.000Z",
  }));

  const result = await loadRegionalCollection(dataDir, "bidders.json", "bidders");
  assert.equal(result.source, "legacy-global-fallback");
  assert.equal(result.bidders.length, 1);
});

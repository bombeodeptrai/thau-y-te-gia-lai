import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConcurrentTenderDelta,
  buildConcurrentTenderDelta,
} from "./merge-concurrent-tenders.mjs";

const regions = [
  { slug: "gia-lai", name: "Gia Lai", provinceCodes: ["52", "64"] },
  { slug: "lam-dong", name: "Lâm Đồng", provinceCodes: ["68"] },
];

test("giữ gói phát sinh trên main sau khi quét nền bắt đầu", () => {
  const base = [{ notifyNo: "IB-OLD", regionSlug: "gia-lai", name: "Cũ" }];
  const current = [
    ...base,
    { notifyNo: "DC-NEW", regionSlug: "gia-lai", name: "Thuốc mới", publicDate: "2026-10-03" },
  ];
  const delta = buildConcurrentTenderDelta(base, current);
  const result = applyConcurrentTenderDelta(
    { tenders: [...base] },
    regions[0],
    regions,
    delta,
  );
  assert.deepEqual(result.payload.tenders.map((item) => item.notifyNo), ["DC-NEW", "IB-OLD"]);
});

test("không khôi phục gói đã bị xóa hợp lệ khỏi main", () => {
  const base = [
    { notifyNo: "IB-KEEP", regionSlug: "gia-lai" },
    { notifyNo: "IB-REMOVE", regionSlug: "gia-lai" },
  ];
  const current = [{ notifyNo: "IB-KEEP", regionSlug: "gia-lai" }];
  const delta = buildConcurrentTenderDelta(base, current);
  const result = applyConcurrentTenderDelta(
    { tenders: [...base, { notifyNo: "IB-DEEP", regionSlug: "gia-lai" }] },
    regions[0],
    regions,
    delta,
  );
  assert.deepEqual(
    result.payload.tenders.map((item) => item.notifyNo).sort(),
    ["IB-DEEP", "IB-KEEP"],
  );
});

test("áp dụng thay đổi membership đa tỉnh mà không làm mất dữ liệu quét sâu", () => {
  const base = [{ notifyNo: "IB-MULTI", regionSlug: "lam-dong", name: "Bản cũ" }];
  const current = [{
    notifyNo: "IB-MULTI",
    regionSlug: "lam-dong",
    regionSlugs: ["lam-dong", "gia-lai"],
    name: "Bản mới",
  }];
  const delta = buildConcurrentTenderDelta(base, current);
  const result = applyConcurrentTenderDelta(
    {
      tenders: [
        { notifyNo: "IB-DEEP", regionSlug: "gia-lai" },
        { notifyNo: "IB-MULTI", regionSlug: "gia-lai", winningModels: ["Model A"] },
      ],
    },
    regions[0],
    regions,
    delta,
  );
  const multi = result.payload.tenders.find((item) => item.notifyNo === "IB-MULTI");
  assert.equal(multi.name, "Bản mới");
  assert.deepEqual(multi.regionSlugs, ["gia-lai", "lam-dong"]);
  assert.deepEqual(multi.winningModels, ["Model A"]);
  assert.ok(result.payload.tenders.some((item) => item.notifyNo === "IB-DEEP"));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConcurrentTenderDelta,
  buildConcurrentTenderDelta,
  preserveMissingCurrentTenders,
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

test("bổ sung chi tiết không được làm mất gói hợp lệ còn có trên main: IB2600573479", () => {
  const current = [
    {
      notifyNo: "IB2600573479",
      regionSlug: "gia-lai",
      name: "Mua sắm bổ sung vật tư phục vụ công tác khám sức khỏe toàn dân",
      investor: "Trung tâm Y tế Tuy Phước",
      publicDate: "2026-10-09T16:40:00",
    },
  ];
  const result = preserveMissingCurrentTenders(
    { tenders: [] },
    regions[0],
    regions,
    current,
    { now: Date.parse("2026-10-11T02:49:55.000Z") },
  );
  assert.equal(result.restored, 1);
  assert.deepEqual(result.payload.tenders.map((item) => item.notifyNo), ["IB2600573479"]);
});

test("không giữ lại gói đã hết phạm vi 1.095 ngày", () => {
  const result = preserveMissingCurrentTenders(
    { tenders: [] },
    regions[0],
    regions,
    [{
      notifyNo: "IB2300267784",
      regionSlug: "gia-lai",
      name: "Mua sắm linh kiện cho các máy xét nghiệm sinh hoá",
      investor: "Bệnh viện Đa khoa tỉnh Gia Lai",
      publicDate: "2023-10-12T10:49:56.000Z",
    }],
    { now: Date.parse("2026-10-11T10:49:57.000Z") },
  );
  assert.equal(result.restored, 0);
  assert.equal(result.payload.tenders.length, 0);
});

test("giữ dữ liệu quét sâu khi gói hiện tại đã có trong kết quả", () => {
  const result = preserveMissingCurrentTenders(
    { tenders: [{ notifyNo: "IB-KEEP", regionSlug: "gia-lai", winningModels: ["Model sâu"] }] },
    regions[0],
    regions,
    [{ notifyNo: "IB-KEEP", regionSlug: "gia-lai", winningModels: [] }],
  );
  assert.equal(result.restored, 0);
  assert.deepEqual(result.payload.tenders[0].winningModels, ["Model sâu"]);
});

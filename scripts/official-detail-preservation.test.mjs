import assert from "node:assert/strict";
import test from "node:test";
import {
  detailFilesForManifest,
  isOfficialDetailFileName,
  mergeOfficialDetail,
  preserveTenderBidderCount,
} from "./official-detail-preservation.mjs";

test("nhận cả hồ sơ IB và DC, chỉ giữ tệp thuộc manifest theo thứ tự ổn định", () => {
  assert.equal(isOfficialDetailFileName("IB2600000001.json"), true);
  assert.equal(isOfficialDetailFileName("DC2600000002.json"), true);
  assert.equal(isOfficialDetailFileName("manual-1.json"), false);
  assert.deepEqual(
    detailFilesForManifest(
      ["DC2600000002.json", "IB2600000001.json", "DC2600000002.json", "ZZ2600000003.json"],
      [
        { notifyNo: "IB2600000001" },
        { notifyNo: "DC2600000002" },
      ],
    ),
    ["DC2600000002.json", "IB2600000001.json"],
  );
});

test("không xóa kết quả nhà thầu và thiết bị khi nguồn làm mới tạm trả rỗng", () => {
  const previous = {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 2,
    bidders: [{ name: "Nhà thầu A" }],
    items: [{ name: "Máy A" }, { name: "Máy B" }],
    requirements: { total: 1, items: [{ name: "Lô cũ" }], disclosure: "public-plan-lots" },
    technicalRequirements: { total: 1, items: [{ content: "Thông số cũ" }] },
    fetchedAt: "2026-10-04T00:00:00.000Z",
  };
  const current = {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 0,
    bidders: [],
    items: [],
    requirements: { total: 0, items: [], disclosure: "temporarily-unavailable" },
    technicalRequirements: { total: 0, items: [], disclosure: "temporarily-unavailable" },
    fetchedAt: "2026-10-05T00:00:00.000Z",
  };
  const merged = mergeOfficialDetail(previous, current);
  assert.deepEqual(merged.bidders, previous.bidders);
  assert.deepEqual(merged.items, previous.items);
  assert.deepEqual(merged.requirements.items, previous.requirements.items);
  assert.deepEqual(merged.technicalRequirements.items, previous.technicalRequirements.items);
  assert.equal(merged.requirements.disclosure, "public-plan-lots");
  assert.equal(merged.total, 2);
  assert.equal(merged.fetchedAt, current.fetchedAt);
});

test("dùng dữ liệu mới khi nguồn chính thức trả về nội dung đầy đủ", () => {
  const merged = mergeOfficialDetail(
    {
      total: 1,
      bidders: [{ name: "Cũ" }],
      items: [{ name: "Thiết bị cũ" }],
      requirements: { total: 1, items: [{ name: "Lô cũ" }] },
      technicalRequirements: { total: 1, items: [{ content: "Cũ" }] },
    },
    {
      total: 2,
      bidders: [{ name: "Mới" }],
      items: [{ name: "Thiết bị mới 1" }, { name: "Thiết bị mới 2" }],
      requirements: { total: 1, items: [{ name: "Lô mới" }] },
      technicalRequirements: { total: 1, items: [{ content: "Mới" }] },
    },
  );
  assert.deepEqual(merged.bidders, [{ name: "Mới" }]);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.requirements.items[0].name, "Lô mới");
  assert.equal(merged.technicalRequirements.items[0].content, "Mới");
});

test("không để quét nhanh ghi đè số nhà thầu đã bổ sung chi tiết về 0", () => {
  assert.equal(
    preserveTenderBidderCount(
      { bidderCount: 1, winnerNames: ["Nhà thầu A"] },
      { bidderCount: 0, winnerNames: [] },
      { winnerNames: ["Nhà thầu A"], participantNames: [] },
    ),
    1,
  );
  assert.equal(
    preserveTenderBidderCount(
      { bidderCount: null },
      { bidderCount: 0 },
      { winnerNames: ["Nhà thầu A", "Nhà thầu B"] },
    ),
    2,
  );
});

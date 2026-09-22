import test from "node:test";
import assert from "node:assert/strict";
import {
  retainedOfficialTenderCount,
  shouldReplaceRescueCollectionMetadata,
  shouldRetainStoredTender,
} from "./scan-baseline.mjs";

const now = Date.parse("2026-09-21T06:00:00.000Z");

test("ngưỡng quét chỉ tính gói y tế còn trong 1.095 ngày", () => {
  const payload = {
    tenders: [
      {
        notifyNo: "IB2600518070",
        name: "Mua sắm xe lăn hỗ trợ nạn nhân chất độc da cam",
        investor: "Quỹ nạn nhân chất độc da cam",
        publicDate: "2026-09-13T00:00:00.000Z",
        regionSlug: "lam-dong",
        regionSlugs: ["gia-lai", "lam-dong"],
      },
      {
        notifyNo: "IB2300000001",
        name: "Mua sắm vật tư y tế",
        investor: "Bệnh viện Đa khoa Gia Lai",
        publicDate: "2023-09-01T00:00:00.000Z",
        regionSlug: "gia-lai",
      },
      {
        notifyNo: "IB2600000002",
        name: "Mua vật tư tiêu hao phục vụ ngành kỹ thuật ô tô",
        investor: "Trường Đại học Quy Nhơn",
        publicDate: "2026-01-01T00:00:00.000Z",
        regionSlug: "gia-lai",
      },
      {
        id: "manual-example",
        name: "Mua vật tư y tế",
        investor: "Bệnh viện Đa khoa Gia Lai",
        publicDate: "2026-01-01T00:00:00.000Z",
        regionSlug: "gia-lai",
      },
    ],
  };

  assert.equal(retainedOfficialTenderCount(payload, {
    regionSlug: "gia-lai",
    scanDays: 1095,
    now,
  }), 1);
});

test("gói đa tỉnh không bị loại khỏi ngưỡng của tỉnh liên quan", () => {
  const payload = {
    tenders: [{
      notifyNo: "IB2600518070",
      name: "Mua sắm xe lăn hỗ trợ nạn nhân chất độc da cam",
      investor: "Quỹ nạn nhân chất độc da cam",
      publicDate: "2026-09-13T00:00:00.000Z",
      regionSlug: "lam-dong",
      regionSlugs: ["gia-lai", "lam-dong"],
    }],
  };

  assert.equal(retainedOfficialTenderCount(payload, { regionSlug: "gia-lai", now }), 1);
  assert.equal(retainedOfficialTenderCount(payload, { regionSlug: "da-nang", now }), 0);
});

test("giữ gói hợp lệ còn hạn khi lượt quét mã tỉnh tạm thời không trả về", () => {
  const recentLocationOnlyTender = {
    notifyNo: "IB2600518070",
    name: "Mua sắm xe lăn hỗ trợ nạn nhân chất độc da cam",
    investor: "Quỹ nạn nhân chất độc da cam",
    publicDate: "2026-09-13T00:00:00.000Z",
  };
  const expiredTender = {
    ...recentLocationOnlyTender,
    notifyNo: "IB2300000001",
    publicDate: "2023-09-01T00:00:00.000Z",
  };

  assert.equal(shouldRetainStoredTender(recentLocationOnlyTender, { now }), true);
  assert.equal(shouldRetainStoredTender(expiredTender, { now }), false);
});

test("quét nhanh không ghi đè metadata của đối chiếu 30 ngày", () => {
  const collection = { lastMedicalRescueDays: 30 };

  assert.equal(shouldReplaceRescueCollectionMetadata(collection, 7), false);
  assert.equal(shouldReplaceRescueCollectionMetadata(collection, 14), false);
  assert.equal(shouldReplaceRescueCollectionMetadata(collection, 30), true);
  assert.equal(shouldReplaceRescueCollectionMetadata(collection, 1095), true);
});

test("lượt quét đầu tiên được phép tạo metadata đối chiếu", () => {
  assert.equal(shouldReplaceRescueCollectionMetadata({}, 7), true);
});

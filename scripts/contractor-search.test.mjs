import test from "node:test";
import assert from "node:assert/strict";
import { buildContractorSearchRows } from "./contractor-search.mjs";

test("tạo chỉ mục tra cứu nhà thầu theo tên và mã số thuế", () => {
  const rows = buildContractorSearchRows([
    {
      notifyNo: "IB2400562576",
      contractorName: "CÔNG TY CỔ PHẦN ĐẦU TƯ Y TẾ VIỆT MỸ",
      contractorCode: "vn0123456789",
      taxCode: "0123456789",
      status: "won",
      lotName: "Cung cấp, lắp đặt thiết bị y tế",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].notifyNo, "IB2400562576");
  assert.equal(rows[0].contractorName, "CÔNG TY CỔ PHẦN ĐẦU TƯ Y TẾ VIỆT MỸ");
  assert.equal(rows[0].taxCode, "0123456789");
  assert.equal(rows[0].status, "won");
});

test("loại dòng trùng và dòng không có định danh nhà thầu", () => {
  const bidder = {
    notifyNo: "IB2600000001",
    contractorName: "Công ty A",
    taxCode: "5900000001",
    status: "participating",
  };
  const rows = buildContractorSearchRows([bidder, { ...bidder }, { notifyNo: "IB2" }]);
  assert.equal(rows.length, 1);
});

test("bổ sung nhà thầu từ kết quả gói khi bidders chưa có dữ liệu", () => {
  const rows = buildContractorSearchRows([], [
    {
      notifyNo: "IB2400562576",
      winnerNames: ["CÔNG TY CỔ PHẦN ĐẦU TƯ Y TẾ VIỆT MỸ"],
      participantNames: ["CÔNG TY THIẾT BỊ Y TẾ KHÁC"],
      regionSlug: "gia-lai",
      region: "Gia Lai",
    },
  ]);

  assert.deepEqual(rows, [
    {
      notifyNo: "IB2400562576",
      contractorName: "CÔNG TY THIẾT BỊ Y TẾ KHÁC",
      contractorCode: "",
      taxCode: "",
      status: "participating",
      lotName: "",
      regionSlug: "gia-lai",
      region: "Gia Lai",
    },
    {
      notifyNo: "IB2400562576",
      contractorName: "CÔNG TY CỔ PHẦN ĐẦU TƯ Y TẾ VIỆT MỸ",
      contractorCode: "",
      taxCode: "",
      status: "won",
      lotName: "",
      regionSlug: "gia-lai",
      region: "Gia Lai",
    },
  ]);
});

test("ưu tiên trạng thái trúng thầu khi cùng nhà thầu xuất hiện nhiều nguồn", () => {
  const rows = buildContractorSearchRows([
    {
      notifyNo: "IB2400562576",
      contractorName: "Công ty Việt Mỹ",
      status: "participating",
      taxCode: "0123456789",
    },
  ], [
    {
      notifyNo: "IB2400562576",
      winnerNames: ["Công ty Việt Mỹ"],
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "won");
  assert.equal(rows[0].taxCode, "0123456789");
});

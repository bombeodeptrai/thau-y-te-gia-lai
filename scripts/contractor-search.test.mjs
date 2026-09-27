import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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

test("ô tìm kiếm chính tra được cả tên nhà thầu và MST từ chỉ mục", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const boundary = source.indexOf("function savedTenderMarkup");
  assert.ok(boundary > 0, "không tìm thấy ranh giới hàm lọc trong app.js");

  const element = {};
  const context = vm.createContext({
    document: { querySelector: () => element },
    localStorage: { getItem: () => null },
    window: { tenderDisplayTime: { withinSnapshotDays: () => true } },
    URL,
    console,
  });
  vm.runInContext(`${source.slice(0, boundary)}\nthis.__searchTest = { state, indexContractors, filteredTenders };`, context);
  const { state, indexContractors, filteredTenders } = context.__searchTest;
  state.tenders = [{
    id: "aca7aa68-00b4-4db6-906a-ed5caee54902",
    notifyNo: "IB2600293301",
    name: "Mua sắm thiết bị y tế",
    investor: "Bệnh viện Bình Định",
    publicDate: "2026-06-17T00:00:00.000Z",
    category: "Thiết bị y tế",
    status: "awarded",
  }];
  state.contractorsByNotifyNo = indexContractors([{
    notifyNo: "IB2600293301",
    contractorName: "CÔNG TY TRÁCH NHIỆM HỮU HẠN KIỂU VIỆT",
    contractorCode: "vn4100596520",
    taxCode: "4100596520",
    status: "lost",
  }]);

  state.query = "4100596520";
  assert.equal(filteredTenders()[0]?.notifyNo, "IB2600293301");
  assert.equal(state.contractorMatchesByNotifyNo.get("IB2600293301")?.[0]?.taxCode, "4100596520");

  state.query = "Kiểu Việt";
  assert.equal(filteredTenders()[0]?.notifyNo, "IB2600293301");
});

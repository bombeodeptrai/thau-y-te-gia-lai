import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficialSourceUrl,
  officialSourceStep,
  repairOfficialSourceUrl,
} from "./official-source.mjs";

test("mở gói chỉ công bố kết quả ở đúng tab KQLCNT", () => {
  const sourceUrl = buildOfficialSourceUrl({
    id: "IB2600525594",
    notifyId: "IB2600525594",
    notifyNo: "IB2600525594-00",
    inputResultId: "8203bd1a-2ade-46c5-b79b-81a964a78fd2",
    bidId: "479c9cb3-5636-4592-beac-0e144adf4d57",
    stepCode: "notify-contractor-step-4-kqlcnt",
    bidForm: "CDTRG",
    isInternet: 0,
  });
  const url = new URL(sourceUrl);

  assert.equal(url.searchParams.get("step"), "kqlcnt");
  assert.equal(url.searchParams.get("notifyId"), "IB2600525594");
  assert.equal(
    url.searchParams.get("inputResultId"),
    "8203bd1a-2ade-46c5-b79b-81a964a78fd2",
  );
  assert.equal(url.searchParams.get("isInternet"), "0");
});

test("giữ gói đang mời thầu ở tab TBMT", () => {
  const sourceUrl = buildOfficialSourceUrl({
    id: "6a1a1c46-a831-4c91-bc42-acde01343210",
    notifyId: "6a1a1c46-a831-4c91-bc42-acde01343210",
    notifyNo: "IB2600530000-00",
  });
  assert.equal(new URL(sourceUrl).searchParams.get("step"), "tbmt");
});

test("không đổi tab mặc định chỉ vì hồ sơ đã có biên bản mở thầu", () => {
  assert.equal(officialSourceStep({ bidOpenId: "a-valid-bid-open-id" }), "tbmt");
});

test("không ghi chuỗi null hoặc undefined vào link", () => {
  const sourceUrl = buildOfficialSourceUrl({
    id: "IB2600530001",
    inputResultId: "null",
    bidOpenId: undefined,
    techReqId: "undefined",
  });
  assert.equal(sourceUrl.includes("=null"), false);
  assert.equal(sourceUrl.includes("=undefined"), false);
  assert.equal(new URL(sourceUrl).searchParams.get("step"), "tbmt");
});

test("sửa link cũ đang ép kết quả lựa chọn nhà thầu về tab TBMT", () => {
  const oldUrl = buildOfficialSourceUrl({
    id: "IB2600525594",
    inputResultId: "8203bd1a-2ade-46c5-b79b-81a964a78fd2",
  }).replace("step=kqlcnt", "step=tbmt");
  assert.equal(new URL(repairOfficialSourceUrl(oldUrl)).searchParams.get("step"), "kqlcnt");
});

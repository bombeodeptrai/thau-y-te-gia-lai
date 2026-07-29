import test from "node:test";
import assert from "node:assert/strict";
import { canonicalNotifyNo, isMedicalTender } from "./medical-scope.mjs";

const hospital = "Bệnh viện Đa khoa Gia Lai";

for (const title of [
  "Gói 6. Hóa chất sử dụng trên máy miễn dịch huỳnh quang gồm 02 mặt hàng 01 phần (lô)",
  "Gói số 5. Hóa chất sử dụng cho máy ELISA miễn dịch bán tự động gồm 06 mặt hàng 01 phần (lô)",
  "Gói 4. Hóa chất sử dụng trên máy Xét nghiệm HbA1C gồm 03 mặt hàng 01 phần (lô)",
  "Gói 3. Hóa chất sử dụng trên máy miễn dịch tự động gồm 08 mặt hàng 01 phần (lô)",
]) {
  test(`nhận đúng gói xét nghiệm: ${title.slice(0, 45)}`, () => {
    assert.equal(isMedicalTender({ bidName: [title], investorName: hospital }), true);
  });
}

test("không nhận gói điện lực dù có chữ vật tư thiết bị", () => {
  assert.equal(isMedicalTender({
    bidName: ["Cung cấp VTTB và dịch vụ thay thế hệ thống điều tốc các tổ máy"],
    investorName: "Công ty Dịch vụ Điện lực Miền Trung",
  }), false);
});

test("không nhận hóa chất xử lý nước của bệnh viện", () => {
  assert.equal(isMedicalTender({
    bidName: ["Mua hóa chất xử lý nước thải năm 2026"],
    investorName: hospital,
  }), false);
});

test("chuẩn hóa mã TBMT có hậu tố -00", () => {
  assert.equal(canonicalNotifyNo("IB2600349751-00"), "IB2600349751");
});

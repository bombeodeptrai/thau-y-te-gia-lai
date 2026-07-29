import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalNotifyNo,
  classifyMedicalTender,
  isMedicalTender,
} from "./medical-scope.mjs";

const hospital = "Bệnh viện Đa khoa tỉnh";

for (const title of [
  "Hóa chất sử dụng trên máy miễn dịch huỳnh quang gồm 02 mặt hàng",
  "Hóa chất sử dụng cho máy ELISA miễn dịch bán tự động",
  "Hóa chất sử dụng trên máy xét nghiệm HbA1C",
  "Hóa chất sử dụng trên máy miễn dịch tự động",
  "Cung cấp thuốc thử, chất hiệu chuẩn và vật tư cho hệ thống xét nghiệm miễn dịch",
  "Mua hóa chất chạy trên máy phân tích huyết học",
  "Sinh phẩm chẩn đoán in vitro phục vụ xét nghiệm",
]) {
  test(`nhận đúng gói xét nghiệm theo ngữ cảnh: ${title}`, () => {
    const result = classifyMedicalTender({ bidName: [title], investorName: hospital });
    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.category, "Vật tư & hóa chất");
  });
}

test("nhận hóa chất dùng cho máy có tên thương mại tại cơ sở y tế", () => {
  assert.equal(isMedicalTender({
    bidName: ["Mua hóa chất sử dụng cho máy ARCHITECT i2000SR"],
    investorName: hospital,
  }), true);
});

for (const [title, investor] of [
  ["Cung cấp vật tư thiết bị và dịch vụ thay thế hệ thống điều tốc các tổ máy", "Công ty Điện lực"],
  ["Mua hóa chất xử lý nước thải năm 2026", hospital],
  ["Mua máy chủ và thiết bị công nghệ thông tin", hospital],
  ["Cải tạo, sửa chữa khu xét nghiệm", hospital],
  ["Mua văn phòng phẩm phục vụ bệnh viện", hospital],
  ["Mua hóa chất giặt là cho máy giặt công nghiệp", hospital],
]) {
  test(`loại đúng gói ngoài phạm vi: ${title}`, () => {
    const result = classifyMedicalTender({ bidName: [title], investorName: investor });
    assert.equal(result.accepted, false);
    assert.match(result.reason, /excluded|insufficient/);
  });
}

test("không dùng tên bệnh viện làm điều kiện duy nhất", () => {
  assert.equal(isMedicalTender({
    bidName: ["Mua sắm hàng hóa phục vụ hoạt động năm 2026"],
    investorName: hospital,
  }), false);
});

test("chuẩn hóa mã TBMT có hậu tố -00", () => {
  assert.equal(canonicalNotifyNo("IB2600349751-00"), "IB2600349751");
});

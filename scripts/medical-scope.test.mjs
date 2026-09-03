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

test("nhận gói liệt kê nhiều nhóm vật tư chuyên môn tại cơ sở y tế", () => {
  const result = classifyMedicalTender({
    notifyNo: "IB2600482835-00",
    bidName: ["Mua sắm vật tư, hóa chất, sinh phẩm bổ sung năm 2026 (Lần 2)"],
    investorName: "Trung tâm Y tế An Nhơn",
  });

  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.category, "Vật tư & hóa chất");
  assert.ok(result.reason.includes("medical-supply-bundle"));
  assert.ok(result.matched.includes("vat tu"));
  assert.ok(result.matched.includes("hoa chat"));
  assert.ok(result.matched.includes("sinh pham"));
});

test("không nhận gói nhiều nhóm vật tư nếu chủ đầu tư không thuộc ngành y tế", () => {
  const result = classifyMedicalTender({
    bidName: ["Mua sắm vật tư, hóa chất, sinh phẩm bổ sung năm 2026"],
    investorName: "Công ty sản xuất công nghiệp",
  });
  assert.equal(result.accepted, false, result.reason);
});

test("nhận giường bệnh chuyên dụng nhưng không mở rộng sang nội thất hành chính", () => {
  const medicalBed = classifyMedicalTender({
    bidName: ["Mua sắm giường bệnh, ghế đa năng và tủ đầu giường cho các phòng bệnh dịch vụ theo yêu cầu của Bệnh viện Sản - Nhi tỉnh Gia Lai năm 2026"],
    investorName: "Bệnh viện Sản - Nhi tỉnh Gia Lai",
  });
  assert.equal(medicalBed.accepted, true, medicalBed.reason);
  assert.equal(medicalBed.category, "Thiết bị y tế");
  assert.ok(medicalBed.matched.includes("giuong benh"));

  const officeFurniture = classifyMedicalTender({
    bidName: ["Mua sắm bàn ghế, giường tủ nội thất phục vụ khối hành chính"],
    investorName: hospital,
  });
  assert.equal(officeFurniture.accepted, false, officeFurniture.reason);
});

for (const title of [
  "Mua sắm vật tư sử dụng cho máy thận 4008S",
  "Mua đệm (gioăng) cửa dùng cho máy hấp tiệt trùng hơi nước dòng máy Lumo, trang bị cho khoa Kiểm soát nhiễm khuẩn",
]) {
  test(`nhận vật tư gắn với máy y tế tại bệnh viện: ${title}`, () => {
    const result = classifyMedicalTender({ bidName: [title], investorName: hospital });
    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.category, "Vật tư & hóa chất");
  });
}

for (const [title, investor] of [
  ["Cung cấp vật tư thiết bị và dịch vụ thay thế hệ thống điều tốc các tổ máy", "Công ty Điện lực"],
  ["Mua hóa chất xử lý nước thải năm 2026", hospital],
  ["Mua máy chủ và thiết bị công nghệ thông tin", hospital],
  ["Cải tạo, sửa chữa khu xét nghiệm", hospital],
  ["Mua văn phòng phẩm phục vụ bệnh viện", hospital],
  ["Mua hóa chất giặt là cho máy giặt công nghiệp", hospital],
  ["Chỉnh lý, số hóa hồ sơ lưu trữ của Đảng ủy 03 xã trước sáp nhập (xã An Nhơn Tây (cũ), xã An Phú, xã Phú Mỹ Hưng)", "Văn phòng Đảng ủy xã An Nhơn Tây"],
  ["Thuê phần mềm quản lý bệnh viện, phần mềm quản lý bệnh án điện tử, phần mềm quản lý chẩn đoán hình ảnh năm 2026-2029", "Trung tâm Y tế Phù Cát"],
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

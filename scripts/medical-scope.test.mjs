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

for (const [notifyNo, title] of [
  ["IB2600550501-00", "Gói 1: Hóa chất, sinh phẩm dùng cho hoạt động labo"],
  ["IB2600550514-00", "Gói 2: Hóa chất, sinh phẩm dùng cho đề tài"],
]) {
  test(`nhận bộ hóa chất sinh phẩm labo tại viện y tế: ${notifyNo}`, () => {
    const result = classifyMedicalTender({
      notifyNo,
      bidName: [title],
      investorName: "Viện Sốt rét - Ký sinh trùng - Côn trùng Quy Nhơn",
    });

    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.category, "Vật tư & hóa chất");
    assert.ok(result.reason.includes("medical-laboratory-supply-bundle"));
    assert.ok(result.matched.includes("hoa chat"));
    assert.ok(result.matched.includes("sinh pham"));
  });
}

test("không nhận bộ hóa chất sinh phẩm nghiên cứu của đơn vị ngoài y tế", () => {
  const result = classifyMedicalTender({
    bidName: ["Hóa chất, sinh phẩm phục vụ đề tài xử lý môi trường"],
    investorName: "Viện Nghiên cứu Tài nguyên và Môi trường",
  });

  assert.equal(result.accepted, false, result.reason);
});

test("không dùng một nhóm hóa chất chung tại viện y tế làm điều kiện đủ", () => {
  const result = classifyMedicalTender({
    bidName: ["Hóa chất dùng cho đề tài"],
    investorName: "Viện Sốt rét - Ký sinh trùng - Côn trùng Quy Nhơn",
  });

  assert.equal(result.accepted, false, result.reason);
});

test("nhận gói test ma túy tại trung tâm y tế", () => {
  const result = classifyMedicalTender({
    notifyNo: "IB2600503446-00",
    bidName: ["Mua sắm test ma túy 05 thành phần (Mã 17.2026)"],
    investorName: "Trung tâm Y tế Phù Mỹ",
  });

  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.category, "Vật tư & hóa chất");
  assert.ok(result.reason.includes("explicit-medical-title"));
  assert.ok(result.matched.includes("test ma tuy"));
});

test("nhận gói túi máu của bệnh viện", () => {
  const result = classifyMedicalTender({
    notifyNo: "IB2600463157-00",
    bidName: ["Gói 4. Túi máu các loại phục vụ hoạt động chuyên môn năm 2026"],
    investorName: "Bệnh viện Đa khoa Gia Lai",
  });

  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.category, "Vật tư & hóa chất");
  assert.ok(result.matched.includes("tui mau"));
});

test("nhận gói xe lăn hỗ trợ nạn nhân chất độc da cam thực hiện tại Gia Lai", () => {
  const result = classifyMedicalTender({
    notifyNo: "IB2600518070-00",
    bidName: ["Mua sắm xe lăn hỗ trợ cho nạn nhân chất độc da cam/dioxin Việt Nam"],
    investorName: "Quỹ nạn nhân chất độc da cam/dioxin Việt Nam",
  });

  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.category, "Thiết bị y tế");
  assert.ok(result.reason.includes("explicit-medical-title"));
  assert.ok(result.matched.includes("xe lan"));
});

test("nhận gói thuốc bó dược liệu của bệnh viện y dược cổ truyền", () => {
  const result = classifyMedicalTender({
    notifyNo: "IB2600535702-00",
    bidName: ["Thuốc bó dược liệu của Bệnh viện Y dược cổ truyền và Phục hồi chức năng Pleiku năm 2026"],
    investorName: "Bệnh viện Y dược cổ truyền và Phục hồi chức năng Pleiku",
  });

  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.category, "Vật tư & hóa chất");
  assert.ok(result.reason.includes("explicit-medical-title"));
  assert.ok(result.matched.includes("thuoc bo"));
});

test("không mở rộng từ thuốc bó sang mọi gói dược liệu", () => {
  const result = classifyMedicalTender({
    bidName: ["Cung cấp cây giống và dược liệu phục vụ mô hình nông nghiệp"],
    investorName: "Trung tâm dịch vụ nông nghiệp",
  });

  assert.equal(result.accepted, false, result.reason);
});

for (const [notifyNo, title, investor] of [
  [
    "IB2600520648-00",
    "Cung cấp dịch vụ kiểm định, hiệu chuẩn thiết bị y tế của Trung tâm Y tế An Nhơn năm 2026 (Lần 2)",
    "Trung tâm Y tế An Nhơn",
  ],
  [
    "IB2600517233-00",
    "Gói thầu số 1: Sửa chữa Ghế nha khoa, Máy Xquang C-Arm, Hệ thống rửa tay tự động và Tủ sấy năm 2026",
    "Trung tâm Y tế Pleiku",
  ],
  [
    "IB2500463852-00",
    "Bảo trì bảo dưỡng trang thiết bị y tế",
    "Công an tỉnh Gia Lai",
  ],
]) {
  test(`nhận dịch vụ dành riêng cho thiết bị y tế: ${notifyNo}`, () => {
    const result = classifyMedicalTender({ notifyNo, bidName: [title], investorName: investor });
    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.category, "Thiết bị y tế");
    assert.ok(result.reason.includes("medical-equipment-service"));
  });
}

for (const [notifyNo, title, investor] of [
  ["IB2600311793-00", "Gói 25. Vật tư thận niệu gồm 08 mặt hàng 08 phần (lô)", "Bệnh viện Đa khoa Gia Lai"],
  ["IB2600313785-00", "Gói 22. Tay dao, dây dao siêu âm gồm 05 mặt hàng", "Bệnh viện Đa khoa Gia Lai"],
  ["IB2600313356-00", "Gói 21. Khớp gối, khớp háng bán phần, toàn phần", "Bệnh viện Đa khoa Gia Lai"],
  ["IB2600312004-00", "Gói 19. Đinh, nẹp, vít, khóa gồm 46 mặt hàng", "Bệnh viện Đa khoa Gia Lai"],
  ["IB2600300426-00", "Mua sắm 12 Micropipet", "Bệnh viện Đa khoa Trung tâm tỉnh Gia Lai"],
  ["IB2600264745-00", "Bộ dây truyền dịch, truyền máu", "Bệnh viện Đa khoa Gia Lai"],
  ["IB2600239471-00", "Mua sắm 01 bình nitơ lưu trữ mẫu", "Bệnh viện Đa khoa Trung tâm tỉnh Gia Lai"],
  ["IB2300372771-00", "Vật tư tiêu hao phục vụ nghiên cứu khoa học", "Viện Sốt rét Ký sinh trùng Côn trùng Quy Nhơn"],
  ["IB2400210144-00", "Mua sắm vật tư tiêu hao và hoá chất tẩy rửa", "Bệnh viện Đa khoa tỉnh Gia Lai"],
]) {
  test(`giữ gói vật tư chuyên khoa khi quét lại: ${notifyNo}`, () => {
    const result = classifyMedicalTender({ notifyNo, bidName: [title], investorName: investor });
    assert.equal(result.accepted, true, result.reason);
    assert.ok(result.reason.includes("medical-context-supply"), result.reason);
  });
}

for (const [notifyNo, title, investor] of [
  ["IB2600165590-00", "Vật tư tiêu hao phục vụ công tác khám sức khỏe", "Công an tỉnh Gia Lai"],
  ["IB2500443781-00", "Mua sắm 01 Máy CT Scanner mô phỏng dùng trong xạ trị ung thư", "Bệnh viện Đa khoa Trung tâm tỉnh Gia Lai"],
  ["IB2500326674-00", "Cung cấp bánh xe và phụ kiện Xe băng ca; Xe tiêm thuốc", "Bệnh viện Đa khoa Trung tâm tỉnh Gia Lai"],
  ["IB2500021922-00", "Mua sắm hóa chất, vật tư tiêu hao phục vụ công tác giám định ma túy, sinh học, pháp y", "Công an tỉnh Gia Lai"],
]) {
  test(`nhận đúng ngữ cảnh y tế rõ ràng ngoài tên cơ sở: ${notifyNo}`, () => {
    const result = classifyMedicalTender({ notifyNo, bidName: [title], investorName: investor });
    assert.equal(result.accepted, true, result.reason);
    assert.ok(result.reason.includes("explicit-medical-title"), result.reason);
  });
}

test("không mở rộng từ test ma túy sang mọi gói có từ test", () => {
  const result = classifyMedicalTender({
    bidName: ["Thuê dịch vụ test tải hệ thống phần mềm"],
    investorName: "Trung tâm công nghệ thông tin",
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
  ["Kiểm định hệ thống điện bệnh viện", hospital],
  ["Sửa chữa máy tính tại bệnh viện", hospital],
  ["Bảo trì máy phát điện của bệnh viện", hospital],
  ["Mua văn phòng phẩm phục vụ bệnh viện", hospital],
  ["Mua hóa chất giặt là cho máy giặt công nghiệp", hospital],
  ["Chỉnh lý, số hóa hồ sơ lưu trữ của Đảng ủy 03 xã trước sáp nhập (xã An Nhơn Tây (cũ), xã An Phú, xã Phú Mỹ Hưng)", "Văn phòng Đảng ủy xã An Nhơn Tây"],
  ["Thuê phần mềm quản lý bệnh viện, phần mềm quản lý bệnh án điện tử, phần mềm quản lý chẩn đoán hình ảnh năm 2026-2029", "Trung tâm Y tế Phù Cát"],
  ["Mua nguyên vật liệu, vật tư tiêu hao phục vụ giảng dạy ngành Công nghệ Kỹ thuật ô tô", "Trường Đại học Quy Nhơn"],
  ["Mua sắm vật tư tiêu hao, hoá chất vận hành 06 trạm quan trắc", "Trung tâm Quan trắc tài nguyên và môi trường"],
  ["Mua sắm vật tư tiêu hao để bảo dưỡng hệ thống thiết bị CNS", "Cảng hàng không Phù Cát"],
  ["Mua hoá chất và vật tư tiêu hao thực hiện nhiệm vụ", "Trung tâm Thông tin Ứng dụng Khoa học và Công nghệ"],
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

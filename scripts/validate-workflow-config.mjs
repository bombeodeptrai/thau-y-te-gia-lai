import { readFile } from "node:fs/promises";

const files = [
  ".github/workflows/regional-full-scan.yml",
  ".github/workflows/regional-detail-backfill.yml",
  ".github/workflows/regional-quick-update.yml",
];

for (const file of files) {
  const text = await readFile(file, "utf8");
  if (!text.includes("MIN_TENDER_COUNT")) {
    throw new Error(`${file} chưa có ngưỡng chống ghi dữ liệu rỗng`);
  }
  if (!text.includes('PAGE_SIZE: "10"')) {
    throw new Error(`${file} chưa giới hạn kích thước trang an toàn`);
  }
}

const fullScan = await readFile(".github/workflows/regional-full-scan.yml", "utf8");
if (!fullScan.includes("matrix.region == 'gia-lai'") || !fullScan.includes("ENABLE_HISTORICAL_FALLBACK")) {
  throw new Error("Workflow quét sâu chưa bật quét bù địa danh riêng cho Gia Lai");
}

const quickScan = await readFile(".github/workflows/regional-quick-update.yml", "utf8");
if (!quickScan.includes('INCREMENTAL_DAYS: "14"') || !quickScan.includes('cron: "*/30 * * * *"')) {
  throw new Error("Workflow cập nhật nhanh phải quét chồng lấn 14 ngày mỗi 30 phút");
}
if (!quickScan.includes("fetch-recent-medical-rescue.mjs") || !quickScan.includes('RESCUE_DAYS: "21"')) {
  throw new Error("Workflow cập nhật nhanh thiếu lớp cứu hộ gói y tế 21 ngày");
}
if (!quickScan.includes("steps.medical_rescue.outcome == 'success'")) {
  throw new Error("Workflow cập nhật nhanh chưa chặn đóng gói khi lớp cứu hộ thất bại");
}

const coverageAudit = await readFile(".github/workflows/regional-coverage-audit.yml", "utf8");
if (!coverageAudit.includes('AUDIT_DAYS: "30"')) {
  throw new Error("Workflow kiểm tra chéo chưa đối chiếu tối thiểu 30 ngày");
}
if (!coverageAudit.includes('cron: "17 */4 * * *"')) {
  throw new Error("Workflow kiểm tra chéo chưa chạy định kỳ mỗi 4 giờ");
}
if (!coverageAudit.includes("fetch-recent-location-audit.mjs")) {
  throw new Error("Workflow kiểm tra chéo chưa gọi bộ quét độc lập theo địa danh");
}
if (!coverageAudit.includes("fetch-recent-medical-rescue.mjs") || !coverageAudit.includes('RESCUE_DAYS: "30"')) {
  throw new Error("Workflow kiểm tra chéo thiếu lớp cứu hộ y tế độc lập 30 ngày");
}

const auditScript = await readFile("scripts/fetch-recent-location-audit.mjs", "utf8");
if (!auditScript.includes("IB2600378695")) {
  throw new Error("Bộ kiểm tra chéo thiếu canary gói An Lão đã từng bị lọt");
}
if (!auditScript.includes("lastLocationAuditAt")) {
  throw new Error("Bộ kiểm tra chéo chưa ghi dấu thời gian đối chiếu");
}

const rescueScript = await readFile("scripts/fetch-recent-medical-rescue.mjs", "utf8");
for (const notifyNo of ["IB2600349751", "IB2600348377", "IB2600347689", "IB2600346897"]) {
  if (!rescueScript.includes(notifyNo)) {
    throw new Error(`Bộ cứu hộ thiếu mã gói xét nghiệm đã bị lọt: ${notifyNo}`);
  }
}
if (!rescueScript.includes("canonicalNotifyNo") || !rescueScript.includes("missingForced")) {
  throw new Error("Bộ cứu hộ chưa chuẩn hóa hậu tố -00 hoặc chưa kiểm tra mã bắt buộc");
}

console.log("Cấu hình quét nhanh, quét sâu, đối chiếu địa danh và cứu hộ gói y tế hợp lệ.");

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

for (const file of [
  "scripts/medical-scope.mjs",
  "scripts/run-region-scan.mjs",
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
execFileSync(process.execPath, ["--test", "scripts/medical-scope.test.mjs"], { stdio: "inherit" });

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
  throw new Error("Workflow cập nhật nhanh thiếu lớp quét bù y tế 21 ngày");
}
if (quickScan.includes("apply-manual-tender-overrides") || quickScan.includes("IB2600349751")) {
  throw new Error("Workflow cập nhật nhanh vẫn phụ thuộc mã gói hoặc dữ liệu chèn thủ công");
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
  throw new Error("Workflow kiểm tra chéo thiếu lớp quét bù theo mã tỉnh 30 ngày");
}
if (coverageAudit.includes("apply-manual-tender-overrides") || coverageAudit.includes("IB2600349751")) {
  throw new Error("Workflow kiểm tra chéo vẫn phụ thuộc mã gói hoặc dữ liệu chèn thủ công");
}

const regionRunner = await readFile("scripts/run-region-scan.mjs", "utf8");
if (!regionRunner.includes("isMedicalTender, medicalCategory")) {
  throw new Error("Đường quét chính chưa được vá sang bộ lọc y tế dùng chung");
}
if (!regionRunner.includes("thay bộ lọc cũ bằng bộ lọc dùng chung")) {
  throw new Error("Đường quét chính chưa xác nhận thay toàn bộ hàm isMedical cũ");
}

for (const file of [
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
]) {
  const text = await readFile(file, "utf8");
  if (!text.includes("classifyMedicalTender")) {
    throw new Error(`${file} chưa dùng bộ phân loại thống nhất`);
  }
  if (text.includes("FORCED_BY_REGION") || text.includes("IB2600349751")) {
    throw new Error(`${file} vẫn chứa mã gói bắt buộc`);
  }
  if (!text.includes("rejectedReasons")) {
    throw new Error(`${file} chưa ghi thống kê lý do loại`);
  }
}

const classifier = await readFile("scripts/medical-scope.mjs", "utf8");
for (const term of ["mien dich", "elisa", "hba1c", "su dung tren may", "su dung cho may"]) {
  if (!classifier.includes(term)) {
    throw new Error(`Bộ lọc thống nhất thiếu ngữ cảnh: ${term}`);
  }
}

console.log("Mọi đường quét dùng chung bộ lọc y tế theo ngữ cảnh; không còn chèn mã gói thủ công.");

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
if (quickScan.includes('PAGE_SIZE: "100"') || quickScan.includes('PAGE_SIZE: "50"')) {
  throw new Error("Workflow cập nhật nhanh còn dùng pageSize bị API từ chối");
}
if (!quickScan.includes("Chặn thành công giả của dữ liệu Gia Lai")
  || !quickScan.includes("medical-rescue-summary.json")
  || !quickScan.includes("manualTenderOverride")) {
  throw new Error("Workflow cập nhật nhanh chưa xác minh quét nguồn thật và loại gói thủ công");
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
if (coverageAudit.includes('PAGE_SIZE: "100"') || coverageAudit.includes('PAGE_SIZE: "50"')) {
  throw new Error("Workflow kiểm tra chéo còn dùng pageSize bị API từ chối");
}
if (!coverageAudit.includes("Xác nhận Gia Lai đã được đối chiếu từ nguồn thật")
  || !coverageAudit.includes("location-audit-summary.json")) {
  throw new Error("Workflow kiểm tra chéo chưa chặn kết quả giả hoặc thiếu báo cáo nguồn thật");
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
if (!regionRunner.includes("backupRegionData")
  || !regionRunner.includes("restoreRegionData")
  || !regionRunner.includes("officialTenderCount")) {
  throw new Error("Đường quét chính chưa rollback dữ liệu khi giảm số gói hoặc chưa loại gói thủ công khỏi ngưỡng");
}
if (!regionRunner.includes("Math.min(10")) {
  throw new Error("Đường quét chính chưa khóa pageSize tối đa 10");
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
  if (!text.includes("Math.min(10")) {
    throw new Error(`${file} chưa khóa pageSize tối đa 10`);
  }
  if (!text.includes("rejectedReasons") || !text.includes("acceptedDiagnostics")) {
    throw new Error(`${file} chưa ghi chẩn đoán nhận/loại của bộ lọc`);
  }
  if (!text.includes("isManualTender") || !text.includes("removedManualCount")) {
    throw new Error(`${file} chưa loại dữ liệu gói thầu thủ công còn sót`);
  }
}

const rescue = await readFile("scripts/fetch-recent-medical-rescue.mjs", "utf8");
if (!rescue.includes("province-codes-plus-location-terms")
  || !rescue.includes("successfulStrategyCount")
  || !rescue.includes("Mọi đường lấy dữ liệu")) {
  throw new Error("Lớp quét bù chưa có nhiều đường lấy dữ liệu và chưa chặn 0 nguồn thành công");
}

const classifier = await readFile("scripts/medical-scope.mjs", "utf8");
for (const term of ["mien dich", "elisa", "hba1c", "su dung tren may", "su dung cho may"]) {
  if (!classifier.includes(term)) {
    throw new Error(`Bộ lọc thống nhất thiếu ngữ cảnh: ${term}`);
  }
}

console.log("Quy trình đã khóa pageSize 10, rollback khi lỗi, chạy lọc trên nguồn thật và không dùng gói thủ công.");

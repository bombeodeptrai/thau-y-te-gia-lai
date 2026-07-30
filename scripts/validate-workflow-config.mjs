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

const fullScanPath = ".github/workflows/regional-full-scan.yml";
const detailPath = ".github/workflows/regional-detail-backfill.yml";
const quickPath = ".github/workflows/regional-quick-update.yml";
const auditPath = ".github/workflows/regional-coverage-audit.yml";
const rapidPath = ".github/workflows/rapid-gia-lai-update.yml";

for (const file of [fullScanPath, detailPath, quickPath]) {
  const text = await readFile(file, "utf8");
  if (!text.includes("MIN_TENDER_COUNT")) {
    throw new Error(`${file} chưa có ngưỡng chống ghi dữ liệu rỗng`);
  }
  if (!text.includes('PAGE_SIZE: "10"')) {
    throw new Error(`${file} chưa giới hạn kích thước trang an toàn`);
  }
}

const nonGiaLaiRegions = [
  "thanh-hoa",
  "nghe-an",
  "ha-tinh",
  "quang-tri",
  "hue",
  "da-nang",
  "quang-ngai",
  "dak-lak",
  "khanh-hoa",
  "lam-dong",
];

const fullScan = await readFile(fullScanPath, "utf8");
if (!fullScan.includes('cron: "15 17 * * 0"')) {
  throw new Error("Mười tỉnh ngoài Gia Lai phải quét tự động đúng một lần mỗi tuần");
}
for (const region of nonGiaLaiRegions) {
  if (!fullScan.includes(`- ${region}`)) {
    throw new Error(`Workflow quét tuần thiếu khu vực ${region}`);
  }
}
if (!fullScan.includes("matrix.region == 'gia-lai'") || !fullScan.includes("ENABLE_HISTORICAL_FALLBACK")) {
  throw new Error("Workflow quét sâu chưa giữ quét bù địa danh riêng cho Gia Lai");
}

const highFrequencyFiles = [quickPath, auditPath, detailPath];
for (const file of highFrequencyFiles) {
  const text = await readFile(file, "utf8");
  if (!text.includes("- gia-lai")) {
    throw new Error(`${file} chưa giữ Gia Lai trong luồng cập nhật thường xuyên`);
  }
  for (const region of nonGiaLaiRegions) {
    if (text.includes(`- ${region}`)) {
      throw new Error(`${file} vẫn quét thường xuyên khu vực ${region}`);
    }
  }
}

const quickScan = await readFile(quickPath, "utf8");
if (quickScan.includes("cron:")) {
  throw new Error("Workflow cập nhật dự phòng Gia Lai không được chạy lịch trùng với luồng 10 phút");
}
if (!quickScan.includes('INCREMENTAL_DAYS: "14"')) {
  throw new Error("Workflow cập nhật dự phòng Gia Lai phải giữ cửa sổ chồng lấn 14 ngày");
}
if (!quickScan.includes("fetch-recent-medical-rescue.mjs") || !quickScan.includes('RESCUE_DAYS: "21"')) {
  throw new Error("Workflow cập nhật dự phòng Gia Lai thiếu lớp quét bù 21 ngày");
}

const coverageAudit = await readFile(auditPath, "utf8");
if (!coverageAudit.includes('AUDIT_DAYS: "30"') || !coverageAudit.includes('cron: "17 */4 * * *"')) {
  throw new Error("Gia Lai phải tiếp tục kiểm tra chéo 30 ngày mỗi 4 giờ");
}
if (!coverageAudit.includes("fetch-recent-location-audit.mjs") || !coverageAudit.includes("fetch-recent-medical-rescue.mjs")) {
  throw new Error("Kiểm tra chéo Gia Lai thiếu một trong hai lớp quét độc lập");
}

const detailScan = await readFile(detailPath, "utf8");
if (!detailScan.includes('cron: "17 */2 * * *"') || !detailScan.includes('DETAIL_LIMIT: "40"')) {
  throw new Error("Gia Lai phải tiếp tục bổ sung chi tiết mỗi 2 giờ");
}

const rapidScan = await readFile(rapidPath, "utf8");
if (!rapidScan.includes('cron: "*/10 * * * *"') || !rapidScan.includes("fetch-recent-medical-rescue.mjs gia-lai")) {
  throw new Error("Luồng quét nhanh Gia Lai mỗi 10 phút chưa hợp lệ");
}

for (const file of [quickPath, auditPath]) {
  const text = await readFile(file, "utf8");
  if (text.includes("apply-manual-tender-overrides") || text.includes("IB2600349751")) {
    throw new Error(`${file} vẫn phụ thuộc mã gói hoặc dữ liệu chèn thủ công`);
  }
}

const regionRunner = await readFile("scripts/run-region-scan.mjs", "utf8");
if (!regionRunner.includes("isMedicalTender, medicalCategory")) {
  throw new Error("Đường quét chính chưa dùng bộ lọc y tế thống nhất");
}

for (const file of [
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
]) {
  const text = await readFile(file, "utf8");
  if (!text.includes("classifyMedicalTender")) {
    throw new Error(`${file} chưa dùng bộ phân loại thống nhất`);
  }
  if (!text.includes("rejectedReasons")) {
    throw new Error(`${file} chưa ghi thống kê lý do loại`);
  }
}

console.log("Gia Lai cập nhật thường xuyên; 10 tỉnh còn lại chỉ quét tự động một lần mỗi tuần.");

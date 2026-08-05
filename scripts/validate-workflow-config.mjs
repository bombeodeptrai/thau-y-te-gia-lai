import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

for (const file of [
  "scripts/medical-scope.mjs",
  "scripts/run-region-scan.mjs",
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
  "scripts/repair-official-tender-identities.mjs",
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
if (!quickScan.includes("repair-official-tender-identities.mjs")
  || !quickScan.includes("fetch-recent-medical-rescue.mjs")
  || !quickScan.includes('RESCUE_DAYS: "21"')
  || !quickScan.includes('PAGE_SIZE: "10"')) {
  throw new Error("Workflow cập nhật dự phòng Gia Lai thiếu lớp sửa định danh hoặc quét bù an toàn");
}

const coverageAudit = await readFile(auditPath, "utf8");
if (!coverageAudit.includes('AUDIT_DAYS: "30"') || !coverageAudit.includes('cron: "17 */4 * * *"')) {
  throw new Error("Gia Lai phải tiếp tục kiểm tra chéo 30 ngày mỗi 4 giờ");
}
if (!coverageAudit.includes("repair-official-tender-identities.mjs")
  || !coverageAudit.includes("fetch-recent-location-audit.mjs")
  || !coverageAudit.includes("fetch-recent-medical-rescue.mjs")
  || coverageAudit.includes('PAGE_SIZE: "50"')
  || coverageAudit.includes('PAGE_SIZE: "100"')) {
  throw new Error("Kiểm tra chéo Gia Lai chưa dùng đầy đủ nguồn thật với pageSize 10");
}

const detailScan = await readFile(detailPath, "utf8");
if (!detailScan.includes('cron: "17 */2 * * *"')
  || !detailScan.includes('DETAIL_LIMIT: "80"')
  || !detailScan.includes("repair-official-tender-identities.mjs")) {
  throw new Error("Gia Lai phải bổ sung tối đa 80 hồ sơ mỗi 2 giờ sau khi sửa định danh chính thức");
}

const rapidScan = await readFile(rapidPath, "utf8");
if (!rapidScan.includes('cron: "*/10 * * * *"')
  || !rapidScan.includes("repair-official-tender-identities.mjs gia-lai")
  || !rapidScan.includes("fetch-recent-medical-rescue.mjs gia-lai")
  || !rapidScan.includes("run-region-scan.mjs gia-lai")
  || !rapidScan.includes('DETAIL_LIMIT: "80"')
  || rapidScan.includes('PAGE_SIZE: "100"')) {
  throw new Error("Luồng quét nhanh Gia Lai chưa sửa định danh, tải chi tiết hoặc còn pageSize không an toàn");
}

for (const file of [quickPath, auditPath, rapidPath]) {
  const text = await readFile(file, "utf8");
  if (text.includes("apply-manual-tender-overrides") || /IB\d{10}/.test(text)) {
    throw new Error(`${file} vẫn phụ thuộc mã gói hoặc dữ liệu chèn thủ công`);
  }
}

const regionRunner = await readFile("scripts/run-region-scan.mjs", "utf8");
if (!regionRunner.includes("isMedicalTender, medicalCategory")
  || !regionRunner.includes("backupRegionData")
  || !regionRunner.includes("restoreRegionData")
  || !regionRunner.includes("officialTenderCount")
  || !regionRunner.includes("Math.min(10")) {
  throw new Error("Đường quét chính chưa dùng bộ lọc chung, pageSize 10 và rollback dữ liệu lỗi");
}

for (const file of [
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
]) {
  const text = await readFile(file, "utf8");
  if (!text.includes("classifyMedicalTender")
    || !text.includes("rejectedReasons")
    || !text.includes("isManualTender")
    || !text.includes("Math.min(10")) {
    throw new Error(`${file} chưa lọc, chẩn đoán, loại dữ liệu thủ công hoặc khóa pageSize 10`);
  }
}

const repairScript = await readFile("scripts/repair-official-tender-identities.mjs", "utf8");
if (!repairScript.includes("dynamic-direct-notify-search")
  || !repairScript.includes("notifyPayload")
  || !repairScript.includes("unresolved")
  || /IB\d{10}/.test(repairScript)) {
  throw new Error("Bộ sửa định danh chưa tìm động từ nguồn thật hoặc còn mã gói viết cứng");
}

console.log("Gia Lai dùng nguồn chính thức, sửa định danh và tải chi tiết; 10 tỉnh còn lại chỉ quét mỗi tuần.");

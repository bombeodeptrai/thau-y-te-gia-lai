import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

for (const file of [
  "scripts/medical-scope.mjs",
  "scripts/fetch-data.mjs",
  "scripts/run-region-scan.mjs",
  "scripts/fetch-recent-location-audit.mjs",
  "scripts/fetch-recent-medical-rescue.mjs",
  "scripts/repair-official-tender-identities.mjs",
  "scripts/refresh-official-tender-details.mjs",
]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
execFileSync(process.execPath, ["--test", "scripts/medical-scope.test.mjs"], { stdio: "inherit" });

const fullScanPath = ".github/workflows/regional-full-scan.yml";
const detailPath = ".github/workflows/regional-detail-backfill.yml";
const quickPath = ".github/workflows/regional-quick-update.yml";
const auditPath = ".github/workflows/regional-coverage-audit.yml";
const rapidPath = ".github/workflows/rapid-gia-lai-update.yml";
const pagesPath = ".github/workflows/pages.yml";

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
if (!quickScan.includes("steps.regional_scan.outcome == 'success' || steps.medical_rescue.outcome == 'success'")) {
  throw new Error("Workflow đang bỏ kết quả quét chính khi riêng lớp cứu hộ thất bại");
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
  || !detailScan.includes("repair-official-tender-identities.mjs")
  || !detailScan.includes("refresh-official-tender-details.mjs")) {
  throw new Error("Gia Lai phải bổ sung tối đa 80 hồ sơ mỗi 2 giờ sau khi sửa định danh chính thức");
}

const rapidScan = await readFile(rapidPath, "utf8");
if (!rapidScan.includes('cron: "*/10 * * * *"')
  || !rapidScan.includes("repair-official-tender-identities.mjs gia-lai")
  || !rapidScan.includes("fetch-recent-medical-rescue.mjs gia-lai")
  || !rapidScan.includes("refresh-official-tender-details.mjs gia-lai")
  || !rapidScan.includes('DETAIL_LIMIT: "80"')
  || rapidScan.includes('PAGE_SIZE: "100"')) {
  throw new Error("Luồng quét nhanh Gia Lai chưa sửa định danh, tạo chi tiết hoặc còn pageSize không an toàn");
}
if (rapidScan.includes("LOCATION_TERM_LIMIT")) {
  throw new Error("Luồng quét nhanh Gia Lai vẫn giới hạn địa danh và có thể bỏ khu vực Bình Định cũ");
}

const medicalRescue = await readFile("scripts/fetch-recent-medical-rescue.mjs", "utf8");
if (medicalRescue.includes("LOCATION_TERM_LIMIT")
  || medicalRescue.includes("]).slice(0,")
  || !medicalRescue.includes("removedRejectedStoredCount")
  || !medicalRescue.includes("rejectedSourceKeys")) {
  throw new Error("Quét bù Gia Lai chưa quét đủ địa danh hoặc chưa tự loại bản ghi cũ sai phạm vi");
}

const dataWorkflowPaths = [fullScanPath, detailPath, quickPath, auditPath, rapidPath];
for (const file of dataWorkflowPaths) {
  const text = await readFile(file, "utf8");
  if (text.includes("group: pages-deploy")
    || text.includes("actions/deploy-pages")
    || text.includes("actions/upload-pages-artifact")
    || text.includes("environment:\n      name: github-pages")) {
    throw new Error(`${file} vẫn tự triển khai Pages và có thể chặn hàng đợi cập nhật dữ liệu`);
  }
  if (!text.includes("group: regional-data-write")) {
    throw new Error(`${file} chưa dùng khóa ghi dữ liệu ngắn, dùng chung giữa các workflow`);
  }
}

for (const file of [fullScanPath, detailPath, quickPath, auditPath]) {
  const text = await readFile(file, "utf8");
  if (text.includes("group: regional-data\n")) {
    throw new Error(`${file} còn khóa toàn workflow khiến các lịch quét triệt tiêu lẫn nhau`);
  }
}
if (rapidScan.includes("group: rapid-gia-lai-update")) {
  throw new Error("Luồng quét nhanh còn khóa toàn workflow nên một lượt deploy chờ có thể chặn mọi lượt sau");
}

const pagesWorkflow = await readFile(pagesPath, "utf8");
if (pagesWorkflow.includes("paths-ignore:") && pagesWorkflow.includes('"data/**"')) {
  throw new Error("Workflow Pages đang bỏ qua commit dữ liệu nên website không tự cập nhật");
}
if (!pagesWorkflow.includes("group: pages-deploy")
  || !pagesWorkflow.includes("actions/deploy-pages@v4")) {
  throw new Error("Workflow Pages duy nhất chưa giữ khóa triển khai và bước deploy chính thức");
}
for (const workflowName of [
  "Cập nhật nhanh gói mới và hồ sơ chính thức Gia Lai",
  "Cập nhật dự phòng dữ liệu Gia Lai",
  "Kiểm tra chéo chống lọt gói Gia Lai",
  "Bổ sung chi tiết nhà thầu thiết bị và model Gia Lai",
  "Khởi tạo và quét sâu dữ liệu miền Trung",
]) {
  if (!pagesWorkflow.includes(`- ${workflowName}`)) {
    throw new Error(`Workflow Pages chưa tự chạy sau luồng dữ liệu: ${workflowName}`);
  }
}
if (!pagesWorkflow.includes("workflow_run:")
  || !pagesWorkflow.includes("github.event.workflow_run.conclusion == 'success'")) {
  throw new Error("Workflow Pages chưa xử lý commit do GITHUB_TOKEN ghi hoặc còn deploy sau lượt quét thất bại");
}
const pagesBeforeJobs = pagesWorkflow.split("\njobs:\n")[0];
const pagesDeployJob = pagesWorkflow.split("\n  deploy:\n")[1] || "";
if (pagesBeforeJobs.includes("\nconcurrency:")
  || !pagesDeployJob.includes("    concurrency:\n      group: pages-deploy")) {
  throw new Error("Khóa Pages phải nằm trong job deploy để workflow_run bị bỏ qua không hủy lượt triển khai thật");
}

for (const file of [quickPath, auditPath, rapidPath]) {
  const text = await readFile(file, "utf8");
  if (text.includes("apply-manual-tender-overrides") || /IB\d{10}/.test(text)) {
    throw new Error(`${file} vẫn phụ thuộc mã gói hoặc dữ liệu chèn thủ công`);
  }
}

const regionRunner = await readFile("scripts/run-region-scan.mjs", "utf8");
const mainScanner = await readFile("scripts/fetch-data.mjs", "utf8");
if (!mainScanner.includes('import { isMedicalTender, medicalCategory } from "./medical-scope.mjs";')
  || !mainScanner.includes(".filter(isMedicalTender)")
  || mainScanner.includes("function isMedical(")
  || mainScanner.includes("FORCED_NOTIFY_NOS")
  || mainScanner.includes("fetchForcedNotifyNos")
  || /const FORCED_NOTIFY_NOS|Tìm trực tiếp IB\d{10}/.test(mainScanner)) {
  throw new Error("Đường quét chính chưa dùng trực tiếp bộ lọc chung hoặc còn mã gói ép buộc");
}
if (!regionRunner.includes("backupRegionData")
  || !regionRunner.includes("restoreRegionData")
  || !regionRunner.includes("officialTenderCount")
  || !regionRunner.includes("Math.min(10")
  || regionRunner.includes("thay bộ lọc cũ bằng bộ lọc dùng chung")
  || regionRunner.includes("loại bỏ mã gói bắt buộc")) {
  throw new Error("Bộ chạy vùng còn vá bộ lọc bằng chuỗi hoặc thiếu pageSize 10/rollback dữ liệu lỗi");
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

const detailScript = await readFile("scripts/refresh-official-tender-details.mjs", "utf8");
if (!detailScript.includes("PLAN_BID_DETAIL_URL")
  || !detailScript.includes("ONLINE_REOFFER_HSMT_URL")
  || !detailScript.includes("official-identity-plan-and-public-technical-details")
  || /IB\d{10}/.test(detailScript)) {
  throw new Error("Bộ tạo hồ sơ chi tiết chưa dùng định danh chính thức hoặc còn mã gói viết cứng");
}

console.log("Gia Lai dùng nguồn chính thức, sửa định danh và tạo chi tiết; 10 tỉnh còn lại chỉ quét mỗi tuần.");

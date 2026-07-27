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

const auditScript = await readFile("scripts/fetch-recent-location-audit.mjs", "utf8");
if (!auditScript.includes("IB2600378695")) {
  throw new Error("Bộ kiểm tra chéo thiếu canary gói An Lão đã từng bị lọt");
}
if (!auditScript.includes("lastLocationAuditAt")) {
  throw new Error("Bộ kiểm tra chéo chưa ghi dấu thời gian đối chiếu");
}

console.log("Cấu hình quét nhanh, quét sâu và kiểm tra chéo chống lọt gói hợp lệ.");

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

console.log("Cấu hình workflow phục hồi dữ liệu và quét bù địa danh hợp lệ.");

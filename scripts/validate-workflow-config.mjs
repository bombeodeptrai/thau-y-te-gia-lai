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
  if (!text.includes("PAGE_SIZE: \"10\"")) {
    throw new Error(`${file} chưa giới hạn kích thước trang an toàn`);
  }
}

console.log("Cấu hình workflow phục hồi dữ liệu hợp lệ.");

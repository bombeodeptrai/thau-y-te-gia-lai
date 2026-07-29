import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDir, "..");
const sourcePath = resolve(scriptsDir, "fetch-data.mjs");
const configPath = resolve(root, "data/regions.json");

const slug = String(process.argv[2] || process.env.REGION_SLUG || "").trim();
if (!slug) throw new Error("Thiếu REGION_SLUG hoặc đối số tên tỉnh/thành");

const regionConfig = JSON.parse(await readFile(configPath, "utf8"));
const region = (regionConfig.regions || []).find((item) => item.slug === slug);
if (!region) throw new Error(`Không có cấu hình khu vực: ${slug}`);

const scanDays = Math.max(1, Number(process.env.SCAN_DAYS) || 1095);
const incrementalDays = Math.max(1, Number(process.env.INCREMENTAL_DAYS) || 7);
const windowDays = Math.max(1, Number(process.env.WINDOW_DAYS) || (scanDays >= 365 ? 60 : 7));
const pageSize = Math.max(1, Math.min(10, Number(process.env.PAGE_SIZE) || 10));
const detailLimit = Math.max(1, Number(process.env.DETAIL_LIMIT) || (scanDays >= 365 ? 60 : 15));
const minTenderCount = Math.max(0, Number(process.env.MIN_TENDER_COUNT) || 1);
const enableHistoricalFallback = process.env.ENABLE_HISTORICAL_FALLBACK === "1";
const forceFullRefresh = process.env.FORCE_FULL_REFRESH === "1";
const defaultHistoricalTitleTerms = [
  "thiết bị", "vật tư", "hóa chất", "hoá chất", "sinh phẩm", "xét nghiệm", "máy",
  "miễn dịch", "elisa", "hba1c", "thuốc thử", "chất hiệu chuẩn", "reagent",
];
const historicalTitleTerms = String(process.env.HISTORICAL_TITLE_TERMS || "")
  .split("|")
  .map((value) => value.trim())
  .filter(Boolean);
if (!historicalTitleTerms.length) historicalTitleTerms.push(...defaultHistoricalTitleTerms);

const regionDataDir = resolve(root, "data", "regions", region.slug);
const regionOutputPath = resolve(regionDataDir, "tenders.json");
const regionSummaryPath = resolve(regionDataDir, "scan-summary.json");
const topLevelTenderPath = resolve(root, "data", "tenders.json");
const bidderOutputPath = resolve(regionDataDir, "bidders.json");
const equipmentOutputPath = resolve(regionDataDir, "equipment.json");

async function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function isManualTender(item) {
  return Boolean(
    item?.manualTenderOverride
    || String(item?.id || "").startsWith("manual-")
    || String(item?.sourceStage || "").startsWith("manual"),
  );
}

function officialTenderCount(payload, regionSlug = "") {
  if (!Array.isArray(payload?.tenders)) return 0;
  return payload.tenders.filter((item) => {
    if (isManualTender(item)) return false;
    return !regionSlug || !item.regionSlug || item.regionSlug === regionSlug;
  }).length;
}

const existingRegionalPayload = await readJsonSafe(regionOutputPath, { tenders: [] });
const topLevelPayload = slug === "gia-lai"
  ? await readJsonSafe(topLevelTenderPath, { tenders: [] })
  : { tenders: [] };
const existingRegionalCount = officialTenderCount(existingRegionalPayload);
const legacyGiaLaiCount = slug === "gia-lai"
  ? officialTenderCount(topLevelPayload, "gia-lai")
  : 0;
const baselineTenderCount = Math.max(existingRegionalCount, legacyGiaLaiCount);
const requiredTenderCount = Math.max(minTenderCount, baselineTenderCount);

function js(value) {
  return JSON.stringify(value, null, 2);
}

function replaceOrThrow(source, pattern, replacement, label) {
  const matched = typeof pattern === "string"
    ? source.includes(pattern)
    : new RegExp(pattern.source, pattern.flags.replace("g", "")).test(source);
  if (!matched) throw new Error(`Không vá được fetch-data.mjs tại: ${label}`);
  return source.replace(pattern, replacement);
}

function runNode(args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

async function backupRegionData() {
  const backupRoot = resolve(scriptsDir, `.region-backup-${region.slug}-${Date.now()}`);
  const backupDataDir = resolve(backupRoot, "region");
  await mkdir(backupRoot, { recursive: true });
  try {
    await cp(regionDataDir, backupDataDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(backupDataDir, { recursive: true });
  }
  return { backupRoot, backupDataDir };
}

async function restoreRegionData(backup) {
  await rm(regionDataDir, { recursive: true, force: true });
  await cp(backup.backupDataDir, regionDataDir, { recursive: true, force: true });
  process.stderr.write(`Đã khôi phục dữ liệu ${region.name} sau lượt quét không hợp lệ.\n`);
}

let source = await readFile(sourcePath, "utf8");

source = replaceOrThrow(
  source,
  'import { extractOnlineReofferTechnicalRequirements } from "./technical-requirements.mjs";',
  'import { extractOnlineReofferTechnicalRequirements } from "./technical-requirements.mjs";\nimport { isMedicalTender, medicalCategory } from "./medical-scope.mjs";',
  "nạp bộ lọc y tế dùng chung",
);
source = replaceOrThrow(
  source,
  /function isMedical\(item\) \{[\s\S]*?\n\}\n\nfunction isStoredTenderMedical/,
  "function isMedical(item) {\n  return isMedicalTender(item);\n}\n\nfunction isStoredTenderMedical",
  "thay bộ lọc cũ bằng bộ lọc dùng chung",
);
source = replaceOrThrow(
  source,
  /function categoryOf\(name\) \{[\s\S]*?\n\}\n\nfunction statusOf/,
  "function categoryOf(name) {\n  return medicalCategory(name);\n}\n\nfunction statusOf",
  "phân loại nhóm hàng dùng chung",
);
source = replaceOrThrow(
  source,
  'const PROVINCE_CODE = "52";',
  `const REGION_SLUG = ${js(region.slug)};\nconst REGION_NAME = ${js(region.name)};\nconst PROVINCE_CODES = ${js(region.provinceCodes)};\nconst REGION_LOCATION_TERMS = ${js(region.locationTerms)};\nconst ENABLE_HISTORICAL_FALLBACK = ${enableHistoricalFallback};\nconst DETAIL_LIMIT = ${detailLimit};`,
  "cấu hình tỉnh",
);
source = replaceOrThrow(source, "const DAYS = 3 * 365;", `const DAYS = ${scanDays};`, "số ngày quét");
source = replaceOrThrow(source, "const INCREMENTAL_DAYS = 14;", `const INCREMENTAL_DAYS = ${incrementalDays};`, "số ngày cập nhật");
source = replaceOrThrow(source, "const WINDOW_DAYS = 7;", `const WINDOW_DAYS = ${windowDays};`, "cửa sổ ngày");
source = replaceOrThrow(source, "const PAGE_SIZE = 10;", `const PAGE_SIZE = ${pageSize};`, "kích thước trang");
source = replaceOrThrow(
  source,
  /const HISTORICAL_LOCATION_TERMS = \[[\s\S]*?\n\];\nconst HISTORICAL_TITLE_TERMS =/,
  "const HISTORICAL_LOCATION_TERMS = REGION_LOCATION_TERMS;\nconst HISTORICAL_TITLE_TERMS =",
  "địa danh quét bù",
);
source = replaceOrThrow(
  source,
  /const HISTORICAL_TITLE_TERMS = \[[\s\S]*?\n\];/,
  `const HISTORICAL_TITLE_TERMS = ${js(historicalTitleTerms)};`,
  "từ khóa quét bù",
);
source = replaceOrThrow(
  source,
  /const FORCED_NOTIFY_NOS = \[[\s\S]*?\n\];/,
  "const FORCED_NOTIFY_NOS = [];",
  "loại bỏ mã gói bắt buộc",
);
source = replaceOrThrow(
  source,
  /const outputPath = resolve\(root, "data\/tenders\.json"\);\nconst biddersOutputPath = resolve\(root, "data\/bidders\.json"\);\nconst equipmentOutputPath = resolve\(root, "data\/equipment\.json"\);\nconst requirementsOutputPath = resolve\(root, "data\/requirements\.json"\);\nconst technicalRequirementsOutputPath = resolve\(root, "data\/technical-requirements\.json"\);\nconst detailsDir = resolve\(root, "data\/details"\);/,
  `const regionDataDir = resolve(root, "data", "regions", REGION_SLUG);\nconst outputPath = resolve(regionDataDir, "tenders.json");\nconst biddersOutputPath = resolve(regionDataDir, "bidders.json");\nconst equipmentOutputPath = resolve(regionDataDir, "equipment.json");\nconst requirementsOutputPath = resolve(regionDataDir, "requirements.json");\nconst technicalRequirementsOutputPath = resolve(regionDataDir, "technical-requirements.json");\nconst detailsDir = resolve(regionDataDir, "details");`,
  "đường dẫn dữ liệu khu vực",
);
source = replaceOrThrow(
  source,
  '{ fieldName: "locations.provCode", searchType: "in", fieldValues: [PROVINCE_CODE] },',
  '{ fieldName: "locations.provCode", searchType: "in", fieldValues: PROVINCE_CODES },',
  "mã tỉnh tìm kiếm",
);
source = source.replaceAll("thau-y-te-gia-lai-public-data/2.0", `thau-y-te-mien-trung-${region.slug}/4.1`);
source = replaceOrThrow(
  source,
  "    name,\n    investor:",
  "    name,\n    regionSlug: REGION_SLUG,\n    region: REGION_NAME,\n    provinceCodes: PROVINCE_CODES,\n    investor:",
  "nhãn khu vực trên gói thầu",
);
source = replaceOrThrow(source, 'join(", ") || "Tỉnh Gia Lai",', 'join(", ") || REGION_NAME,', "địa điểm mặc định");
source = replaceOrThrow(
  source,
  "  const fullRefresh = !previous.tenders?.length\n    || previousDays < DAYS",
  `  const fullRefresh = ${forceFullRefresh} || !previous.tenders?.length\n    || previousDays < DAYS`,
  "buộc quét toàn bộ",
);
source = replaceOrThrow(
  source,
  "  const historicalFallbackItems = fullRefresh\n    ? await fetchHistoricalFallback()\n    : [];",
  "  const historicalFallbackItems = fullRefresh && ENABLE_HISTORICAL_FALLBACK\n    ? await fetchHistoricalFallback()\n    : [];",
  "bật tắt quét bù lịch sử",
);
source = replaceOrThrow(
  source,
  /  const detailsToRefresh = detailCandidates\n    \.filter\(\(tender\) => shouldRefreshDetails\(tender, detailsByNotifyNo\[tender\.notifyNo\]\)\);/,
  `  const statusPriority = { urgent: 500, open: 450, evaluating: 400, closed: 300, awarded: 200 };\n  const detailsToRefresh = detailCandidates\n    .filter((tender) => shouldRefreshDetails(tender, detailsByNotifyNo[tender.notifyNo]))\n    .sort((left, right) => {\n      const leftMissing = detailsByNotifyNo[left.notifyNo] ? 0 : 1000;\n      const rightMissing = detailsByNotifyNo[right.notifyNo] ? 0 : 1000;\n      const leftTime = new Date(left.publicDate || 0).getTime() || 0;\n      const rightTime = new Date(right.publicDate || 0).getTime() || 0;\n      return (rightMissing + (statusPriority[right.status] || 0) + rightTime / 1e12)\n        - (leftMissing + (statusPriority[left.status] || 0) + leftTime / 1e12);\n    })\n    .slice(0, DETAIL_LIMIT);`,
  "giới hạn chi tiết",
);
source = replaceOrThrow(
  source,
  "    provinceCode: PROVINCE_CODE,",
  "    regionSlug: REGION_SLUG,\n    region: REGION_NAME,\n    provinceCodes: PROVINCE_CODES,",
  "metadata khu vực",
);
source = replaceOrThrow(
  source,
  '      strategy: "incremental-province-plus-historical-entity-keywords",',
  '      strategy: ENABLE_HISTORICAL_FALLBACK\n        ? "regional-province-codes-plus-historical-location-terms-unified-filter"\n        : "regional-province-codes-unified-filter",',
  "chiến lược quét",
);

const generatedPath = resolve(scriptsDir, `.generated-fetch-data-${region.slug}.mjs`);
await writeFile(generatedPath, source);

if (process.env.DRY_RUN === "1") {
  const checkCode = await runNode(["--check", generatedPath]);
  await rm(generatedPath, { force: true });
  if (checkCode !== 0) process.exit(checkCode);
  process.stdout.write(`Kiểm tra cấu hình quét ${region.name}: hợp lệ; pageSize=${pageSize}, bộ lọc thống nhất.\n`);
  process.exit(0);
}

process.stdout.write(
  `Bắt đầu quét ${region.name}: mã ${region.provinceCodes.join(", ")}, ${scanDays} ngày, `
  + `ngưỡng dữ liệu chính thức không giảm ${requiredTenderCount} gói, pageSize=${pageSize}.\n`,
);

const backup = await backupRegionData();
try {
  const exitCode = await runNode([generatedPath]);
  if (exitCode !== 0) throw new Error(`Tiến trình quét ${region.name} kết thúc với mã ${exitCode}`);

  const payload = JSON.parse(await readFile(regionOutputPath, "utf8"));
  const tenderCount = officialTenderCount(payload);
  const coverageDays = Number(payload.collection?.days) || 0;
  const detailTenderCount = Number(payload.detailTenderCount) || 0;

  if (tenderCount < requiredTenderCount) {
    throw new Error(
      `Quét ${region.name} chỉ có ${tenderCount} gói chính thức, thấp hơn dữ liệu đang giữ ${requiredTenderCount}`,
    );
  }
  if (forceFullRefresh && coverageDays < scanDays) {
    throw new Error(`Quét ${region.name} mới phủ ${coverageDays}/${scanDays} ngày; không công nhận hoàn tất`);
  }

  const bidderPayload = await readJsonSafe(bidderOutputPath, { bidders: [] });
  const equipmentPayload = await readJsonSafe(equipmentOutputPath, { equipment: [] });
  const bidderCount = Array.isArray(bidderPayload.bidders) ? bidderPayload.bidders.length : 0;
  const equipmentCount = Array.isArray(equipmentPayload.equipment) ? equipmentPayload.equipment.length : 0;

  await writeFile(regionSummaryPath, `${JSON.stringify({
    schemaVersion: 4,
    regionSlug: region.slug,
    region: region.name,
    completedAt: new Date().toISOString(),
    scanDays,
    tenderCount,
    baselineTenderCount,
    detailTenderCount,
    bidderCount,
    equipmentCount,
    historicalLocationTermCount: region.locationTerms.length,
    historicalTitleTermCount: historicalTitleTerms.length,
    historicalFallback: enableHistoricalFallback,
    filterStrategy: "unified-medical-scope-v4",
    rollbackOnFailure: true,
    status: "success",
  }, null, 2)}\n`);

  process.stdout.write(
    `Xác thực ${region.name}: ${tenderCount} gói chính thức/${coverageDays} ngày, `
    + `${detailTenderCount} gói chi tiết, ${bidderCount} dòng nhà thầu, ${equipmentCount} mặt hàng/model.\n`,
  );
} catch (error) {
  await restoreRegionData(backup);
  throw error;
} finally {
  await rm(generatedPath, { force: true });
  await rm(backup.backupRoot, { recursive: true, force: true });
}

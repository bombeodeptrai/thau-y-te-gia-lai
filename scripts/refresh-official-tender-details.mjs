import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractOnlineReofferTechnicalRequirements } from "./technical-requirements.mjs";

const PLAN_BID_DETAIL_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/lcnt/bid-po-bidp-plan-project-view/get-bidp-plan-detail-by-id?token=public";
const ONLINE_REOFFER_HSMT_URL = "https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/lcnt_tbmcgtt_hsmt";
const MAX_ATTEMPTS = 5;
const DETAIL_LIMIT = Math.max(1, Math.min(200, Number(process.env.DETAIL_LIMIT) || 80));
const CONCURRENCY = 3;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slug = String(process.argv[2] || process.env.REGION_SLUG || "gia-lai").trim();
const regionDir = resolve(root, "data/regions", slug);
const tendersPath = resolve(regionDir, "tenders.json");
const detailsDir = resolve(regionDir, "details");
const requirementsPath = resolve(regionDir, "requirements.json");
const technicalRequirementsPath = resolve(regionDir, "technical-requirements.json");
const summaryPath = resolve(regionDir, "official-detail-refresh-summary.json");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function mapLimited(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function postJson(url, body, timeoutMs = 40_000) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "Content-Type": "application/json",
          Origin: "https://muasamcong.mpi.gov.vn",
          Referer: "https://muasamcong.mpi.gov.vn/",
          "User-Agent": `thau-y-te-official-detail-refresh-${slug}/1.0`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${compact(text).slice(0, 300)}`);
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
        throw new Error(`Nguồn không trả JSON: ${compact(text).slice(0, 200)}`);
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  throw lastError;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeRequirement(item) {
  return {
    id: String(item.id || crypto.randomUUID()),
    lotNo: compact(item.lotNo),
    name: compact(item.lotName || item.tenThuoc || item.bidName) || "Phần/lô chưa có tên",
    quantity: numberOrZero(item.quantity),
    unit: compact(item.uom),
    plannedPrice: numberOrZero(item.lotPrice ?? item.lotEstimatePrice ?? item.pricePlan),
    specification: compact(item.qualityStandards),
    sourceStage: "invitation",
  };
}

async function fetchRequirements(tender) {
  if (!tender.bidId) {
    return {
      total: 0,
      items: [],
      summary: "",
      disclosure: "missing-plan-detail-id",
    };
  }
  try {
    const payload = await postJson(PLAN_BID_DETAIL_URL, { id: tender.bidId });
    const lots = Array.isArray(payload?.bidpBidLotList) ? payload.bidpBidLotList : [];
    const items = [...new Map(lots.map((item) => {
      const normalized = normalizeRequirement(item);
      return [normalized.id || `${normalized.lotNo}|${normalized.name}`, normalized];
    })).values()];
    return {
      total: items.length,
      items,
      summary: compact(payload?.generalTasks),
      disclosure: items.length ? "public-plan-lots" : "plan-summary-only",
    };
  } catch (error) {
    return {
      total: 0,
      items: [],
      summary: "",
      disclosure: "temporarily-unavailable",
      error: error.message,
    };
  }
}

async function fetchTechnicalRequirements(tender) {
  if (tender.bidForm !== "CGTTRG") {
    return {
      total: 0,
      items: [],
      chapters: [],
      files: [],
      disclosure: "official-captcha-required",
    };
  }
  if (!tender.notifyId) {
    return {
      total: 0,
      items: [],
      chapters: [],
      files: [],
      disclosure: "missing-official-notify-id",
    };
  }
  try {
    const payload = await postJson(ONLINE_REOFFER_HSMT_URL, {
      id: tender.notifyId,
      processApply: tender.processApply || "LDT",
    }, 50_000);
    return extractOnlineReofferTechnicalRequirements(payload);
  } catch (error) {
    return {
      total: 0,
      items: [],
      chapters: [],
      files: [],
      disclosure: "temporarily-unavailable",
      error: error.message,
    };
  }
}

async function refreshTender(tender) {
  const [requirements, technicalRequirements] = await Promise.all([
    fetchRequirements(tender),
    fetchTechnicalRequirements(tender),
  ]);
  const detail = {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 0,
    bidders: [],
    items: [],
    requirements,
    technicalRequirements,
    modelDisclosure: "as-published",
    sourceIdentity: {
      notifyNo: tender.notifyNo,
      notifyId: tender.notifyId || "",
      bidId: tender.bidId || "",
      bidForm: tender.bidForm || "",
      sourceStage: tender.sourceStage || "official-public-search",
    },
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(resolve(detailsDir, `${tender.notifyNo}.json`), `${JSON.stringify(detail, null, 2)}\n`);
  return {
    notifyNo: tender.notifyNo,
    requirementCount: requirements.items?.length || 0,
    technicalCount: technicalRequirements.items?.length || 0,
    requirementDisclosure: requirements.disclosure || "",
    technicalDisclosure: technicalRequirements.disclosure || "",
  };
}

async function rebuildAggregates(manifest) {
  const tenderByNotifyNo = new Map((manifest.tenders || []).map((item) => [item.notifyNo, item]));
  const files = (await readdir(detailsDir)).filter((name) => /^IB\d{10}\.json$/.test(name));
  const details = await mapLimited(files, 10, async (name) => ({
    notifyNo: name.replace(/\.json$/, ""),
    detail: await readJson(resolve(detailsDir, name), {}),
  }));
  const requirements = details.flatMap(({ notifyNo, detail }) => {
    const tender = tenderByNotifyNo.get(notifyNo);
    return (detail.requirements?.items || []).map((item) => ({
      notifyNo,
      tenderName: tender?.name || "",
      sourceUrl: tender?.sourceUrl || "",
      ...item,
    }));
  });
  const technicalRequirements = details.flatMap(({ notifyNo, detail }) => {
    const tender = tenderByNotifyNo.get(notifyNo);
    return (detail.technicalRequirements?.items || []).map((item) => ({
      notifyNo,
      tenderName: tender?.name || "",
      sourceUrl: tender?.sourceUrl || "",
      ...item,
    }));
  });
  const fetchedAt = new Date().toISOString();
  await writeFile(requirementsPath, `${JSON.stringify({ requirements, fetchedAt }, null, 2)}\n`);
  await writeFile(technicalRequirementsPath, `${JSON.stringify({ technicalRequirements, fetchedAt }, null, 2)}\n`);
  await writeFile(tendersPath, `${JSON.stringify({
    ...manifest,
    detailTenderCount: files.length,
  }, null, 2)}\n`);
  return { detailTenderCount: files.length, requirementCount: requirements.length, technicalCount: technicalRequirements.length };
}

const manifest = await readJson(tendersPath, { tenders: [] });
await mkdir(detailsDir, { recursive: true });
const existingFiles = new Set((await readdir(detailsDir)).filter((name) => /^IB\d{10}\.json$/.test(name)));
const statusPriority = { urgent: 500, open: 450, evaluating: 400, closed: 300, awarded: 200 };
const candidates = (manifest.tenders || [])
  .filter((tender) => tender.notifyNo && tender.notifyId)
  .filter((tender) => tender.hasResult || ["open", "urgent", "evaluating", "closed"].includes(tender.status))
  .filter((tender) => !existingFiles.has(`${tender.notifyNo}.json`))
  .sort((left, right) => {
    const leftRepair = String(left.sourceStage || "").includes("repair") ? 1000 : 0;
    const rightRepair = String(right.sourceStage || "").includes("repair") ? 1000 : 0;
    const leftTime = new Date(left.publicDate || 0).getTime() || 0;
    const rightTime = new Date(right.publicDate || 0).getTime() || 0;
    return (rightRepair + (statusPriority[right.status] || 0) + rightTime / 1e12)
      - (leftRepair + (statusPriority[left.status] || 0) + leftTime / 1e12);
  })
  .slice(0, DETAIL_LIMIT);

if (!candidates.length) {
  process.stdout.write(`${slug}: không có hồ sơ chính thức còn thiếu cần tạo.\n`);
  process.exit(0);
}

const results = await mapLimited(candidates, CONCURRENCY, async (tender) => {
  try {
    const result = await refreshTender(tender);
    process.stdout.write(`Chi tiết ${tender.notifyNo}: ${result.requirementCount} phần/lô, ${result.technicalCount} dòng kỹ thuật.\n`);
    return { ...result, success: true, error: "" };
  } catch (error) {
    return { notifyNo: tender.notifyNo, success: false, error: error.message };
  }
});
const failed = results.filter((item) => !item.success);
if (failed.length) {
  throw new Error(`Không tạo được hồ sơ cho: ${failed.map((item) => item.notifyNo).join(", ")}`);
}

const aggregate = await rebuildAggregates(manifest);
const refreshedAt = new Date().toISOString();
await writeFile(summaryPath, `${JSON.stringify({
  schemaVersion: 1,
  regionSlug: slug,
  refreshedAt,
  limit: DETAIL_LIMIT,
  refreshedCount: results.length,
  results,
  ...aggregate,
  strategy: "official-identity-plan-and-public-technical-details",
}, null, 2)}\n`);

process.stdout.write(`Đã tạo ${results.length} hồ sơ chi tiết chính thức; tổng ${aggregate.detailTenderCount} hồ sơ vùng.\n`);

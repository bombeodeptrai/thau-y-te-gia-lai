import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const overridePath = resolve(dataDir, "manual-tender-overrides.json");
const requestedRegion = String(process.argv[2] || "").trim();

function canonicalNotifyNo(value) {
  return String(value || "").trim().replace(/-\d{2}$/, "");
}

function compact(value, maxLength = 5000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function meaningful(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value !== 0;
  return true;
}

function statusFromDates(item) {
  if (item.hasResult || item.winnerNames?.length || Number(item.winningPrice)) return "awarded";
  const closeAt = new Date(item.closeDate || 0).getTime();
  if (!Number.isFinite(closeAt) || !closeAt) return item.status || "closed";
  const remaining = closeAt - Date.now();
  if (remaining <= 0) return item.bidOpenId ? "evaluating" : "closed";
  return remaining <= 3 * 86_400_000 ? "urgent" : "open";
}

function sourceUrl(notifyNo) {
  const params = new URLSearchParams({
    p_p_id: "egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2",
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    _egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render: "detail-v2",
    type: "es-notify-contractor",
    stepCode: "notify-contractor-step-1-tbmt",
    notifyNo,
    step: "tbmt",
  });
  return `https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?${params}`;
}

function normalizeManual(item, verifiedAt) {
  const notifyNo = canonicalNotifyNo(item.notifyNo || item.sourceNotifyNo);
  return {
    id: `manual-${notifyNo}`,
    notifyId: "",
    bidId: "",
    bidOpenId: "",
    inputResultId: "",
    bidForm: "",
    processApply: "LDT",
    stepCode: "notify-contractor-step-1-tbmt",
    notifyNo,
    sourceNotifyNo: compact(item.sourceNotifyNo || notifyNo, 100),
    name: compact(item.name),
    regionSlug: compact(item.regionSlug, 100),
    region: compact(item.region, 200),
    provinceCodes: unique(item.provinceCodes || []),
    investor: compact(item.investor, 1500),
    location: compact(item.location, 800),
    closeDate: item.closeDate || "",
    publicDate: item.publicDate || "",
    price: Number(item.price) || 0,
    category: item.category || "Vật tư & hóa chất",
    status: item.status || "open",
    sourceStatus: item.sourceStatus || "01",
    statusForNotify: item.statusForNotify || "",
    bidderCount: null,
    sourceUrl: item.sourceUrl || sourceUrl(notifyNo),
    winnerNames: [],
    winningPrice: 0,
    decisionDate: "",
    resultPublishedDate: "",
    hasResult: false,
    participantNames: [],
    loserNames: [],
    loserDetails: [],
    winningModels: [],
    losingModels: [],
    losingModelDisclosure: "",
    manualTenderOverride: true,
    manualTenderVerifiedAt: verifiedAt || "",
  };
}

function mergeTender(existing, manual) {
  if (!existing) return { ...manual, status: statusFromDates(manual) };

  const merged = { ...manual, ...existing };
  for (const [field, value] of Object.entries(manual)) {
    if (!meaningful(merged[field]) && meaningful(value)) merged[field] = value;
  }

  merged.notifyNo = canonicalNotifyNo(existing.notifyNo || manual.notifyNo);
  merged.sourceNotifyNo = existing.sourceNotifyNo || manual.sourceNotifyNo;
  merged.provinceCodes = unique([...(manual.provinceCodes || []), ...(existing.provinceCodes || [])]);
  merged.winnerNames = unique([...(manual.winnerNames || []), ...(existing.winnerNames || [])]);
  merged.participantNames = unique([...(manual.participantNames || []), ...(existing.participantNames || [])]);
  merged.loserNames = unique([...(manual.loserNames || []), ...(existing.loserNames || [])]);
  merged.winningModels = unique([...(manual.winningModels || []), ...(existing.winningModels || [])]);
  merged.losingModels = unique([...(manual.losingModels || []), ...(existing.losingModels || [])]);
  merged.manualTenderOverride = true;
  merged.manualTenderVerifiedAt = manual.manualTenderVerifiedAt;
  merged.status = statusFromDates(merged);
  return merged;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function applyToFile(path, manualItems, label) {
  const payload = await readJson(path, { tenders: [] });
  const map = new Map();

  for (const tender of payload.tenders || []) {
    const key = canonicalNotifyNo(tender.notifyNo || tender.id);
    if (!key) continue;
    map.set(key, { ...tender, notifyNo: key });
  }

  let inserted = 0;
  for (const manual of manualItems) {
    const key = canonicalNotifyNo(manual.notifyNo);
    if (!map.has(key)) inserted += 1;
    map.set(key, mergeTender(map.get(key), manual));
  }

  const tenders = [...map.values()].sort(
    (left, right) => new Date(right.publicDate || 0) - new Date(left.publicDate || 0),
  );
  const fetchedAt = new Date().toISOString();
  const output = {
    ...payload,
    tenders,
    fetchedAt,
    collection: {
      ...(payload.collection || {}),
      manualTenderOverrideCount: manualItems.length,
      lastManualTenderOverrideAt: fetchedAt,
    },
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${label}: bảo đảm ${manualItems.length} gói đối chiếu trực tiếp, thêm mới ${inserted}, tổng ${tenders.length}.\n`);
}

const overrides = await readJson(overridePath, { tenders: [] });
const verifiedAt = overrides.verifiedAt || new Date().toISOString();
const manualTenders = (overrides.tenders || []).map((item) => normalizeManual(item, verifiedAt));

if (!manualTenders.length) {
  process.stdout.write("Không có gói thầu bổ sung thủ công.\n");
  process.exit(0);
}

const selected = requestedRegion
  ? manualTenders.filter((item) => item.regionSlug === requestedRegion)
  : manualTenders;

if (requestedRegion) {
  if (selected.length) {
    await applyToFile(
      resolve(dataDir, "regions", requestedRegion, "tenders.json"),
      selected,
      `Dữ liệu vùng ${requestedRegion}`,
    );
  }
} else {
  const byRegion = new Map();
  for (const item of selected) {
    if (!byRegion.has(item.regionSlug)) byRegion.set(item.regionSlug, []);
    byRegion.get(item.regionSlug).push(item);
  }
  for (const [regionSlug, items] of byRegion) {
    await applyToFile(
      resolve(dataDir, "regions", regionSlug, "tenders.json"),
      items,
      `Dữ liệu vùng ${regionSlug}`,
    );
  }
  await applyToFile(resolve(dataDir, "tenders.json"), selected, "Dữ liệu tổng hợp");
}

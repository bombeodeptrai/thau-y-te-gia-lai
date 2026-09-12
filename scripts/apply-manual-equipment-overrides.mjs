import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const overridePath = resolve(root, "data/manual-equipment-overrides.json");
const tendersPath = resolve(root, "data/tenders.json");
const regionsDir = resolve(root, "data/regions");
const detailsDir = resolve(root, "data/details");

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return compactText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeItem(item, notifyNo, tender) {
  return {
    id: String(item.id || `manual-${notifyNo}-${Date.now()}`),
    name: compactText(item.name) || "Hàng hóa chưa có tên",
    model: compactText(item.model),
    brand: compactText(item.brand),
    manufacturer: compactText(item.manufacturer),
    origin: compactText(item.origin),
    manufactureYear: compactText(item.manufactureYear),
    specification: String(item.specification || "").trim(),
    unit: compactText(item.unit),
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.unitPrice) || 0,
    amount: Number(item.amount) || 0,
    contractorCode: compactText(item.contractorCode),
    winnerNames: Array.isArray(item.winnerNames)
      ? [...new Set(item.winnerNames.map(compactText).filter(Boolean))]
      : [],
    lotNo: compactText(item.lotNo),
    decisionNo: compactText(item.decisionNo),
    decisionDate: item.decisionDate || "",
    resultPublishedDate: item.resultPublishedDate || "",
    sourceStage: "manual-public-verification",
    sourceUrl: item.sourceUrl || tender?.sourceUrl || "",
    verifiedAt: item.verifiedAt || "",
  };
}

function mergeItems(existingItems, manualItems) {
  const merged = new Map();

  for (const item of [...(existingItems || []), ...(manualItems || [])]) {
    const key = [normalizeKey(item.lotNo), normalizeKey(item.model || item.name)].join("|");
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...item });
      continue;
    }

    const next = { ...previous, ...item };
    for (const [field, value] of Object.entries(previous)) {
      const current = next[field];
      const empty = current === ""
        || current === null
        || current === undefined
        || (Array.isArray(current) && current.length === 0)
        || (typeof current === "number" && current === 0);
      if (empty) next[field] = value;
    }
    next.winnerNames = [...new Set([
      ...(previous.winnerNames || []),
      ...(item.winnerNames || []),
    ].filter(Boolean))];
    merged.set(key, next);
  }

  return [...merged.values()];
}

function emptyDetail() {
  return {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 0,
    bidders: [],
    items: [],
    requirements: { total: 0, items: [], summary: "", disclosure: "unknown" },
    technicalRequirements: {
      total: 0,
      items: [],
      chapters: [],
      files: [],
      disclosure: "unknown",
    },
    modelDisclosure: "as-published",
    fetchedAt: new Date().toISOString(),
  };
}

const regionCache = new Map();
async function loadRegion(slug) {
  if (regionCache.has(slug)) return regionCache.get(slug);
  const regionDir = resolve(regionsDir, slug);
  const state = {
    slug,
    regionDir,
    tendersPath: resolve(regionDir, "tenders.json"),
    equipmentPath: resolve(regionDir, "equipment.json"),
    detailsDir: resolve(regionDir, "details"),
    tenders: await readJson(resolve(regionDir, "tenders.json"), { tenders: [] }),
    equipment: await readJson(resolve(regionDir, "equipment.json"), { equipment: [] }),
    touched: false,
  };
  regionCache.set(slug, state);
  return state;
}

const overrides = await readJson(overridePath, {});
const manifest = await readJson(tendersPath, { tenders: [] });
const tenderByNotifyNo = new Map(
  (manifest.tenders || []).map((tender) => [tender.notifyNo, tender]),
);

let appliedTenderCount = 0;
let appliedItemCount = 0;

for (const [notifyNo, rows] of Object.entries(overrides)) {
  if (!Array.isArray(rows) || rows.length === 0) continue;

  const tender = tenderByNotifyNo.get(notifyNo);
  if (!tender) {
    process.stderr.write(`Bỏ qua dữ liệu bổ sung ${notifyNo}: gói không có trong tenders.json\n`);
    continue;
  }

  const region = await loadRegion(compactText(tender.regionSlug) || "gia-lai");
  let regionalTender = (region.tenders.tenders || [])
    .find((item) => item.notifyNo === notifyNo);
  if (!regionalTender) {
    regionalTender = { ...tender, regionSlug: region.slug };
    region.tenders.tenders = [...(region.tenders.tenders || []), regionalTender];
  }

  const regionalDetailPath = resolve(region.detailsDir, `${notifyNo}.json`);
  const mergedDetailPath = resolve(detailsDir, `${notifyNo}.json`);
  const detail = await readJson(
    regionalDetailPath,
    await readJson(mergedDetailPath, emptyDetail()),
  );
  const manualItems = rows.map((item) => normalizeItem(item, notifyNo, tender));
  detail.items = mergeItems(detail.items, manualItems);
  detail.total = Math.max(Number(detail.total) || 0, detail.items.length);
  detail.manualEquipmentOverrideCount = manualItems.length;
  detail.manualEquipmentVerifiedAt = manualItems
    .map((item) => item.verifiedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";

  await mkdir(region.detailsDir, { recursive: true });
  await mkdir(detailsDir, { recursive: true });
  const detailText = `${JSON.stringify(detail, null, 2)}\n`;
  await writeFile(regionalDetailPath, detailText);
  await writeFile(mergedDetailPath, detailText);

  const winningModels = [...new Set(detail.items
    .map((item) => item.model || item.name)
    .filter(Boolean))];
  tender.winningModels = winningModels;
  regionalTender.winningModels = winningModels;

  const otherEquipment = (region.equipment.equipment || [])
    .filter((item) => item.notifyNo !== notifyNo);
  const tenderEquipment = detail.items.map((item) => ({
    notifyNo,
    tenderName: tender.name || "",
    regionSlug: region.slug,
    region: tender.region || regionalTender.region || "",
    sourceUrl: tender.sourceUrl || "",
    ...item,
  }));
  region.equipment.equipment = [...otherEquipment, ...tenderEquipment];
  region.touched = true;

  appliedTenderCount += 1;
  appliedItemCount += manualItems.length;
  process.stdout.write(`Bổ sung đã xác minh ${notifyNo}: ${manualItems.length} mặt hàng\n`);
}

await writeFile(tendersPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const region of regionCache.values()) {
  if (!region.touched) continue;
  await mkdir(region.regionDir, { recursive: true });
  await writeFile(region.tendersPath, `${JSON.stringify(region.tenders, null, 2)}\n`);
  await writeFile(region.equipmentPath, `${JSON.stringify(region.equipment, null, 2)}\n`);
}

process.stdout.write(
  `Đã áp dụng dữ liệu bổ sung cho ${appliedTenderCount} gói, ${appliedItemCount} mặt hàng từ các tệp vùng\n`,
);

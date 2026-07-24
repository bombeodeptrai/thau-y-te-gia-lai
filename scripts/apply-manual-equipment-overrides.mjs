import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const overridePath = resolve(root, "data/manual-equipment-overrides.json");
const tendersPath = resolve(root, "data/tenders.json");
const equipmentPath = resolve(root, "data/equipment.json");
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
    const key = [
      normalizeKey(item.lotNo),
      normalizeKey(item.model || item.name),
    ].join("|");

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

const overrides = JSON.parse(await readFile(overridePath, "utf8"));
const manifest = JSON.parse(await readFile(tendersPath, "utf8"));
const equipmentPayload = JSON.parse(await readFile(equipmentPath, "utf8"));
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

  const detailPath = resolve(detailsDir, `${notifyNo}.json`);
  let detail;
  try {
    detail = JSON.parse(await readFile(detailPath, "utf8"));
  } catch {
    detail = {
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

  const manualItems = rows.map((item) => normalizeItem(item, notifyNo, tender));
  detail.items = mergeItems(detail.items, manualItems);
  detail.total = Math.max(Number(detail.total) || 0, detail.items.length);
  detail.manualEquipmentOverrideCount = manualItems.length;
  detail.manualEquipmentVerifiedAt = manualItems
    .map((item) => item.verifiedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";

  await writeFile(detailPath, `${JSON.stringify(detail, null, 2)}\n`);

  tender.winningModels = [...new Set(detail.items
    .map((item) => item.model || item.name)
    .filter(Boolean))];

  const otherEquipment = (equipmentPayload.equipment || [])
    .filter((item) => item.notifyNo !== notifyNo);
  const tenderEquipment = detail.items.map((item) => ({
    notifyNo,
    tenderName: tender.name || "",
    sourceUrl: tender.sourceUrl || "",
    ...item,
  }));
  equipmentPayload.equipment = [...otherEquipment, ...tenderEquipment];

  appliedTenderCount += 1;
  appliedItemCount += manualItems.length;
  process.stdout.write(
    `Bổ sung đã xác minh ${notifyNo}: ${manualItems.length} mặt hàng\n`,
  );
}

manifest.fetchedAt = new Date().toISOString();
equipmentPayload.fetchedAt = new Date().toISOString();

await writeFile(tendersPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(equipmentPath, `${JSON.stringify(equipmentPayload, null, 2)}\n`);

process.stdout.write(
  `Đã áp dụng dữ liệu bổ sung cho ${appliedTenderCount} gói, ${appliedItemCount} mặt hàng\n`,
);

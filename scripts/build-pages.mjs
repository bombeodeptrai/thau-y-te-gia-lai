import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-pages");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ["index.html", "styles.css", "app.js", "favicon.svg", "assets", "data"]) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}
const equipmentData = JSON.parse(await readFile(resolve(root, "data/equipment.json"), "utf8"));
let requirementsData = { requirements: [], fetchedAt: "" };
let technicalRequirementsData = { technicalRequirements: [], fetchedAt: "" };
try {
  requirementsData = JSON.parse(await readFile(resolve(root, "data/requirements.json"), "utf8"));
} catch {
  // Bản dữ liệu cũ chưa có danh mục phần/lô mời thầu.
}
try {
  technicalRequirementsData = JSON.parse(await readFile(resolve(root, "data/technical-requirements.json"), "utf8"));
} catch {
  // Bản dữ liệu cũ chưa có biểu mẫu kỹ thuật e-HSMT đã trích xuất.
}
const awardedEquipmentSearch = (equipmentData.equipment || [])
  .filter((item) => item.notifyNo)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: String(item.name || "").replace(/\s+/g, " ").trim(),
    model: String(item.model || "").replace(/\s+/g, " ").trim(),
    brand: String(item.brand || "").replace(/\s+/g, " ").trim(),
    manufacturer: String(item.manufacturer || "").replace(/\s+/g, " ").trim(),
    origin: String(item.origin || "").replace(/\s+/g, " ").trim(),
    stage: "award",
  }));
const invitedEquipmentSearch = (requirementsData.requirements || [])
  .filter((item) => item.notifyNo && item.name)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: String(item.name || "").replace(/\s+/g, " ").trim(),
    model: "",
    brand: "",
    manufacturer: "",
    origin: "",
    lotNo: String(item.lotNo || "").replace(/\s+/g, " ").trim(),
    stage: "invitation",
  }));
const technicalEquipmentSearch = (technicalRequirementsData.technicalRequirements || [])
  .filter((item) => item.notifyNo && item.name)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: String(item.name || "").replace(/\s+/g, " ").trim(),
    model: String(item.code || "").replace(/\s+/g, " ").trim(),
    brand: String(item.brand || "").replace(/\s+/g, " ").trim(),
    manufacturer: String(item.manufacturer || "").replace(/\s+/g, " ").trim(),
    origin: String(item.origin || "").replace(/\s+/g, " ").trim(),
    lotNo: String(item.lotNo || "").replace(/\s+/g, " ").trim(),
    lotName: String(item.lotName || "").replace(/\s+/g, " ").trim(),
    stage: "invitation-technical",
  }));
const equipmentSearch = [
  ...awardedEquipmentSearch,
  ...invitedEquipmentSearch,
  ...technicalEquipmentSearch,
];
await writeFile(
  resolve(output, "data/equipment-search.json"),
  `${JSON.stringify({
    equipment: equipmentSearch,
    fetchedAt: equipmentData.fetchedAt || requirementsData.fetchedAt
      || technicalRequirementsData.fetchedAt || "",
  })}\n`,
);
await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write(`Đã tạo bản GitHub Pages tại ${output} với ${equipmentSearch.length} dòng chỉ mục thiết bị/model/e-HSMT\n`);

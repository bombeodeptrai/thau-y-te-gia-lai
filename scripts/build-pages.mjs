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
const equipmentSearch = (equipmentData.equipment || [])
  .filter((item) => item.notifyNo)
  .map((item) => ({
    notifyNo: String(item.notifyNo).trim(),
    name: String(item.name || "").replace(/\s+/g, " ").trim(),
    model: String(item.model || "").replace(/\s+/g, " ").trim(),
    brand: String(item.brand || "").replace(/\s+/g, " ").trim(),
    manufacturer: String(item.manufacturer || "").replace(/\s+/g, " ").trim(),
    origin: String(item.origin || "").replace(/\s+/g, " ").trim(),
  }));
await writeFile(
  resolve(output, "data/equipment-search.json"),
  `${JSON.stringify({ equipment: equipmentSearch, fetchedAt: equipmentData.fetchedAt || "" })}\n`,
);
await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write(`Đã tạo bản GitHub Pages tại ${output} với ${equipmentSearch.length} dòng chỉ mục thiết bị/model\n`);

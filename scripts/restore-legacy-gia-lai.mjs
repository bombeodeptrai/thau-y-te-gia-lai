import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const legacyCommit = process.env.LEGACY_DATA_COMMIT
  || "2c0658c433d63e681d622c0ac34c9fbcef14af82";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function gitText(path) {
  return execFileSync("git", ["show", `${legacyCommit}:${path}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

async function restoreFile(path, required = false) {
  try {
    const content = gitText(path);
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    return true;
  } catch (error) {
    if (required) throw new Error(`Không khôi phục được ${path}: ${error.message}`);
    return false;
  }
}

async function ensurePayload(path, key) {
  const current = await readJson(resolve(root, path), null);
  if (current && Array.isArray(current[key])) return;
  await writeFile(resolve(root, path), `${JSON.stringify({
    [key]: [],
    fetchedAt: new Date().toISOString(),
    disclosure: "legacy-tender-list-restored; details-will-be-refreshed",
  }, null, 2)}\n`);
}

const current = await readJson(resolve(dataDir, "tenders.json"), { tenders: [] });
if (Array.isArray(current.tenders) && current.tenders.length > 0) {
  process.stdout.write(`Dữ liệu hiện tại còn ${current.tenders.length} gói; không cần khôi phục dự phòng.\n`);
  process.exit(0);
}

await restoreFile("data/tenders.json", true);

const optionalPayloads = [
  ["data/bidders.json", "bidders"],
  ["data/equipment.json", "equipment"],
  ["data/requirements.json", "requirements"],
  ["data/technical-requirements.json", "technicalRequirements"],
];
for (const [path, key] of optionalPayloads) {
  const restored = await restoreFile(path, false);
  if (!restored) await ensurePayload(path, key);
}
for (const path of ["data/competitor-history.json", "data/ai-analyses.json"]) {
  await restoreFile(path, false);
}

let detailFiles = [];
try {
  detailFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", legacyCommit, "--", "data/details"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => /^data\/details\/IB\d{10}\.json$/.test(value));
} catch {
  detailFiles = [];
}
for (const path of detailFiles) await restoreFile(path, false);

const restored = await readJson(resolve(dataDir, "tenders.json"), { tenders: [] });
if (!Array.isArray(restored.tenders) || !restored.tenders.length) {
  throw new Error("Bản dự phòng Gia Lai không chứa gói thầu");
}

process.stdout.write(
  `Đã khôi phục dự phòng Gia Lai từ ${legacyCommit}: ${restored.tenders.length} gói, ${detailFiles.length} hồ sơ chi tiết. Các chi tiết còn thiếu sẽ được quét lại.\n`,
);

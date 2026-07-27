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

async function restoreFile(path, required = true) {
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

const current = await readJson(resolve(dataDir, "tenders.json"), { tenders: [] });
if (Array.isArray(current.tenders) && current.tenders.length > 0) {
  process.stdout.write(`Dữ liệu hiện tại còn ${current.tenders.length} gói; không cần khôi phục dự phòng.\n`);
  process.exit(0);
}

const requiredFiles = [
  "data/tenders.json",
  "data/bidders.json",
  "data/equipment.json",
  "data/requirements.json",
  "data/technical-requirements.json",
];
for (const path of requiredFiles) await restoreFile(path, true);
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
  `Đã khôi phục dự phòng Gia Lai từ ${legacyCommit}: ${restored.tenders.length} gói, ${detailFiles.length} hồ sơ chi tiết.\n`,
);

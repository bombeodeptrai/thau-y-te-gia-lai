import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-pages");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ["index.html", "styles.css", "app.js", "favicon.svg", "assets", "data"]) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}
await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write(`Đã tạo bản GitHub Pages tại ${output}\n`);

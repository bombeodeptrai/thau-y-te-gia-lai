import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.argv[2] || "dist-pages/competitor-analysis.js");
let source = await readFile(target, "utf8");

const oldFunction = `  function isRegional(record) {
    return /gia lai|pleiku|quy nhon|binh dinh|an khe|ayun pa/.test(
      normalize(\`${"${record?.location || \"\"} ${record?.investor || \"\"}"}\`),
    );
  }`;
const newFunction = `  function isRegional(tender, record) {
    if (tender?.regionSlug && record?.regionSlug) {
      return tender.regionSlug === record.regionSlug;
    }
    return /thanh hoa|nghe an|ha tinh|quang tri|quang binh|hue|da nang|quang nam|quang ngai|kon tum|gia lai|binh dinh|dak lak|phu yen|khanh hoa|ninh thuan|lam dong|binh thuan|dak nong/.test(
      normalize(\`${"${record?.location || \"\"} ${record?.investor || \"\"}"}\`),
    );
  }`;

if (!source.includes(oldFunction)) {
  throw new Error("Không tìm thấy hàm isRegional cần vá trong competitor-analysis.js");
}
source = source.replace(oldFunction, newFunction);
source = source.replace(
  ".filter((record) => isRegional(record))",
  ".filter((record) => isRegional(tender, record))",
);

await writeFile(target, source);
process.stdout.write(`Đã điều chỉnh phân tích đối thủ theo tỉnh tại ${target}\n`);

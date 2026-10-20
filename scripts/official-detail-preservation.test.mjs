import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  detailFilesForManifest,
  isOfficialDetailFileName,
  mergeOfficialDetail,
  preserveTenderBidderCount,
  normalizeTenderDisclosedNames,
  mergeDisclosedBidders,
} from "./official-detail-preservation.mjs";

test("IB2600313612 giữ 223 dòng mở thầu khi kết quả chỉ trả 167 dòng", () => {
  const opening = Array.from({length:223}, (_, i) => ({contractorCode:`vn${i}`,lotNo:`PP${i}`,status:"participating",bidPrice:i+1}));
  const result = opening.slice(0,167).map(row => ({...row,status:"won",winningPrice:row.bidPrice}));
  const bidders = mergeDisclosedBidders(opening,result);
  assert.equal(bidders.length,223);
  assert.equal(bidders.filter(row=>row.status==="won").length,167);
  assert.equal(bidders.filter(row=>row.status==="participating").length,56);
  assert.deepEqual(mergeDisclosedBidders(bidders,result),bidders);
  assert.equal(mergeOfficialDetail({bidders:opening},{bidders:result}).bidders.length,223);
});

test("DC2600000882 không đếm hai tên khác khoảng trắng thành hai nhà thầu", () => {
  const name = "CÔNG TY TNHH THIẾT BỊ Y TẾ VŨ GIA PHÁT";
  const tender = {notifyNo:"DC2600000882", bidderCount:2, winnerNames:[name+" ",name], participantNames:[name]};
  assert.equal(preserveTenderBidderCount({}, {bidderCount:0}, tender), 1);
  const result = normalizeTenderDisclosedNames(tender, [{taxCode:"0110122265",contractorName:name}]);
  assert.equal(result.bidderCount,1);
  assert.deepEqual(result.winnerNames,[name]);
  assert.equal(normalizeTenderDisclosedNames(tender, []).bidderCount,2);
  assert.equal(normalizeTenderDisclosedNames({...tender,notifyNo:"IB2600567655"}, [{taxCode:"0110122265",contractorName:name}]).bidderCount,1);
  assert.equal(normalizeTenderDisclosedNames({...tender,sourceBidderCount:2}, [{taxCode:"0110122265",contractorName:name}]).bidderCount,2);
  assert.equal(normalizeTenderDisclosedNames({...tender,bidderCount:5}, [{taxCode:"0110122265",contractorName:name}]).bidderCount,5);
  assert.equal(preserveTenderBidderCount({bidderCount:3},{bidderCount:0},tender),3);
});

test("ghép audit đếm hồ sơ hiện có thay cho bộ đếm artifact cũ: IB2600573048", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "merge-detail-count-"));
  t.after(() => rm(root, {recursive:true,force:true}));
  await mkdir(resolve(root,"scripts"),{recursive:true});
  const region = resolve(root,"data/regions/gia-lai");
  await mkdir(resolve(region,"details"),{recursive:true});
  for (const file of ["merge-regions.mjs","region-membership.mjs","official-detail-preservation.mjs"]) {
    await copyFile(new URL(file,import.meta.url),resolve(root,"scripts",file));
  }
  await writeFile(resolve(root,"data/regions.json"),JSON.stringify({regions:[{slug:"gia-lai",name:"Gia Lai",provinceCodes:["52","64"]}]}));
  await writeFile(resolve(region,"tenders.json"),JSON.stringify({tenders:[{notifyNo:"IB2600573048",regionSlug:"gia-lai"}],detailTenderCount:0,collection:{days:1095}}));
  await writeFile(resolve(region,"details/IB2600573048.json"),"{}");
  await writeFile(resolve(region,"details/IB2300271301.json"),"{}");
  execFileSync(process.execPath,[resolve(root,"scripts/merge-regions.mjs")],{stdio:"pipe"});
  const manifest=JSON.parse(await readFile(resolve(region,"tenders.json"),"utf8"));
  const coverage=JSON.parse(await readFile(resolve(root,"data/region-coverage.json"),"utf8"));
  assert.equal(manifest.detailTenderCount,1);
  assert.equal(coverage.regions[0].detailTenderCount,1);
  assert.equal(manifest.tenders[0].notifyNo,"IB2600573048");
});

test("nhận cả hồ sơ IB và DC, chỉ giữ tệp thuộc manifest theo thứ tự ổn định", () => {
  assert.equal(isOfficialDetailFileName("IB2600000001.json"), true);
  assert.equal(isOfficialDetailFileName("DC2600000002.json"), true);
  assert.equal(isOfficialDetailFileName("manual-1.json"), false);
  assert.deepEqual(
    detailFilesForManifest(
      ["DC2600000002.json", "IB2600000001.json", "DC2600000002.json", "ZZ2600000003.json"],
      [
        { notifyNo: "IB2600000001" },
        { notifyNo: "DC2600000002" },
      ],
    ),
    ["DC2600000002.json", "IB2600000001.json"],
  );
});

test("không xóa kết quả nhà thầu và thiết bị khi nguồn làm mới tạm trả rỗng", () => {
  const previous = {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 2,
    bidders: [{ name: "Nhà thầu A" }],
    items: [{ name: "Máy A" }, { name: "Máy B" }],
    requirements: { total: 1, items: [{ name: "Lô cũ" }], disclosure: "public-plan-lots" },
    technicalRequirements: { total: 1, items: [{ content: "Thông số cũ" }] },
    fetchedAt: "2026-10-04T00:00:00.000Z",
  };
  const current = {
    schemaVersion: 3,
    resultItemParserVersion: 3,
    total: 0,
    bidders: [],
    items: [],
    requirements: { total: 0, items: [], disclosure: "temporarily-unavailable" },
    technicalRequirements: { total: 0, items: [], disclosure: "temporarily-unavailable" },
    fetchedAt: "2026-10-05T00:00:00.000Z",
  };
  const merged = mergeOfficialDetail(previous, current);
  assert.deepEqual(merged.bidders, previous.bidders);
  assert.deepEqual(merged.items, previous.items);
  assert.deepEqual(merged.requirements.items, previous.requirements.items);
  assert.deepEqual(merged.technicalRequirements.items, previous.technicalRequirements.items);
  assert.equal(merged.requirements.disclosure, "public-plan-lots");
  assert.equal(merged.total, 2);
  assert.equal(merged.fetchedAt, current.fetchedAt);
});

test("dùng dữ liệu mới khi nguồn chính thức trả về nội dung đầy đủ", () => {
  const merged = mergeOfficialDetail(
    {
      total: 1,
      bidders: [{ name: "Cũ" }],
      items: [{ name: "Thiết bị cũ" }],
      requirements: { total: 1, items: [{ name: "Lô cũ" }] },
      technicalRequirements: { total: 1, items: [{ content: "Cũ" }] },
    },
    {
      total: 2,
      bidders: [{ name: "Mới" }],
      items: [{ name: "Thiết bị mới 1" }, { name: "Thiết bị mới 2" }],
      requirements: { total: 1, items: [{ name: "Lô mới" }] },
      technicalRequirements: { total: 1, items: [{ content: "Mới" }] },
    },
  );
  assert.deepEqual(merged.bidders, [{ name: "Mới" }]);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.requirements.items[0].name, "Lô mới");
  assert.equal(merged.technicalRequirements.items[0].content, "Mới");
});

test("không để quét nhanh ghi đè số nhà thầu đã bổ sung chi tiết về 0", () => {
  assert.equal(
    preserveTenderBidderCount(
      { bidderCount: 1, winnerNames: ["Nhà thầu A"] },
      { bidderCount: 0, winnerNames: [] },
      { winnerNames: ["Nhà thầu A"], participantNames: [] },
    ),
    1,
  );
  assert.equal(
    preserveTenderBidderCount(
      { bidderCount: null },
      { bidderCount: 0 },
      { winnerNames: ["Nhà thầu A", "Nhà thầu B"] },
    ),
    2,
  );
});

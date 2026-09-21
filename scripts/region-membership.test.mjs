import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeTenderRegionSlugs,
  tenderBelongsToRegion,
  tenderRegionSlugs,
} from "./region-membership.mjs";

test("giữ tương thích với gói chỉ thuộc một tỉnh", () => {
  const tender = { notifyNo: "IB2600000001", regionSlug: "gia-lai" };
  assert.deepEqual(tenderRegionSlugs(tender), ["gia-lai"]);
  assert.equal(tenderBelongsToRegion(tender, "gia-lai"), true);
  assert.equal(tenderBelongsToRegion(tender, "lam-dong"), false);
});

test("hợp nhất đầy đủ các tỉnh của cùng một gói đa tỉnh", () => {
  const slugs = mergeTenderRegionSlugs(
    { notifyNo: "IB2600518070", regionSlug: "thanh-hoa" },
    { notifyNo: "IB2600518070", regionSlug: "gia-lai" },
    { notifyNo: "IB2600518070", regionSlug: "lam-dong", regionSlugs: ["dak-lak"] },
  );

  assert.deepEqual(slugs, ["thanh-hoa", "gia-lai", "dak-lak", "lam-dong"]);
  assert.equal(tenderBelongsToRegion({ regionSlug: "lam-dong", regionSlugs: slugs }, "gia-lai"), true);
});

test("loại vùng trống và vùng trùng khi hợp nhất", () => {
  assert.deepEqual(mergeTenderRegionSlugs(
    { regionSlug: "gia-lai", regionSlugs: ["gia-lai", ""] },
    { regionSlug: "gia-lai" },
  ), ["gia-lai"]);
});

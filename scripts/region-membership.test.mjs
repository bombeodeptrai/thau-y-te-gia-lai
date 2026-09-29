import test from "node:test";
import assert from "node:assert/strict";
import {
  inferTenderRegionSlugs,
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

test("suy ra đủ vùng từ tên tỉnh chính thức của gói đa tỉnh", () => {
  const regions = [
    { slug: "gia-lai", name: "Gia Lai", provinceCodes: ["52", "64"], locationTerms: ["Gia Lai", "Bình Định", "Vĩnh Thạnh"] },
    { slug: "nghe-an", name: "Nghệ An", provinceCodes: ["40"], locationTerms: ["Nghệ An", "Vinh"] },
    { slug: "lam-dong", name: "Lâm Đồng", provinceCodes: ["60", "67", "68"], locationTerms: ["Lâm Đồng", "Bình Thuận", "Đắk Nông"] },
  ];
  const slugs = inferTenderRegionSlugs({
    notifyNo: "IB2600558508",
    regionSlug: "gia-lai",
    location: "Tỉnh Gia Lai, Tỉnh Lâm Đồng",
  }, regions);

  assert.deepEqual(slugs, ["gia-lai", "lam-dong"]);
});

test("không suy nhầm tên huyện thành tỉnh khác", () => {
  const regions = [
    { slug: "gia-lai", name: "Gia Lai", locationTerms: ["Gia Lai", "Vĩnh Thạnh"] },
    { slug: "nghe-an", name: "Nghệ An", locationTerms: ["Nghệ An", "Vinh"] },
  ];

  assert.deepEqual(inferTenderRegionSlugs({
    regionSlug: "gia-lai",
    location: "Huyện Vĩnh Thạnh, Tỉnh Gia Lai",
  }, regions), ["gia-lai"]);
});

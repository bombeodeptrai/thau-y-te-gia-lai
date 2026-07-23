import assert from "node:assert/strict";
import test from "node:test";
import { extractOnlineReofferTechnicalRequirements } from "./technical-requirements.mjs";

test("extracts a child technical row and inherits its lot information", () => {
  const payload = {
    bidaInvChapterConfList: [{ code: "FORM-1", name: "Phạm vi cung cấp", orderIndex: 1 }],
    bidoInvBiddingDTO: [{
      formCode: "FORM-1",
      formValue: JSON.stringify({
        Table: [
          { id: 10, lotNo: "PP001", lotName: "Lô xét nghiệm", projectPlace: "Gia Lai" },
          {
            id: 11,
            parent: 10,
            pos: "1.1",
            name: "Máy xét nghiệm",
            qty: 2,
            uom: "Máy",
            code: "MODEL-01",
            manufacture: "Hãng A",
            specification: "Công suất tối thiểu 100 mẫu/giờ",
          },
        ],
      }),
    }],
  };

  const result = extractOnlineReofferTechnicalRequirements(payload);
  assert.equal(result.total, 1);
  assert.equal(result.disclosure, "public-structured-hsmt");
  assert.deepEqual(result.items[0], {
    id: "11",
    position: "1.1",
    lotNo: "PP001",
    lotName: "Lô xét nghiệm",
    name: "Máy xét nghiệm",
    unit: "Máy",
    quantity: 2,
    code: "MODEL-01",
    brand: "",
    manufacturer: "Hãng A",
    origin: "",
    manufactureYear: "",
    specification: "Công suất tối thiểu 100 mẫu/giờ",
    otherRequirement: "",
    projectPlace: "Gia Lai",
    earliestDeliveryDate: "",
    latestDeliveryDate: "",
    formCode: "FORM-1",
    chapterName: "Phạm vi cung cấp",
    sourceStage: "invitation-technical",
  });
});

test("returns a clear disclosure when no technical table is public", () => {
  const result = extractOnlineReofferTechnicalRequirements({ bidoInvBiddingDTO: [] });
  assert.equal(result.total, 0);
  assert.equal(result.disclosure, "public-hsmt-no-technical-table");
});

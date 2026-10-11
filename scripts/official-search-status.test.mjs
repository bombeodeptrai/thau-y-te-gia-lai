import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

for (const file of ["fetch-recent-location-audit.mjs", "fetch-recent-medical-rescue.mjs", "repair-official-tender-identities.mjs"]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const body = source.match(/function statusOf\(item\) \{[\s\S]*?\n\}/u)[0];
  const statusOf = vm.runInNewContext(`(${body})`);
  test(`${file}: giữ trạng thái hủy và không có nhà thầu khi đối chiếu lại`, () => {
    const closed = { bidCloseDate: "2026-01-01" };
    assert.equal(statusOf({ ...closed, notifyNo: "IB2600550501", status: "CANCEL_BID", statusForNotify: "DXT" }), "cancelled");
    assert.equal(statusOf({ ...closed, notifyNo: "IB2600550475", statusForNotify: "DHT" }), "cancelled");
    assert.equal(statusOf({ ...closed, statusForNotify: "DHTBMT" }), "cancelled");
    assert.equal(statusOf({ ...closed, notifyNo: "IB2600558508", numBidderJoin: 0 }), "no_bidder");
    assert.equal(statusOf({ ...closed, numBidderJoin: "0" }), "no_bidder");
    assert.equal(statusOf({ ...closed, numBidderJoin: null }), "closed");
    assert.equal(statusOf(closed), "closed");
    assert.equal(statusOf({ ...closed, inputResultId: "official-result", numBidderJoin: 0 }), "awarded");
  });
}

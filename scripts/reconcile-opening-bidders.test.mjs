import assert from 'node:assert/strict';
import test from 'node:test';
import { disclosedOpeningRows } from './reconcile-opening-bidders.mjs';
import { mergeDisclosedBidders } from './official-detail-preservation.mjs';

test('nguồn mở thầu giữ trạng thái tham dự, không suy đoán trượt', () => {
  const rows = disclosedOpeningRows([{ id: 'source-id', contractorCode: 'vn01', contractorName: ' Công ty A ', lotNo: 'PP01', lotName: ' Vật tư ', lotFinalPrice: 120, succBidderYn: 0 }]);
  assert.equal(rows[0].status, 'participating');
  assert.equal(rows[0].winningPrice, 0);
  assert.equal(rows[0].contractorName, 'Công ty A');
  const result = { ...rows[0], status: 'won', winningPrice: 110, models: ['model công khai'] };
  assert.deepEqual(mergeDisclosedBidders(rows, [result]), [result]);
  assert.deepEqual(mergeDisclosedBidders([result], rows), [result]);
  assert.equal(mergeDisclosedBidders([{ contractorCode: 'vn02', lotNo: '', status: 'participating' }], rows).length, 2);
});
test('không ghi dữ liệu từ lỗi nguồn hoặc dòng thiếu định danh', () => {
  assert.throws(() => disclosedOpeningRows({ error: 'blocked' }));
  assert.throws(() => disclosedOpeningRows([{ contractorCode: 'vn01' }]));
  assert.deepEqual(disclosedOpeningRows([]), []);
});

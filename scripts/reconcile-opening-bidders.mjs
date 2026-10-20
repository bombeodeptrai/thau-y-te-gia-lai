import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDisclosedBidders, uniqueDisclosedNames } from './official-detail-preservation.mjs';

const SOURCE = 'https://muasamcong.mof.gov.vn';
const ENDPOINT = `${SOURCE}/o/egp-portal-contractor-selection-v2/services/expose/ldtkqmt/bid-notification-p/lotOpenDetail?token=public`;
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const number = value => Number(value) || 0;

export function disclosedOpeningRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Nguồn mở thầu không trả về danh sách; không ghi dữ liệu');
  return rows.map(row => {
    if (!row.contractorCode || !row.lotNo || !row.contractorName) {
      throw new Error('Dòng mở thầu thiếu định danh hoặc tên; không suy đoán dữ liệu');
    }
    return {
      id: row.id || `${row.contractorCode}|${row.lotNo}`,
      contractorCode: row.contractorCode, taxCode: row.taxCode || '',
      contractorName: text(row.contractorName), status: 'participating',
      lotNo: row.lotNo, lotName: text(row.lotName),
      bidPrice: number(row.lotOpenPrice ?? row.bidFinalPrice ?? row.lotFinalPrice ?? row.lotPrice ?? row.bidPrice),
      finalPrice: number(row.lotFinalPrice ?? row.bidFinalPrice ?? row.bidPrice),
      winningPrice: 0, reason: text(row.reason || row.noPassedRson || row.noSuccBidderRson),
      submittedAt: row.createdDateBidOpen || row.createdDate || '', models: [],
    };
  });
}

async function fetchOpening(tender) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Origin: SOURCE, Referer: `${SOURCE}/` },
        body: JSON.stringify({ notifyNo: tender.notifyNo, notifyId: tender.notifyId || tender.id, type: 'TBMT', packType: 0 }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return disclosedOpeningRows(await response.json());
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function main() {
  const region = process.argv[2] || 'gia-lai';
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(region)) throw new Error('Định danh vùng không hợp lệ');
  const dir = resolve('data/regions', region);
  const manifest = await read(resolve(dir, 'tenders.json'));
  const originalBidders = await read(resolve(dir, 'bidders.json'));
  const candidates = manifest.tenders.filter(t => t.inputResultId && t.bidOpenId);
  const changes = new Map(), failures = [], checked = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < candidates.length) {
      const tender = candidates[next++];
      try {
        const opening = await fetchOpening(tender);
        const path = resolve(dir, 'details', `${tender.notifyNo}.json`);
        const detail = await read(path);
        const bidders = mergeDisclosedBidders(opening, detail.bidders);
        const restored = bidders.length - (detail.bidders || []).length;
        checked.push({ notifyNo: tender.notifyNo, openingRows: opening.length, restored });
        if (restored > 0) changes.set(tender.notifyNo, { path, detail: { ...detail, bidders }, restored });
        if (checked.length % 25 === 0 || restored > 0) console.log(`${checked.length}/${candidates.length} ${tender.notifyNo}: phục hồi ${restored}`);
      } catch (error) { failures.push({ notifyNo: tender.notifyNo, error: error.message }); }
    }
  }));
  const summary = {
    checkedAt: new Date().toISOString(), region, source: ENDPOINT,
    scope: 'all-active-result-tenders-with-opening-id', windowDays: manifest.collection?.days || 1095,
    candidateCount: candidates.length, checkedCount: checked.length, failures,
    restoredTenderCount: changes.size,
    restoredBidderRows: [...changes.values()].reduce((sum, change) => sum + change.restored, 0),
    changes: [...changes].map(([notifyNo, change]) => ({ notifyNo, restored: change.restored })),
  };
  console.log(JSON.stringify(summary));
  if (failures.length) throw new Error(`${failures.length} hồ sơ chưa xác minh; không ghi dữ liệu`);
  if (!process.argv.includes('--apply')) return;
  const tendersByNo = new Map(manifest.tenders.map(t => [t.notifyNo, t]));
  const bidders = originalBidders.bidders.filter(row => !changes.has(row.notifyNo));
  for (const [notifyNo, change] of changes) {
    const tender = tendersByNo.get(notifyNo);
    tender.participantNames = uniqueDisclosedNames([...(tender.participantNames || []), ...change.detail.bidders.map(b => b.contractorName)]);
    tender.bidderCount = Math.max(Number(tender.bidderCount) || 0, tender.participantNames.length);
    bidders.push(...change.detail.bidders.map(row => ({ notifyNo, tenderName: tender.name, sourceUrl: tender.sourceUrl, ...row })));
  }
  if (bidders.length < originalBidders.bidders.length) throw new Error('Chặn giảm số dòng nhà thầu');
  for (const change of changes.values()) await save(change.path, change.detail);
  if (changes.size) {
    await save(resolve(dir, 'bidders.json'), { ...originalBidders, bidders, fetchedAt: summary.checkedAt });
    // Không giả mạo fetchedAt của lượt quét danh sách gói.
    await save(resolve(dir, 'tenders.json'), manifest);
  }
  await save(resolve(dir, 'opening-reconciliation-summary.json'), summary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

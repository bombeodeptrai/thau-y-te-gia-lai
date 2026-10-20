const OFFICIAL_NOTIFY_NO = /^[A-Z]{2}\d{10}$/u;

function hasRows(value) {
  return Array.isArray(value) && value.length > 0;
}

function preserveRows(previous, current) {
  if (hasRows(current)) return current;
  if (hasRows(previous)) return previous;
  return Array.isArray(current) ? current : (Array.isArray(previous) ? previous : []);
}

// Kết quả lựa chọn có thể chỉ công bố một phần nhà thầu đã mở thầu.
// Khóa nhà thầu + lô giữ lịch sử công khai, còn kết quả mới thắng khi trùng khóa.
export function mergeDisclosedBidders(previous = [], current = []) {
  if (!hasRows(current)) return preserveRows(previous, current);
  const key = row => {
    const contractor = String(row.contractorCode || row.taxCode || row.contractorName || "").trim();
    const lot = String(row.lotNo || row.lotName || "").trim();
    return contractor ? `${contractor}|${lot}` : "";
  };
  const merged = new Map();
  for (const row of previous || []) if (key(row)) merged.set(key(row), row);
  const unkeyed = [];
  for (const row of current) {
    const identity = key(row);
    if (identity) {
      const known = merged.get(identity) || {};
      const keepResult = ['won', 'lost'].includes(known.status) && row.status === 'participating';
      merged.set(identity, keepResult ? { ...row, ...known } : { ...known, ...row });
    }
    else unkeyed.push(row);
  }
  return [...merged.values(), ...unkeyed];
}

function preserveSection(previous = {}, current = {}) {
  const items = preserveRows(previous?.items, current?.items);
  const usePrevious = !hasRows(current?.items) && hasRows(previous?.items);
  const preferred = usePrevious ? previous : current;
  const fallback = usePrevious ? current : previous;
  return {
    ...(fallback || {}),
    ...(preferred || {}),
    items,
    total: Math.max(
      Number(previous?.total) || 0,
      Number(current?.total) || 0,
      items.length,
    ),
  };
}

export function isOfficialDetailFileName(name) {
  const value = String(name || "");
  return value.endsWith(".json")
    && OFFICIAL_NOTIFY_NO.test(value.slice(0, -5));
}

export function detailFilesForManifest(fileNames, tenders = []) {
  const allowed = new Set(
    tenders
      .map((tender) => String(tender?.notifyNo || "").trim())
      .filter((notifyNo) => OFFICIAL_NOTIFY_NO.test(notifyNo))
      .map((notifyNo) => `${notifyNo}.json`),
  );
  return [...new Set(fileNames)]
    .filter((name) => isOfficialDetailFileName(name) && allowed.has(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function mergeOfficialDetail(previous = {}, current = {}) {
  const bidders = mergeDisclosedBidders(previous?.bidders, current?.bidders);
  const items = preserveRows(previous?.items, current?.items);
  return {
    ...(previous || {}),
    ...(current || {}),
    schemaVersion: Math.max(Number(previous?.schemaVersion) || 0, Number(current?.schemaVersion) || 0),
    resultItemParserVersion: Math.max(
      Number(previous?.resultItemParserVersion) || 0,
      Number(current?.resultItemParserVersion) || 0,
    ),
    total: Math.max(
      Number(previous?.total) || 0,
      Number(current?.total) || 0,
      items.length,
    ),
    bidders,
    items,
    requirements: preserveSection(previous?.requirements, current?.requirements),
    technicalRequirements: preserveSection(
      previous?.technicalRequirements,
      current?.technicalRequirements,
    ),
  };
}

export function uniqueDisclosedNames(values = []) {
  return [...new Set(values.map(value => String(value ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

export function normalizeTenderDisclosedNames(tender, bidders = []) {
  const rawNames = new Set([...(tender.winnerNames || []), ...(tender.participantNames || [])].filter(Boolean));
  const names = uniqueDisclosedNames([...rawNames]);
  const normalized = { ...tender };
  for (const field of ["winnerNames", "participantNames", "loserNames"]) {
    if (Array.isArray(tender[field])) normalized[field] = uniqueDisclosedNames(tender[field]);
  }
  // Chỉ sửa bộ đếm lịch sử suy ra từ tên trùng khi
  // hồ sơ chính thức có cùng một định danh nhà thầu. Không hạ số đã biết
  // nguồn đã công bố số lớn hơn hoặc bộ đếm lớn hơn số tên đã công bố.
  const identities = new Set(bidders.map(b => b.taxCode || b.contractorCode).filter(Boolean));
  if (OFFICIAL_NOTIFY_NO.test(tender.notifyNo || "")
      && rawNames.size > names.length && names.length === 1
      && !(Number(tender.sourceBidderCount) > 1)
      && Number(tender.bidderCount) === rawNames.size
      && identities.size === 1 && bidders.length > 0
      && bidders.every(b => uniqueDisclosedNames([b.contractorName])[0] === names[0])) {
    normalized.bidderCount = 1;
  }
  return normalized;
}

export function preserveTenderBidderCount(previous = {}, current = {}, merged = {}) {
  const counts = [previous?.bidderCount, current?.bidderCount]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const disclosedNames = uniqueDisclosedNames([
    ...(merged?.winnerNames || []),
    ...(merged?.participantNames || []),
  ]).length;
  if (!counts.length && disclosedNames === 0) {
    return current?.bidderCount ?? previous?.bidderCount ?? null;
  }
  return Math.max(0, disclosedNames, ...counts);
}

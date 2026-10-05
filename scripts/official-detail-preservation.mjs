const OFFICIAL_NOTIFY_NO = /^[A-Z]{2}\d{10}$/u;

function hasRows(value) {
  return Array.isArray(value) && value.length > 0;
}

function preserveRows(previous, current) {
  if (hasRows(current)) return current;
  if (hasRows(previous)) return previous;
  return Array.isArray(current) ? current : (Array.isArray(previous) ? previous : []);
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
  const bidders = preserveRows(previous?.bidders, current?.bidders);
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

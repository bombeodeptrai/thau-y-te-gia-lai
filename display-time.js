(function exposeTenderDisplayTime(root) {
  "use strict";

  const SOURCE_TIME_ZONE_OFFSET = "+07:00";

  function sourceDateTimestamp(value) {
    const text = String(value ?? "").trim();
    if (!text) return Number.NaN;
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    const sourceLocalTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
    return new Date(sourceLocalTime && !hasExplicitZone
      ? `${text}${SOURCE_TIME_ZONE_OFFSET}`
      : text).getTime();
  }

  function withinSnapshotDays(publicDate, days, fetchedAt) {
    const published = sourceDateTimestamp(publicDate);
    if (!Number.isFinite(published)) return true;
    const dayCount = Number(days);
    if (!Number.isFinite(dayCount) || dayCount <= 0) return true;
    const snapshotTime = new Date(fetchedAt || "").getTime();
    const referenceTime = Number.isFinite(snapshotTime) ? snapshotTime : Date.now();
    return published >= referenceTime - dayCount * 86_400_000;
  }

  const api = { sourceDateTimestamp, withinSnapshotDays };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.tenderDisplayTime = api;
}(typeof window !== "undefined" ? window : global));

import { isMedicalTender } from "./medical-scope.mjs";
import { tenderRegionSlugs } from "./region-membership.mjs";

function isManualTender(item) {
  return Boolean(
    item?.manualTenderOverride
    || String(item?.id || "").startsWith("manual-")
    || String(item?.sourceStage || "").startsWith("manual"),
  );
}

export function shouldRetainStoredTender(item, {
  scanDays = 1095,
  now = Date.now(),
} = {}) {
  if (isManualTender(item)) return false;
  const coverageCutoff = Number(now) - Math.max(1, Number(scanDays) || 1) * 86_400_000;
  const publishedAt = new Date(item?.publicDate || 0).getTime();
  if (!publishedAt || publishedAt < coverageCutoff) return false;
  return isMedicalTender({
    bidName: [item?.name],
    investorName: item?.investor,
  });
}

export function retainedOfficialTenderCount(payload, {
  regionSlug = "",
  scanDays = 1095,
  now = Date.now(),
} = {}) {
  if (!Array.isArray(payload?.tenders)) return 0;

  return payload.tenders.filter((item) => {
    const itemRegions = tenderRegionSlugs(item);
    if (regionSlug && itemRegions.length && !itemRegions.includes(regionSlug)) return false;
    return shouldRetainStoredTender(item, { scanDays, now });
  }).length;
}

export function shouldReplaceRescueCollectionMetadata(collection, scanDays) {
  const previousDays = Math.max(0, Number(collection?.lastMedicalRescueDays) || 0);
  const currentDays = Math.max(0, Number(scanDays) || 0);
  return previousDays === 0 || currentDays >= previousDays;
}

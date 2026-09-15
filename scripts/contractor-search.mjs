function compact(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const STATUS_PRIORITY = {
  won: 3,
  lost: 2,
  participating: 1,
};

export function buildContractorSearchRows(bidders = [], tenders = []) {
  const rows = new Map();
  const upsert = (item = {}) => {
    const notifyNo = compact(item.notifyNo, 100);
    const contractorName = compact(item.contractorName || item.name, 500);
    const contractorCode = compact(item.contractorCode, 100);
    const taxCode = compact(item.taxCode, 100);
    if (!notifyNo || (!contractorName && !contractorCode && !taxCode)) return;

    const status = compact(item.status, 80);
    const identity = contractorName || contractorCode || taxCode;
    const key = [notifyNo, identity]
      .map((value) => value.toLocaleLowerCase("vi-VN"))
      .join("|");
    const current = rows.get(key);
    const next = {
      notifyNo,
      contractorName: contractorName || current?.contractorName || "",
      contractorCode: contractorCode || current?.contractorCode || "",
      taxCode: taxCode || current?.taxCode || "",
      status: (STATUS_PRIORITY[status] || 0) >= (STATUS_PRIORITY[current?.status] || 0)
        ? status
        : current.status,
      lotName: compact(item.lotName || item.lotNo, 350) || current?.lotName || "",
      regionSlug: compact(item.regionSlug, 100) || current?.regionSlug || "",
      region: compact(item.region, 160) || current?.region || "",
    };
    rows.set(key, next);
  };

  for (const bidder of Array.isArray(bidders) ? bidders : []) upsert(bidder);

  for (const tender of Array.isArray(tenders) ? tenders : []) {
    const shared = {
      notifyNo: tender?.notifyNo,
      regionSlug: tender?.regionSlug,
      region: tender?.region,
    };
    for (const contractorName of tender?.participantNames || []) {
      upsert({ ...shared, contractorName, status: "participating" });
    }
    for (const contractorName of tender?.loserNames || []) {
      upsert({ ...shared, contractorName, status: "lost" });
    }
    for (const loser of tender?.loserDetails || []) {
      upsert({ ...shared, ...loser, status: "lost" });
    }
    for (const contractorName of tender?.winnerNames || []) {
      upsert({ ...shared, contractorName, status: "won" });
    }
  }
  return [...rows.values()];
}

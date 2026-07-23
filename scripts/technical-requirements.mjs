function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function technicalRow(row) {
  return Boolean(
    compactText(row?.name)
    || compactText(row?.specification)
    || compactText(row?.code)
    || compactText(row?.brand)
    || compactText(row?.manufacture)
    || compactText(row?.goodsOrigin),
  );
}

function ancestorFor(row, byId) {
  let current = row;
  const visited = new Set();
  while (current) {
    const parentId = current.tempParent ?? current.parent;
    if (parentId === null || parentId === undefined || parentId === 0 || visited.has(String(parentId))) {
      return current === row ? null : current;
    }
    visited.add(String(parentId));
    const parent = byId.get(String(parentId));
    if (!parent) return current === row ? null : current;
    current = parent;
    if (compactText(current.lotNo) || compactText(current.lotName)) return current;
  }
  return null;
}

function collectFiles(payload, forms) {
  const files = [];
  const addFile = (file) => {
    const id = compactText(file?.fileId ?? file?.id);
    const name = compactText(file?.fileName ?? file?.name);
    if (!id && !name) return;
    files.push({ id, name });
  };

  const rootFile = payload?.bidoInvFileDTO;
  if (rootFile) {
    const attached = parseJson(rootFile.attachedFiles, []);
    (Array.isArray(attached) ? attached : []).forEach(addFile);
    addFile(rootFile);
  }

  forms.forEach((form) => {
    const value = parseJson(form.formValue, {});
    [value.sharedFiles, value.attachFiles].forEach((group) => {
      const parsed = parseJson(group, []);
      (Array.isArray(parsed) ? parsed : []).forEach(addFile);
    });
  });

  return [...new Map(files.map((file) => [`${file.id}|${file.name}`, file])).values()];
}

export function extractOnlineReofferTechnicalRequirements(payload) {
  const forms = Array.isArray(payload?.bidoInvBiddingDTO) ? payload.bidoInvBiddingDTO : [];
  const chapters = Array.isArray(payload?.bidaInvChapterConfList)
    ? payload.bidaInvChapterConfList.map((chapter) => ({
      code: compactText(chapter.code),
      name: compactText(chapter.name),
      parentCode: compactText(chapter.parentCode),
      orderIndex: numberOrZero(chapter.orderIndex),
    }))
    : [];
  const chapterByCode = new Map(chapters.map((chapter) => [chapter.code, chapter]));
  const items = [];

  forms.forEach((form) => {
    const value = parseJson(form.formValue, {});
    const rows = Array.isArray(value.Table) ? value.Table : [];
    const byId = new Map(rows
      .filter((row) => row?.id !== null && row?.id !== undefined)
      .map((row) => [String(row.id), row]));
    const chapter = chapterByCode.get(compactText(form.formCode))
      || chapterByCode.get(compactText(form.chapterCode));

    rows.filter(technicalRow).forEach((row) => {
      const ancestor = ancestorFor(row, byId) || {};
      items.push({
        id: compactText(row.id) || crypto.randomUUID(),
        position: compactText(row.currentItemIndex || row.pos),
        lotNo: compactText(row.lotNo || ancestor.lotNo),
        lotName: compactText(row.lotName || ancestor.lotName),
        name: compactText(row.name || row.tenThuoc || row.bidName) || "Hàng hóa/thiết bị chưa có tên",
        unit: compactText(row.uom || row.donViTinh),
        quantity: numberOrZero(row.qty ?? row.quantity),
        code: compactText(row.code || row.kyMaHieu),
        brand: compactText(row.brand || row.nhanHieu),
        manufacturer: compactText(row.manufacture || row.manufacturer || row.hangSanXuat),
        origin: compactText(row.goodsOrigin || row.origin || row.xuatXu),
        manufactureYear: compactText(row.manufactureYear || row.namSanXuat),
        specification: String(row.specification || row.qualityStandards || "").trim(),
        otherRequirement: String(row.otherRequirement || "").trim(),
        projectPlace: compactText(row.projectPlace || ancestor.projectPlace),
        earliestDeliveryDate: compactText(row.earlietDeliveryDate || ancestor.earlietDeliveryDate),
        latestDeliveryDate: compactText(row.lateDeliveryDate || ancestor.lateDeliveryDate),
        formCode: compactText(form.formCode),
        chapterName: compactText(chapter?.name || form.templateCode || form.formCode),
        sourceStage: "invitation-technical",
      });
    });
  });

  const uniqueItems = [...new Map(items.map((item) => [
    `${item.formCode}|${item.lotNo}|${item.position}|${item.name}|${item.code}`,
    item,
  ])).values()];

  return {
    total: uniqueItems.length,
    items: uniqueItems,
    chapters,
    files: collectFiles(payload, forms),
    disclosure: uniqueItems.length ? "public-structured-hsmt" : "public-hsmt-no-technical-table",
  };
}

const OFFICIAL_ORIGIN = "https://muasamcong.mpi.gov.vn";
const OFFICIAL_PATH = "/web/guest/contractor-selection";

function cleanParam(value) {
  const text = String(value ?? "").trim();
  return /^(null|undefined)$/i.test(text) ? "" : text;
}

function defaultStepCode(step) {
  if (step === "kqlcnt") return "notify-contractor-step-4-kqlcnt";
  return "notify-contractor-step-1-tbmt";
}

export function officialSourceStep(item = {}) {
  const stepCode = cleanParam(item.stepCode).toLowerCase();
  if (cleanParam(item.inputResultId) || stepCode.includes("kqlcnt")) return "kqlcnt";

  const explicitStep = cleanParam(item.step).toLowerCase();
  return ["tbmt", "bbmt", "kqlcnt"].includes(explicitStep) ? explicitStep : "tbmt";
}

export function buildOfficialSourceUrl(item = {}) {
  const step = officialSourceStep(item);
  const id = cleanParam(item.id);
  const params = new URLSearchParams({
    p_p_id: "egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2",
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    _egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render: "detail-v2",
    type: cleanParam(item.type) || "es-notify-contractor",
    stepCode: cleanParam(item.stepCode) || defaultStepCode(step),
    id,
    notifyId: cleanParam(item.notifyId) || id,
    inputResultId: cleanParam(item.inputResultId),
    bidOpenId: cleanParam(item.bidOpenId),
    techReqId: cleanParam(item.techReqId),
    bidPreNotifyResultId: cleanParam(item.bidPreNotifyResultId),
    bidPreOpenId: cleanParam(item.bidPreOpenId),
    processApply: cleanParam(item.processApply) || "LDT",
    bidMode: cleanParam(item.bidMode),
    notifyNo: cleanParam(item.notifyNo),
    planNo: cleanParam(item.planNo),
    pno: cleanParam(item.pno),
    step,
    isInternet: cleanParam(item.isInternet),
    caseKHKQ: cleanParam(item.caseKHKQ),
    bidForm: cleanParam(item.bidForm),
  });
  return `${OFFICIAL_ORIGIN}${OFFICIAL_PATH}?${params}`;
}

export function repairOfficialSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "muasamcong.mpi.gov.vn") {
      return `${OFFICIAL_ORIGIN}/`;
    }

    const step = officialSourceStep({
      step: url.searchParams.get("step"),
      stepCode: url.searchParams.get("stepCode"),
      inputResultId: url.searchParams.get("inputResultId"),
    });
    url.searchParams.set("step", step);
    if (!cleanParam(url.searchParams.get("stepCode"))) {
      url.searchParams.set("stepCode", defaultStepCode(step));
    }
    return url.href;
  } catch {
    return `${OFFICIAL_ORIGIN}/`;
  }
}

export function normalizeMedicalText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s./+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalNotifyNo(value) {
  return String(value ?? "").trim().replace(/-\d{2}$/, "");
}

const HARD_EXCLUDED_TITLE_TERMS = [
  "xay lap", "xay dung", "cai tao", "sua chua", "tu van", "tham dinh",
  "lap e hsmt", "danh gia e hsdt", "giam sat thi cong", "quan ly du an",
  "bao tri", "bao duong", "kiem dinh", "hieu chuan thiet bi dien",
  "suat an", "thuc pham", "bao ve", "ve sinh cong nghiep", "van phong pham",
  "xang dau", "cay xanh", "rac thai", "chat thai", "in an", "trang phuc",
  "bao ho lao dong", "bao hiem", "may tinh", "may in", "tin hoc",
  "cong nghe thong tin", "may chu", "thiet bi tuong lua", "bao mat du lieu",
  "thang may", "may phat dien", "dieu hoa khong khi", "vat tu dien luc",
  "thiet bi dien", "duong day", "tram bien ap", "cap dien", "tu dien",
  "phan bon", "bao ve thuc vat", "thu y", "thuoc generic", "duoc pham",
  "hoa chat xu ly nuoc", "hoa chat xu ly nuoc thai", "hoa chat giat la",
  "hoa chat tay rua", "hoa chat ve sinh", "hoa chat ho boi",
  "hoa chat phong chay", "hoa chat cong nghiep", "may giat", "may say",
];

const EXPLICIT_MEDICAL_TITLE_TERMS = [
  "thiet bi y te", "trang thiet bi y te", "vat tu y te", "vat tu tieu hao y te",
  "vat tu phau thuat", "vat tu xet nghiem", "hoa chat xet nghiem", "hoa chat y te",
  "hoa chat khu khuan", "sinh pham y te", "sinh pham xet nghiem",
  "sinh pham chan doan", "chan doan in vitro", "dung cu y te", "y cu",
  "khi y te", "oxy y te", "may xet nghiem", "may sieu am", "may tho",
  "may dien tim", "may theo doi benh nhan", "may loc mau", "may chay than",
  "giuong benh", "giuong y te", "giuong hoi suc", "giuong cap cuu",
  "may chup", "x quang", "noi soi", "phau thuat", "catheter", "stent",
  "implant", "bom tiem", "kim tiem", "gang tay y te", "bong y te",
  "gac y te", "khau trang y te", "kit test", "test nhanh", "nha khoa",
  "loc mau", "chay than", "dien cuc tim", "may phan tich",
];

const MEDICAL_INVESTOR_TERMS = [
  "so y te", "benh vien", "trung tam y te", "tram y te", "phong kham", "benh xa",
  "trung tam kiem soat benh tat", "cdc", "trung tam kiem nghiem",
  "trung tam phap y", "y khoa", "y duoc", "da khoa", "chuyen khoa",
];

const LAB_SUPPLY_TERMS = [
  "hoa chat", "sinh pham", "thuoc thu", "chat hieu chuan", "chat kiem soat",
  "calibrator", "control", "reagent", "vat tu xet nghiem", "dung dich",
];

const LAB_ANALYZER_TERMS = [
  "xet nghiem", "chan doan", "in vitro", "mien dich", "elisa", "hba1c",
  "sinh hoa", "huyet hoc", "dong mau", "dien giai", "vi sinh", "pcr",
  "real time", "hoa mo mien dich", "mien dich huynh quang", "may phan tich",
  "may mien dich", "may elisa", "may hba1c", "may huyet hoc", "may sinh hoa",
  "may dong mau", "may dien giai", "may vi sinh", "may realtime",
];

const MACHINE_USAGE_TERMS = [
  "su dung tren may", "su dung cho may", "dung tren may", "dung cho may",
  "chay tren may", "chay may", "phuc vu may", "cho he thong", "tren he thong",
];

const GENERIC_SUPPLY_TERMS = [
  "vat tu", "hoa chat", "sinh pham", "dung cu", "may", "thiet bi", "hang hoa",
];

const CLINICAL_TERMS = [
  "xet nghiem", "chan doan", "kham chua benh", "kham benh", "chua benh",
  "dieu tri", "phong mo", "phau thuat", "cap cuu", "hoi suc",
];

function matchedTerms(text, terms) {
  const haystack = ` ${normalizeMedicalText(text).replace(/[^a-z0-9]+/g, " ").trim()} `;
  return terms.filter((term) => {
    const needle = normalizeMedicalText(term).replace(/[^a-z0-9]+/g, " ").trim();
    return needle && haystack.includes(` ${needle} `);
  });
}

export function classifyMedicalTender(item) {
  const title = normalizeMedicalText(item?.bidName?.join?.(" ") || item?.name || item?.title || "");
  const investor = normalizeMedicalText(
    item?.investorName || item?.procuringEntityName || item?.investor || "",
  );

  if (!title) {
    return { accepted: false, category: "", score: 0, reason: "empty-title", matched: [] };
  }

  const excluded = matchedTerms(title, HARD_EXCLUDED_TITLE_TERMS);
  if (excluded.length) {
    return {
      accepted: false,
      category: "",
      score: -100,
      reason: `excluded:${excluded[0]}`,
      matched: excluded,
    };
  }

  const explicit = matchedTerms(title, EXPLICIT_MEDICAL_TITLE_TERMS);
  const medicalInvestor = matchedTerms(investor, MEDICAL_INVESTOR_TERMS);
  const labSupply = matchedTerms(title, LAB_SUPPLY_TERMS);
  const labAnalyzer = matchedTerms(title, LAB_ANALYZER_TERMS);
  const machineUsage = matchedTerms(title, MACHINE_USAGE_TERMS);
  const genericSupply = matchedTerms(title, GENERIC_SUPPLY_TERMS);
  const clinical = matchedTerms(title, CLINICAL_TERMS);

  let score = 0;
  const reasons = [];

  if (explicit.length) {
    score += 100;
    reasons.push("explicit-medical-title");
  }
  if (medicalInvestor.length) {
    score += 35;
    reasons.push("medical-investor");
  }
  if (labSupply.length) {
    score += 30;
    reasons.push("laboratory-supply");
  }
  if (labAnalyzer.length) {
    score += 35;
    reasons.push("laboratory-analyzer-context");
  }
  if (machineUsage.length) {
    score += 25;
    reasons.push("machine-usage-context");
  }
  if (genericSupply.length) score += 10;
  if (clinical.length) score += 20;

  const accepted = explicit.length > 0
    || (labSupply.length > 0 && labAnalyzer.length > 0)
    || (medicalInvestor.length > 0 && labSupply.length > 0 && machineUsage.length > 0)
    || (medicalInvestor.length > 0 && genericSupply.length > 0 && machineUsage.length > 0)
    || (medicalInvestor.length > 0 && genericSupply.length > 0 && clinical.length > 0);

  return {
    accepted,
    category: accepted ? medicalCategory(title) : "",
    score,
    reason: accepted ? reasons.join("+") : "insufficient-medical-context",
    matched: [...new Set([
      ...explicit,
      ...medicalInvestor,
      ...labSupply,
      ...labAnalyzer,
      ...machineUsage,
      ...clinical,
    ])],
  };
}

export function isMedicalTender(item) {
  return classifyMedicalTender(item).accepted;
}

export function medicalCategory(name) {
  const text = normalizeMedicalText(name);
  return matchedTerms(text, [
    "vat tu", "hoa chat", "sinh pham", "dung cu", "kit", "test", "gac", "gang",
    "kim", "stent", "catheter", "reagent", "thuoc thu", "dung dich", "gioang", "dem",
  ]).length
    ? "Vật tư & hóa chất"
    : "Thiết bị y tế";
}

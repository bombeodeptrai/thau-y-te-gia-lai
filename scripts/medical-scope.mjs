export function normalizeMedicalText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalNotifyNo(value) {
  return String(value ?? "").trim().replace(/-\d{2}$/, "");
}

const EXCLUDED_TITLE_TERMS = [
  "xay lap", "xay dung", "cai tao", "sua chua", "tu van", "bao tri", "kiem dinh",
  "suat an", "thuc pham", "bao ve", "ve sinh cong nghiep", "van phong pham", "xang dau",
  "cay xanh", "rac thai", "chat thai", "in an", "trang phuc", "bao hiem",
  "may tinh", "may in", "cong nghe thong tin", "may chu", "thang may", "may phat dien",
  "dieu hoa", "phan bon", "bao ve thuc vat", "thu y", "thuoc generic", "duoc pham",
  "hoa chat xu ly nuoc", "hoa chat xu ly nuoc thai", "hoa chat giat la", "hoa chat tay rua",
  "hoa chat ve sinh", "hoa chat ho boi", "hoa chat phong chay", "hoa chat cong nghiep",
];

const EXPLICIT_MEDICAL_TERMS = [
  "thiet bi y te", "trang thiet bi y te", "vat tu y te", "vat tu tieu hao",
  "vat tu phau thuat", "vat tu xet nghiem", "hoa chat xet nghiem", "hoa chat y te",
  "hoa chat khu khuan", "sinh pham", "chan doan in vitro", "dung cu y te", "y cu",
  "khi y te", "oxy y te", "may xet nghiem", "may sieu am", "may tho", "may dien tim",
  "may theo doi benh nhan", "may loc mau", "may chay than", "may chup", "x quang",
  "noi soi", "phau thuat", "catheter", "stent", "implant", "bom tiem", "kim tiem",
  "gang tay y te", "bong y te", "gac y te", "khau trang y te", "kit test", "test nhanh",
];

const MEDICAL_INVESTOR_TERMS = [
  "so y te", "benh vien", "trung tam y te", "tram y te", "phong kham", "benh xa",
  "trung tam kiem soat benh tat", "cdc", "trung tam kiem nghiem", "trung tam phap y",
  "y khoa", "y duoc", "da khoa", "chuyen khoa",
];

const LAB_SUPPLY_TERMS = [
  "hoa chat", "sinh pham", "thuoc thu", "chat hieu chuan", "chat kiem soat",
  "calibrator", "control", "reagent", "vat tu xet nghiem",
];

const LAB_ANALYZER_TERMS = [
  "xet nghiem", "chan doan", "in vitro", "mien dich", "elisa", "hba1c",
  "sinh hoa", "huyet hoc", "dong mau", "dien giai", "vi sinh", "pcr", "real time",
  "hoa mo mien dich", "mien dich huynh quang", "may phan tich", "may mien dich",
  "may elisa", "may hba1c", "may huyet hoc", "may sinh hoa", "may dong mau",
  "may dien giai", "may vi sinh", "may realtime", "may real time",
];

const GENERIC_SUPPLY_TERMS = ["vat tu", "hoa chat", "sinh pham", "dung cu", "may", "thiet bi"];
const CLINICAL_TERMS = ["xet nghiem", "chan doan", "kham", "chua benh", "dieu tri", "phong mo"];

export function isMedicalTender(item) {
  const title = normalizeMedicalText(item?.bidName?.join?.(" ") || item?.name || item?.title || "");
  const investor = normalizeMedicalText(item?.investorName || item?.procuringEntityName || item?.investor || "");

  if (!title || EXCLUDED_TITLE_TERMS.some((term) => title.includes(term))) return false;
  if (EXPLICIT_MEDICAL_TERMS.some((term) => title.includes(term))) return true;

  const hasMedicalInvestor = MEDICAL_INVESTOR_TERMS.some((term) => investor.includes(term));
  if (!hasMedicalInvestor) return false;

  const hasLabSupply = LAB_SUPPLY_TERMS.some((term) => title.includes(term));
  const hasLabAnalyzer = LAB_ANALYZER_TERMS.some((term) => title.includes(term));
  if (hasLabSupply && hasLabAnalyzer) return true;

  const hasSupply = GENERIC_SUPPLY_TERMS.some((term) => title.includes(term));
  const hasClinicalContext = CLINICAL_TERMS.some((term) => title.includes(term));
  return hasSupply && hasClinicalContext;
}

export function medicalCategory(name) {
  const text = normalizeMedicalText(name);
  return /(vat tu|hoa chat|sinh pham|dung cu|kit|test|gac|gang|kim|stent|catheter|reagent)/.test(text)
    ? "Vật tư & hóa chất"
    : "Thiết bị y tế";
}

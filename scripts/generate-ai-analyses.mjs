import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tendersPath = resolve(root, "data/tenders.json");
const profilePath = resolve(root, "data/kieu-viet-capability.json");
const analysesPath = resolve(root, "data/ai-analyses.json");
const detailsDir = resolve(root, "data/details");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const MODEL = String(process.env.OPENAI_MODEL || "gpt-5-mini").trim();
const API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const MAX_PER_RUN = Math.max(1, Number(process.env.AI_MAX_PER_RUN) || 12);
const TTL_HOURS = Math.max(6, Number(process.env.AI_ANALYSIS_TTL_HOURS) || 24);
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.AI_CONCURRENCY) || 2));

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall_score",
    "success_probability",
    "recommendation",
    "confidence",
    "executive_summary",
    "fit",
    "primary_equipment",
    "strengths",
    "gaps",
    "risks",
    "required_partners",
    "next_actions",
    "assumptions",
    "data_quality",
    "disclaimer",
  ],
  properties: {
    overall_score: { type: "integer", minimum: 0, maximum: 100 },
    success_probability: { type: "integer", minimum: 0, maximum: 100 },
    recommendation: {
      type: "string",
      enum: [
        "Ưu tiên tham gia",
        "Tham gia có điều kiện",
        "Theo dõi và làm rõ",
        "Không khuyến nghị tham gia",
      ],
    },
    confidence: { type: "string", enum: ["Thấp", "Trung bình", "Cao"] },
    executive_summary: { type: "string" },
    fit: {
      type: "object",
      additionalProperties: false,
      required: ["legal", "technical", "commercial", "schedule", "geography", "partnership"],
      properties: {
        legal: { type: "integer", minimum: 0, maximum: 100 },
        technical: { type: "integer", minimum: 0, maximum: 100 },
        commercial: { type: "integer", minimum: 0, maximum: 100 },
        schedule: { type: "integer", minimum: 0, maximum: 100 },
        geography: { type: "integer", minimum: 0, maximum: 100 },
        partnership: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
    primary_equipment: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "importance", "fit", "note"],
        properties: {
          name: { type: "string" },
          importance: { type: "string", enum: ["Chủ đạo", "Quan trọng", "Phụ trợ"] },
          fit: { type: "integer", minimum: 0, maximum: 100 },
          note: { type: "string" },
        },
      },
    },
    strengths: { type: "array", maxItems: 7, items: { type: "string" } },
    gaps: { type: "array", maxItems: 8, items: { type: "string" } },
    risks: { type: "array", maxItems: 8, items: { type: "string" } },
    required_partners: { type: "array", maxItems: 7, items: { type: "string" } },
    next_actions: { type: "array", maxItems: 10, items: { type: "string" } },
    assumptions: { type: "array", maxItems: 8, items: { type: "string" } },
    data_quality: { type: "string" },
    disclaimer: { type: "string" },
  },
};

function compactText(value, maxLength = 3000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function readDetail(notifyNo) {
  if (!notifyNo) return null;
  return readJson(resolve(detailsDir, `${notifyNo}.json`), null);
}

function itemSummary(item) {
  return {
    name: compactText(item?.name, 500),
    lotNo: compactText(item?.lotNo, 120),
    lotName: compactText(item?.lotName, 500),
    quantity: Number(item?.quantity) || 0,
    unit: compactText(item?.unit, 80),
    model: compactText(item?.model || item?.code, 180),
    brand: compactText(item?.brand, 180),
    manufacturer: compactText(item?.manufacturer, 240),
    origin: compactText(item?.origin, 160),
    specification: compactText(item?.specification, 1800),
    plannedPrice: Number(item?.plannedPrice) || 0,
    unitPrice: Number(item?.unitPrice) || 0,
  };
}

function bidderSummary(item) {
  return {
    contractorName: compactText(item?.contractorName, 400),
    status: compactText(item?.status, 80),
    lotName: compactText(item?.lotName, 300),
    bidPrice: Number(item?.bidPrice) || 0,
    finalPrice: Number(item?.finalPrice) || 0,
    winningPrice: Number(item?.winningPrice) || 0,
    reason: compactText(item?.reason, 700),
    models: Array.isArray(item?.models) ? item.models.slice(0, 8).map((value) => compactText(value, 240)) : [],
  };
}

function detailSummary(detail) {
  if (!detail) return {
    disclosure: "Chưa có tệp chi tiết công khai",
    invitedItems: [],
    technicalItems: [],
    awardedItems: [],
    bidders: [],
  };

  return {
    disclosure: {
      requirements: detail.requirements?.disclosure || "",
      technicalRequirements: detail.technicalRequirements?.disclosure || "",
      modelDisclosure: detail.modelDisclosure || "",
    },
    invitedTotal: Number(detail.requirements?.total) || detail.requirements?.items?.length || 0,
    technicalTotal: Number(detail.technicalRequirements?.total) || detail.technicalRequirements?.items?.length || 0,
    awardedTotal: Number(detail.total) || detail.items?.length || 0,
    invitedItems: (detail.requirements?.items || []).slice(0, 16).map(itemSummary),
    technicalItems: (detail.technicalRequirements?.items || []).slice(0, 20).map(itemSummary),
    awardedItems: (detail.items || []).slice(0, 14).map(itemSummary),
    bidders: (detail.bidders || []).slice(0, 12).map(bidderSummary),
  };
}

function tenderSummary(tender) {
  return {
    id: tender.id || "",
    notifyNo: tender.notifyNo || "",
    name: compactText(tender.name, 1000),
    investor: compactText(tender.investor, 500),
    location: compactText(tender.location, 300),
    category: compactText(tender.category, 160),
    status: tender.status || "",
    publicDate: tender.publicDate || "",
    closeDate: tender.closeDate || "",
    price: Number(tender.price) || 0,
    winningPrice: Number(tender.winningPrice) || 0,
    bidderCount: tender.bidderCount === null || tender.bidderCount === undefined
      ? null
      : Number(tender.bidderCount),
    participantNames: (tender.participantNames || []).slice(0, 12).map((value) => compactText(value, 400)),
    winnerNames: (tender.winnerNames || []).slice(0, 8).map((value) => compactText(value, 400)),
    winningModels: (tender.winningModels || []).slice(0, 12).map((value) => compactText(value, 300)),
    sourceUrl: tender.sourceUrl || "",
  };
}

function inputHash(tender, detail, profile) {
  return sha256(JSON.stringify({
    profileVersion: profile.profileVersion || "",
    tender: tenderSummary(tender),
    detail: detailSummary(detail),
  }));
}

function isFresh(analysis, hash) {
  if (!analysis || analysis.inputHash !== hash || !analysis.generatedAt) return false;
  const generatedAt = new Date(analysis.generatedAt).getTime();
  return Number.isFinite(generatedAt)
    && generatedAt >= Date.now() - TTL_HOURS * 60 * 60 * 1000;
}

function priority(tender) {
  const statusScore = ({ urgent: 500, open: 400, evaluating: 300, awarded: 100 })[tender.status] || 0;
  const publicTime = new Date(tender.publicDate || 0).getTime();
  const recency = Number.isFinite(publicTime) ? Math.max(0, 180 - (Date.now() - publicTime) / 86_400_000) : 0;
  const priceScore = Math.min(100, Math.log10(Math.max(1, Number(tender.price) || 1)) * 8);
  return statusScore + recency + priceScore;
}

function candidateTender(tender) {
  return ["open", "urgent", "evaluating"].includes(tender.status);
}

async function mapLimited(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function callOpenAI(profile, tender, detail) {
  const systemPrompt = [
    "Bạn là Chuyên viên đấu thầu của Hệ sinh thái Kiểu Việt, chuyên phân tích gói thầu thiết bị và vật tư y tế tại Việt Nam.",
    "Chỉ sử dụng dữ liệu được cung cấp. Không tự suy đoán Kiểu Việt có giấy ủy quyền hãng, năng lực tài chính, nhân sự, tồn kho hoặc hợp đồng tương tự nếu hồ sơ năng lực chưa xác minh.",
    "Phải tách rõ: điểm phù hợp, khoảng trống hồ sơ, đối tác cần có, rủi ro và hành động tiếp theo.",
    "Xác suất thành công là ước tính quản trị thận trọng dựa trên dữ liệu hiện có, không phải cam kết trúng thầu.",
    "Ưu tiên xác định thiết bị/vật tư chủ đạo, yêu cầu hãng/nhà phân phối, tiến độ giao hàng, bảo hành, kiểm định, CO/CQ, năng lực địa phương và quy mô tài chính.",
    "Nếu dữ liệu E-HSMT chưa đầy đủ hoặc còn CAPTCHA, phải giảm độ tin cậy và nêu rõ cần mở hồ sơ chính thức để kiểm tra.",
    "Trả lời bằng tiếng Việt theo đúng JSON schema, ngắn gọn nhưng có thể hành động ngay.",
  ].join("\n");

  const userPayload = {
    companyCapability: profile,
    tender: tenderSummary(tender),
    publicDetail: detailSummary(detail),
    requestedAnalysis: [
      "Đánh giá mức độ phù hợp với hồ sơ năng lực Kiểu Việt",
      "Xác định thiết bị/vật tư chủ đạo và mức độ phù hợp",
      "Ước tính khả năng thành công",
      "Nêu điều kiện phải bổ sung trước khi quyết định tham gia",
      "Đề xuất hành động trong 24-72 giờ",
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": `kieu-viet-${tender.notifyNo || tender.id}-${Date.now()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(userPayload) }],
        },
      ],
      max_output_tokens: 2600,
      safety_identifier: "kieu-viet-tender-analyzer",
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "kieu_viet_tender_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(100_000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${compactText(responseText, 900)}`);
  }

  const payload = JSON.parse(responseText);
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("OpenAI không trả nội dung phân tích");
  return JSON.parse(outputText);
}

await mkdir(detailsDir, { recursive: true });
const manifest = await readJson(tendersPath, { tenders: [] });
const profile = await readJson(profilePath, null);
const stored = await readJson(analysesPath, {
  schemaVersion: 1,
  generatedAt: "",
  model: "",
  profileVersion: "",
  analyses: {},
});

if (!profile) throw new Error("Thiếu data/kieu-viet-capability.json");
stored.analyses = stored.analyses && typeof stored.analyses === "object" ? stored.analyses : {};

if (!API_KEY) {
  stored.schemaVersion = 1;
  stored.profileVersion = profile.profileVersion || "";
  await writeFile(analysesPath, `${JSON.stringify(stored, null, 2)}\n`);
  process.stdout.write("Chưa có secret OPENAI_API_KEY; giữ nguyên dữ liệu phân tích AI hiện có.\n");
  process.exit(0);
}

const prepared = await Promise.all(
  (manifest.tenders || [])
    .filter(candidateTender)
    .map(async (tender) => {
      const detail = await readDetail(tender.notifyNo);
      const hash = inputHash(tender, detail, profile);
      return { tender, detail, hash };
    }),
);

const queue = prepared
  .filter(({ tender, hash }) => !isFresh(stored.analyses[tender.notifyNo], hash))
  .sort((left, right) => priority(right.tender) - priority(left.tender))
  .slice(0, MAX_PER_RUN);

if (!queue.length) {
  process.stdout.write(`Phân tích AI còn hiệu lực trong ${TTL_HOURS} giờ; không có gói cần gọi lại.\n`);
} else {
  process.stdout.write(`Gọi OpenAI phân tích ${queue.length} gói bằng model ${MODEL}.\n`);
}

await mapLimited(queue, CONCURRENCY, async ({ tender, detail, hash }) => {
  const key = tender.notifyNo || String(tender.id || "");
  try {
    const analysis = await callOpenAI(profile, tender, detail);
    stored.analyses[key] = {
      ...analysis,
      notifyNo: tender.notifyNo || "",
      tenderId: tender.id || "",
      generatedAt: new Date().toISOString(),
      inputHash: hash,
      model: MODEL,
      source: "openai-responses-api",
      profileVersion: profile.profileVersion || "",
    };
    process.stdout.write(`AI ${key}: ${analysis.overall_score}/100 · ${analysis.recommendation}\n`);
  } catch (error) {
    process.stderr.write(`Bỏ qua AI ${key}: ${error.message}\n`);
  }
});

stored.schemaVersion = 1;
stored.generatedAt = new Date().toISOString();
stored.model = MODEL;
stored.profileVersion = profile.profileVersion || "";

await writeFile(analysesPath, `${JSON.stringify(stored, null, 2)}\n`);
process.stdout.write(`Đã lưu ${Object.keys(stored.analyses).length} phân tích AI vào data/ai-analyses.json.\n`);

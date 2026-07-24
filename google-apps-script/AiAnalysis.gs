const AI_OPENAI_URL = "https://api.openai.com/v1/responses";
const AI_CAPABILITY_PROFILE_URL = "https://bombeodeptrai.github.io/thau-y-te-gia-lai/data/kieu-viet-capability.json";

/**
 * Web App backend cho nút "Phân tích lại bằng AI" trên GitHub Pages.
 *
 * Script Properties bắt buộc:
 *   OPENAI_API_KEY = khóa API của OpenAI
 *
 * Tùy chọn:
 *   OPENAI_MODEL = gpt-5-mini
 *   AI_MAX_REQUESTS_PER_HOUR = 30
 */
function doGet(e) {
  return aiJsonOutput_({
    ok: true,
    service: "Kieu Viet Tender AI",
    configured: Boolean(PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY")),
    action: String((e && e.parameter && e.parameter.action) || "health"),
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(String((e && e.postData && e.postData.contents) || "{}"));
    if (body.action !== "analyzeTender") {
      throw new Error("Action không hợp lệ.");
    }

    const tender = aiSanitizeTender_(body.tender || {});
    if (!tender.notifyNo && !tender.id) {
      throw new Error("Thiếu mã gói thầu.");
    }

    aiCheckRateLimit_(String(body.sessionId || "anonymous"));
    const profile = aiLoadCapabilityProfile_();
    const analysis = aiCallOpenAI_(profile, tender, aiSanitizeDetail_(body.detail));

    return aiJsonOutput_({
      ok: true,
      analysis: analysis,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return aiJsonOutput_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function aiCallOpenAI_(profile, tender, detail) {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = String(properties.getProperty("OPENAI_API_KEY") || "").trim();
  const model = String(properties.getProperty("OPENAI_MODEL") || "gpt-5-mini").trim();
  if (!apiKey) throw new Error("Chưa cấu hình Script Property OPENAI_API_KEY.");

  const systemPrompt = [
    "Bạn là Chuyên viên đấu thầu của Hệ sinh thái Kiểu Việt, chuyên phân tích gói thầu thiết bị và vật tư y tế tại Việt Nam.",
    "Chỉ sử dụng dữ liệu được cung cấp. Không tự suy đoán Kiểu Việt có giấy ủy quyền hãng, năng lực tài chính, nhân sự, tồn kho hoặc hợp đồng tương tự nếu hồ sơ chưa xác minh.",
    "Phải tách rõ điểm phù hợp, khoảng trống hồ sơ, đối tác cần có, rủi ro và hành động tiếp theo.",
    "Xác suất thành công là ước tính quản trị thận trọng, không phải cam kết trúng thầu.",
    "Nếu E-HSMT chưa đầy đủ hoặc còn CAPTCHA, phải giảm độ tin cậy và yêu cầu kiểm tra hồ sơ chính thức.",
    "Trả lời bằng tiếng Việt theo đúng JSON schema.",
  ].join("\n");

  const requestBody = {
    model: model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            companyCapability: profile,
            tender: tender,
            publicDetail: detail,
            requestedAnalysis: [
              "Mức độ phù hợp với hồ sơ năng lực Kiểu Việt",
              "Thiết bị/vật tư chủ đạo",
              "Khả năng thành công",
              "Khoảng trống phải bổ sung",
              "Hành động trong 24-72 giờ",
            ],
          }),
        }],
      },
    ],
    max_output_tokens: 2600,
    safety_identifier: "kieu-viet-tender-webapp",
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "kieu_viet_tender_analysis",
        strict: true,
        schema: aiAnalysisSchema_(),
      },
    },
  };

  const response = UrlFetchApp.fetch(AI_OPENAI_URL, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Request-Id": `kieu-viet-apps-script-${tender.notifyNo || tender.id}-${Date.now()}`,
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`OpenAI HTTP ${statusCode}: ${aiCompactText_(responseText, 900)}`);
  }

  const payload = JSON.parse(responseText);
  const outputText = aiExtractOutputText_(payload);
  if (!outputText) throw new Error("OpenAI không trả nội dung phân tích.");
  const analysis = JSON.parse(outputText);
  analysis.model = model;
  analysis.source = "openai-live-endpoint";
  analysis.generatedAt = new Date().toISOString();
  return analysis;
}

function aiAnalysisSchema_() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "overall_score", "success_probability", "recommendation", "confidence",
      "executive_summary", "fit", "primary_equipment", "strengths", "gaps",
      "risks", "required_partners", "next_actions", "assumptions",
      "data_quality", "disclaimer",
    ],
    properties: {
      overall_score: { type: "integer", minimum: 0, maximum: 100 },
      success_probability: { type: "integer", minimum: 0, maximum: 100 },
      recommendation: {
        type: "string",
        enum: ["Ưu tiên tham gia", "Tham gia có điều kiện", "Theo dõi và làm rõ", "Không khuyến nghị tham gia"],
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
}

function aiLoadCapabilityProfile_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "KIEU_VIET_CAPABILITY_PROFILE_V1";
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(`${AI_CAPABILITY_PROFILE_URL}?v=${Date.now()}`, {
    muteHttpExceptions: true,
    headers: { Accept: "application/json" },
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Không tải được hồ sơ năng lực: HTTP ${response.getResponseCode()}`);
  }
  const profile = JSON.parse(response.getContentText());
  cache.put(cacheKey, JSON.stringify(profile), 21600);
  return profile;
}

function aiCheckRateLimit_(sessionId) {
  const properties = PropertiesService.getScriptProperties();
  const maximum = Math.max(1, Number(properties.getProperty("AI_MAX_REQUESTS_PER_HOUR")) || 30);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sessionId)
    .slice(0, 12)
    .map(function(value) { return (value + 256).toString(16).slice(-2); })
    .join("");
  const key = `AI_RATE_${digest}`;
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const count = Number(cache.get(key)) || 0;
    if (count >= maximum) {
      throw new Error(`Đã vượt giới hạn ${maximum} lượt phân tích trong một giờ.`);
    }
    cache.put(key, String(count + 1), 3600);
  } finally {
    lock.releaseLock();
  }
}

function aiSanitizeTender_(tender) {
  return {
    id: aiCompactText_(tender.id, 160),
    notifyNo: aiCompactText_(tender.notifyNo, 80),
    name: aiCompactText_(tender.name, 1200),
    investor: aiCompactText_(tender.investor, 600),
    location: aiCompactText_(tender.location, 400),
    category: aiCompactText_(tender.category, 160),
    status: aiCompactText_(tender.status, 80),
    publicDate: aiCompactText_(tender.publicDate, 80),
    closeDate: aiCompactText_(tender.closeDate, 80),
    price: Number(tender.price) || 0,
    winningPrice: Number(tender.winningPrice) || 0,
    bidderCount: tender.bidderCount === null || tender.bidderCount === undefined ? null : Number(tender.bidderCount),
    participantNames: aiArrayText_(tender.participantNames, 12, 400),
    winnerNames: aiArrayText_(tender.winnerNames, 8, 400),
    winningModels: aiArrayText_(tender.winningModels, 12, 300),
    sourceUrl: aiCompactText_(tender.sourceUrl, 1500),
  };
}

function aiSanitizeDetail_(detail) {
  if (!detail || typeof detail !== "object") return null;
  return {
    disclosure: {
      requirements: aiCompactText_(detail.requirements && detail.requirements.disclosure, 120),
      technicalRequirements: aiCompactText_(detail.technicalRequirements && detail.technicalRequirements.disclosure, 120),
      modelDisclosure: aiCompactText_(detail.modelDisclosure, 120),
    },
    invitedItems: aiArrayObjects_(detail.requirements && detail.requirements.items, 16),
    technicalItems: aiArrayObjects_(detail.technicalRequirements && detail.technicalRequirements.items, 20),
    awardedItems: aiArrayObjects_(detail.items, 14),
    bidders: aiArrayObjects_(detail.bidders, 12),
  };
}

function aiArrayObjects_(values, maximum) {
  return (Array.isArray(values) ? values : []).slice(0, maximum).map(function(item) {
    return {
      name: aiCompactText_(item.name, 500),
      lotNo: aiCompactText_(item.lotNo, 120),
      lotName: aiCompactText_(item.lotName, 500),
      quantity: Number(item.quantity) || 0,
      unit: aiCompactText_(item.unit, 80),
      model: aiCompactText_(item.model || item.code, 180),
      brand: aiCompactText_(item.brand, 180),
      manufacturer: aiCompactText_(item.manufacturer, 240),
      origin: aiCompactText_(item.origin, 160),
      specification: aiCompactText_(item.specification, 1800),
      plannedPrice: Number(item.plannedPrice) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      contractorName: aiCompactText_(item.contractorName, 400),
      status: aiCompactText_(item.status, 80),
      reason: aiCompactText_(item.reason, 700),
    };
  });
}

function aiArrayText_(values, maximum, maxLength) {
  return (Array.isArray(values) ? values : []).slice(0, maximum).map(function(value) {
    return aiCompactText_(value, maxLength);
  }).filter(Boolean);
}

function aiExtractOutputText_(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (let index = 0; index < output.length; index += 1) {
    const content = Array.isArray(output[index].content) ? output[index].content : [];
    for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
      if (content[contentIndex].type === "output_text" && typeof content[contentIndex].text === "string") {
        return content[contentIndex].text;
      }
    }
  }
  return "";
}

function aiCompactText_(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const limit = Number(maxLength) || 3000;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function aiJsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function testAiAnalysisConnection() {
  const profile = aiLoadCapabilityProfile_();
  const result = aiCallOpenAI_(profile, {
    id: "test",
    notifyNo: "TEST-AI",
    name: "Mua sắm máy siêu âm tổng quát cho cơ sở y tế tại Gia Lai",
    investor: "Bệnh viện thử nghiệm",
    location: "Gia Lai",
    category: "Thiết bị y tế",
    status: "open",
    publicDate: new Date().toISOString(),
    closeDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    price: 3000000000,
    bidderCount: null,
  }, null);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

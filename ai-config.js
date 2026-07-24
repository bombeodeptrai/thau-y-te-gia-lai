window.KIEU_VIET_AI_CONFIG = {
  analysesUrl: "./data/ai-analyses.json",
  tenderDataUrl: "./data/tenders.json",
  detailsBaseUrl: "./data/details",
  capabilityUrl: "./data/kieu-viet-capability.json",

  // Chế độ miễn phí: chỉ phân tích bằng quy tắc cục bộ và dữ liệu công khai.
  // Không gửi request tới OpenAI hoặc bất kỳ API trả phí nào.
  liveEndpoint: "",
  freeMode: true,

  hoverEnabled: true,
  hoverDelayMs: 650,
  requestTimeoutMs: 100000,
  localCacheHours: 24,
};

window.KIEU_VIET_AI_CONFIG = {
  analysesUrl: "./data/ai-analyses.json",
  tenderDataUrl: "./data/tenders.json",
  detailsBaseUrl: "./data/details",
  capabilityUrl: "./data/kieu-viet-capability.json",

  // Để trống vẫn dùng được các phân tích AI đã tạo trong GitHub Actions.
  // Sau khi triển khai google-apps-script/AiAnalysis.gs thành Web App,
  // dán URL kết thúc bằng /exec vào đây để nút "Phân tích lại" gọi AI trực tiếp.
  liveEndpoint: "",

  hoverEnabled: true,
  hoverDelayMs: 650,
  requestTimeoutMs: 100000,
  localCacheHours: 24,
};

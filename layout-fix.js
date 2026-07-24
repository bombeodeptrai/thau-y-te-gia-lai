(() => {
  const params = new URLSearchParams(window.location.search);
  const navigationEntry = performance.getEntriesByType?.("navigation")?.[0];
  const navigationType = navigationEntry?.type || "";
  const hasCacheBust = params.has("v") || params.has("t");
  const shouldResetScroll = !window.location.hash
    && (hasCacheBust || navigationType === "reload");

  if (!shouldResetScroll) return;

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const resetScroll = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  // Gọi ở nhiều mốc để chặn Chrome khôi phục vị trí cuộn cũ sau khi DOM,
  // ảnh hero hoặc dữ liệu động hoàn tất tải.
  resetScroll();
  document.addEventListener("DOMContentLoaded", resetScroll, { once: true });
  window.addEventListener("load", () => {
    requestAnimationFrame(() => {
      resetScroll();
      requestAnimationFrame(resetScroll);
    });
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resetScroll();
  }, { once: true });
})();

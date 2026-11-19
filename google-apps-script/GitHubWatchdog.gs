// Handler for the existing 15-minute trigger. The GitHub watchdog decides
// whether a source scan is stale and avoids dispatching duplicate scans.
function triggerGitHubUpdate() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Thiếu cấu hình GITHUB_TOKEN cho watchdog.");
  var response = UrlFetchApp.fetch(
    "https://api.github.com/repos/bombeodeptrai/thau-y-te-gia-lai/actions/workflows/rapid-gia-lai-watchdog.yml/dispatches",
    {
      method: "post",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      contentType: "application/json",
      payload: JSON.stringify({ ref: "main" }),
      followRedirects: false,
      muteHttpExceptions: true
    }
  );
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error("GitHub không nhận lệnh watchdog: HTTP " + status);
}

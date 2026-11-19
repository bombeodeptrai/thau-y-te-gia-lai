import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("../google-apps-script/GitHubWatchdog.gs", import.meta.url), "utf8");
function run(status, token = "fixture") {
  const ctx = {
    PropertiesService: {getScriptProperties: () => ({getProperty(key) {assert.equal(key, "GITHUB_TOKEN");return token;}})},
    UrlFetchApp: {fetch(url, opt) {
      assert.equal(url, "https://api.github.com/repos/bombeodeptrai/thau-y-te-gia-lai/actions/workflows/rapid-gia-lai-watchdog.yml/dispatches");
      assert.equal(opt.followRedirects, false);
      assert.equal(opt.method, "post");
      assert.equal(opt.headers.Authorization, "Bearer fixture");
      assert.deepEqual(JSON.parse(opt.payload), {ref:"main"});
      return {getResponseCode: () => status};
    }}
  };
  return vm.runInNewContext(code + "\ntriggerGitHubUpdate();", ctx);
}
test("trigger ngoài gọi đúng watchdog, không tự gọi quét song song", () => run(204));
test("báo thiếu cấu hình hoặc lỗi GitHub, không ghi nội dung phản hồi", () => {
  assert.throws(() => run(204, ""), /Thiếu cấu hình/);
  for (const status of [302, 401, 403, 404, 429, 500]) assert.throws(() => run(status), new RegExp("HTTP " + status));
});

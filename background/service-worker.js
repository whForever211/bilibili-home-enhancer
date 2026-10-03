// B站首页增强 —— 后台 Service Worker（MV3）
// 职责：作为内容脚本 fetch 的 CORS 兜底代理；安装时清理旧版本残留数据。
// （快捷键已按需求移除，交互只保留页面按钮。）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'bhe-fetch' && typeof msg.url === 'string') {
    fetch(msg.url, { credentials: 'omit' })
      .then((r) => r.json())
      .then((json) => sendResponse({ ok: true, json }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 异步回复
  }
});

chrome.runtime.onInstalled.addListener(() => {
  // 清理可能的旧键，避免残留
  chrome.storage.local.remove(['bhe:v0-history', 'bhe:v0-pool'], () => {});
});

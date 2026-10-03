// B站首页增强 —— MAIN world 桥接层
// 在页面自己的执行环境里包装 fetch / XMLHttpRequest，识别推荐流接口的响应，
// 通过 postMessage 把 JSON 抛给隔离世界的 content script。
// 必须以 document_start + world:MAIN 注入，才能赶在 B 站脚本发起请求之前完成包装。
(() => {
  if (window.__bheBridgeInstalled) return;
  if (!/^\/(index\.html?)?\/?$/i.test(location.pathname)) return;
  window.__bheBridgeInstalled = true;

  const FEED_RE = [
    /\/x\/web-interface\/(wbi\/)?index\/top\/feed\/rcmd/,
    /\/x\/web-feed\/feed\/rcmd/,
    /\/x\/web-interface\/feed\/(index|rcmd)/
  ];

  const post = (json) => {
    try {
      window.postMessage({ source: 'bhe-bridge', type: 'rcmd', json }, window.location.origin);
    } catch (e) { /* ignore */ }
  };

  const isFeedUrl = (url) => {
    try {
      const u = String(url || '');
      return FEED_RE.some((re) => re.test(u));
    } catch (e) {
      return false;
    }
  };

  // ---- 包装 fetch ----
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const p = origFetch.apply(this, arguments);
      if (isFeedUrl(url)) {
        p.then((res) => {
          try {
            res.clone().json().then(post).catch(() => {});
          } catch (e) { /* ignore */ }
        }).catch(() => {});
      }
      return p;
    };
  }

  // ---- 包装 XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bheUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (isFeedUrl(this.__bheUrl)) {
      this.addEventListener('load', () => {
        try {
          post(JSON.parse(this.responseText));
        } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };
})();

// B站首页增强 —— 总调度
// 生命周期：等待推荐网格与“换一换”按钮就绪 → 挂载各模块 →
// MutationObserver（防抖）监视网格，网格变化时跑管线：
//   清理上轮遗留 → 近期已见集合 → 广告原位替换（含楼层广告）→ 破茧注入（顶批末尾原位替换）→ 刷新 UI
// 历史快照与管线解耦，只在两个时机发生：首屏加载完成、点击“换一换”瞬间，
// 且只取顶部前 N 张视频槽（默认6，弹窗可调4-12）；无限滚动不产生新批次。
// 自我触发防护：管线前后对比“批次签名”，签名未变则跳过。
(async function () {
  if (!BHE.CONFIG.isHomepage()) return;
  // 版本标记：F12 Console 可确认扩展是否为新版本（排查"改了没生效"问题）
  try {
    console.info('[B站首页增强] v' + chrome.runtime.getManifest().version + ' 已加载');
  } catch (e) { /* ignore */ }

  // 提前声明（storage.onChanged 回调可能在 await 期间触发，避免 TDZ）
  let lastSig = null;
  let applying = false;
  let initialSnapshotted = false;

  await BHE.Settings.load();
  await BHE.Counters.load();
  await BHE.Capture.init();

  // MAIN world 桥接抛来的推荐接口 JSON → 结构化增强
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'bhe-bridge' || d.type !== 'rcmd') return;
    BHE.Capture.onApiResponse(d.json);
  });

  // storage 变更统一入口：
  //   - 弹窗“清空历史/统计”删掉存储键后，同步清空内容脚本的内存镜像并关闭面板
  //     （否则面板仍读到旧数据，挂着的防抖回写还会把旧数据“复活”到存储）
  //   - 弹窗改设置后立即重跑管线
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const K = BHE.CONFIG.keys;
    if (changes[K.history]) {
      BHE.Capture.history = Array.isArray(changes[K.history].newValue) ? changes[K.history].newValue : [];
      BHE.HistoryUI.closeAll();
      BHE.HistoryUI.updateButtons();
    }
    if (changes[K.statsBatches]) {
      const nv = changes[K.statsBatches].newValue;
      BHE.Capture.statsBatches = Array.isArray(nv) ? nv : [];
      if (!nv || !nv.length) BHE.Capture.statsGen++; // 统计被清空 → 在途异步写入作废
      BHE.Panel.refresh();
    }
    const c = changes[K.settings];
    if (c && c.newValue) {
      BHE.Settings.data = Object.assign({}, BHE.CONFIG.defaults, c.newValue);
      if (!BHE.Settings.data.history) BHE.HistoryUI.closeAll();
      lastSig = null; // 强制重新执行管线
      runPipeline();
    }
  });

  // 首页是 Vue SSR：轮询等待推荐流渲染出来
  const ok = await waitForFeed(90, 700);
  if (!ok) return; // 60 秒仍未见推荐流（网络异常/改版），静默退出

  installRollGuard();
  BHE.HistoryUI.mount();
  // 预热热门池；就绪后若仍有兜底隐藏的广告槽（首轮池未就绪时隐藏的），强制再跑管线补上
  BHE.Extras.warm().then(() => {
    if (BHE.dom.grid && BHE.dom.grid.querySelector('.bhe-hidden')) runPipeline(true);
  });
  observeGrid();
  runPipeline();

  // ---------- 内部 ----------

  async function waitForFeed(maxTries, interval) {
    for (let i = 0; i < maxTries; i++) {
      const grid = findGrid();
      const btn = document.querySelector(BHE.CONFIG.selectors.rollButton[0]) ||
        document.querySelector(BHE.CONFIG.selectors.rollButton[1]);
      if (grid && btn) {
        BHE.dom.grid = grid;
        BHE.dom.rollBtn = btn;
        return true;
      }
      await BHE.sleep(interval);
    }
    return false;
  }

  // 找“包含 ≥70% 推荐卡片的最深公共祖先”= 推荐网格容器。
  // 不写死容器类名（B站容器类会变），只依赖卡片类名。
  function findGrid() {
    const cards = [...document.querySelectorAll(BHE.CONFIG.selectors.rcmdCard)]
      .filter((c) => !c.closest('.bhe-overlay, .bhe-modal, .bhe-stats'));
    if (cards.length < 2) return null;
    const counts = new Map();
    for (const c of cards) {
      let p = c.parentElement;
      while (p && p !== document.body) {
        counts.set(p, (counts.get(p) || 0) + 1);
        p = p.parentElement;
      }
    }
    const need = Math.ceil(cards.length * 0.7);
    let best = null, bestDepth = -1;
    for (const [el, n] of counts) {
      if (n < need) continue;
      let d = 0, p = el;
      while (p) { d++; p = p.parentElement; }
      if (d > bestDepth) { bestDepth = d; best = el; }
    }
    return best;
  }

  // “换一换”点击守卫：捕获阶段抢在 B 站替换 DOM 之前快照当前批（顶部前N张）。
  // 快照前先撤销原位替换（露出原生广告等）——B站马上会重建这些 DOM，用户无感；
  // 不撤销的话，B站清理子项时可能残留我们的 .bhe-card 孤儿节点。
  function installRollGuard() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.bhe-roll-btn')) return; // 我们注入的同风格按钮（复用了 roll-btn 类名），不触发快照
      if (t.closest('button.roll-btn, .feed-roll-btn')) {
        if (BHE.HistoryUI.histPos != null) BHE.HistoryUI.exitToLive(false);
        if (BHE.dom.grid) BHE.Swap.revertAll(BHE.dom.grid);
        BHE.Capture.snapshotBatch('roll');
      }
    }, true);
  }

  function observeGrid() {
    const mo = new MutationObserver(BHE.debounce(runPipeline, 450));
    mo.observe(BHE.dom.grid, { childList: true, subtree: true });
  }

  // 批次签名：只看真实卡片（忽略注入物），用于识别“真换批”与抑制自触发
  function quickSig() {
    const grid = BHE.dom.grid;
    if (!grid) return '';
    return [...grid.children].map((c) => {
      if (c.classList.contains('bhe-cell')) return '';
      const a = c.querySelector('.bili-video-card a[href*="/video/BV"], .bili-video-card a[href*="cm.bilibili.com"]');
      if (!a) return '';
      return ((a.getAttribute('href') || '').match(/BV[0-9A-Za-z]{10}/) || ['cm'])[0];
    }).filter(Boolean).join(',');
  }

  async function runPipeline(force) {
    const grid = BHE.dom.grid;
    if (!grid || applying) return;
    const pre = force ? null : quickSig();
    if (!force && pre === lastSig) return;
    applying = true;
    try {
      // 1) 清掉旧版追加式注入的残留；原位替换槽不用清理——
      //    AdFilter.apply 先自愈空槽再重新替换，Diversity 按“顶批已注入量”增量补齐
      grid.querySelectorAll(':scope > .bhe-cell').forEach((n) => n.remove());

      // 2) 喂“近期已见”集合（供破茧/补位去重）。
      //    不写历史——无限滚动加载的卡片不算新批次（实测“换一换”只替换顶部）
      const items = BHE.Capture.scrapeDom(grid);
      if (!items.length) return;
      BHE.Capture.noteRecent(items);

      // 3) 广告/非视频卡原位替换（含楼层卡广告；池未就绪时兜底隐藏）
      await BHE.AdFilter.apply();

      // 4) 破茧注入：顶批末尾 k 张原位替换（出现在第一屏视线内）
      const injected = await BHE.Diversity.apply();

      BHE.dom.lastInjected = injected;
      lastSig = quickSig();

      // 首屏批次入历史（仅此一次；之后的批次由“换一换”点击守卫快照）
      if (!initialSnapshotted) {
        initialSnapshotted = true;
        BHE.Capture.snapshotBatch('initial');
      }
      BHE.HistoryUI.updateButtons();
      BHE.Panel.refresh();
    } finally {
      applying = false;
    }
  }
})();

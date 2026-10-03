// B站首页增强 —— 破茧：热门内容池 + 按比例原位注入
// 思路：推荐接口是强个性化的，热门/排行榜接口个性化程度低。
// 每批渲染稳定后，把“顶批”（网格前 batchSize 个视频槽位）末尾 K 张原生卡
// 原位替换为热门内容池的卡片（K = round(批大小 × 比例)），打上来源角标。
// 热门内容池跨页轮换、与“近期已见”集合（含推荐流本身）去重，
// 避免反复推同一批视频。
window.BHE = window.BHE || {};

// ---------- 热门内容池 ----------
BHE.Extras = {
  pool: [],        // [{bvid,title,cover,url,author,mid,duration,play,sourceName,...}]
  page: 1,         // 热门接口页码（轮换）
  srcIdx: 0,       // 数据源轮换下标
  busy: false,
  failures: 0,

  async warm() {
    if (this.pool.length < 12 && this.failures < 4) await this.fill();
  },

  async fill() {
    if (this.busy) return;
    this.busy = true;
    try {
      const srcs = BHE.CONFIG.diversitySources;
      const src = srcs[this.srcIdx % srcs.length];
      const url = src.url.replace('{pn}', String(((this.page - 1) % src.pages) + 1));
      const json = await this.fetchJson(url);
      const list = (json && json.data && (json.data.list || json.data.items)) || [];
      let added = 0;
      for (const v of list) {
        if (!v || !v.bvid) continue;
        if (BHE.Capture.isRecent(v.bvid)) continue;
        if (this.pool.some((p) => p.bvid === v.bvid)) continue;
        this.pool.push({
          bvid: v.bvid,
          title: v.title || '',
          cover: BHE.httpsIt(v.pic || ''),
          url: 'https://www.bilibili.com/video/' + v.bvid,
          author: (v.owner && v.owner.name) || '',
          mid: (v.owner && v.owner.mid) || 0,
          duration: v.duration || 0,
          play: (v.stat && v.stat.view) || 0,
          danmaku: 0,
          sourceName: src.name,
          isAd: false,
          source: 'extras'
        });
        added++;
      }
      this.page++;
      // 某个源没补充到新内容（都看过了）就轮换数据源
      if (!added) this.srcIdx++;
    } catch (e) {
      this.failures++;
    } finally {
      this.busy = false;
    }
  },

  // 直连优先（实测 api.bilibili.com 对热门/排行开放跨域），
  // 失败走后台 Service Worker 代理（host_permissions 豁免 CORS）。
  async fetchJson(url) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      return await r.json();
    } catch (e) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'bhe-fetch', url }, (resp) => {
            resolve(resp && resp.ok ? resp.json : null);
          });
        } catch (e2) {
          resolve(null);
        }
      });
    }
  },

  async pick(n) {
    let guard = 0;
    while (this.pool.length < n && this.failures < 4 && guard < 4) {
      await this.fill();
      guard++;
    }
    const out = this.pool.splice(0, n);
    for (const it of out) BHE.Capture.markRecent(it.bvid);
    BHE.Capture.saveRecentSoon();
    return out;
  }
};

// ---------- 注入 ----------
// 原位替换版：不再“隐藏末尾卡 + 追加到网格末尾”（末尾在无限滚动下永远在
// 屏幕外，注入内容从未被看到）。改为替换“顶批”（网格前 batchSize 个视频槽位）
// 的末尾 k 张 → 破茧内容直接出现在第一屏视线内，且网格几何零变化。
BHE.Diversity = {
  async apply() {
    const grid = BHE.dom.grid;
    if (!grid) return 0;
    const s = BHE.Settings.data;
    if (!s.diversity || !(s.diversityRatio > 0)) {
      BHE.Swap.revertAll(grid, 'div');
      return 0;
    }

    // 顶批 = 网格内前 N 个“视频槽位”（普通卡/楼层卡/已替换槽都算占位，
    // 横幅与加载锚点不算），N = 设置的每批记录数。
    // 注意 .bili-video-card 可能自身就是网格子项（实测存在），querySelector 不匹配自身，
    // 需先 matches 再 querySelector。
    const S = BHE.CONFIG.selectors;
    const n = Math.max(2, Math.min(12, Number(s.batchSize) || 6));
    const slots = [];
    for (const child of grid.children) {
      if (slots.length >= n) break;
      const cls = child.classList;
      if (cls.contains('recommended-swipe') || cls.contains('load-more-anchor') || cls.contains('bhe-cell')) continue;
      if (cls.contains('bhe-swapped') || cls.contains('bhe-hidden')) { slots.push(child); continue; }
      if (child.matches(S.floorCard) || child.matches(S.card) || child.querySelector(S.card)) slots.push(child);
    }
    if (slots.length < 4) return 0;

    let k = Math.max(1, Math.round(n * s.diversityRatio));
    k = Math.min(k, 4, Math.max(0, slots.length - 2));

    // 本顶批已注入过就不再动（滚动加载不触发二次注入；比例调大时只补差额）
    const already = slots.filter((c) => c.dataset.bheSwap === 'div').length;
    if (already >= k) return 0;
    k -= already;

    // 候选 = 顶批内未被替换、未被隐藏、也不是广告槽的原生卡（广告槽由补位接管）
    const eligible = slots.filter(
      (c) => !c.classList.contains('bhe-swapped') &&
             !c.classList.contains('bhe-hidden') &&
             !BHE.AdFilter.isAdChild(c)
    );
    k = Math.min(k, eligible.length);
    if (k <= 0) return 0;

    const targets = eligible.slice(-k); // 顶批末尾（保留前排，减少感知突兀）
    const items = await BHE.Extras.pick(k);
    let done = 0;
    for (let i = 0; i < Math.min(targets.length, items.length); i++) {
      const it = items[i];
      if (BHE.Swap.inPlace(targets[i], it, it.sourceName || '破茧', 'div')) done++;
    }
    if (done) BHE.Counters.bump('injected', done);
    return done;
  }
};

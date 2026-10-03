// B站首页增强 —— 捕获层
// 三份职责：
//   1) 批次快照：把“主页顶部前 N 张视频槽”作为一批压入历史栈
//      （仅在首屏加载完成与点击“换一换”瞬间触发，无限滚动不产生新批次）；
//      原位替换槽记录用户实际看到的补位/破茧卡；
//   2) API 增强：消费 MAIN world 桥接抛来的推荐接口 JSON，提供结构化字段；
//   3) 茧房统计（主频道维度：详情接口拿 tid_v2 + 视频页内嵌频道表解析名称，本地缓存）与
//      近期已见集合（供破茧去重）。
// 双通道：首页首批为服务端渲染（无客户端请求），因此以 DOM 抓取为主、API 数据按 bvid 匹配增强。
window.BHE = window.BHE || {};

BHE.Capture = {
  history: [],        // [{id, time, sig, items:[...]}] 末位为当前批
  pendingApi: null,   // {items:[...], itemMap:Map, time}
  statsBatches: [],   // 最近 N 批的统计摘要 [{time, entries:[{bvid,followed,tname}]}]
  recentSet: new Set(),
  catCache: {},       // bvid → {main, ts} 主频道缓存（视频详情接口 + 频道表）
  catMap: null,       // {tids:{tid:{n,m}}, ts} 频道表（从视频页 channelKv 收割）
  statsGen: 0,        // 统计代数号：清空统计时 +1，使在途异步写入失效
  _viewInflight: new Map(),
  _catMapBusy: false,
  _saveSoon: null,
  _saveStatsSoon: null,
  _saveRecentSoon: null,
  _saveCatSoon: null,
  _saveCatMapSoon: null,

  async init() {
    const K = BHE.CONFIG.keys;
    this.history = (await BHE.Store.get(K.history, [])) || [];
    this.statsBatches = (await BHE.Store.get(K.statsBatches, [])) || [];
    this.catCache = (await BHE.Store.get(K.category, {})) || {};
    this.catMap = (await BHE.Store.get(K.catMap, null)) || null;
    const recent = (await BHE.Store.get(K.recent, [])) || [];
    this.recentSet = new Set(recent);
    const depth = BHE.Settings.data.historyDepth || 50;
    if (this.history.length > depth) this.history.splice(0, this.history.length - depth);
    this._saveSoon = BHE.debounce(() => BHE.Store.set(K.history, this.history), 600);
    this._saveStatsSoon = BHE.debounce(() => BHE.Store.set(K.statsBatches, this.statsBatches), 1500);
    this._saveCatSoon = BHE.debounce(() => BHE.Store.set(K.category, this.catCache), 1500);
    this._saveCatMapSoon = BHE.debounce(() => BHE.Store.set(K.catMap, this.catMap), 500);
    this._saveRecentSoon = BHE.debounce(() => {
      const arr = [...this.recentSet];
      if (arr.length > 400) arr.splice(0, arr.length - 400);
      BHE.Store.set(K.recent, arr);
    }, 1000);
    // 分区缓存限额（超出按时间淘汰最旧的）
    const ck = Object.keys(this.catCache);
    if (ck.length > 1600) {
      ck.sort((a, b) => (this.catCache[a].ts || 0) - (this.catCache[b].ts || 0));
      for (const key of ck.slice(0, ck.length - 1500)) delete this.catCache[key];
    }
  },

  // ---------- 标准化 ----------

  // 消费推荐接口响应（data.item[]，实测键名）
  onApiResponse(json) {
    try {
      const d = json && json.data;
      if (!d) return;
      const arr = d.item || d.items || [];
      const items = [];
      const itemMap = new Map();
      for (const it of arr) {
        const goto = String(it.goto || '');
        const bvid = it.bvid || '';
        const uri = String(it.uri || '');
        const isAd = goto === 'ad' || !!(it.ad_info || it.ad_cb) || /cm\.bilibili\.com/.test(uri) ||
                     String(it.jump_url || '').includes('cm.bilibili.com');
        const item = {
          bvid,
          title: it.title || '',
          cover: BHE.httpsIt(it.pic || ''),
          url: bvid ? 'https://www.bilibili.com/video/' + bvid : uri,
          author: (it.owner && it.owner.name) || '',
          mid: (it.owner && it.owner.mid) || 0,
          duration: it.duration || 0,
          play: (it.stat && it.stat.view) || 0,
          danmaku: (it.stat && it.stat.danmaku) || 0,
          followed: !!it.is_followed,
          reason: (it.rcmd_reason && (it.rcmd_reason.text || it.rcmd_reason.content)) || '',
          isAd,
          type: goto,
          source: 'api'
        };
        items.push(item);
        if (bvid) itemMap.set(bvid, item);
      }
      this.pendingApi = { items, itemMap, time: Date.now() };
    } catch (e) { /* 解析失败则回退 DOM 抓取 */ }
  },

  // 抓取单张 DOM 卡片（选择器均实测）
  scrapeCard(card) {
    const S = BHE.CONFIG.selectors;
    const imgLink = card.querySelector(S.cardImageLink);
    const titleLink = card.querySelector('.bili-video-card__info--tit a');
    const href = (imgLink && imgLink.getAttribute('href')) || (titleLink && titleLink.getAttribute('href')) || '';
    let abs = href;
    try { abs = href ? new URL(href, location.href).href : ''; } catch (e) { /* keep raw */ }
    const bvid = (abs.match(/BV[0-9A-Za-z]{10}/) || [''])[0];
    const titleEl = card.querySelector(S.cardTitle);
    const title = (((titleEl && titleEl.getAttribute('title')) || (titleLink && titleLink.textContent) || '')).trim();
    const img = card.querySelector(S.cardCoverImg);
    let cover = img ? (img.currentSrc || img.getAttribute('src') || '') : '';
    if (cover.startsWith('//')) cover = 'https:' + cover; // 协议相对地址兜底
    const authorEl = card.querySelector(S.cardAuthor);
    const ownerEl = card.querySelector(S.cardOwnerLink);
    const mid = ((ownerEl && (ownerEl.getAttribute('href') || '').match(/space\.bilibili\.com\/(\d+)/)) || [0, 0])[1];
    const dateEl = card.querySelector(S.cardDate);
    const statTexts = [...card.querySelectorAll(S.cardStatsText)].map((s) => (s.textContent || '').trim());
    const durEl = card.querySelector(S.cardDuration);
    return {
      bvid,
      title,
      cover: BHE.httpsIt(cover),
      url: bvid ? 'https://www.bilibili.com/video/' + bvid : abs,
      author: (((authorEl && (authorEl.getAttribute('title') || authorEl.textContent)) || '')).trim(),
      mid: Number(mid) || 0,
      date: dateEl ? (dateEl.textContent || '').trim() : '',
      play: statTexts[0] || '',
      danmaku: statTexts[1] || '',
      duration: durEl ? (durEl.textContent || '').trim() : '',
      isAd: !!card.querySelector(S.adLink),
      followed: false,
      reason: '',
      source: 'dom'
    };
  },

  // 抓取整个网格当前批次（含我们自己注入的卡片），并用最近的 API 数据增强
  scrapeDom(grid) {
    const out = [];
    for (const child of grid.children) {
      // 注入卡：.bhe-cell > .bhe-card（数据挂在 __bheData）
      if (child.classList.contains('bhe-cell')) {
        const c = child.querySelector('.bhe-card');
        if (c && c.__bheData) { out.push(c.__bheData); continue; }
      }
      const card = child.matches(BHE.CONFIG.selectors.card) ? child : child.querySelector(BHE.CONFIG.selectors.card);
      if (!card || card.querySelector(BHE.CONFIG.selectors.skeleton)) continue;
      out.push(this.scrapeCard(card));
    }
    if (this.pendingApi) {
      for (const it of out) {
        const a = it.bvid && this.pendingApi.itemMap.get(it.bvid);
        if (a) {
          it.mid = a.mid || it.mid;
          it.followed = a.followed;
          it.reason = a.reason;
          if (a.play) it.play = a.play;
          if (a.danmaku) it.danmaku = a.danmaku;
          if (a.duration && !it.duration) it.duration = a.duration;
        }
      }
    }
    return out.filter((i) => i.title || i.url);
  },

  // ---------- 历史栈 ----------

  // 签名只统计真实推荐卡片（忽略注入的破茧/补位卡），
  // 与 index.js 的 quickSig 口径一致，避免每批产生重复历史条目
  sig(items) {
    return items.filter((i) => i.source !== 'extras').map((i) => i.bvid || i.url || '').join('|');
  },

  pushBatch(items, source) {
    if (!items || !items.length) return;
    const s = this.sig(items);
    const last = this.history[this.history.length - 1];
    if (last && last.sig === s) {
      // 同一批但快照更完整（例如“换一换”点击瞬间的快照带上了注入卡片）
      // → 用最新快照覆盖，时间也以最近一次为准
      last.time = Date.now();
      last.items = items;
      if (this._saveSoon) this._saveSoon();
      return;
    }
    this.history.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      time: Date.now(),
      sig: s,
      source: source || '',
      items
    });
    const depth = BHE.Settings.data.historyDepth || 50;
    if (this.history.length > depth) this.history.splice(0, this.history.length - depth);
    if (this._saveSoon) this._saveSoon();
  },

  // 批次快照：取网格顶部前 N 张真实视频卡（N=设置 batchSize，默认6）。
  // 跳过横幅/加载锚点/骨架/我们隐藏的卡（用户没看到的不记录）；
  // 注入的破茧/补位卡若落在前 N 也如实记录。批内按 bvid 去重。
  // 仅两个时机调用：首屏加载完成、点击“换一换”瞬间（捕获阶段）。
  snapshotBatch(source) {
    const grid = BHE.dom.grid;
    if (!grid) return;
    const n = Math.max(2, Math.min(12, Number(BHE.Settings.data.batchSize) || 6));
    const items = [];
    const seen = new Set();
    for (const child of grid.children) {
      if (items.length >= n) break;
      const cls = child.classList;
      if (cls.contains('recommended-swipe') || cls.contains('load-more-anchor')) continue;
      if (cls.contains('bhe-hidden') || cls.contains('bhe-div-hidden')) continue;
      let item = null;
      if (cls.contains('bhe-swapped')) {
        // 原位替换槽：记录用户实际看到的补位/破茧卡（数据挂在 .bhe-card 上）
        const c = child.querySelector(':scope > .bhe-card');
        if (c && c.__bheData) item = Object.assign({}, c.__bheData);
      } else if (cls.contains('bhe-cell')) {
        // 旧版追加式注入的残留：读挂载在元素上的数据
        const c = child.querySelector('.bhe-card');
        if (c && c.__bheData) item = Object.assign({}, c.__bheData);
      } else {
        const card = cls.contains('bili-video-card') ? child : child.querySelector('.bili-video-card');
        if (card && !card.querySelector(BHE.CONFIG.selectors.skeleton)) {
          item = this.scrapeCard(card);
          // API 数据增强（UP主 mid / 已关注 / 推荐理由）
          const a = item.bvid && this.pendingApi && this.pendingApi.itemMap.get(item.bvid);
          if (a) {
            item.mid = a.mid || item.mid;
            item.followed = a.followed;
            item.reason = a.reason;
          }
        }
      }
      if (item && (item.bvid || (item.title && item.url))) {
        const k = item.bvid || item.url;
        if (!seen.has(k)) { seen.add(k); items.push(item); }
      }
    }
    if (!items.length) return;
    this.pushBatch(items, source);

    // 茧房统计（分区维度，异步补齐分区后入库）与近期已见集合
    this.pushStatsBatch(items);
    for (const i of items) if (i.bvid) this.recentSet.add(i.bvid);
    if (this._saveRecentSoon) this._saveRecentSoon();
  },

  // ---------- 分区统计 ----------

  // 视频详情接口（同站直连）：B站已全面隐去 tname（实测 2026-09，视频页 SSR 同样为空），
  // 只拿 tid / tid_v2，名称由频道表解析
  async fetchView(bvid) {
    if (this._viewInflight.has(bvid)) return this._viewInflight.get(bvid);
    const p = (async () => {
      try {
        const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { credentials: 'omit' });
        const j = await r.json();
        const d = j && j.data;
        if (d && (d.tid_v2 || d.tid)) return { tid: d.tid || 0, tidV2: d.tid_v2 || 0 };
      } catch (e) { /* 网络异常：按未识别处理 */ }
      return null;
    })();
    this._viewInflight.set(bvid, p);
    return p;
  },

  // 频道表：从任意视频页 HTML 内嵌的 channelKv 收割 tid→名称映射
  // （30+ 主频道 + 全部子频道，v2 分区体系，实测 236 条）。只收割一次，缓存进 storage。
  async ensureCatMap() {
    if (this.catMap && this.catMap.tids && Object.keys(this.catMap.tids).length) return true;
    if (this._catMapBusy) return false;
    this._catMapBusy = true;
    try {
      const bvid = BHE.CONFIG.catMapSourceBvid;
      const resp = await fetch('https://www.bilibili.com/video/' + bvid + '/', { credentials: 'include' });
      const html = await resp.text();
      const i = html.indexOf('"channelKv"');
      if (i < 0) return false;
      let start = html.indexOf('[', i), depth = 0, end = -1;
      for (let j = start; j < html.length; j++) {
        const c = html[j];
        if (c === '[') depth++;
        else if (c === ']') { depth--; if (!depth) { end = j; break; } }
      }
      if (end < 0) return false;
      const arr = JSON.parse(html.slice(start, end + 1));
      const tids = {};
      for (const ch of arr) {
        if (ch && ch.tid && ch.name) {
          tids[ch.tid] = { n: ch.name, m: ch.name }; // 主频道：m = 自身
          for (const sub of (ch.sub || [])) {
            if (sub && sub.tid && sub.name) tids[sub.tid] = { n: sub.name, m: ch.name };
          }
        }
      }
      if (Object.keys(tids).length < 50) return false; // 结构异常时不用半张表
      this.catMap = { tids, ts: Date.now() };
      if (this._saveCatMapSoon) this._saveCatMapSoon();
      return true;
    } catch (e) {
      return false; // 失败则本批按未识别处理，下批快照时重试
    } finally {
      this._catMapBusy = false;
    }
  },

  // tid → 主频道名（面板聚合粒度）；查不到返回空串
  resolveMain(tid, tidV2) {
    const tids = this.catMap && this.catMap.tids;
    if (!tids) return '';
    const hit = (tidV2 && tids[tidV2]) || (tid && tids[tid]);
    return hit ? (hit.m || hit.n || '') : '';
  },

  // 给批次里没有分区缓存的视频补齐（每批最多 12 个请求，按 bvid 缓存永不重复）。
  // 两类回补：① 已拿到 tid 但频道表当时未就绪 → 表就绪后重解析（不重新请求接口）；
  // ② 详情接口当时失败（无 tid）→ 超过 10 分钟后允许重试。
  async enrichCategory(items) {
    if (!(this.catMap && Object.keys(this.catMap.tids || {}).length)) await this.ensureCatMap();
    const mapReady = !!(this.catMap && Object.keys(this.catMap.tids || {}).length);
    const list = items.filter((i) => {
      if (!i.bvid) return false;
      const c = this.catCache[i.bvid];
      if (!c) return true;
      if (c.main) return false;
      if (c.tidV2 != null) return mapReady;          // ① 重解析
      return Date.now() - (c.ts || 0) > 600000;      // ② 重试
    }).slice(0, 12);
    if (!list.length) return;
    await Promise.all(list.map(async (i) => {
      let c = this.catCache[i.bvid];
      if (!c || (c.main === '' && c.tidV2 == null)) {
        const info = await this.fetchView(i.bvid);
        c = { tid: info ? info.tid : 0, tidV2: info ? info.tidV2 : null, main: '', ts: Date.now() };
        c.main = this.resolveMain(c.tid, c.tidV2);
        this.catCache[i.bvid] = c;
      } else {
        c.main = this.resolveMain(c.tid, c.tidV2);
      }
    }));
    if (this._saveCatSoon) this._saveCatSoon();
  },

  // 批次统计入库：只统计真实推荐（不含广告与注入的破茧/补位卡）
  async pushStatsBatch(items) {
    const real = items.filter((i) => !i.isAd && i.bvid && i.source !== 'extras');
    if (!real.length) return;
    const gen = this.statsGen;
    await this.enrichCategory(real);
    if (gen !== this.statsGen) return; // 期间统计被清空，放弃本批
    const entries = real.map((i) => {
      const c = this.catCache[i.bvid] || {};
      return { bvid: i.bvid, followed: !!i.followed, main: c.main || '' };
    });
    this.statsBatches.push({ time: Date.now(), entries });
    if (this.statsBatches.length > 30) this.statsBatches.splice(0, this.statsBatches.length - 30);
    if (this._saveStatsSoon) this._saveStatsSoon();
    BHE.Panel.refresh();
  },

  // 管线调用：把当前网格所有卡片喂给“近期已见”集合（破茧/补位去重用）。
  // 注意：不写历史——无限滚动加载不算新批次。
  noteRecent(items) {
    for (const i of items || []) if (i.bvid) this.recentSet.add(i.bvid);
    if (this._saveRecentSoon) this._saveRecentSoon();
  },

  // ---------- 近期已见（破茧/补位去重用） ----------

  isRecent(bvid) {
    return this.recentSet.has(bvid);
  },

  markRecent(bvid) {
    if (bvid) this.recentSet.add(bvid);
  },

  saveRecentSoon() {
    if (this._saveRecentSoon) this._saveRecentSoon();
  },

  async clearHistory() {
    this.history = [];
    this.statsBatches = [];
    this.statsGen++; // 使在途的异步统计写入失效
    await BHE.Store.set(BHE.CONFIG.keys.history, []);
    await BHE.Store.set(BHE.CONFIG.keys.statsBatches, []);
  }
};

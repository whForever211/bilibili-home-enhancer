// B站首页增强 —— 通用工具：格式化 / 存储 / 设置 / 计数 / 卡片渲染
window.BHE = window.BHE || {};

(() => {
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function httpsIt(u) {
    return typeof u === 'string' ? u.replace(/^http:\/\//i, 'https://') : (u || '');
  }

  function fmtCount(n) {
    n = Number(n);
    if (!isFinite(n)) return '';
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(n);
  }

  function fmtDuration(sec) {
    sec = Number(sec) || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const mm = String(m).padStart(h ? 2 : 2, '0');
    const ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  const Store = {
    async get(key, def) {
      try {
        const o = await chrome.storage.local.get(key);
        return key in o ? o[key] : def;
      } catch (e) {
        return def;
      }
    },
    async set(key, val) {
      try {
        await chrome.storage.local.set({ [key]: val });
      } catch (e) { /* 存储异常时静默，功能降级为内存态 */ }
    }
  };

  const Settings = {
    data: Object.assign({}, BHE.CONFIG.defaults),
    async load() {
      const s = await Store.get(BHE.CONFIG.keys.settings, null);
      if (s) this.data = Object.assign({}, BHE.CONFIG.defaults, s);
    },
    async save() {
      await Store.set(BHE.CONFIG.keys.settings, this.data);
    }
  };

  const Counters = {
    data: { ads: 0, injected: 0, backfilled: 0 },
    async load() {
      this.data = Object.assign(this.data, await Store.get(BHE.CONFIG.keys.counters, {}));
    },
    saveSoon: null,
    bump(key, n) {
      this.data[key] = (this.data[key] || 0) + (n || 1);
      if (this.saveSoon) this.saveSoon();
    }
  };
  Counters.saveSoon = debounce(() => Store.set(BHE.CONFIG.keys.counters, Counters.data), 800);

  const ICONS = {
    play: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4c0 .5.6.9 1 .6l8.2-5.2c.4-.3.4-.9 0-1.1L5.5 2.2c-.4-.3-1 .1-1 .6z"/></svg>',
    up: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="8" cy="4" r="2.4"/><path d="M3.2 13.6c.3-2.7 2.3-4.4 4.8-4.4s4.5 1.7 4.8 4.4c.05.5-.35.9-.85.9H4.05c-.5 0-.9-.4-.85-.9z"/></svg>',
    back: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-3.97L2.5 5.7"/><path d="M2.5 2.2v3.5H6"/></svg>',
    grid: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>'
  };

  // 渲染一张扩展自有结构的卡片（封面+时长+角标+标题+UP主+播放量）。
  // 不复用 B 站内部类名（v-img 等组件需要其 JS 配合，克隆出来图片不显示），
  // 全部用自己的 CSS，样式可控且不随 B 站改版漂移。
  // item 数据挂在根元素 __bheData 上，供快照与搜索复用。
  function renderExtraCard(item) {
    const card = document.createElement('div');
    card.className = 'bhe-card bhe-extra';
    card.__bheData = item;

    const link = document.createElement('a');
    link.className = 'bhe-card__link';
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noopener';

    const cover = document.createElement('div');
    cover.className = 'bhe-card__cover';
    if (item.cover) {
      const img = document.createElement('img');
      img.src = item.cover;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      cover.appendChild(img);
    } else {
      cover.classList.add('bhe-card__cover--empty');
    }

    if (item.tag) {
      const badge = document.createElement('span');
      badge.className = 'bhe-card__badge';
      badge.textContent = item.tag;
      cover.appendChild(badge);
    }
    if (item.duration) {
      const dur = document.createElement('span');
      dur.className = 'bhe-card__duration';
      dur.textContent = typeof item.duration === 'string' ? item.duration : fmtDuration(item.duration);
      cover.appendChild(dur);
    }
    link.appendChild(cover);

    const title = document.createElement('a');
    title.className = 'bhe-card__title';
    title.href = item.url || '#';
    title.target = '_blank';
    title.rel = 'noopener';
    title.title = item.title || '';
    title.textContent = item.title || '';

    const meta = document.createElement('div');
    meta.className = 'bhe-card__meta';
    const owner = document.createElement('a');
    owner.className = 'bhe-card__owner';
    if (item.mid) {
      owner.href = 'https://space.bilibili.com/' + item.mid;
      owner.target = '_blank';
      owner.rel = 'noopener';
    }
    owner.innerHTML = ICONS.up;
    const author = document.createElement('span');
    author.className = 'bhe-card__author';
    author.title = item.author || '';
    author.textContent = item.author || '';
    owner.appendChild(author);
    const stat = document.createElement('span');
    stat.className = 'bhe-card__stat';
    stat.innerHTML = ICONS.play;
    stat.appendChild(document.createTextNode(fmtCount(item.play)));
    meta.append(owner, stat);

    card.append(link, title, meta);
    return card;
  }

  // 注入卡包装层：纯净 div（不借用 .feed-card 等 B站类名——实测 B站 CSS 会
  // 隐藏不含原生卡片的 .feed-card，且纯净 div 已实测与原生卡片同宽对齐）
  function appendExtraCard(grid, cardEl) {
    const cell = document.createElement('div');
    cell.className = 'bhe-cell';
    cell.appendChild(cardEl);
    grid.appendChild(cell);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'bhe-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('bhe-toast-show'));
    setTimeout(() => {
      t.classList.remove('bhe-toast-show');
      setTimeout(() => t.remove(), 300);
    }, 1600);
  }

  Object.assign(BHE, {
    debounce, sleep, httpsIt, fmtCount, fmtDuration, fmtTime,
    Store, Settings, Counters, ICONS, renderExtraCard, appendExtraCard, toast
  });
})();

// B站首页增强 —— 历史找回 UI
// 入口（按用户反馈迭代）：
//   1) “换一换”正下方两个与原生按钮同风格的按钮（复用 roll-btn 类名继承 B站样式）：
//      [上一批] 逐批回退；[历史] 打开历史网格面板（封面+标题+UP主，支持搜索）。
//   2) 回放面板头部提供 ‹ › 前进/后退与“回到最新”按钮；Esc 关闭。
// 回放用覆盖层复刻网格布局（复制列数/间距），真实网格只是 visibility:hidden，
// 不动 Vue 管理的 DOM，退出即恢复。
window.BHE = window.BHE || {};

BHE.HistoryUI = {
  stack: null,
  histPos: null,   // null = 实时视图；整数 = BHE.Capture.history 下标
  overlay: null,
  modal: null,

  mount() {
    const rollBtn = BHE.dom.rollBtn;
    if (!rollBtn || this.stack) return;
    const nativeWrap = rollBtn.closest('.feed-roll-btn') || rollBtn;
    const host = nativeWrap.parentElement || rollBtn.parentElement;
    if (!host) return;

    const stack = document.createElement('div');
    stack.className = 'bhe-roll-stack';
    const mkRoll = (act, text, icon, title) => {
      const wrap = document.createElement('div');
      wrap.className = 'feed-roll-btn bhe-roll-wrap'; // 借用原生容器类名继承样式，定位已用 CSS 取消
      const btn = document.createElement('button');
      btn.className = 'roll-btn bhe-roll-btn';
      btn.dataset.act = act;
      btn.title = title || '';
      btn.innerHTML = icon; // 常量 SVG，安全
      const span = document.createElement('span');
      span.className = 'roll-btn-text';
      span.textContent = text;
      btn.appendChild(span);
      wrap.appendChild(btn);
      return wrap;
    };
    stack.append(
      mkRoll('prev', '上一批', BHE.ICONS.back, '查看上一批推荐'),
      mkRoll('panel', '历史', BHE.ICONS.grid, '推荐历史面板：浏览/搜索/回放')
    );
    stack.addEventListener('click', (e) => {
      const btn = e.target.closest('.bhe-roll-btn');
      if (!btn) return;
      if (btn.dataset.act === 'prev') this.openPrev();
      else if (btn.dataset.act === 'panel') this.openModal();
    });
    host.appendChild(stack);
    this.stack = stack;

    // 宿主若未定位则补 relative，作为按钮栈的定位锚点（先定锚点再算坐标）
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    this.positionStack();
    window.addEventListener('resize', BHE.debounce(() => this.positionStack(), 300));

    // Esc 关闭最上层界面（仅保留这一项键盘操作，其余快捷键已按需求移除）
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('input,textarea,[contenteditable]')) return;
      if (e.key === 'Escape') {
        if (this.modal) this.closeModal();
        else if (this.histPos != null) this.exitToLive(false);
      }
    });

    this.updateButtons();
  },

  // 依据“换一换”按钮的实测位置，把按钮栈钉在其正下方（同列、间距12px）
  positionStack() {
    if (!this.stack || !BHE.dom.rollBtn) return;
    const nativeWrap = BHE.dom.rollBtn.closest('.feed-roll-btn') || BHE.dom.rollBtn;
    const host = this.stack.parentElement;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    const wr = nativeWrap.getBoundingClientRect();
    this.stack.style.top = Math.round(wr.bottom - hr.top + 12) + 'px';
    this.stack.style.right = Math.round(hr.right - wr.right) + 'px';
  },

  updateButtons() {
    if (!this.stack) return;
    const hist = BHE.Capture.history;
    const prev = this.stack.querySelector('[data-act="prev"]');
    if (prev) {
      prev.disabled = !BHE.Settings.data.history || hist.length < 2 ||
        (this.histPos != null && this.histPos <= 0);
    }
    this.stack.style.display = BHE.Settings.data.history ? '' : 'none';
  },

  // ---------- 逐批回退 ----------

  openPrev() {
    const hist = BHE.Capture.history;
    if (!BHE.Settings.data.history || hist.length < 2) {
      BHE.toast('还没有更早的批次，多点几次换一换吧');
      return;
    }
    if (this.histPos == null) this.histPos = hist.length - 2;
    else if (this.histPos <= 0) {
      BHE.toast('已经是最早的一批了');
      return;
    } else this.histPos--;
    this.openOverlay(this.histPos);
  },

  openNext() {
    if (this.histPos == null) return;
    const hist = BHE.Capture.history;
    if (this.histPos >= hist.length - 1) {
      this.exitToLive(true);
      return;
    }
    this.histPos++;
    this.openOverlay(this.histPos);
  },

  exitToLive(notify) {
    this.histPos = null;
    this.closeOverlay();
    if (notify) BHE.toast('已回到最新一批');
    this.updateButtons();
  },

  // ---------- 回放覆盖层 ----------

  openOverlay(pos) {
    const grid = BHE.dom.grid;
    const hist = BHE.Capture.history;
    const batch = hist[pos];
    if (!batch || !grid) return;
    this.closeOverlay();

    const rect = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const cols = (cs.gridTemplateColumns || '').split(' ').filter((c) => c && c !== 'none' && c !== '0px').length || 2;
    const gap = cs.columnGap || '16px';

    const ov = document.createElement('div');
    ov.className = 'bhe-overlay';
    ov.style.left = Math.max(8, rect.left) + 'px';
    ov.style.top = Math.max(8, rect.top) + 'px';
    ov.style.width = rect.width + 'px';
    ov.style.maxHeight = (window.innerHeight - 24) + 'px';

    const head = document.createElement('div');
    head.className = 'bhe-overlay-head';
    const info = document.createElement('span');
    info.className = 'bhe-overlay-info';
    info.textContent = '历史批次 ' + (hist.length - pos) + '/' + hist.length +
      ' · ' + BHE.fmtTime(batch.time) + ' · ' + batch.items.length + ' 条';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const mkBtn = (text, fn, primary) => {
      const b = document.createElement('button');
      b.className = 'bhe-mini-btn' + (primary ? ' primary' : '');
      b.textContent = text;
      b.addEventListener('click', fn);
      return b;
    };
    head.append(
      mkBtn('‹', () => this.openPrev()),
      mkBtn('›', () => this.openNext()),
      info,
      spacer,
      mkBtn('回到最新', () => this.exitToLive(true), true),
      mkBtn('✕', () => this.exitToLive(false))
    );

    const body = document.createElement('div');
    body.className = 'bhe-overlay-body';
    const g = document.createElement('div');
    g.className = 'bhe-overlay-grid';
    g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    g.style.gap = gap;
    for (const item of batch.items) {
      const copy = Object.assign({}, item);
      copy.tag = item.isAd ? '广告' : (item.tag || '');
      g.appendChild(BHE.renderExtraCard(copy));
    }
    body.appendChild(g);
    ov.append(head, body);
    document.body.appendChild(ov);
    this.overlay = ov;

    grid.classList.add('bhe-grid-muted');
    this.updateButtons();
  },

  closeOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (BHE.dom.grid) BHE.dom.grid.classList.remove('bhe-grid-muted');
  },

  // ---------- 历史网格面板 ----------

  openModal() {
    const hist = BHE.Capture.history;
    if (!hist.length) {
      BHE.toast('历史为空，先点几次换一换吧');
      return;
    }
    this.closeModal();

    const bd = document.createElement('div');
    bd.className = 'bhe-modal-backdrop';
    bd.addEventListener('click', (e) => {
      if (e.target === bd) this.closeModal();
    });

    const m = document.createElement('div');
    m.className = 'bhe-modal';

    const head = document.createElement('div');
    head.className = 'bhe-modal-head';
    const title = document.createElement('span');
    title.className = 'bhe-modal-title';
    title.textContent = '推荐历史 · ' + hist.length + ' 批';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'bhe-modal-search';
    search.placeholder = '搜索标题或UP主，找回那个错过的视频…';
    const statsBtn = document.createElement('button');
    statsBtn.className = 'bhe-link-btn';
    statsBtn.textContent = '茧房统计';
    statsBtn.addEventListener('click', () => BHE.Panel.toggle());
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bhe-modal-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.closeModal());
    head.append(title, search, statsBtn, closeBtn);

    const body = document.createElement('div');
    body.className = 'bhe-modal-body';

    const sections = [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const batch = hist[i];
      const sec = document.createElement('div');
      sec.className = 'bhe-modal-batch';
      const secHead = document.createElement('div');
      secHead.className = 'bhe-modal-batch-head';
      const label = document.createElement('span');
      label.textContent = BHE.fmtTime(batch.time) + ' · ' + batch.items.length + ' 条';
      const viewBtn = document.createElement('button');
      viewBtn.className = 'bhe-link-btn';
      viewBtn.textContent = '查看此批';
      viewBtn.addEventListener('click', () => {
        this.closeModal();
        this.histPos = i;
        this.openOverlay(i);
      });
      secHead.append(label, viewBtn);
      const g = document.createElement('div');
      g.className = 'bhe-modal-grid';
      for (const item of batch.items) {
        const copy = Object.assign({}, item);
        copy.tag = item.isAd ? '广告' : (item.tag || '');
        g.appendChild(BHE.renderExtraCard(copy));
      }
      sec.append(secHead, g);
      body.appendChild(sec);
      sections.push({ sec, cards: [...g.children] });
    }

    search.addEventListener('input', () => {
      const q = (search.value || '').trim().toLowerCase();
      for (const { sec, cards } of sections) {
        let visible = 0;
        for (const card of cards) {
          const d = card.__bheData || {};
          const hit = !q || ((d.title || '') + ' ' + (d.author || '')).toLowerCase().includes(q);
          card.style.display = hit ? '' : 'none';
          if (hit) visible++;
        }
        sec.style.display = visible ? '' : 'none';
      }
    });

    m.append(head, body);
    bd.appendChild(m);
    document.body.appendChild(bd);
    this.modal = bd;
  },

  closeModal() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  },

  closeAll() {
    this.closeModal();
    this.exitToLive(false);
  }
};

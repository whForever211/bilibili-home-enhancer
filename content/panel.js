// B站首页增强 —— 茧房统计面板（主频道维度）
// UP主集中度已按用户反馈移除（同一UP主内容类型也跨度很大，衡量不了茧房）。
// 分区数据链路：视频详情接口拿 tid_v2（B站已隐去 tname）→ 视频页收割的频道表
// 解析出主频道（游戏/知识/音乐…21 个大类，见 capture.ensureCatMap），按 bvid 本地缓存。
// 展示：本批概况、最近 30 批的主频道分布、茧房指数（最集中频道占比）、
// 覆盖频道数、已关注内容占比。
window.BHE = window.BHE || {};

BHE.Panel = {
  el: null,

  mount() { /* 懒创建，首次 toggle 时构建 */ },

  toggle() {
    if (this.el) this.hide();
    else this.show();
  },

  hide() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  },

  refresh() {
    if (this.el) this.build();
  },

  show() {
    this.build();
  },

  build() {
    this.hide();
    if (!BHE.Settings.data.stats) {
      BHE.toast('统计面板已在扩展设置中关闭');
      return;
    }

    // ---- 汇总最近批次（只统计已识别主频道的视频）----
    const batches = BHE.Capture.statsBatches;
    const entries = batches.flatMap((b) => b.entries || []);
    const cats = new Map();
    let known = 0, followed = 0;
    for (const e of entries) {
      if (!e.main) continue; // 主频道未识别（接口失败/频道表未就绪）不计入分布
      known++;
      if (e.followed) followed++;
      cats.set(e.main, (cats.get(e.main) || 0) + 1);
    }
    const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total = known || 1;
    const cocoonPct = Math.round((topCats[0] ? topCats[0][1] / total : 0) * 100);
    const followedPct = known ? Math.round((followed / known) * 100) : 0;

    const el = document.createElement('div');
    el.className = 'bhe-stats';

    const close = document.createElement('button');
    close.className = 'bhe-stats-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    el.appendChild(close);

    const h = (text) => {
      const x = document.createElement('h4');
      x.textContent = text;
      return x;
    };

    // 本批概况
    el.appendChild(h('本批'));
    const cur = document.createElement('div');
    cur.className = 'bhe-stats-cur';
    cur.textContent =
      '处理广告 ' + (BHE.dom.lastAdSwapped || 0) + ' 条 · 破茧注入 ' + (BHE.dom.lastInjected || 0) + ' 条';
    el.appendChild(cur);

    // 分区分布
    el.appendChild(h('最近 ' + batches.length + ' 批 · 频道分布'));
    if (!topCats.length) {
      const empty = document.createElement('div');
      empty.className = 'bhe-stats-empty';
      empty.textContent = entries.length
        ? '频道识别中，稍后重新打开本面板…'
        : '暂无数据（多刷几批推荐后这里会出现统计）';
      el.appendChild(empty);
    } else {
      const sum = document.createElement('div');
      sum.className = 'bhe-stats-cur';
      sum.textContent = known + ' 条视频 · 覆盖 ' + cats.size + ' 个频道 · 茧房指数 ' + cocoonPct +
        '% · 已关注内容占 ' + followedPct + '%';
      el.appendChild(sum);
      for (const [name, count] of topCats) {
        const row = document.createElement('div');
        row.className = 'bhe-stats-row';
        const label = document.createElement('span');
        label.className = 'bhe-stats-name';
        label.title = name;
        label.textContent = name;
        const bar = document.createElement('div');
        bar.className = 'bhe-stats-bar';
        const inner = document.createElement('i');
        inner.style.width = Math.round((count / topCats[0][1]) * 100) + '%';
        bar.appendChild(inner);
        const cnt = document.createElement('span');
        cnt.className = 'bhe-stats-cnt';
        cnt.textContent = Math.round((count / total) * 100) + '%';
        row.append(label, bar, cnt);
        el.appendChild(row);
      }
    }

    const tip = document.createElement('div');
    tip.className = 'bhe-stats-tip';
    tip.textContent = '频道越集中、茧房指数越高说明推荐越单一，可在扩展弹窗里调高破茧比例。';
    el.appendChild(tip);

    // 定位到按钮栈左侧
    let left = 60, top = 120;
    const stack = BHE.HistoryUI.stack;
    if (stack) {
      const r = stack.getBoundingClientRect();
      top = Math.max(8, r.top);
      left = Math.max(8, r.left - 316);
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';

    document.body.appendChild(el);
    this.el = el;
  }
};

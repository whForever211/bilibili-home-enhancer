// B站首页增强 —— 广告过滤（原位替换版）
// 广告判定（多信号冗余，任一命中即替换）：
//   A. 卡片内存在指向 cm.bilibili.com 的链接（实测主信号，广告封面/标题均走该域名）；
//   B. 存在 .bili-video-card__info--ad / --creative 等广告角标类；
//   C. 小尺寸角标元素文本恰为“广告/推广”；
//   D. 推荐接口返回的该 bvid 条目 goto === 'ad'（API 印证）。
// 另覆盖“楼层卡”家族（.floor-single-card：直播/继续观看/运营广告位，内部没有
// .bili-video-card，旧版完全漏判——A/B 对比截图里未过滤的 updream 广告即此类）；
// 直播卡与“继续观看”卡保留不动。
// 处理方式：原位替换——槽位外壳保留、原生内容 CSS 隐藏、补位视频插入该槽，
// 网格几何零变化（不触发回流错位）。热门池未就绪时才兜底 display:none。
window.BHE = window.BHE || {};

BHE.AdFilter = {
  async apply() {
    const grid = BHE.dom.grid;
    if (!grid) return 0;

    // 自愈：B站重渲染可能吃掉我们插进槽位的卡片（外壳标记还在、内容空了）
    // → 先还原标记露出原生内容，本轮下方会重新替换
    for (const el of [...grid.querySelectorAll('.bhe-swapped')]) {
      if (!el.querySelector(':scope > .bhe-card')) BHE.Swap.revert(el);
    }

    const s = BHE.Settings.data;
    if (!s.adFilter && !s.hideLoginCard) {
      BHE.Swap.revertAll(grid, 'ad');
      BHE.dom.lastAdSwapped = 0;
      return 0;
    }

    const targets = [];
    for (const child of grid.children) {
      if (child.classList.contains('bhe-cell') || child.classList.contains('bhe-swapped')) continue;
      const cls = child.classList;
      if (cls.contains('recommended-swipe') || cls.contains('load-more-anchor')) continue;

      const floor = child.matches('.floor-single-card');
      const ad = s.adFilter && this.isAdChild(child);
      let loginCard = false;
      if (!ad && s.hideLoginCard && !floor) {
        const card = child.matches(BHE.CONFIG.selectors.card)
          ? child
          : child.querySelector(BHE.CONFIG.selectors.card);
        loginCard = !!card && !card.querySelector(BHE.CONFIG.selectors.skeleton) && this.isNonVideoCard(card);
      }
      if (ad || loginCard) targets.push({ el: child, ad: !!ad });
    }

    let swapped = 0, adCount = 0;
    if (targets.length) {
      if (s.backfill) {
        const items = await BHE.Extras.pick(targets.length);
        for (let i = 0; i < targets.length; i++) {
          const { el, ad } = targets[i];
          if (i < items.length) {
            if (BHE.Swap.inPlace(el, items[i], '补位', 'ad')) {
              swapped++;
              if (ad) adCount++;
            }
          } else {
            el.classList.add('bhe-hidden'); // 池暂时没货：兜底隐藏（罕见，池就绪后自愈）
          }
        }
      } else {
        // 用户关闭“补位替换”：退回旧的仅隐藏行为（会回流错位，由用户自担）
        BHE.Swap.revertAll(grid, 'ad');
        for (const { el, ad } of targets) {
          el.classList.add('bhe-hidden');
          swapped++;
          if (ad) adCount++;
        }
      }
    }
    if (adCount) BHE.Counters.bump('ads', adCount);
    BHE.dom.lastAdSwapped = swapped;
    return swapped;
  },

  // 网格子项级别的广告判定（含楼层卡家族）
  isAdChild(child) {
    const S = BHE.CONFIG.selectors;
    if (child.classList.contains('bhe-swapped')) return false;
    if (child.matches(S.floorCard)) return this.isFloorAd(child);
    const card = child.matches(S.card) ? child : child.querySelector(S.card);
    if (!card || card.querySelector(S.skeleton)) return false;
    return this.isAdCard(card);
  },

  isAdCard(card) {
    const S = BHE.CONFIG.selectors;
    if (card.querySelector(S.adLink)) return true;           // A：广告追踪域名
    if (card.querySelector(S.adBadgeClass)) return true;     // B：广告角标类名
    if (this.hasAdBadgeText(card)) return true;              // C：小角标文本
    const api = BHE.Capture.pendingApi;                      // D：API 印证
    if (api) {
      const link = card.querySelector('a[href*="/video/BV"]');
      const bvid = link ? ((link.getAttribute('href') || '').match(/BV[0-9A-Za-z]{10}/) || [''])[0] : '';
      const it = bvid && api.itemMap.get(bvid);
      if (it && it.isAd) return true;
    }
    return false;
  },

  // 楼层卡（.floor-single-card）：直播卡保留，其余按广告信号判定
  isFloorAd(child) {
    const S = BHE.CONFIG.selectors;
    if (child.querySelector(S.liveLink)) return false;   // 直播楼层卡保留
    if (child.querySelector(S.adLink)) return true;
    return this.hasAdBadgeText(child);
  },

  hasAdBadgeText(root) {
    for (const el of root.querySelectorAll('span')) {
      const t = (el.textContent || '').trim();
      if (t === '广告' || t === '推广' || t === '广告·') {
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && w <= 90 && h > 0 && h <= 44) return true;
      }
    }
    return false;
  },

  // 非“广告”但也不是视频的卡片（登录提示等）：卡片内没有任何视频/广告/直播链接
  isNonVideoCard(card) {
    return !card.querySelector('a[href*="/video/BV"], a[href*="cm.bilibili.com"], a[href*="live.bilibili.com"], a[href*="blackboard.bilibili.com"], a[href*="www.bilibili.com/list/"]');
  }
};

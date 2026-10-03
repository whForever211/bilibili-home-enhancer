// B站首页增强 —— 原位替换核心
// 背景：此前“隐藏广告卡片”引发底部行错位（用户 A/B 截图实锤）。根因是
// display:none 会从网格里真正移除该项 → 整个网格回流重排，而信息流里混着
// 横幅、楼层卡等特殊占位元素（部分带跨列样式），回流后行结构错乱。
// 方案：绝不动网格子项本身——槽位外壳原样保留（网格几何零变化），
// 原生内容用 CSS 藏住（.bhe-swapped > *:not(.bhe-card)），
// 我们渲染的卡片作为子节点插进同一槽位 → 布局与未开启过滤时完全一致。
// kind: 'ad' = 广告/非视频槽的补位替换；'div' = 破茧替换顶批末尾卡。
window.BHE = window.BHE || {};

BHE.Swap = {
  // 把 wrapper 槽位原位替换为 item 卡片；已替换过则拒绝（防重复）
  inPlace(wrapper, item, tag, kind) {
    if (!wrapper || wrapper.classList.contains('bhe-swapped')) return false;
    const it = Object.assign({}, item);
    it.tag = tag || item.tag || '';
    wrapper.classList.add('bhe-swapped');
    wrapper.classList.remove('bhe-hidden'); // 撤销池未就绪时的兜底隐藏
    wrapper.dataset.bheSwap = kind || 'ad';
    wrapper.appendChild(BHE.renderExtraCard(it)); // __bheData 挂的就是带角标的副本
    return true;
  },

  // 还原槽位：移除我们的卡片、露出原生内容（换一换重建 DOM 前调用）
  revert(el) {
    if (!el) return;
    el.classList.remove('bhe-swapped');
    delete el.dataset.bheSwap;
    el.querySelectorAll(':scope > .bhe-card').forEach((n) => n.remove());
  },

  // 还原全部（可只还原某一 kind：设置开关切换时互不影响）
  revertAll(root, kind) {
    if (!root) return;
    root.querySelectorAll('.bhe-swapped').forEach((el) => {
      if (!kind || el.dataset.bheSwap === kind) this.revert(el);
    });
  }
};

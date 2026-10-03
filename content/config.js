// B站首页增强 —— 集中配置
// B站前端改版导致功能失效时，优先检查/更新这个文件里的选择器与接口特征。
// 以下选择器与接口均为 2026-09 在 www.bilibili.com 首页实测确认。
window.BHE = window.BHE || {};

BHE.CONFIG = {
  // 只在首页生效（pathname 为 / 或 /index.htm）
  isHomepage() {
    return /^\/(index\.html?)?\/?$/i.test(location.pathname);
  },

  selectors: {
    // “换一换”按钮（实测：.feed-roll-btn > button.roll-btn > span.roll-btn-text）
    rollButton: ['button.roll-btn', '.feed-roll-btn button'],
    rollWrap: '.feed-roll-btn',
    rollAside: '.recommended-container_floor-aside',
    // 推荐卡片（实测类名，广告卡与普通卡同类名，靠链接与角标区分）
    rcmdCard: '.bili-video-card.is-rcmd',
    card: '.bili-video-card',
    skeleton: '.bili-video-card__skeleton',
    cardTitle: '.bili-video-card__info--tit',
    cardAuthor: '.bili-video-card__info--author',
    cardOwnerLink: '.bili-video-card__info--owner',
    cardDate: '.bili-video-card__info--date',
    cardCoverImg: '.bili-video-card__cover img',
    cardImageLink: 'a.bili-video-card__image--link',
    cardStatsText: '.bili-video-card__stats--text',
    cardDuration: '.bili-video-card__stats__duration',
    adBadgeClass: '.bili-video-card__info--ad, .bili-video-card__info--creative',
    adLink: 'a[href*="cm.bilibili.com"]',
    // 楼层卡家族（直播/继续观看/运营广告位，内部无 .bili-video-card）
    floorCard: '.floor-single-card',
    liveLink: 'a[href*="live.bilibili.com"]'
  },

  // 推荐流接口的 URL 特征（MAIN world 桥接层据此识别响应）
  // 实测首页（V8 版）：/x/web-interface/wbi/index/top/feed/rcmd，返回 data.item[]
  feedApiPatterns: [
    /\/x\/web-interface\/(wbi\/)?index\/top\/feed\/rcmd/,
    /\/x\/web-feed\/feed\/rcmd/,
    /\/x\/web-interface\/feed\/(index|rcmd)/
  ],

  // 破茧内容源（非个性化接口，已实测可跨域访问）
  diversitySources: [
    { name: '热门', url: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn={pn}', pages: 8 },
    { name: '排行', url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', pages: 1 }
  ],

  defaults: {
    adFilter: true,       // 隐藏推荐位广告
    hideLoginCard: true,  // 隐藏“登录提示”等非视频卡片
    backfill: true,       // 广告槽原位替换为热门视频（关闭则仅隐藏，会恢复回流错位）
    history: true,        // 找回上一批（按钮回退 + 历史面板）
    historyDepth: 50,     // 历史保留批数
    batchSize: 6,         // 每批快照的顶部视频卡数量（4-12）
    diversity: true,      // 破茧注入
    diversityRatio: 0.3,  // 注入比例（每批被替换为非个性化内容的比例）
    stats: true           // 茧房统计面板
  },

  keys: {
    settings: 'bhe:settings',
    history: 'bhe:history',
    statsBatches: 'bhe:stats-batches',
    recent: 'bhe:recent',
    counters: 'bhe:counters',
    category: 'bhe:category',
    catMap: 'bhe:cat-map'
  },

  // 分区表收割来源：一支常年在线的官方视频页（HTML 内嵌 channelKv 频道表，
  // 含 30+ 主频道与全部子频道的 tid→名称映射，v2 分区体系）。仅首次抓取一次。
  catMapSourceBvid: 'BV1GJ411x7h7'
};

// 运行期共享的 DOM 引用与状态
BHE.dom = { grid: null, rollBtn: null, lastAdSwapped: 0 };

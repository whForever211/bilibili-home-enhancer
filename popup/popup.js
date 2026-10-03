// B站首页增强 —— 设置弹窗
// 注意：popup 无法加载 content/config.js，这里的默认值需与其保持一致（两处都有注释标注）。
const KEY = 'bhe:settings';
const DEFAULTS = {
  adFilter: true,
  hideLoginCard: true,
  backfill: true,
  history: true,
  historyDepth: 50,
  batchSize: 6,
  diversity: true,
  diversityRatio: 0.3,
  stats: true
};
const BOOL_KEYS = ['adFilter', 'backfill', 'hideLoginCard', 'history', 'diversity', 'stats'];

const $ = (id) => document.getElementById(id);

async function load() {
  const o = await chrome.storage.local.get([KEY, 'bhe:counters', 'bhe:history']);
  const s = Object.assign({}, DEFAULTS, o[KEY] || {});
  for (const k of BOOL_KEYS) $(k).checked = !!s[k];
  $('historyDepth').value = s.historyDepth;
  $('batchSize').value = s.batchSize;
  $('diversityRatio').value = s.diversityRatio;
  $('ratioVal').textContent = Math.round(s.diversityRatio * 100) + '%';
  const c = o['bhe:counters'] || {};
  $('qAds').textContent = c.ads || 0;
  $('qInjected').textContent = c.injected || 0;
  $('qBatches').textContent = (o['bhe:history'] || []).length;
}

function save() {
  const s = {
    adFilter: $('adFilter').checked,
    backfill: $('backfill').checked,
    hideLoginCard: $('hideLoginCard').checked,
    history: $('history').checked,
    historyDepth: Math.max(10, Math.min(200, Number($('historyDepth').value) || 50)),
    batchSize: Math.max(4, Math.min(12, Number($('batchSize').value) || 6)),
    diversity: $('diversity').checked,
    diversityRatio: Number($('diversityRatio').value),
    stats: $('stats').checked
  };
  $('ratioVal').textContent = Math.round(s.diversityRatio * 100) + '%';
  chrome.storage.local.set({ [KEY]: s });
}

document.querySelectorAll('input').forEach((el) => el.addEventListener('change', save));

$('clearHistory').addEventListener('click', async () => {
  if (!confirm('确定清空推荐历史与统计数据？此操作不可恢复。')) return;
  await chrome.storage.local.remove(['bhe:history', 'bhe:stats-batches']);
  $('qBatches').textContent = 0;
});

$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

load();

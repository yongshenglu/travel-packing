/* 入口：启动、事件、同步状态、PWA */

import { loadData, state, saveConfig } from './store.js';
import { render, handleAction, parseRoute, go, initPoolDrag } from './views.js';
import { onSyncStatus, scheduleSync, startAutoSync, syncNow, configured, corruptBlocked } from './sync.js';

/* 变更后自动同步的钩子（store.mutate 调用） */
window.__scheduleSync = scheduleSync;

function setSyncChip(status) {
  const chip = document.getElementById('sync-chip');
  const text = document.getElementById('sync-text');
  if (!chip || !text) return;

  if (!configured()) {
    chip.dataset.state = 'offline';
    text.textContent = '仅本机';
    return;
  }
  if (corruptBlocked()) {
    chip.dataset.state = 'error';
    text.textContent = '数据异常';
    return;
  }
  const map = {
    ok: ['ok', '已同步'],
    dirty: ['dirty', '有改动'],
    syncing: ['syncing', '同步中'],
    error: ['error', '同步失败'],
    offline: ['offline', '离线']
  };
  if (status === 'ok' && state.dirty) status = 'dirty';
  const [ds, label] = map[status] || map.ok;
  chip.dataset.state = ds;
  text.textContent = label;
}

function bind() {
  document.getElementById('btn-back').addEventListener('click', () => {
    const p = { checklist: '#/lists', template: '#/templates' }[parseRoute().name];
    go(p || '#/lists');
  });

  /* 「＋ 新建」由全局 data-action 委托处理，随所在页面切换动作 */

  document.getElementById('sync-chip').addEventListener('click', () => {
    if (!configured()) {
      go('#/settings');
      return;
    }
    syncNow({ successToast: true }).then(() => render());
  });

  document.getElementById('tabbar').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) go('#/' + t.dataset.tab);
  });

  const main = document.getElementById('main');

  /* 全局委托：主区域与底部弹层共用同一套 data-action */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) handleAction(el.dataset.action, el);
  });

  main.addEventListener('input', e => {
    if (e.target.id === 'st-auto') {
      state.config.autoSync = e.target.checked;
      saveConfig();
    }
  });

  /* 物品池搜索：只重绘两块 chips，保住输入焦点 */
  main.addEventListener('input', e => {
    if (e.target.id !== 'pool-search') return;
    import('./views.js').then(m => {
      m.ui.poolSearch = e.target.value;
      m.refreshPoolChips();
    });
  });

  main.addEventListener('keydown', e => {
    /* 清点行是 div + role=button，需自行处理回车/空格 */
    const row = e.target.closest('.check-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleAction('toggle-item', row);
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'quick-add-input') {
      e.preventDefault();
      const btn = main.querySelector('[data-action="quick-add"]');
      if (btn) handleAction('quick-add', btn);
      return;
    }
    const pool = e.target.dataset && e.target.dataset.addPool;
    if (pool) {
      e.preventDefault();
      const btn = main.querySelector(`[data-action="pool-add"][data-pool="${pool}"]`);
      if (btn) handleAction('pool-add', btn);
    }
  });

  document.addEventListener('change', e => {
    if (e.target.id !== 'import-file') return;
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      import('./store.js')
        .then(m => {
          m.importJson(reader.result);
          render();
          return import('./ui.js').then(u => u.toast('导入成功'));
        })
        .catch(() => import('./ui.js').then(u => u.toast('文件格式不正确，导入失败')))
        .finally(() => { e.target.value = ''; });
    };
    reader.onerror = () => { e.target.value = ''; };
    reader.readAsText(f);
  });

  window.addEventListener('hashchange', () => render());
  initPoolDrag(document.getElementById('shell'));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  /* 本地调试时不注册，避免缓存干扰改动验证 */
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* 不受支持时忽略 */ });
}

function init() {
  loadData();
  bind();
  render();
  setSyncChip(configured() ? (state.dirty ? 'dirty' : 'ok') : 'offline');
  onSyncStatus(setSyncChip);
  if (configured()) startAutoSync();
  registerSW();
}

init();

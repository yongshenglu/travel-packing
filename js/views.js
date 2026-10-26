/* 视图渲染与交互 */

import {
  state, POOLS, POOL_LABEL, mutate, saveConfig, clampQty, getList, getTemplate, liveLists, liveTemplates,
  livePool, liveItems, progressOf, newPoolItem, newItem, newTemplate, newList, copyItem,
  restoreSeed, exportJson, importJson, clearLocal, renumberPool, movePoolItemTo,
  saveAsPreset, hasCustomPreset, clearPreset
} from './store.js';
import {
  esc, toast, fmtCNDate, fmtCNStamp, fmtCNStampTime, todayISO, uuid, nowMs,
  openSheet, closeSheet, confirmDialog
} from './ui.js';
import { configured, syncNow, pullOnly, testRepo, startAutoSync, corruptBlocked } from './sync.js';

const RING_C = 2 * Math.PI * 36;

const SVG = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
};

export const ui = {
  route: { name: 'lists', id: null },
  filter: 'all',
  poolSearch: '',
  pick: null,
  qtyEdit: null
};

export function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/lists';
  const [path] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'list' && seg[1]) return { name: 'checklist', id: seg[1] };
  if (seg[0] === 'template' && seg[1]) return { name: 'template', id: seg[1] };
  if (seg[0] === 'pools') return { name: 'pools' };
  if (seg[0] === 'templates') return { name: 'templates' };
  if (seg[0] === 'settings') return { name: 'settings' };
  return { name: 'lists', id: null };
}

export function go(hash) {
  location.hash = hash;
}

const PARENT = { checklist: 'lists', template: 'templates' };
const TITLES = { lists: '行李清单', pools: '物品池', templates: '模版', settings: '设置' };

/* ================= 清单列表 ================= */
function viewLists() {
  const lists = liveLists().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const active = lists.filter(l => !progressOf(l).complete);
  const done = lists.filter(l => progressOf(l).complete && progressOf(l).total > 0);

  const row = l => {
    const p = progressOf(l);
    return `<button class="row" data-action="open-list" data-id="${l.id}">
      <div class="row-main">
        <div class="row-title">${esc(l.name)}</div>
        <div class="row-sub">
          ${l.date ? `<span class="row-date">${fmtCNDate(l.date)}出发</span>` : '<span>未设日期</span>'}
          <span>已打包 ${p.done} / ${p.total}</span>
        </div>
        <div class="bar${p.complete ? ' done' : ''}"><i style="width:${p.pct}%"></i></div>
      </div><span class="chev">›</span></button>`;
  };

  let html = '';
  if (!lists.length) {
    html = `<div class="empty">${SVG.case}<p>还没有清单<br>点右上角「＋ 新建」开始准备下一次出行</p></div>`;
  } else {
    if (active.length) html += `<div class="sec-label">进行中</div><div class="card list-cards">${active.map(row).join('')}</div>`;
    if (done.length) html += `<div class="sec-label">已完成</div><div class="card list-cards">${done.map(row).join('')}</div>`;
  }
  return html;
}

/* 数量：默认只显示 ×N，点一下变成行内步进器 */
function qtyHTML(item, listId) {
  if (ui.qtyEdit === item.id) {
    return `<span class="qty-stepper">
      <button type="button" class="step" data-action="qty-dec" data-list="${listId}" data-item="${item.id}" aria-label="减少${esc(item.name)}数量">−</button>
      <button type="button" class="num" data-action="qty-done" aria-label="完成">${item.qty}</button>
      <button type="button" class="step" data-action="qty-inc" data-list="${listId}" data-item="${item.id}" aria-label="增加${esc(item.name)}数量">＋</button>
    </span>`;
  }
  return `<span class="qty-badge${item.qty > 1 ? '' : ' once'}" data-action="qty-start" data-item="${item.id}">×${item.qty}</span>`;
}

function bumpQty(listId, itemId, delta) {
  let next = 1;
  mutate(d => {
    const l = d.lists.find(x => x.id === listId);
    const it = l && l.items.find(x => x.id === itemId);
    if (!it) return;
    next = clampQty(it.qty + delta);
    it.qty = next;
    it.updatedAt = nowMs();
    l.updatedAt = nowMs();
  });
  return next;
}

/* ================= 清点页 ================= */
function viewChecklist(id) {
  const l = getList(id);
  if (!l) { go('#/lists'); return ''; }
  const p = progressOf(l);
  const items = liveItems(l);
  const f = ui.filter;

  let shown = items;
  if (f === 'todo') shown = items.filter(i => !i.checked);
  else if (f === 'done') shown = items.filter(i => i.checked);
  else if (f === 'essential') shown = items.filter(i => i.pool === 'essential');
  else if (f === 'optional') shown = items.filter(i => i.pool === 'optional');

  const listHTML = shown.length
    ? shown.map(i => `<div class="check-row${i.checked ? ' done' : ''}" role="button" tabindex="0" data-action="toggle-item" data-id="${i.id}">
        <span class="chk-box" aria-hidden="true">${SVG.check}</span>
        <span class="name">${esc(i.name)}</span>
        ${qtyHTML(i, l.id)}
        <span class="tag tag-${i.pool}"><i class="hole"></i>${POOL_LABEL[i.pool]}</span>
        <button type="button" class="row-x" data-action="list-del-item" data-list="${l.id}" data-item="${i.id}" aria-label="从清单删除${esc(i.name)}">${SVG.x}</button>
      </div>`).join('')
    : `<div class="empty"><p>${
      items.length === 0 ? '清单还是空的，可以从物品池选择，或在下方直接添加'
      : f === 'todo' ? '都打包好了'
      : '没有符合筛选的物品'
    }</p></div>`;

  const chip = (key, label) => `<button class="chip${f === key ? ' on' : ''}" data-action="filter" data-filter="${key}">${label}</button>`;

  return `
    <div class="check-head">
      <div class="ring-wrap${p.complete ? ' complete' : ''}" id="ring">
        <svg viewBox="0 0 84 84" aria-hidden="true">
          <circle class="track" cx="42" cy="42" r="36"></circle>
          <circle class="fill" id="ring-fill" cx="42" cy="42" r="36" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - (p.total ? p.done / p.total : 0))}"></circle>
        </svg>
        <div class="ring-center"><div><b id="ring-num">${p.done}/${p.total}</b><span>已打包</span></div></div>
      </div>
      <div class="check-meta">
        <h2><button class="title-btn" data-action="rename-list" data-id="${l.id}">${esc(l.name)}</button></h2>
        <button class="date-link" data-action="edit-date" data-id="${l.id}">
          ${SVG.cal}${l.date ? fmtCNDate(l.date) + '出发 · 点击修改' : '设置出发日期'}
        </button>
      </div>
    </div>

    <div class="check-progress-line${p.complete ? ' done' : ''}" id="prog-line"><i style="width:${p.pct}%"></i></div>

    <div class="filter-row">
      <div class="chips scroll" id="filter-chips">
        ${chip('all', '全部')}${chip('todo', '未打包')}${chip('done', '已打包')}${chip('essential', '必带')}${chip('optional', '选带')}
      </div>
    </div>

    <div class="check-list" id="check-list">${listHTML}</div>

    <div class="quick-add">
      <input id="quick-add-input" type="text" placeholder="添加物品（只进清单）" aria-label="快捷添加">
      <button class="btn" data-action="quick-add" data-id="${l.id}">添加</button>
    </div>
    <button class="btn block" style="margin-top:8px" data-action="open-pick" data-target="list:${l.id}">从物品池选择</button>

    <div class="tpl-actions">
      <button class="btn sm" data-action="save-tpl" data-id="${l.id}">存为模版</button>
      <button class="btn sm" data-action="update-tpl" data-id="${l.id}">更新模版</button>
      <button class="btn sm" data-action="reset-all" data-id="${l.id}">全部重置</button>
      <button class="btn sm danger" data-action="del-list" data-id="${l.id}">删除清单</button>
    </div>`;
}

/* ================= 物品池 ================= */
function poolChipsHTML(pool) {
  const q = ui.poolSearch.trim().toLowerCase();
  const items = livePool(pool).filter(it => !q || it.name.toLowerCase().includes(q));
  if (!items.length) return `<p class="muted">${q ? '未找到匹配物品' : '暂无物品，先在下方添加'}</p>`;

  return items.map(it => `<span class="pool-chip" data-id="${it.id}" data-pool="${pool}">
      <button class="chip-name" data-action="pool-edit" data-pool="${pool}" data-id="${it.id}">${esc(it.name)}</button>
      <button class="x" data-action="pool-del" data-pool="${pool}" data-id="${it.id}" aria-label="删除${esc(it.name)}">${SVG.x}</button>
    </span>`).join('');
}

export function refreshPoolChips() {
  for (const pool of POOLS) {
    const el = document.getElementById('pool-' + pool);
    if (el) el.innerHTML = poolChipsHTML(pool);
  }
}

function viewPools() {
  const block = pool => `
    <div class="sec-label label-pool">${POOL_LABEL[pool]}</div>
    <div class="pool-chips" id="pool-${pool}">${poolChipsHTML(pool)}</div>
    <div class="add-row">
      <input type="text" placeholder="添加${POOL_LABEL[pool]}物品" data-add-pool="${pool}">
      <button class="btn primary" data-action="pool-add" data-pool="${pool}">添加</button>
    </div>`;

  return `
    <div class="search-box">${SVG.search}
      <input id="pool-search" type="search" placeholder="搜索物品" value="${esc(ui.poolSearch)}">
    </div>
    ${block('essential')}
    ${block('optional')}
    <button class="btn block save-preset" data-action="save-preset">保存为预设物品</button>`;
}

/* ================= 模版列表 ================= */
function viewTemplates() {
  const tpls = liveTemplates().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (!tpls.length) {
    return `<div class="empty">${SVG.case}<p>还没有模版<br>在清单底部点「存为模版」即可保存一份常用的行李组合</p></div>`;
  }
  return `<div class="sec-label">我的模版</div>
    <div class="card">${tpls.map(t => `<div class="row tpl-card-main row-split">
        <button class="row-main as-btn" data-action="open-template" data-id="${t.id}">
          <div class="row-title">${esc(t.name)}</div>
          <div class="row-sub"><span>${liveItems(t).length} 件物品</span><span>${fmtCNStamp(t.updatedAt)}更新</span></div>
        </button>
        <button class="row-icon danger" data-action="del-tpl" data-id="${t.id}" aria-label="删除${esc(t.name)}">${SVG.x}</button>
      </div>`).join('')}</div>`;
}

/* ================= 模版详情 ================= */
function viewTemplate(id) {
  const t = getTemplate(id);
  if (!t) { go('#/templates'); return ''; }
  const items = liveItems(t);

  const group = pool => {
    const rows = items.filter(i => i.pool === pool).map(i => `<div class="item-plain">
        <span class="name">${esc(i.name)}</span>
        <button class="x" data-action="tpl-del-item" data-id="${t.id}" data-item="${i.id}" aria-label="删除${esc(i.name)}">${SVG.x}</button>
      </div>`).join('');
    return rows ? `<div class="sec-label label-pool">${POOL_LABEL[pool]}</div><div class="card">${rows}</div>` : '';
  };

  return `
    <div class="tpl-detail-head">
      <h2><button class="title-btn" data-action="rename-tpl" data-id="${t.id}">${esc(t.name)}</button></h2>
      <div class="meta">${items.length} 件物品 · ${fmtCNStamp(t.updatedAt)}更新</div>
    </div>
    <div class="tpl-btns">
      <button class="btn primary" data-action="tpl-new-list" data-id="${t.id}">用此模版建清单</button>
      <button class="btn" data-action="tpl-update-from" data-id="${t.id}">从清单更新</button>
      <button class="btn" data-action="open-pick" data-target="template:${t.id}">编辑物品</button>
    </div>
    ${group('essential')}${group('optional')}
    ${items.length ? '' : '<div class="empty"><p>模版还没有物品</p></div>'}
    <button class="btn block" style="margin-top:8px" data-action="open-pick" data-target="template:${t.id}">添加物品</button>
    <div class="tpl-actions">
      <button class="btn sm danger" style="flex:1" data-action="del-tpl" data-id="${t.id}">删除模版</button>
    </div>`;
}

/* ================= 设置 ================= */
function viewSettings() {
  const c = state.config;
  const on = configured();
  const corrupt = corruptBlocked();
  return `
    ${corrupt ? `<div class="notice danger-notice">
      <b>本机数据含乱码，同步已暂停</b><br>
      旧版本解码有缺陷，把中文存成了 Ã¥Â 之类的乱码，且已经无法自动还原。
      同步已自动暂停，避免把乱码推到云端。<br><br>
      处理办法：先「导出 JSON」留个底，再点「清空本机数据」，之后重新同步即可从云端拉到干净数据。
    </div>` : ''}
    <div class="notice">
      <b>隐私说明</b><br>
      访问令牌只保存在本机浏览器，不会上传到任何第三方服务器。
      清单数据保存在你自己 GitHub 账号的<b>私有仓库</b>中，只有你能看到。
    </div>

    <div class="sec-label">GitHub 同步</div>
    <div class="set-card">
      <label class="field"><span>GitHub 用户名</span>
        <input id="st-owner" type="text" value="${esc(c.owner || '')}" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>数据仓库名（需为私有仓库）</span>
        <input id="st-repo" type="text" value="${esc(c.repo || 'travel-packing-data')}" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>访问令牌（PAT，仅该仓库 Contents 读写）</span>
        <input id="st-token" type="password" value="${esc(c.token || '')}" autocomplete="off" spellcheck="false"></label>
      <div class="btn-row">
        <button class="btn" data-action="st-test">测试连接</button>
        <button class="btn primary" data-action="st-save">保存配置</button>
      </div>
      <div class="test-result" id="test-result"></div>
      <div class="set-row" style="margin-top:12px">
        <div class="lbl"><b>自动同步</b><small>改动后约 5 秒自动推送到云端</small></div>
        <label class="switch">
          <input type="checkbox" id="st-auto"${c.autoSync !== false && on ? ' checked' : ''}${on ? '' : ' disabled'}>
          <span class="knob"></span>
        </label>
      </div>
      <button class="btn primary block" style="margin-top:12px" data-action="st-sync"${on ? '' : ' disabled'}>立即同步</button>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn sm" data-action="st-pull"${on ? '' : ' disabled'}>仅拉取</button>
        <button class="btn sm" data-action="st-push"${on ? '' : ' disabled'}>仅推送</button>
      </div>
      <p class="muted" style="margin-top:10px" id="sync-info">${escapeSyncInfo()}</p>
    </div>

    <div class="sec-label">数据管理</div>
    <div class="set-card">
      <button class="btn block" data-action="export">导出 JSON</button>
      <button class="btn block" data-action="import">导入 JSON</button>
      <button class="btn block" data-action="restore-seed">恢复预置物品${hasCustomPreset() ? '（自定义）' : ''}</button>
      ${hasCustomPreset() ? '<button class="btn ghost block" data-action="clear-preset">回到内置预设</button>' : ''}
      <button class="btn danger block" data-action="clear">清空本机数据</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <p class="muted" style="text-align:center;margin-top:14px">当前版本 ${esc(appVersion())}</p>`;
}

/* 版本号取自 index.html 的 meta，发版时和 sw.js 的 VER 一起改 */
function appVersion() {
  return document.querySelector('meta[name="app-version"]')?.content || '未知';
}

function escapeSyncInfo() {
  if (!configured()) return '当前为仅本机模式：数据只保存在本机浏览器，换设备或清除浏览器数据会丢失。';
  if (!state.meta.lastSyncAt) return '尚未同步过';
  return `上次同步：${fmtCNStampTime(state.meta.lastSyncAt)}` + (state.dirty ? '（有未同步修改）' : '');
}

/* ================= 主渲染 ================= */
export function render() {
  const route = parseRoute();
  ui.route = route;
  if (route.name !== 'checklist') ui.qtyEdit = null;
  if (route.name !== 'pools' && initPoolDrag.abort) initPoolDrag.abort();
  /* 进入清单页（或换了一份清单）时筛选回到「全部」；
     同一份清单内重绘则保留用户当前的筛选 */
  if (route.name === 'checklist' && (ui._lastRoute !== 'checklist' || ui._lastListId !== route.id)) {
    ui.filter = 'all';
  }
  if (route.name === 'checklist') ui._lastListId = route.id;
  const main = document.getElementById('main');
  const scrollTop = main.scrollTop;

  let html = '', title = TITLES[route.name] || '行李清单', back = false;
  switch (route.name) {
    case 'checklist': {
      const l = getList(route.id);
      if (!l) { location.hash = '#/lists'; return; }
      html = viewChecklist(l.id);
      title = l.name; back = true;
      break;
    }
    case 'pools': html = viewPools(); break;
    case 'templates': html = viewTemplates(); break;
    case 'template': {
      const t = getTemplate(route.id);
      if (!t) { location.hash = '#/templates'; return; }
      html = viewTemplate(t.id);
      title = t.name; back = true;
      break;
    }
    case 'settings': html = viewSettings(); break;
    default: html = viewLists();
  }

  document.getElementById('page-title').textContent = title;
  document.getElementById('btn-back').hidden = !back;
  const newBtn = document.getElementById('btn-new');
  newBtn.hidden = !(route.name === 'lists' || route.name === 'templates');
  newBtn.dataset.action = route.name === 'templates' ? 'new-template' : 'new-list';

  const tabKey = PARENT[route.name] || route.name;
  document.querySelectorAll('#tabbar .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabKey));

  main.innerHTML = html;
  if (route.name === ui._lastRoute && scrollTop) main.scrollTop = scrollTop;
  else main.scrollTop = 0;
  ui._lastRoute = route.name;
}

/* 只更新进度，不整屏重绘（勾选时保持滚动位置） */
function updateProgress(id) {
  const l = getList(id);
  if (!l) return;
  const p = progressOf(l);
  const num = document.getElementById('ring-num');
  const fill = document.getElementById('ring-fill');
  const ring = document.getElementById('ring');
  const line = document.getElementById('prog-line');
  if (num) num.textContent = `${p.done}/${p.total}`;
  if (fill) fill.setAttribute('stroke-dashoffset', RING_C * (1 - (p.total ? p.done / p.total : 0)));
  if (ring) ring.classList.toggle('complete', p.complete);
  if (line) {
    line.classList.toggle('done', p.complete);
    line.querySelector('i').style.width = p.pct + '%';
  }
}

/* ================= 弹层：新建清单 ================= */
export function openNewList(pre = {}) {
  const tpls = liveTemplates();
  const optPool = livePool('optional');
  let selectedTpl = pre.templateId || null;
  const checkedOptional = new Set(pre.optionalIds || []);
  let search = '';

  const renderSheet = () => {
    const tplChips = tpls.length ? tpls.map(t =>
      `<button class="chip tog${selectedTpl === t.id ? ' on' : ''}" type="button" data-tpl="${t.id}">
        <span class="box">${SVG.check}</span>${esc(t.name)}
      </button>`).join('') : '<p class="muted">还没有模版</p>';

    const optChips = optPool
      .filter(it => !search || it.name.toLowerCase().includes(search))
      .map(it => `<button class="chip tog${checkedOptional.has(it.id) ? ' on' : ''}" type="button" data-opt="${it.id}">
        <span class="box">${SVG.check}</span>${esc(it.name)}
      </button>`).join('') || '<p class="muted">选带池为空</p>';

    openSheet({
      title: '新建清单',
      body: `
        <label class="field"><span>名称</span>
          <input id="nl-name" type="text" value="${esc(pre.name || '')}" placeholder="如：五一杭州游"></label>
        <label class="field"><span>出发日期（可选）</span>
          <input id="nl-date" type="date" value="${esc(pre.date || '')}"></label>
        <div class="switch-row">
          <div class="lbl"><b>自动带入必带物品</b><small>创建后仍可单独移除</small></div>
          <label class="switch"><input type="checkbox" id="nl-auto"${pre.auto === false ? '' : ' checked'}><span class="knob"></span></label>
        </div>
        <div class="sec-label" style="margin-top:6px">从模版创建（可选）</div>
        <div class="chips" id="nl-tpls">${tplChips}</div>
        <div class="sec-label">选带物品（可多选）</div>
        <div class="search-box">${SVG.search}<input id="nl-search" type="search" placeholder="搜索选带物品" value="${esc(search)}"></div>
        <div class="chips" id="nl-optional">${optChips}</div>`,
      foot: `<button class="btn ghost" data-close>取消</button>
             <button class="btn primary" data-action="nl-create">创建</button>`,
      onMount(root) {
        root.querySelector('#nl-tpls').addEventListener('click', e => {
          const chip = e.target.closest('[data-tpl]');
          if (!chip) return;
          selectedTpl = selectedTpl === chip.dataset.tpl ? null : chip.dataset.tpl;
          const auto = root.querySelector('#nl-auto');
          pre.name = root.querySelector('#nl-name').value;
          pre.date = root.querySelector('#nl-date').value;
          pre.auto = auto ? auto.checked : true;
          pre.templateId = selectedTpl;
          pre.optionalIds = [...checkedOptional];
          renderSheet();
        });
        root.querySelector('#nl-optional').addEventListener('click', e => {
          const chip = e.target.closest('[data-opt]');
          if (!chip) return;
          const id = chip.dataset.opt;
          if (checkedOptional.has(id)) checkedOptional.delete(id);
          else checkedOptional.add(id);
          chip.classList.toggle('on', checkedOptional.has(id));
        });
        root.querySelector('#nl-search').addEventListener('input', e => {
          search = e.target.value.trim().toLowerCase();
          const wrap = root.querySelector('#nl-optional');
          wrap.innerHTML = optPool
            .filter(it => !search || it.name.toLowerCase().includes(search))
            .map(it => `<button class="chip tog${checkedOptional.has(it.id) ? ' on' : ''}" type="button" data-opt="${it.id}">
              <span class="box">${SVG.check}</span>${esc(it.name)}
            </button>`).join('') || '<p class="muted">没有匹配的物品</p>';
        });
      }
    });
    setTimeout(() => {
      const el = document.getElementById('nl-name');
      if (el) el.focus();
    }, 60);
  };

  ui._newList = { render: renderSheet, get: () => ({ selectedTpl, checkedOptional }) };
  renderSheet();
}

function createList() {
  const nameEl = document.getElementById('nl-name');
  const dateEl = document.getElementById('nl-date');
  const autoEl = document.getElementById('nl-auto');
  const { selectedTpl, checkedOptional } = ui._newList.get();
  const name = (nameEl && nameEl.value || '').trim() || '我的行程';
  const date = (dateEl && dateEl.value) || '';
  const auto = autoEl ? autoEl.checked : true;

  const items = [];
  const seen = new Set();
  const push = (src, pool) => {
    const key = pool + '|' + src.name;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(newItem(src.name, pool, false, src.qty));
  };

  if (selectedTpl) {
    const t = getTemplate(selectedTpl);
    if (t) liveItems(t).forEach(i => push(i, i.pool));
  }
  if (auto) livePool('essential').forEach(i => push(i, 'essential'));
  if (!selectedTpl) {
    for (const id of checkedOptional) {
      const it = livePool('optional').find(x => x.id === id);
      if (it) push(it, 'optional');
    }
  }

  const l = newList(name, date, items, selectedTpl);
  mutate(d => { d.lists.push(l); });
  closeSheet();
  go('#/list/' + l.id);
  toast(`已创建清单，带入 ${liveItems(l).length} 件物品`);
}

/* ================= 弹层：新建模版 ================= */
export function openNewTemplate() {
  const picked = new Set();
  let search = '';

  const chipsHTML = () => {
    const q = search.trim().toLowerCase();
    const groups = POOLS.map(pool => {
      const list = livePool(pool).filter(it => !q || it.name.toLowerCase().includes(q));
      if (!list.length) return '';
      return `<div class="sec-label label-pool">${POOL_LABEL[pool]}</div>
        <div class="chips">${list.map(it => `<button class="chip tog${picked.has(it.id) ? ' on' : ''}" type="button" data-opt="${it.id}">
          <span class="box">${SVG.check}</span>${esc(it.name)}
        </button>`).join('')}</div>`;
    }).join('');
    return groups || '<p class="muted">物品池为空，创建后可在模版里再添加</p>';
  };

  const open = () => openSheet({
    title: '新建模版',
    body: `
      <label class="field"><span>名称</span>
        <input id="nt-name" type="text" placeholder="如：海边度假"></label>
      <div class="btn-row" style="margin:4px 0 12px">
        <button class="btn sm" data-pick="essential">全选必带</button>
        <button class="btn sm" data-pick="none">清空</button>
      </div>
      <div class="search-box">${SVG.search}
        <input id="nt-search" type="search" placeholder="搜索物品" value="${esc(search)}"></div>
      <div id="nt-chips">${chipsHTML()}</div>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-new-template">创建（已选 <span id="nt-count">${picked.size}</span> 件）</button>`,
    onMount(root) {
      root.addEventListener('click', e => {
        const bulk = e.target.closest('[data-pick]');
        if (bulk) {
          const kind = bulk.dataset.pick;
          if (kind === 'none') picked.clear();
          else livePool(kind).forEach(it => picked.add(it.id));
          root.querySelector('#nt-chips').innerHTML = chipsHTML();
          root.querySelector('#nt-count').textContent = picked.size;
          return;
        }
        const chip = e.target.closest('[data-opt]');
        if (chip) {
          const id = chip.dataset.opt;
          if (picked.has(id)) picked.delete(id); else picked.add(id);
          chip.classList.toggle('on', picked.has(id));
          root.querySelector('#nt-count').textContent = picked.size;
        }
      });
      root.querySelector('#nt-search').addEventListener('input', e => {
        search = e.target.value;
        root.querySelector('#nt-chips').innerHTML = chipsHTML();
      });
    }
  });

  ui._newTemplate = { picked, get: () => document.getElementById('nt-name')?.value.trim() };
  open();
  setTimeout(() => document.getElementById('nt-name')?.focus(), 60);
}

function createTemplate() {
  const picked = ui._newTemplate.picked;
  const name = (ui._newTemplate.get() || '').trim() || '新模版';
  const items = POOLS
    .flatMap(p => livePool(p))
    .filter(it => picked.has(it.id))
    .map(it => newItem(it.name, it.pool, false));
  const t = newTemplate(name, items, null);
  mutate(d => { d.templates.push(t); });
  closeSheet();
  go('#/template/' + t.id);
  toast(`已创建模版「${name}」`);
}

/* ================= 弹层：物品选择 ================= */
function openPick(target) {
  const isList = target.startsWith('list:');
  const id = target.slice(target.indexOf(':') + 1);
  const entity = isList ? getList(id) : getTemplate(id);
  if (!entity) return;

  const keyOf = it => it.pool + '|' + it.name;
  const selected = new Set(liveItems(entity).map(keyOf));
  let search = '';

  const renderBody = root => {
    const bulk = `<div class="btn-row" style="margin-bottom:12px">
        <button class="btn sm" data-pick="essential">全选必带</button>
        <button class="btn sm" data-pick="optional">全选选带</button>
        <button class="btn sm" data-pick="none">清空</button>
      </div>`;
    const chipsFor = pool => {
      const list = livePool(pool).filter(it => !search || it.name.toLowerCase().includes(search));
      return list.map(it => {
        const k = keyOf(it);
        return `<button class="chip tog${selected.has(k) ? ' on' : ''}" type="button" data-pick-item="${esc(k)}">
          <span class="box">${SVG.check}</span>${esc(it.name)}
        </button>`;
      }).join('') || '<p class="muted">暂无物品</p>';
    };
    root.querySelector('#pick-body').innerHTML = `
      ${bulk}
      <div class="sec-label label-pool">必带</div><div class="chips" id="pick-essential">${chipsFor('essential')}</div>
      <div class="sec-label label-pool">选带</div><div class="chips" id="pick-optional">${chipsFor('optional')}</div>`;
    root.querySelector('#pick-count').textContent = selected.size;
  };

  openSheet({
    title: isList ? '从物品池选择' : '编辑模版物品',
    body: `
      <div class="search-box">${SVG.search}<input id="pick-search" type="search" placeholder="搜索物品"></div>
      <div id="pick-body"></div>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="pick-confirm" data-target="${esc(target)}">确定（已选 <span id="pick-count">${selected.size}</span> 件）</button>`,
    onMount(root) {
      renderBody(root);
      root.querySelector('#pick-search').addEventListener('input', e => {
        search = e.target.value.trim().toLowerCase();
        renderBody(root);
      });
      root.querySelector('#pick-body').addEventListener('click', e => {
        const bulk = e.target.closest('[data-pick]');
        if (bulk) {
          const kind = bulk.dataset.pick;
          if (kind === 'none') selected.clear();
          else livePool(kind).forEach(it => selected.add(keyOf(it)));
          renderBody(root);
          return;
        }
        const chip = e.target.closest('[data-pick-item]');
        if (chip) {
          const k = chip.dataset.pickItem;
          if (selected.has(k)) selected.delete(k); else selected.add(k);
          chip.classList.toggle('on', selected.has(k));
          root.querySelector('#pick-count').textContent = selected.size;
        }
      });
    }
  });

  ui._pick = { target, selected, id, isList };
}

function applyPick() {
  const p = ui._pick;
  if (!p) return;
  const entity = p.isList ? getList(p.id) : getTemplate(p.id);
  if (!entity) { closeSheet(); return; }

  const poolNames = new Map();
  for (const pool of POOLS) for (const it of livePool(pool)) poolNames.set(pool + '|' + it.name, it.name);

  const removed = new Set();
  for (const pool of POOLS) {
    for (const it of livePool(pool)) {
      const k = pool + '|' + it.name;
      if (!p.selected.has(k)) removed.add(k);
    }
  }

  mutate(d => {
    const ent = (p.isList ? d.lists : d.templates).find(x => x.id === p.id);
    if (!ent) return;
    ent.items = ent.items.filter(it => !it.deleted && !removed.has(it.pool + '|' + it.name));
    for (const k of p.selected) {
      const [pool, name] = k.split('|');
      if (!ent.items.some(i => !i.deleted && i.pool === pool && i.name === name)) {
        ent.items.push(newItem(name, pool, p.isList ? false : undefined));
      }
    }
    ent.updatedAt = nowMs();
  });

  ui.pick = null;
  ui._pick = null;
  closeSheet();
  render();
  toast('已保存');
}

/* ================= 其它弹层 ================= */
function openSaveTpl(listId) {
  const l = getList(listId);
  if (!l) return;
  openSheet({
    title: '存为新模版',
    body: `<label class="field"><span>模版名称</span>
        <input id="st-name" type="text" value="${esc(l.name)}" placeholder="如：海边度假"></label>
      <p class="muted">将把当前清单的 ${liveItems(l).length} 件物品存入模版，方便下次一键套用。</p>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-save-tpl" data-id="${l.id}">保存</button>`
  });
  setTimeout(() => document.getElementById('st-name')?.focus(), 60);
}

function doSaveTpl(listId) {
  const l = getList(listId);
  if (!l) return;
  const name = (document.getElementById('st-name')?.value || '').trim() || l.name;
  const t = newTemplate(name, liveItems(l), l.id);
  mutate(d => { d.templates.push(t); });
  closeSheet();
  toast(`已存为模版「${name}」`);
}

function openUpdateTpl(listId) {
  const l = getList(listId);
  const tpls = liveTemplates();
  if (!l) return;
  if (!tpls.length) { toast('还没有模版，请先「存为模版」'); return; }
  openSheet({
    title: '更新已有模版',
    body: `<p class="muted" style="margin-bottom:12px">选择要覆盖的模版，将用当前清单的物品替换它。</p>
      <div class="card">${tpls.map(t => `<button class="row" data-action="do-update-tpl" data-list="${l.id}" data-tpl="${t.id}">
        <div class="row-main">
          <div class="row-title">${esc(t.name)}</div>
          <div class="row-sub"><span>${liveItems(t).length} 件物品</span></div>
        </div><span class="chev">›</span></button>`).join('')}</div>`,
    foot: `<button class="btn ghost" data-close>取消</button>`
  });
}

function doUpdateTpl(listId, tplId) {
  const l = getList(listId);
  const t = getTemplate(tplId);
  if (!l || !t) return;
  mutate(d => {
    const tt = d.templates.find(x => x.id === tplId);
    tt.items = liveItems(l).map(i => copyItem(i, false));
    tt.sourceListId = l.id;
    tt.updatedAt = nowMs();
  });
  closeSheet();
  toast(`已用当前清单更新「${t.name}」`);
}

function openDate(id) {
  const l = getList(id);
  if (!l) return;
  openSheet({
    title: '出发日期',
    body: `<label class="field"><span>留空表示不设日期</span>
        <input id="ed-date" type="date" value="${esc(l.date || '')}"></label>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-date" data-id="${id}">保存</button>`
  });
}

function openRenameList(id) {
  const l = getList(id);
  if (!l) return;
  openSheet({
    title: '重命名清单',
    body: `<label class="field"><span>名称</span>
        <input id="rn-name" type="text" value="${esc(l.name)}"></label>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-rename" data-id="${id}">保存</button>`
  });
}

function openRenameTpl(id) {
  const t = getTemplate(id);
  if (!t) return;
  openSheet({
    title: '重命名模版',
    body: `<label class="field"><span>名称</span>
        <input id="rt-name" type="text" value="${esc(t.name)}"></label>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-rename-tpl" data-id="${id}">保存</button>`
  });
}

function openTplFromList(id) {
  const tpls = liveLists();
  if (!tpls.length) { toast('还没有可用来更新的清单'); return; }
  openSheet({
    title: '从清单更新',
    body: `<p class="muted" style="margin-bottom:12px">选择一份清单，用它的物品覆盖当前模版。</p>
      <div class="card">${tpls.map(l => `<button class="row" data-action="do-tpl-from-list" data-id="${id}" data-list="${l.id}">
        <div class="row-main">
          <div class="row-title">${esc(l.name)}</div>
          <div class="row-sub"><span>${liveItems(l).length} 件物品</span></div>
        </div><span class="chev">›</span></button>`).join('')}</div>`,
    foot: `<button class="btn ghost" data-close>取消</button>`
  });
}

function openTplNewList(id) {
  const t = getTemplate(id);
  if (!t) return;
  const today = todayISO();
  openNewList({
    name: t.name,
    date: today,
    templateId: t.id,
    optionalIds: [],
    auto: true
  });
}

function openPoolEdit(pool, id) {
  const it = state.data.pools[pool].find(x => x.id === id && !x.deleted);
  if (!it) return;
  openSheet({
    title: '修改物品',
    body: `<label class="field"><span>名称</span>
        <input id="pe-name" type="text" value="${esc(it.name)}"></label>
        <div class="sec-label">所属池</div>
        <div class="seg" id="pe-seg">
          <button type="button" class="${pool === 'essential' ? 'active' : ''}" data-pe-pool="essential">必带</button>
          <button type="button" class="${pool === 'optional' ? 'active' : ''}" data-pe-pool="optional">选带</button>
        </div>`,
    foot: `<button class="btn ghost" data-close>取消</button>
           <button class="btn primary" data-action="do-pool-edit" data-id="${id}" data-pool="${pool}">保存</button>`,
    onMount(root) {
      root.querySelector('#pe-seg').addEventListener('click', e => {
        const b = e.target.closest('[data-pe-pool]');
        if (!b) return;
        root.querySelectorAll('#pe-seg button').forEach(x => x.classList.toggle('active', x === b));
      });
    }
  });
  setTimeout(() => document.getElementById('pe-name')?.focus(), 60);
}

/* ================= 动作分发 ================= */
export function handleAction(action, el) {
  const id = el.dataset.id;

  switch (action) {
    case 'new-list': openNewList({}); return;
    case 'new-template': openNewTemplate(); return;
    case 'do-new-template': createTemplate(); return;

    case 'open-list': go('#/list/' + id); return;
    case 'open-template': go('#/template/' + id); return;

    case 'filter':
      ui.filter = el.dataset.filter;
      render();
      return;

    case 'toggle-item': {
      const l = getList(ui.route.id);
      if (!l) return;
      const item = liveItems(l).find(i => i.id === id);
      if (!item) return;
      ui.qtyEdit = null;
      mutate(d => {
        const ll = d.lists.find(x => x.id === l.id);
        const ii = ll.items.find(x => x.id === id);
        ii.checked = !ii.checked;
        ii.updatedAt = nowMs();
        ll.updatedAt = nowMs();
      });
      const row = el.closest('.check-row');
      if (row) row.classList.toggle('done', item.checked);
      updateProgress(l.id);
      if (progressOf(l).complete) toast('全部打包完成！');
      return;
    }

    case 'quick-add': {
      const l = getList(id);
      const input = document.getElementById('quick-add-input');
      const name = (input?.value || '').trim();
      if (!l || !name) return;
      const pool = POOLS.find(p => livePool(p).some(i => i.name === name)) || 'optional';
      if (liveItems(l).some(i => i.pool === pool && i.name === name)) { toast('该物品已在清单中'); return; }
      mutate(d => {
        const ll = d.lists.find(x => x.id === id);
        ll.items.push(newItem(name, pool, false));
        ll.updatedAt = nowMs();
      });
      if (input) { input.value = ''; input.focus(); }
      render();
      return;
    }

    case 'list-del-item': {
      const l = getList(el.dataset.list);
      const item = l && liveItems(l).find(i => i.id === el.dataset.item);
      if (!l || !item) return;
      if (!confirmDialog(`删除「${item.name}」？`)) return;
      mutate(d => {
        const ll = d.lists.find(x => x.id === l.id);
        const it = ll && ll.items.find(x => x.id === el.dataset.item);
        if (it) { it.deleted = true; it.updatedAt = nowMs(); }
        if (ll) ll.updatedAt = nowMs();
      });
      ui.qtyEdit = null;
      render();
      toast(`已删除「${item.name}」`);
      return;
    }

    case 'qty-start': ui.qtyEdit = el.dataset.item; render(); return;
    case 'qty-done': ui.qtyEdit = null; render(); return;
    case 'qty-inc': bumpQty(el.dataset.list, el.dataset.item, 1); render(); return;
    case 'qty-dec': bumpQty(el.dataset.list, el.dataset.item, -1); render(); return;

    case 'open-pick': openPick(el.dataset.target); return;
    case 'pick-confirm': applyPick(); return;

    case 'reset-all': {
      const l = getList(id);
      if (!l) return;
      mutate(d => {
        const ll = d.lists.find(x => x.id === id);
        ll.items.forEach(i => { i.checked = false; i.updatedAt = nowMs(); });
        ll.updatedAt = nowMs();
      });
      ui.qtyEdit = null;
      render();
      toast('已全部重置');
      return;
    }

    case 'del-list': {
      const l = getList(id);
      if (!l) return;
      if (!confirmDialog(`删除清单「${l.name}」？`)) return;
      mutate(d => {
        const ll = d.lists.find(x => x.id === id);
        if (ll) { ll.deleted = true; ll.updatedAt = nowMs(); }
      });
      if (parseRoute().name === 'checklist') go('#/lists');
      else render();
      toast(`已删除「${l.name}」`);
      return;
    }

    case 'save-tpl': openSaveTpl(id); return;
    case 'do-save-tpl': doSaveTpl(id); return;
    case 'update-tpl': openUpdateTpl(id); return;
    case 'do-update-tpl': doUpdateTpl(el.dataset.list, el.dataset.tpl); return;
    case 'edit-date': openDate(id); return;
    case 'rename-list': openRenameList(id); return;
    case 'rename-tpl': openRenameTpl(id); return;
    case 'do-date': {
      const v = document.getElementById('ed-date')?.value || null;
      mutate(d => {
        const l = d.lists.find(x => x.id === id);
        if (l) { l.date = /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; l.updatedAt = nowMs(); }
      });
      closeSheet();
      render();
      toast('已保存');
      return;
    }
    case 'do-rename': {
      const name = (document.getElementById('rn-name')?.value || '').trim();
      if (!name) return;
      mutate(d => {
        const l = d.lists.find(x => x.id === id);
        if (l) { l.name = name; l.updatedAt = nowMs(); }
      });
      closeSheet();
      render();
      toast('已保存');
      return;
    }

    case 'save-preset': {
      const ess = livePool('essential').length;
      const opt = livePool('optional').length;
      if (ess + opt === 0) { toast('物品池是空的，先添加物品再保存'); return; }
      if (!confirmDialog(`把当前 ${ess + opt} 件物品存为预设？之后「恢复预置物品」会恢复到这份。`)) return;
      const n = saveAsPreset();
      toast(`已保存 ${n} 件预设物品`);
      return;
    }

    case 'pool-add': {
      const pool = el.dataset.pool;
      const input = document.querySelector(`[data-add-pool="${pool}"]`);
      const name = (input?.value || '').trim();
      if (!name) return;
      if (livePool(pool).some(i => i.name === name)) { toast('该物品已存在'); return; }
      const maxOrder = livePool(pool).reduce((m, i) => Math.max(m, i.order || 0), -1);
      mutate(d => {
        d.pools[pool].push(newPoolItem(name, maxOrder + 1));
        renumberPool(pool);
      });
      render();
      setTimeout(() => document.querySelector(`[data-add-pool="${pool}"]`)?.focus(), 0);
      return;
    }
    case 'pool-edit': openPoolEdit(el.dataset.pool, id); return;
    case 'pool-del': {
      const name = livePool(el.dataset.pool).find(x => x.id === id)?.name;
      if (!confirmDialog(`删除「${name}」？`)) return;
      mutate(d => {
        const it = d.pools[el.dataset.pool].find(x => x.id === id);
        if (it) { it.deleted = true; it.updatedAt = nowMs(); }
        renumberPool(el.dataset.pool);
      });
      render();
      toast(`已删除「${name}」`);
      return;
    }
    case 'do-pool-edit': {
      const name = (document.getElementById('pe-name')?.value || '').trim();
      if (!name) return;
      const fromPool = el.dataset.pool;
      const toPool = document.querySelector('#pe-seg .active')?.dataset.pePool || fromPool;
      mutate(d => {
        const arr = d.pools[fromPool];
        const i = arr.findIndex(x => x.id === id);
        if (i < 0) return;
        const it = arr[i];
        it.name = name;
        it.updatedAt = nowMs();
        if (toPool !== fromPool) {
          /* 原池必须留墓碑：合并是按池分别做的，
             直接移走的话，云端还留着旧记录，一合并就会把它加回来 */
          arr.splice(i, 1);
          arr.push({
            id: it.id, name: it.name, order: 0,
            updatedAt: nowMs(), deleted: true
          });
          d.pools[toPool].push(it);
          renumberPool(fromPool);
          renumberPool(toPool);
        }
      });
      closeSheet();
      render();
      toast(toPool === fromPool ? '已保存' : `已移到${POOL_LABEL[toPool]}`);
      return;
    }

    case 'tpl-del-item': {
      mutate(d => {
        const t = d.templates.find(x => x.id === id);
        if (!t) return;
        const i = t.items.find(x => x.id === el.dataset.item);
        if (i) { i.deleted = true; i.updatedAt = nowMs(); }
        t.updatedAt = nowMs();
      });
      render();
      return;
    }
    case 'del-tpl': {
      if (!confirmDialog('确定删除该模版？')) return;
      mutate(d => {
        const t = d.templates.find(x => x.id === id);
        if (t) { t.deleted = true; t.updatedAt = nowMs(); }
      });
      /* 已在模版列表页时 hash 不变，不会触发 hashchange，这里显式重绘 */
      if (parseRoute().name === 'template') go('#/templates');
      else render();
      toast('模版已删除');
      return;
    }
    case 'do-rename-tpl': {
      const name = (document.getElementById('rt-name')?.value || '').trim();
      if (!name) return;
      mutate(d => {
        const t = d.templates.find(x => x.id === id);
        if (t) { t.name = name; t.updatedAt = nowMs(); }
      });
      closeSheet();
      render();
      toast('已保存');
      return;
    }
    case 'tpl-update-from': openTplFromList(id); return;
    case 'do-tpl-from-list': {
      const l = getList(el.dataset.list);
      if (!l) return;
      mutate(d => {
        const t = d.templates.find(x => x.id === id);
        if (!t) return;
        t.items = liveItems(l).map(i => copyItem(i, false));
        t.sourceListId = l.id;
        t.updatedAt = nowMs();
      });
      closeSheet();
      render();
      toast('模版已更新');
      return;
    }
    case 'tpl-new-list': openTplNewList(id); return;
    case 'nl-create': createList(); return;

    case 'st-save': {
      const owner = (document.getElementById('st-owner')?.value || '').trim();
      const repo = (document.getElementById('st-repo')?.value || '').trim();
      const token = (document.getElementById('st-token')?.value || '').trim();
      const auto = document.getElementById('st-auto')?.checked !== false;
      state.config.owner = owner;
      state.config.repo = repo || 'travel-packing-data';
      state.config.token = token;
      state.config.autoSync = auto;
      saveConfig();
      render();
      toast(owner && repo && token ? '配置已保存' : '已保存（未填完整，暂不启用同步）');
      if (owner && repo && token) startAutoSync();
      return;
    }
    case 'st-test': {
      const owner = (document.getElementById('st-owner')?.value || '').trim();
      const repo = (document.getElementById('st-repo')?.value || '').trim();
      const token = (document.getElementById('st-token')?.value || '').trim();
      const box = document.getElementById('test-result');
      if (!owner || !repo || !token) { box.innerHTML = '<span class="err">请先填写用户名、仓库名和令牌</span>'; return; }
      const saved = { ...state.config };
      state.config.owner = owner; state.config.repo = repo; state.config.token = token;
      box.textContent = '测试中…';
      testRepo().then(() => { box.innerHTML = '<span class="ok">连接成功，仓库可访问</span>'; })
        .catch(e => { box.innerHTML = `<span class="err">${esc(e.message)}</span>`; })
        .finally(() => { state.config = saved; });
      return;
    }
    case 'st-sync': syncNow({ successToast: true }); return;
    case 'st-pull':
      pullOnly().then(ok => { if (ok) render(); });
      return;
    case 'st-push': syncNow({ successToast: true }); return;

    case 'export': {
      const blob = new Blob([exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'travel-packing-' + todayISO() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('已导出');
      return;
    }
    case 'import': document.getElementById('import-file')?.click(); return;
    case 'clear-preset': {
      if (!confirmDialog('回到内置预设？你存的自定义预设会被丢掉（物品池本身不受影响）。')) return;
      clearPreset();
      render();
      toast('已回到内置预设');
      return;
    }
    case 'restore-seed': {
      const n = restoreSeed();
      render();
      toast(`已恢复 ${n} 件预置物品`);
      return;
    }
    case 'clear': {
      if (!confirmDialog('清空本机数据？该操作不可撤销，建议先导出备份。')) return;
      clearLocal();
      render();
      toast('已清空本机数据');
      return;
    }
  }
}


/* ================= 物品池长按拖动 =================
   长按某个物品后它会脱离文档流跟着手指走，
   原位留一个虚线占位；松手时把占位换成它并提交顺序。 */
const LONG_PRESS = 250;   // 触发拖动的时长
const WATCHDOG = 6000;    // 无指针事件超过该时长则自动收尾，防止状态卡死

let poolDrag = null;      // 当前拖动，route 切换时也要能收尾

export function initPoolDrag(root) {
  let timer = null;
  let watchdog = null;

  const clearWatch = () => { clearTimeout(watchdog); watchdog = null; };

  const cancelPress = () => { clearTimeout(timer); timer = null; };

  /* 结束拖动并把顺序提交到数据 */
  const endDrag = (commit) => {
    const d = poolDrag;
    if (!d) return;
    const { chip, placeholder, list, pool, id } = d;
    clearWatch();
    poolDrag = null;
    /* 把拖动件放回占位处，清掉临时样式 */
    if (placeholder.parentNode) placeholder.parentNode.insertBefore(chip, placeholder);
    placeholder.remove();
    list.classList.remove('drag-active');
    chip.classList.remove('dragging');
    chip.removeAttribute('style');
    if (!commit) { render(); return; }
    const ids = [...list.querySelectorAll('.pool-chip')].map(c => c.dataset.id);
    movePoolItemTo(pool, id, ids.indexOf(id));
    render();
  };

  /* 路由切走或页面失焦时中断拖动，避免残留状态吞掉后续点击 */
  const abort = () => { if (poolDrag) endDrag(false); };

  root.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    /* 任何按下都先清掉上一轮的长按计时，避免旧计时器误触发 */
    cancelPress();
    const chip = e.target.closest('.pool-chip');
    if (!chip || e.target.closest('.x')) return;   // 删除按钮照常点
    const list = chip.closest('.pool-chips');
    if (!list || poolDrag) return;

    const sx = e.clientX, sy = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      if (poolDrag) return;
      const r = chip.getBoundingClientRect();

      const placeholder = chip.cloneNode(true);
      placeholder.classList.add('ph');
      placeholder.setAttribute('aria-hidden', 'true');
      chip.parentNode.insertBefore(placeholder, chip);

      chip.classList.add('dragging');
      chip.style.left = r.left + 'px';
      chip.style.top = r.top + 'px';
      chip.style.width = r.width + 'px';
      chip.style.height = r.height + 'px';
      document.body.appendChild(chip);

      list.classList.add('drag-active');
      poolDrag = { chip, placeholder, list, pool: chip.dataset.pool, id: chip.dataset.id, sx, sy };
      /* 看门狗：长时间收不到指针事件就自动收尾 */
      clearWatch();
      watchdog = setTimeout(() => endDrag(true), WATCHDOG);
      if (navigator.vibrate) navigator.vibrate(8);
    }, LONG_PRESS);
  });

  /* 拖动件已被移到 body 上，监听必须挂在 window 才不会漏事件 */
  window.addEventListener('pointermove', e => {
    if (!poolDrag) {
      if (timer) cancelPress();
      return;
    }
    e.preventDefault();
    const { chip, placeholder, list, sx, sy } = poolDrag;
    chip.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) scale(1.06)`;

    const target = nearest(list, e.clientX, e.clientY);
    if (target) {
      const r = target.getBoundingClientRect();
      const want = e.clientX < r.left + r.width / 2 ? target : target.nextSibling;
      if (want !== placeholder) list.insertBefore(placeholder, want);
    }
    /* 有活动就顺延看门狗 */
    clearWatch();
    watchdog = setTimeout(() => endDrag(true), WATCHDOG);
  }, { passive: false });

  const finish = () => { cancelPress(); endDrag(true); };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', abort);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') abort();
  });

  /* 供 render 在离开物品池页时调用 */
  initPoolDrag.abort = abort;

  /* 找距离指针最近的其它 chip（排除拖动件和占位） */
  function nearest(list, x, y) {
    let best = null, bestD = Infinity;
    for (const el of list.querySelectorAll('.pool-chip')) {
      if (el.classList.contains('dragging') || el.classList.contains('ph')) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
}

/* 数据层：模型、localStorage、预置数据 */

import { uuid, nowISO, nowMs } from './ui.js';

export const POOLS = ['essential', 'optional'];
export const POOL_LABEL = { essential: '必带', optional: '选带' };

const LS = { data: 'tp.data', config: 'tp.config', meta: 'tp.meta', preset: 'tp.preset' };
const SCHEMA = 1;

export const SEED = {
  essential: [
    '身份证',
    '充电宝（线）',
    '充电器（线）',
    '睡衣',
    '牙线',
    '枕头套',
    '蓝膜',
    '马桶套',
    '一次性杯子',
    '一次性浴巾',
    '一次性包头巾',
    '换洗衣物（内衣、袜子）',
    '洗澡拖鞋',
    '纸巾',
    '洗脸巾',
    '洗面奶',
    '湿巾（纯水、消毒）',
    '急救包（碘伏棒、邦迪）',
    '塑料袋（食品袋）',
    '梳子头绳',
    '剃须刀',
    '口罩',
    '钥匙'
  ],
  optional: [
    '护照',
    '电脑',
    '现金（银行卡）',
    '学生证',
    '吹风机',
    '常用药（烧敏泻）',
    '牙刷牙膏',
    '驱蚊水',
    '无比滴',
    '防晒霜',
    '沐浴分装',
    '墨镜',
    '冰袖',
    '肥皂',
    '矿泉水',
    '软水壶',
    '替换鞋子',
    '充饥食品',
    '床单套',
    '浴缸套',
    '多空插座（接线板）',
    '雨衣',
    '鞋套',
    '野餐垫',
    '室外拖鞋',
    '浮潜装备',
    '泳衣',
    '沙滩鞋',
    '凉衣绳',
    '大毛巾',
    '一次性面盆',
    '一次性短裤',
    '腰带',
    '洗澡篮子',
    '大水杯',
    '电解质粉',
    '耳塞',
    '指甲钳',
    '优盘'
  ]
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 忽略配额/隐私模式错误 */
  }
}

/* ---------- 清洗 ---------- */
function sanitizePool(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((it, idx) => ({
      id: (it && it.id) || uuid(),
      name: String((it && it.name) || '').trim(),
      order: Number.isFinite(it && it.order) ? it.order : idx,
      updatedAt: (it && it.updatedAt) || nowMs(),
      deleted: !!(it && it.deleted)
    }))
    .filter(it => it.name || it.deleted)
    .sort((a, b) => a.order - b.order);
}

function sanitizeItems(arr, withChecked) {
  return (Array.isArray(arr) ? arr : [])
    .map(it => {
      const o = {
        id: (it && it.id) || uuid(),
        name: String((it && it.name) || '').trim(),
        pool: (it && it.pool === 'essential') ? 'essential' : 'optional',
        qty: clampQty(it && it.qty),
        updatedAt: (it && it.updatedAt) || nowMs(),
        deleted: !!(it && it.deleted)
      };
      if (withChecked) o.checked = !!(it && it.checked);
      return o;
    })
    .filter(it => it.name || it.deleted);
}

/* 数量：整数，至少 1，上限 99 */
function clampQty(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 1) return 1;
  return Math.min(n, 99);
}
export { clampQty };

function sanitizeContainer(it, withChecked, withDate) {
  const now = nowISO();
  const o = {
    id: (it && it.id) || uuid(),
    name: String((it && it.name) || '').trim() || '未命名',
    items: sanitizeItems((it && it.items) || [], withChecked),
    createdAt: (it && it.createdAt) || now,
    updatedAt: (it && it.updatedAt) || now,
    deleted: !!(it && it.deleted)
  };
  if (withChecked) o.items.forEach(x => { x.checked = x.checked === true; });
  if (withDate) {
    const d = (it && it.date) || null;
    o.date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (!withChecked) o.sourceListId = (it && it.sourceListId) || null;
  return o;
}

export function sanitizeData(d) {
  const now = nowISO();
  return {
    schema: SCHEMA,
    updatedAt: (d && d.updatedAt) || now,
    pools: {
      essential: sanitizePool(d && d.pools && d.pools.essential),
      optional: sanitizePool(d && d.pools && d.pools.optional)
    },
    lists: (Array.isArray(d && d.lists) ? d.lists : []).map(l => sanitizeContainer(l, true, true)),
    templates: (Array.isArray(d && d.templates) ? d.templates : []).map(t => sanitizeContainer(t, false, false))
  };
}

/* 自定义预设：用户在物品池点「保存为预设物品」后生效，
   优先于内置 SEED；清掉它即回到内置预设 */
export function activeSeed() {
  const custom = readJSON(LS.preset, null);
  if (custom && Array.isArray(custom.essential) && Array.isArray(custom.optional)) {
    return {
      essential: custom.essential.map(String).map(s => s.trim()).filter(Boolean),
      optional: custom.optional.map(String).map(s => s.trim()).filter(Boolean)
    };
  }
  return SEED;
}

export function hasCustomPreset() {
  return !!readJSON(LS.preset, null);
}

/* 把当前两个池的内容存为预设，返回件数 */
export function saveAsPreset() {
  const preset = {
    essential: livePool('essential').map(i => i.name),
    optional: livePool('optional').map(i => i.name)
  };
  writeJSON(LS.preset, preset);
  return preset.essential.length + preset.optional.length;
}

/* 清掉自定义预设，回到内置 SEED */
export function clearPreset() {
  try { localStorage.removeItem(LS.preset); } catch (e) { /* 忽略 */ }
}

export function freshData() {
  const now = nowISO();
  const d = {
    schema: SCHEMA,
    updatedAt: now,
    pools: { essential: [], optional: [] },
    lists: [],
    templates: []
  };
  const seed = activeSeed();
  for (const p of POOLS) {
    d.pools[p] = seed[p].map((name, idx) => newPoolItem(name, idx));
  }
  return d;
}

/* ---------- 状态 ---------- */
export const state = {
  data: null,
  config: null,
  meta: null,
  dirty: false,
  /* 本机数据是否含历史乱码（旧版本解码 bug 造成）。为 true 时禁止同步，
     否则会把乱码推上去污染云端 */
  corrupt: false
};

function defaultConfig() {
  return {
    owner: '',
    repo: 'travel-packing-data',
    dataPath: 'data.json',
    token: '',
    autoSync: true,
    deviceId: uuid()
  };
}

function defaultMeta() {
  return { dirty: false, lastSyncAt: null, lastSyncSha: null, status: 'local' };
}

/* 旧版本解码 bug 会把中文变成 Ã¥Â 之类的乱码，特征很明显 */
const MOJIBAKE = /\uFFFD|[\u0080-\u009f]|[\u00c2\u00c3][\u0080-\u00bf]/;

export function looksCorrupt(obj) {
  try { return MOJIBAKE.test(JSON.stringify(obj)); } catch (e) { return false; }
}

export function loadData() {
  const stored = readJSON(LS.data, null);
  state.data = stored ? sanitizeData(stored) : freshData();
  state.config = Object.assign(defaultConfig(), readJSON(LS.config, {}));
  state.meta = Object.assign(defaultMeta(), readJSON(LS.meta, {}));
  state.dirty = !!state.meta.dirty;
  state.corrupt = looksCorrupt(state.data);
  if (!stored) saveData();
}

export function saveData() {
  writeJSON(LS.data, state.data);
}

export function saveConfig() {
  writeJSON(LS.config, state.config);
}

export function saveMeta() {
  writeJSON(LS.meta, state.meta);
}

/* 数据变更入口：写盘 + 标脏 + 交给上层调度同步 */
export function mutate(fn) {
  fn(state.data);
  state.data.updatedAt = nowMs();
  saveData();
  state.dirty = true;
  state.meta.dirty = true;
  saveMeta();
  if (typeof window !== 'undefined' && window.__scheduleSync) window.__scheduleSync();
}

export function markClean(sha) {
  state.dirty = false;
  state.meta.dirty = false;
  state.meta.lastSyncAt = nowISO();
  state.meta.lastSyncSha = sha;
  saveMeta();
}

/* ---------- 查询 ---------- */
export function getList(id) {
  return state.data.lists.find(l => l.id === id && !l.deleted);
}
export function getTemplate(id) {
  return state.data.templates.find(t => t.id === id && !t.deleted);
}
export function liveLists() {
  return state.data.lists.filter(l => !l.deleted);
}
export function liveTemplates() {
  return state.data.templates.filter(t => !t.deleted);
}
/* 物品池条目本身不带 pool 字段（靠所在数组区分），读取时补上，便于跨池使用 */
export function livePool(pool) {
  return state.data.pools[pool]
    .filter(i => !i.deleted)
    .map(i => ({
      id: i.id, name: i.name, order: i.order, updatedAt: i.updatedAt, deleted: i.deleted, pool
    }));
}
export function liveItems(entity) {
  return entity.items.filter(i => !i.deleted);
}
export function progressOf(list) {
  const items = liveItems(list);
  const total = items.length;
  const done = items.filter(i => i.checked).length;
  return {
    total, done,
    pct: total ? Math.round(done / total * 100) : 0,
    complete: total > 0 && done === total
  };
}

/* ---------- 构造 ---------- */
export function newPoolItem(name, order) {
  return {
    id: uuid(),
    name: String(name).trim(),
    order: Number.isFinite(order) ? order : Date.now(),
    updatedAt: nowMs(),
    deleted: false
  };
}

/* 把某件物品挪到该池存活项中的指定下标位置 */
export function movePoolItemTo(pool, id, toIndex) {
  mutate(() => {
    const arr = state.data.pools[pool];
    const live = arr.filter(x => !x.deleted);
    const from = live.findIndex(x => x.id === id);
    if (from < 0) return;
    const [it] = live.splice(from, 1);
    live.splice(Math.max(0, Math.min(toIndex, live.length)), 0, it);
    state.data.pools[pool] = [...live, ...arr.filter(x => x.deleted)];
    renumberPool(pool);
  });
}

/* 按当前数组顺序重新编号，并统一抬高 updatedAt，
   让另一台设备能通过合并感知到「顺序变了」。
   注意：不按 order 重排 —— 调用方已经把数组排成了目标顺序。 */
export function renumberPool(pool) {
  const now = nowMs();
  state.data.pools[pool]
    .filter(it => !it.deleted)
    .forEach((it, idx) => { it.order = idx; it.updatedAt = now; });
}

export function newItem(name, pool, checked, qty) {
  return {
    id: uuid(),
    name: String(name).trim(),
    pool: pool === 'essential' ? 'essential' : 'optional',
    qty: clampQty(qty == null ? 1 : qty),
    checked: !!checked,
    updatedAt: nowMs(),
    deleted: false
  };
}

/* 复制一份物品（保留数量），用于清单↔模版之间搬移 */
export function copyItem(it, checked) {
  return newItem(it.name, it.pool, !!checked, it.qty);
}

export function newTemplate(name, items, sourceListId) {
  const now = nowISO();
  return {
    id: uuid(),
    name: String(name).trim() || '未命名',
    items: (items || []).map(i => newItem(i.name, i.pool, false, i.qty)),
    sourceListId: sourceListId || null,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
}

export function newList(name, date, items, fromTemplateId) {
  const now = nowISO();
  return {
    id: uuid(),
    name: String(name).trim() || '我的行程',
    date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null,
    items: (items || []).map(i => newItem(i.name, i.pool, false, i.qty)),
    fromTemplateId: fromTemplateId || null,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
}

/* ---------- 恢复预置 / 导出导入 / 清空 ---------- */
/* 恢复预置：清空两个池，按当前生效的预设重新填入 */
export function restoreSeed() {
  const seed = activeSeed();
  mutate(d => {
    for (const p of POOLS) {
      const now = nowMs();
      d.pools[p].forEach(it => { if (!it.deleted) { it.deleted = true; it.updatedAt = now; } });
      seed[p].forEach((name, idx) => { d.pools[p].push(newPoolItem(name, idx)); });
      renumberPool(p);
    }
  });
  return seed.essential.length + seed.optional.length;
}

export function exportJson() {
  return JSON.stringify(state.data, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  const next = sanitizeData(parsed);
  state.data = next;
  saveData();
  state.dirty = true;
  state.meta.dirty = true;
  saveMeta();
  if (window.__scheduleSync) window.__scheduleSync();
}

export function clearLocal() {
  const d = freshData();
  d.pools = { essential: [], optional: [] };
  state.data = d;
  saveData();
  state.dirty = true;
  state.meta.dirty = true;
  saveMeta();
  if (window.__scheduleSync) window.__scheduleSync();
}

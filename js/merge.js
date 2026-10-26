/* 多设备合并：实体级 + 条目级 LWW，配墓碑传播删除 */

function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return ((a.updatedAt || 0) >= (b.updatedAt || 0)) ? a : b;
}

/* 按 id 合并实体数组；deleted 标记靠 updatedAt 更新的一侧获胜 */
function mergeEntities(a, b) {
  const map = new Map();
  for (const e of a || []) map.set(e.id, e);
  for (const e of b || []) {
    const cur = map.get(e.id);
    map.set(e.id, pickNewer(cur, e));
  }
  return [...map.values()];
}

/*
 * 条目合并：先按 id 取较新的一份，再按「较新容器的顺序优先、另一侧新增项追加」
 * 保持用户看到的排序大体稳定，同时两边各自新增的物品都不会丢。
 */
function mergeItems(oldSide, newSide) {
  const byId = new Map();
  for (const e of oldSide || []) byId.set(e.id, e);
  for (const e of newSide || []) {
    const cur = byId.get(e.id);
    byId.set(e.id, pickNewer(cur, e));
  }
  const seen = new Set();
  const out = [];
  for (const e of newSide || []) {
    if (byId.has(e.id) && !seen.has(e.id)) { out.push(byId.get(e.id)); seen.add(e.id); }
  }
  for (const e of oldSide || []) {
    if (byId.has(e.id) && !seen.has(e.id)) { out.push(byId.get(e.id)); seen.add(e.id); }
  }
  return out;
}

function mergeContainer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = pickNewer(a, b);
  const older = newer === a ? b : a;
  const merged = Object.assign({}, newer, {
    items: mergeItems(older.items || [], newer.items || [])
  });
  /* 标量字段取较新一侧；若较新的一侧是墓碑，容器整体删除 */
  merged.deleted = !!newer.deleted;
  merged.updatedAt = newer.updatedAt;
  return merged;
}

function mergeCollection(aArr, bArr, byContainer, byOrder) {
  const map = new Map();
  for (const e of aArr || []) map.set(e.id, e);
  for (const e of bArr || []) {
    const cur = map.get(e.id);
    map.set(e.id, byContainer ? mergeContainer(cur, e) : pickNewer(cur, e));
  }
  const out = [...map.values()];
  if (byOrder) out.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.updatedAt || 0) - (b.updatedAt || 0));
  return out;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* 返回 { data, localChanged, remoteChanged } */
export function mergeData(local, remote) {
  if (!remote) return { data: local, localChanged: false, remoteChanged: false };
  if (!local) return { data: remote, localChanged: true, remoteChanged: false };

  const merged = {
    schema: local.schema || remote.schema || 1,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    pools: {
      essential: mergeCollection(local.pools.essential, remote.pools.essential, false, true),
      optional: mergeCollection(local.pools.optional, remote.pools.optional, false, true)
    },
    lists: mergeCollection(local.lists, remote.lists, true),
    templates: mergeCollection(local.templates, remote.templates, true)
  };

  return {
    data: merged,
    localChanged: !same(merged, local),
    remoteChanged: !same(merged, remote)
  };
}

/* 90 天以上的墓碑清理，避免数据无限膨胀 */
export function pruneTombstones(data, olderThanMs = 90 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - olderThanMs;
  const keep = arr => (arr || []).filter(e => !(e.deleted && (e.updatedAt || 0) < cutoff));
  return {
    schema: data.schema,
    updatedAt: data.updatedAt,
    pools: { essential: keep(data.pools.essential), optional: keep(data.pools.optional) },
    lists: keep(data.lists),
    templates: keep(data.templates)
  };
}

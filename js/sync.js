/* GitHub 同步：Contents API 读写私有仓库的 data.json */

import { state, sanitizeData, saveData, markClean, saveMeta } from './store.js';
import { mergeData, pruneTombstones } from './merge.js';
import { toast } from './ui.js';

const API = 'https://api.github.com';
const API_MSG = {
  401: '令牌无效或已过期，请到 GitHub 重新生成',
  403: '请求被拒绝（权限不足或请求过于频繁）',
  404: '仓库不存在或令牌无权访问',
  409: '云端数据刚被改动，已自动重试',
  422: '云端数据刚被改动，已自动重试'
};

let syncing = false;
let syncTimer = null;
let retryTimer = null;
let retryDelay = 5000;
const listeners = new Set();

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status, extra) {
  state.meta.status = status;
  saveMeta();
  listeners.forEach(fn => fn(status, extra));
}

function err(msg, status) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

export function configured() {
  const c = state.config;
  return !!(c && c.owner && c.repo && c.token);
}

function headers() {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (state.config.token) h['Authorization'] = 'Bearer ' + state.config.token;
  return h;
}

function contentsPath() {
  const c = state.config;
  return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeURIComponent(c.dataPath || 'data.json')}`;
}

async function api(path, opts = {}) {
  let resp;
  try {
    resp = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers(),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) {
    throw err('网络不可用，请检查网络连接');
  }
  if (resp.ok) return resp.json();
  throw err(API_MSG[resp.status] || `请求失败 (${resp.status})`, resp.status);
}

async function fetchRemote() {
  let j;
  try {
    j = await api(contentsPath());
  } catch (e) {
    if (e.status === 404) return { notFound: true, sha: null, data: null };
    throw e;
  }
  if (!j.content) throw err('云端文件过大，无法读取');
  let data;
  try {
    data = sanitizeData(JSON.parse(atob(String(j.content).replace(/\s+/g, ''))));
  } catch (e) {
    throw err('云端数据格式异常');
  }
  return { notFound: false, sha: j.sha, data };
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function pushRemote(data, sha) {
  const body = {
    message: '同步行李清单数据',
    content: utf8ToBase64(JSON.stringify(data, null, 2))
  };
  if (sha) body.sha = sha;
  const j = await api(contentsPath(), { method: 'PUT', body });
  return j.content.sha;
}

function serialize(d) {
  return JSON.stringify(pruneTombstones(d));
}

/* 主流程：拉取 → 合并 → 落地 → 需要时推送 */
async function doSync({ successToast = false, quiet = false } = {}) {
  if (!configured() || syncing) return;
  syncing = true;
  emit('syncing');
  try {
    const remote = await fetchRemote();
    const local = state.data;
    const { data: merged, localChanged, remoteChanged } = mergeData(local, remote.data);

    if (localChanged) {
      state.data = sanitizeData(merged);
      saveData();
    }

    let newSha = remote.sha;
    if (remote.notFound || remoteChanged) {
      newSha = await pushRemote(state.data, remote.notFound ? undefined : remote.sha);
    }

    markClean(newSha);
    retryDelay = 5000;
    emit('ok');
    if (successToast) toast('同步成功');
  } catch (e) {
    if (!navigator.onLine) {
      emit('offline');
      if (!quiet) toast('离线，恢复网络后会自动同步');
    } else {
      emit('error', e.message);
      if (!quiet) toast(e.message);
      retryTimer = setTimeout(() => {
        doSync({ quiet: true });
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 120000);
    }
  } finally {
    syncing = false;
  }
}

/* 变更后防抖推送 */
export function scheduleSync() {
  if (!configured() || !state.config.autoSync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync({ quiet: true }), 5000);
}

export function syncNow(opts) {
  clearTimeout(syncTimer);
  clearTimeout(retryTimer);
  return doSync(opts || {});
}

export async function testRepo() {
  await api(`/repos/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}`);
  const remote = await fetchRemote();
  return { hasRemote: !remote.notFound };
}

export async function pullOnly() {
  if (!configured()) return;
  syncing = true;
  emit('syncing');
  try {
    const remote = await fetchRemote();
    if (remote.notFound) throw err('云端还没有数据');
    const { data: merged, localChanged } = mergeData(state.data, remote.data);
    if (localChanged) {
      state.data = sanitizeData(merged);
      saveData();
    }
    markClean(remote.sha);
    emit('ok');
    toast('已拉取云端数据');
    return true;
  } catch (e) {
    emit(navigator.onLine ? 'error' : 'offline', e.message);
    toast(e.message);
    return false;
  } finally {
    syncing = false;
  }
}

export function startAutoSync() {
  if (!configured()) return;
  doSync({ quiet: true });

  window.addEventListener('online', () => {
    clearTimeout(retryTimer);
    doSync({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !syncing) {
      doSync({ quiet: true });
    }
  });
  window.addEventListener('beforeunload', () => {
    /* 页面卸载时尽力而为地推送，不保证成功 */
    if (state.dirty && configured()) {
      const body = JSON.stringify(state.data, null, 2);
      try {
        navigator.sendBeacon?.(
          API + contentsPath(),
          new Blob([JSON.stringify({
            message: '同步行李清单数据',
            content: utf8ToBase64(body),
            sha: state.meta.lastSyncSha || undefined
          })], { type: 'application/json' })
        );
      } catch (e) { /* 忽略 */ }
    }
  });
}

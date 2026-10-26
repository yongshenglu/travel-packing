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

/* 本机数据含历史乱码时禁止同步，否则会把乱码推上去污染云端 */
export function corruptBlocked() {
  return !!state.corrupt;
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

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/* atob 给出的是「每字符一个字节」的二进制串，不是 UTF-8 文本。
   必须先还原成字节再用 TextDecoder 解码，否则中文会变成乱码。 */
function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/* 旧版本直接把 atob 的结果当文本用了，中文每同步一轮就再劣化一次。
   这里反复按「字符码当字节再解 UTF-8」反解，直到能正常解析。 */
const MOJIBAKE = /\uFFFD|[\u0080-\u009f]|[\u00c2\u00c3][\u0080-\u00bf]/;

function parseCloudJson(text) {
  for (let i = 0; i <= 3; i++) {
    if (!MOJIBAKE.test(text)) {
      try { return JSON.parse(text); } catch (e) { /* 下面尝试反解 */ }
    }
    const bytes = new Uint8Array(text.length);
    for (let j = 0; j < text.length; j++) bytes[j] = text.charCodeAt(j) & 0xff;
    const next = new TextDecoder('utf-8').decode(bytes);
    if (next === text) break;
    text = next;
  }
  throw err('云端数据格式异常');
}

async function fetchRemote() {
  let meta;
  try {
    meta = await api(contentsPath());
  } catch (e) {
    if (e.status === 404) return { notFound: true, sha: null, data: null };
    throw e;
  }

  let text;
  if (meta.content) {
    text = base64ToUtf8(String(meta.content).replace(/\s+/g, ''));
  } else {
    const resp = await fetch(API + contentsPath(), {
      headers: Object.assign({}, headers(), { 'Accept': 'application/vnd.github.raw' })
    });
    if (!resp.ok) throw err(API_MSG[resp.status] || `请求失败 (${resp.status})`, resp.status);
    text = await resp.text();
  }

  let data;
  try {
    data = sanitizeData(parseCloudJson(text));
  } catch (e) {
    throw e.status ? e : err('云端数据格式异常');
  }
  return { notFound: false, sha: meta.sha, data };
}

async function pushRemote(data, sha) {
  /* 推送前丢掉过期墓碑，否则删除记录会把文件越撑越大 */
  const body = {
    message: '同步行李清单数据',
    content: utf8ToBase64(JSON.stringify(pruneTombstones(data), null, 2))
  };
  if (sha) body.sha = sha;
  const j = await api(contentsPath(), { method: 'PUT', body });
  return j.content.sha;
}

/* 主流程：拉取 → 合并 → 落地 → 需要时推送 */
async function doSync({ successToast = false, quiet = false } = {}) {
  if (!configured() || syncing) return;
  if (corruptBlocked()) {
    emit('error', '本机数据有乱码，同步已暂停');
    if (!quiet) toast('本机数据含旧版乱码，已暂停同步以免污染云端');
    return;
  }
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
  if (!configured() || corruptBlocked()) return;
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

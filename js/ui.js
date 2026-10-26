/* 通用工具：转义、提示、弹层、日期格式化 */

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

export function nowMs() {
  return Date.now();
}

/* 5月1日 */
export function fmtCNDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[2]}月${+m[3]}日` : (iso || '');
}

/* 4月20日 */
export function fmtCNStamp(msOrIso) {
  const d = new Date(msOrIso);
  if (isNaN(d)) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/* 10月22日 14:32 */
export function fmtCNStampTime(msOrIso) {
  const d = new Date(msOrIso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}

/* ---------- 弹层 ---------- */
const SHEET_SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

let sheetHandler = null;

export function openSheet({ title, body, foot, onMount }) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `
    <div class="sheet-mask" data-close></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <h3>${esc(title)}</h3>
        <button class="sheet-close" data-close aria-label="关闭">${SHEET_SVG_X}</button>
      </div>
      <div class="sheet-body">${body || ''}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  root.classList.add('open');
  sheetHandler = onMount || null;
  if (sheetHandler) sheetHandler(root);
  return root;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  root.classList.remove('open');
  root.innerHTML = '';
  sheetHandler = null;
}

export function sheetIsOpen() {
  return document.getElementById('sheet-root').classList.contains('open');
}

/* 弹层内统一事件：data-close 关闭，其它交给 onMount 绑定 */
document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) closeSheet();
});

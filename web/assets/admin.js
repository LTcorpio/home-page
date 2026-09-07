/* home-page 管理后台：分组 / 卡片 / 设置 / 导入 */

const el = (id) => document.getElementById(id);
const state = { groups: [], items: [], settings: {}, features: {} };

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch (e) { /* 非 JSON 直接用文本 */ }
    throw new Error(msg);
  }
  return res.json();
}

const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (path, body) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = (path) => api(path, { method: 'DELETE' });

/* ------------------------------------------------------------ 数据加载 */

async function reload() {
  const [board, items] = await Promise.all([api('/api/board'), api('/api/items')]);
  state.groups = board.groups.map((g) => ({ id: g.id, name: g.name, sort: g.sort }));
  state.items = items;
  state.settings = board.settings || {};
  state.features = board.features || {};
  const running = state.items.filter((it) => !it.hidden).length;
  el('countChip').textContent = `${state.groups.length} 个分组 · ${state.items.length} 张卡片 · ${running} 启用`;
  renderAll();
}

function groupName(id) {
  const g = state.groups.find((x) => x.id === id);
  return g ? g.name : '未分组';
}

/* 操作栏 SVG 图标（stroke 风格，14px） */
const I = {
  up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  enable: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  disable: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
};

function applyBg() {
  const bg = state.settings.background_image || '';
  const wp = el('wallpaper');
  if (bg) {
    wp.classList.add('has-image');
    wp.style.background = `url(${bg}) no-repeat center/cover`;
  } else {
    wp.classList.remove('has-image');
    wp.style.background = '';
  }
}

/* ------------------------------------------------------------ 分组 */

function renderGroups() {
  const box = el('groupList');
  if (!state.groups.length) {
    box.innerHTML = `<div class="empty">还没有分组，先在上方新建一个</div>`;
    return;
  }
  box.innerHTML = `<h3>分组列表（${state.groups.length}）</h3>` + state.groups.map((g, i) => {
    const total = state.items.filter((it) => it.group_id === g.id).length;
    const enabled = state.items.filter((it) => it.group_id === g.id && !it.hidden).length;
    return `<div class="row">
      <div class="grow">
        <div style="font-weight:600">${escapeHTML(g.name)} <span class="badge ${enabled ? 'on' : 'off'}">${enabled} 启用</span></div>
        <div class="sub">共 ${total} 张卡片</div>
      </div>
      <button class="btn mini" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
      <button class="btn mini" data-act="down" data-i="${i}" ${i === state.groups.length - 1 ? 'disabled' : ''}>下移</button>
      <button class="btn mini" data-act="rename" data-i="${i}">重命名</button>
      <button class="btn mini danger" data-act="del" data-i="${i}">删除</button>
    </div>`;
  }).join('');

  box.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.i);
      const g = state.groups[i];
      if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        const ids = state.groups.map((x) => x.id);
        const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await post('/api/groups/sort', { ids });
        await reload();
      } else if (btn.dataset.act === 'rename') {
        const name = prompt('新的分组名', g.name);
        if (name && name.trim()) {
          await put(`/api/groups/${g.id}`, { name: name.trim(), sort: g.sort });
          await reload();
        }
      } else if (btn.dataset.act === 'del') {
        const n = state.items.filter((it) => it.group_id === g.id).length;
        if (!confirm(`删除分组「${g.name}」？${n ? `该分组下 ${n} 张卡片会一并删除。` : ''}`)) return;
        await del(`/api/groups/${g.id}`);
        await reload();
      }
    });
  });
}

/* ------------------------------------------------------------ 卡片 */

function renderItems() {
  const filter = el('filterGroup').value;
  const list = state.items.filter((it) => filter === 'all' || String(it.group_id) === filter);
  const tbody = el('itemList');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-faint);padding:28px 0">没有卡片</td></tr>`;
    return;
  }
  // 分组内顺序（含禁用项），决定上移/下移是否可用
  const inGroup = (gid) => state.items.filter((x) => x.group_id === gid);
  tbody.innerHTML = list.map((it) => {
    const grp = inGroup(it.group_id);
    const pos = grp.findIndex((x) => x.id === it.id);
    return `
    <tr class="${it.hidden ? 'row-off' : ''}">
      <td>${iconThumb(it)}</td>
      <td>
        <div class="cell-name">${escapeHTML(it.name)}</div>
        <div class="cell-tags">${it.memo ? '<span class="tag">备忘</span>' : ''}${it.hidden ? '<span class="tag">已禁用</span>' : ''}</div>
      </td>
      <td class="cell-addr">
        <div class="u" title="${escapeHTML(it.url || '')}">${escapeHTML(it.url || '—')}</div>
        ${it.lan_url ? `<div class="l" title="${escapeHTML(it.lan_url)}">↳ ${escapeHTML(it.lan_url)}</div>` : ''}
      </td>
      <td class="no-wrap">${escapeHTML(groupName(it.group_id))}</td>
      <td class="no-wrap">${it.container_name ? `<span class="mono">${escapeHTML(it.container_name)}</span>` : '<span class="sub">—</span>'}</td>
      <td class="no-wrap" style="text-align:right">
        <button class="btn icon" data-move="${it.id}:up" title="上移" ${pos === 0 ? 'disabled' : ''}>${I.up}</button>
        <button class="btn icon" data-move="${it.id}:down" title="下移" ${pos === grp.length - 1 ? 'disabled' : ''}>${I.down}</button>
        <button class="btn icon ${it.hidden ? '' : 'warn'}" data-toggle="${it.id}" title="${it.hidden ? '启用此卡片' : '禁用此卡片'}">${it.hidden ? I.enable : I.disable}</button>
        <button class="btn icon" data-edit="${it.id}" title="编辑">${I.edit}</button>
        <button class="btn icon danger" data-del="${it.id}" title="删除">${I.del}</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const [id, dir] = b.dataset.move.split(':');
    moveItem(Number(id), dir === 'up' ? -1 : 1);
  }));
  tbody.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const it = state.items.find((x) => x.id === Number(b.dataset.toggle));
    await put(`/api/items/${it.id}`, { ...it, hidden: !it.hidden });
    await reload();
    toast(it.hidden ? '已禁用' : '已启用');
  }));
  tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(Number(b.dataset.edit))));
  tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const it = state.items.find((x) => x.id === Number(b.dataset.del));
    if (!confirm(`删除卡片「${it.name}」？`)) return;
    await del(`/api/items/${it.id}`);
    await reload();
  }));
}

// 在所属分组内上移/下移
async function moveItem(id, dir) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const grp = state.items.filter((x) => x.group_id === it.group_id);
  const i = grp.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= grp.length) return;
  [grp[i], grp[j]] = [grp[j], grp[i]];
  await post('/api/items/sort', { group_id: it.group_id, ids: grp.map((x) => x.id) });
  await reload();
}

function iconThumb(it) {
  const text = it.icon_type === 'text' && it.icon_value ? it.icon_value : (it.name || '?').trim().charAt(0) || '?';
  if (it.icon_type === 'upload' && it.icon_value)
    return `<span class="thumb"><img src="/icons/${encodeURIComponent(it.icon_value)}" alt="" /></span>`;
  if (it.icon_type === 'auto' && it.url)
    return `<span class="thumb"><img src="/api/icons/proxy?url=${encodeURIComponent(it.url)}" alt="" onerror="this.parentElement.textContent='${escapeHTML(text)}'" /></span>`;
  return `<span class="thumb">${escapeHTML(text)}</span>`;
}

function renderFilter() {
  const cur = el('filterGroup').value || 'all';
  el('filterGroup').innerHTML = `<option value="all">全部分组（${state.items.length}）</option>`
    + state.groups.map((g) => `<option value="${g.id}">${escapeHTML(g.name)}（${state.items.filter((it) => it.group_id === g.id).length}）</option>`).join('');
  el('filterGroup').value = cur && [...el('filterGroup').options].some((o) => o.value === cur) ? cur : 'all';
  el('fGroup').innerHTML = state.groups.map((g) => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
}

/* ------------------------------------------------------------ 弹窗 */

let editing = null;
let pendingIcon = null; // { icon_type, icon_value }

function openModal(id) {
  editing = id ? state.items.find((x) => x.id === id) : null;
  el('modalTitle').textContent = editing ? '编辑卡片' : '新增卡片';
  el('fId').value = editing ? editing.id : '';
  el('fName').value = editing ? editing.name : '';
  el('fUrl').value = editing ? editing.url : '';
  el('fLanUrl').value = editing ? editing.lan_url || '' : '';
  el('fDesc').value = editing ? editing.description : '';
  el('fGroup').value = editing ? String(editing.group_id) : (state.groups[0] ? String(state.groups[0].id) : '0');
  el('fStatus').value = editing && editing.hidden ? '0' : '1';
  el('fIconType').value = editing ? editing.icon_type || 'auto' : 'auto';
  el('fIconText').value = editing && editing.icon_type === 'text' ? editing.icon_value : '';
  el('fContainer').value = editing ? editing.container_name : '';
  el('fProbe').value = editing && !editing.probe ? '0' : '1';
  el('fAcl').value = editing ? editing.acl : '';
  el('fMemo').value = editing ? editing.memo || '' : '';
  pendingIcon = null;
  syncIconRows();
  updateIconPreview();
  el('mask').classList.add('show');
}

function closeModal() { el('mask').classList.remove('show'); }

function iconOf(editingOrNull) {
  if (pendingIcon) return pendingIcon;
  if (editing) return { icon_type: editing.icon_type || 'auto', icon_value: editing.icon_value || '' };
  return { icon_type: 'auto', icon_value: '' };
}

function updateIconPreview() {
  const box = el('iconPreviewBox');
  const it = { ...(editing || {}), ...iconOf(editing) };
  const url = it.url || '';
  let html = '<span class="sub" style="font-size:11px">—</span>';
  if (it.icon_type === 'upload' && it.icon_value) {
    html = `<img src="/icons/${encodeURIComponent(it.icon_value)}" alt="" />`;
  } else if (it.icon_type === 'auto' && url) {
    html = `<img src="/api/icons/proxy?url=${encodeURIComponent(url)}" alt="" onerror="this.style.display='none'" />`;
  } else {
    const t = it.icon_type === 'text' && it.icon_value ? it.icon_value : (it.name || '?').charAt(0) || '?';
    html = `<span style="color:#fff;font-size:14px">${escapeHTML(t)}</span>`;
  }
  box.innerHTML = html;
}

function syncIconRows() {
  const t = el('fIconType').value;
  el('uploadRow').style.display = t === 'upload' ? '' : 'none';
  el('iconTextRow').style.display = t === 'text' ? '' : 'none';
  updateIconPreview();
}

async function saveModal() {
  const iconType = el('fIconType').value;
  let iconTypeFinal = iconType;
  let iconValue = '';
  if (iconType === 'upload' && pendingIcon && pendingIcon.icon_type === 'upload') {
    iconValue = pendingIcon.icon_value;
  } else if (iconType === 'upload' && editing && editing.icon_type === 'upload') {
    iconValue = editing.icon_value;
  } else if (iconType === 'text') {
    iconValue = el('fIconText').value.trim();
  }
  if (iconType === 'auto') { iconTypeFinal = 'auto'; iconValue = ''; }
  const payload = {
    name: el('fName').value.trim(),
    url: el('fUrl').value.trim(),
    lan_url: el('fLanUrl').value.trim(),
    description: el('fDesc').value.trim(),
    group_id: Number(el('fGroup').value || 0),
    icon_type: iconTypeFinal,
    icon_value: iconValue,
    container_name: el('fContainer').value.trim(),
    probe: el('fProbe').value === '1',
    hidden: el('fStatus').value === '0',
    acl: el('fAcl').value.trim(),
    memo: el('fMemo').value.trim(),
    sort: editing ? editing.sort : 999,
  };
  if (!payload.name) { toast('名称不能为空'); return; }
  try {
    if (editing) await put(`/api/items/${editing.id}`, payload);
    else await post('/api/items', payload);
    closeModal();
    await reload();
    toast('已保存');
  } catch (e) {
    toast('保存失败: ' + e.message);
  }
}

/* ------------------------------------------------------------ 设置 */

function renderSettings() {
  const s = state.settings;
  el('setTitle').value = s.site_title || '';
  el('setBg').value = s.background_image || '';
  el('setMask').value = s.background_mask ?? 0;
  el('setBlur').value = s.background_blur ?? 2;
  el('setMaxWidth').value = s.max_width || 1200;
  el('setDocker').value = s.docker_enabled === '0' ? '0' : '1';
  el('setShowDisabled').value = s.show_disabled === '1' ? '1' : '0';
  el('setInterval').value = s.probe_interval || 20;
  const b = el('dockerBadge');
  b.textContent = state.features.docker ? 'Docker 已就绪' : 'Docker 未启用';
  b.className = 'badge ' + (state.features.docker ? 'on' : 'off');
}

async function saveSettings() {
  await put('/api/settings', {
    site_title: el('setTitle').value.trim() || 'Home',
    background_image: el('setBg').value.trim(),
    background_mask: el('setMask').value,
    background_blur: el('setBlur').value,
    max_width: el('setMaxWidth').value,
    docker_enabled: el('setDocker').value,
    show_disabled: el('setShowDisabled').value,
    probe_interval: el('setInterval').value,
  });
  await reload();
  toast('设置已保存');
}

/* ------------------------------------------------------------ 事件绑定 */

function bind() {
  document.querySelectorAll('.sidebar button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.sidebar button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    el('panel-' + b.dataset.tab).classList.add('active');
  }));

  el('addGroup').addEventListener('click', async () => {
    const name = el('newGroupName').value.trim();
    if (!name) { toast('请输入分组名'); return; }
    await post('/api/groups', { name });
    el('newGroupName').value = '';
    await reload();
  });

  el('filterGroup').addEventListener('change', renderItems);
  el('addItem').addEventListener('click', () => openModal(null));
  el('modalCancel').addEventListener('click', closeModal);
  el('modalSave').addEventListener('click', saveModal);
  el('fIconType').addEventListener('change', syncIconRows);
  el('fName').addEventListener('input', updateIconPreview);
  el('fIconText').addEventListener('input', updateIconPreview);
  // 弹窗仅通过「保存 / 取消」关闭，点击遮罩不会关闭，避免误触丢失已编辑内容
  el('saveSettings').addEventListener('click', () => saveSettings().catch((e) => toast('保存失败: ' + e.message)));

  // 图标：本地上传
  el('doUpload').addEventListener('click', () => el('fIconFile').click());
  el('fIconFile').addEventListener('change', async () => {
    const f = el('fIconFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/icons/upload', { method: 'POST', body: fd });
    if (!res.ok) { toast('上传失败'); return; }
    const data = await res.json();
    pendingIcon = { icon_type: 'upload', icon_value: data.icon_value };
    el('fIconType').value = 'upload';
    syncIconRows();
    toast('图标已上传，保存后生效');
  });

  // 图标：抓取 favicon
  el('doFetch').addEventListener('click', async () => {
    const url = el('fUrl').value.trim();
    if (!url) { toast('请先填写地址'); return; }
    try {
      const data = await post('/api/icons/fetch', { url, item_id: editing ? editing.id : 0 });
      pendingIcon = { icon_type: 'upload', icon_value: data.icon_value };
      el('fIconType').value = 'upload';
      syncIconRows();
      toast('favicon 已抓取，保存后生效');
    } catch (e) {
      toast('抓取失败: ' + e.message);
    }
  });

  // 壁纸
  el('bgUpload').addEventListener('click', () => el('setBgFile').click());
  el('setBgFile').addEventListener('change', async () => {
    const f = el('setBgFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/icons/upload', { method: 'POST', body: fd });
    if (!res.ok) { toast('壁纸上传失败'); return; }
    const data = await res.json();
    el('setBg').value = data.icon_url;
    toast('壁纸已上传，保存设置后生效');
  });

}

function renderAll() {
  applyBg();
  renderFilter();
  renderGroups();
  renderItems();
  renderSettings();
}

(async function boot() {
  bind();
  try {
    await reload();
  } catch (e) {
    toast('加载失败: ' + e.message);
  }
})();

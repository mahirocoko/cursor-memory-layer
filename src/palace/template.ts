// The page script avoids backticks and "${" so it can live in this template literal.
export const PALACE_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cursor Memory Palace</title>
<link rel="icon" href="data:,">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfaf7; --panel: #ffffff; --ink: #1d1d1f; --muted: #6b6b70; --line: #e4e2dc;
    --accent: #5b4bdb; --add: #1f7a3a; --del: #b42318; --addbg: #e8f5ec; --delbg: #fdecea; --tag: #f1efe9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151517; --panel: #1d1d20; --ink: #ececef; --muted: #9a9aa2; --line: #2e2e33;
      --accent: #a99cff; --add: #6fd08c; --del: #ff8a80; --addbg: #16301f; --delbg: #3a1c1a; --tag: #26262b;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
  header { padding: 20px 28px 12px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
  nav { display: flex; gap: 4px; padding: 10px 28px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  nav button { border: 0; background: none; color: var(--muted); padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
  nav button.active { background: var(--tag); color: var(--ink); }
  main { padding: 20px 28px 60px; }
  .split { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 20px; }
  .list { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: auto; max-height: 75vh; }
  .item { padding: 8px 12px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .item:last-child { border-bottom: 0; }
  .item.active { background: var(--tag); }
  .item .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .item .desc { color: var(--muted); font-size: 12px; }
  .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 16px; min-height: 200px; }
  pre { white-space: pre-wrap; word-break: break-word; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; }
  .tag { display: inline-block; background: var(--tag); color: var(--muted); border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 6px; }
  .tag.dream { color: var(--accent); }
  .bar { height: 8px; background: var(--tag); border-radius: 4px; overflow: hidden; margin: 8px 0 16px; }
  .bar > div { height: 100%; background: var(--accent); }
  input[type=search] { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); font: inherit; margin-bottom: 12px; }
  .commit { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); margin-bottom: 10px; }
  .commit summary { padding: 10px 14px; cursor: pointer; list-style: none; }
  .commit summary::-webkit-details-marker { display: none; }
  .commit .sha { font-family: ui-monospace, Menlo, monospace; color: var(--muted); font-size: 12px; margin-right: 8px; }
  .commit .files { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .commit .diff { border-top: 1px solid var(--line); padding: 10px 14px; }
  .add { color: var(--add); background: var(--addbg); display: block; }
  .del { color: var(--del); background: var(--delbg); display: block; }
  .hunk { color: var(--accent); display: block; }
  .muted { color: var(--muted); }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 13px; }
  .more { margin-top: 12px; }
  .more button { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Memory Palace</h1>
  <div class="meta" id="meta"></div>
</header>
<nav id="tabs"></nav>
<main id="main"></main>
<script>
const DATA = /*__PALACE_DATA__*/null;
const PAGE = 50;
const TABS = [
  ['context', 'Context'],
  ['core', 'Core'],
  ['project', 'Project'],
  ['reference', 'Reference'],
  ['skills', 'Skills'],
  ['archives', 'Archives'],
  ['history', 'History'],
  ['dreams', 'Dreams'],
];
const esc = function (text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
const el = function (id) { return document.getElementById(id); };
const filesFor = function (tab) {
  return DATA.files.filter(function (file) {
    if (tab === 'core') return file.tier === 'system';
    if (tab === 'project') return file.tier.indexOf('project-') === 0;
    if (tab === 'reference') return file.tier === 'reference';
    if (tab === 'skills') return file.tier === 'skill';
    if (tab === 'archives') return file.tier === 'archive';
    return false;
  });
};
const renderDiff = function (diff) {
  return diff.split('\\n').map(function (line) {
    if (line.indexOf('+++') === 0 || line.indexOf('---') === 0) return '<span class="muted">' + esc(line) + '</span>';
    if (line.charAt(0) === '+') return '<span class="add">' + esc(line) + '</span>';
    if (line.charAt(0) === '-') return '<span class="del">' + esc(line) + '</span>';
    if (line.indexOf('@@') === 0) return '<span class="hunk">' + esc(line) + '</span>';
    return esc(line);
  }).join('\\n');
};
const renderFiles = function (tab) {
  const files = filesFor(tab);
  if (files.length === 0) return '<p class="muted">No files here yet.</p>';
  let html = '<div class="split"><div class="list">';
  files.forEach(function (file, index) {
    html += '<div class="item" data-index="' + index + '"><div class="path">' + esc(file.path) +
      (file.readOnly ? '<span class="tag">read-only</span>' : '') +
      '<span class="tag">' + file.chars + ' chars</span></div>' +
      (file.description ? '<div class="desc">' + esc(file.description) + '</div>' : '') + '</div>';
  });
  html += '</div><div class="panel" id="file-panel"><p class="muted">Select a file.</p></div></div>';
  setTimeout(function () {
    const items = document.querySelectorAll('.item');
    items.forEach(function (item) {
      item.addEventListener('click', function () {
        items.forEach(function (other) { other.classList.remove('active'); });
        item.classList.add('active');
        const file = files[Number(item.dataset.index)];
        el('file-panel').innerHTML = '<pre>' + esc(file.content) + '</pre>';
      });
    });
    if (items[0]) items[0].click();
  });
  return html;
};
const renderContext = function () {
  const budget = 1400;
  const pct = Math.min(100, Math.round((DATA.context.tokens / budget) * 100));
  return '<p>New chats in <b>' + esc(DATA.projectSlug) + '</b> receive about <b>' + DATA.context.tokens +
    '</b> tokens of memory (budget ' + budget + ').</p><div class="bar"><div style="width:' + pct + '%"></div></div>' +
    '<div class="panel"><pre>' + esc(DATA.context.text) + '</pre></div>';
};
let historyShown = PAGE;
const renderHistory = function () {
  let html = '<input type="search" id="history-search" placeholder="Filter by message, file, or content">';
  html += '<div id="history-list"></div>';
  setTimeout(function () {
    const draw = function () {
      const query = el('history-search').value.toLowerCase();
      const matches = DATA.commits.filter(function (commit) {
        if (!query) return true;
        return (commit.subject + ' ' + commit.body + ' ' + commit.files.map(function (f) { return f.path; }).join(' ') + ' ' + (commit.diff || ''))
          .toLowerCase().indexOf(query) >= 0;
      });
      let out = '';
      matches.slice(0, historyShown).forEach(function (commit) {
        const added = commit.files.reduce(function (sum, f) { return sum + f.added; }, 0);
        const removed = commit.files.reduce(function (sum, f) { return sum + f.removed; }, 0);
        out += '<details class="commit"><summary><span class="sha">' + commit.sha.slice(0, 8) + '</span>' + esc(commit.subject) +
          (commit.reflection ? '<span class="tag dream">dream</span>' : '') +
          '<div class="files">' + esc(commit.date.slice(0, 16).replace('T', ' ')) + ' · ' + esc(commit.author) + ' · ' +
          commit.files.length + ' file(s) <span style="color:var(--add)">+' + added + '</span> <span style="color:var(--del)">-' + removed + '</span></div></summary>' +
          '<div class="diff">' + (commit.body ? '<pre class="muted">' + esc(commit.body) + '</pre><br>' : '') +
          (commit.diff ? '<pre>' + renderDiff(commit.diff) + '</pre>' : '<p class="muted">' + esc(commit.files.map(function (f) { return f.path; }).join(', ')) + ' (diff not embedded for older commits)</p>') +
          '</div></details>';
      });
      if (matches.length > historyShown) out += '<div class="more"><button id="more">Show more (' + (matches.length - historyShown) + ')</button></div>';
      el('history-list').innerHTML = out || '<p class="muted">No matching commits.</p>';
      const more = el('more');
      if (more) more.addEventListener('click', function () { historyShown += PAGE; draw(); });
    };
    el('history-search').addEventListener('input', function () { historyShown = PAGE; draw(); });
    draw();
  });
  return html + '<p class="muted">' + DATA.commits.length + ' of ' + DATA.totalCommits + ' commits embedded.</p>';
};
const renderDreams = function () {
  let html = '<p class="muted">Background reflection runs (newest last). Remote: ' +
    esc(DATA.remote.url || 'local only') + '</p>';
  if (DATA.dreams.length === 0) return html + '<p class="muted">No reflection has run yet.</p>';
  html += '<table><tr><th>When</th><th>Trigger</th><th>Status</th><th>Detail</th></tr>';
  DATA.dreams.forEach(function (run) {
    html += '<tr><td>' + esc(run.at.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(run.trigger) + '</td><td>' + esc(run.status) +
      (run.sha ? ' <span class="sha">' + esc(run.sha.slice(0, 8)) + '</span>' : '') + '</td><td>' + esc(run.detail) +
      (run.rejected ? '<div class="muted">Rejected: ' + esc(run.rejected.join('; ')) + '</div>' : '') + '</td></tr>';
  });
  return html + '</table>';
};
const show = function (tab) {
  document.querySelectorAll('nav button').forEach(function (button) {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  const main = el('main');
  if (tab === 'context') main.innerHTML = renderContext();
  else if (tab === 'history') main.innerHTML = renderHistory();
  else if (tab === 'dreams') main.innerHTML = renderDreams();
  else main.innerHTML = renderFiles(tab);
  location.hash = tab;
};
el('meta').textContent = DATA.memoryRoot + ' · revision ' + (DATA.revision || 'none').slice(0, 8) +
  ' · project ' + DATA.projectSlug + ' · generated ' + DATA.generatedAt.slice(0, 16).replace('T', ' ');
el('tabs').innerHTML = TABS.map(function (tab) {
  const count = ['core', 'project', 'reference', 'skills', 'archives'].indexOf(tab[0]) >= 0 ? ' <span class="tag">' + filesFor(tab[0]).length + '</span>' : '';
  return '<button data-tab="' + tab[0] + '">' + tab[1] + count + '</button>';
}).join('');
document.querySelectorAll('nav button').forEach(function (button) {
  button.addEventListener('click', function () { show(button.dataset.tab); });
});
show((location.hash || '#context').slice(1));
</script>
</body>
</html>
`

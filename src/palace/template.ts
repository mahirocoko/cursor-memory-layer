// The page script avoids backticks and "${" so it can live in this raw template literal.
export const PALACE_TEMPLATE = String.raw`<!doctype html>
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
  .wrap { max-width: 1280px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 20px 28px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .meta { color: var(--muted); font-size: 12px; text-align: right; }
  .mono, .sha, .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  nav { display: flex; gap: 4px; padding: 10px 28px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  nav button { border: 0; background: none; color: var(--muted); padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
  nav button.active { background: var(--tag); color: var(--ink); }
  main { padding: 20px 28px 60px; }
  .hint { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
  .split { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 20px; align-items: start; }
  .tree { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: auto; max-height: 80vh; padding: 6px 0; position: sticky; top: 12px; }
  .tree details > summary { list-style: none; cursor: pointer; padding: 3px 12px; display: flex; justify-content: space-between; gap: 8px; }
  .tree details > summary::-webkit-details-marker { display: none; }
  .tree details > summary::before { content: "▸"; color: var(--muted); width: 12px; flex: none; }
  .tree details[open] > summary::before { content: "▾"; }
  .tree .name { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; word-break: break-all; }
  .tree .leaf .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal; }
  .tree .count, .tree .size { color: var(--muted); font-size: 11px; flex: none; }
  .tree .leaf { padding: 3px 12px; cursor: pointer; display: flex; gap: 8px; border-left: 2px solid transparent; }
  .tree .leaf:hover { background: var(--tag); }
  .tree .leaf.active { background: var(--tag); border-left-color: var(--accent); }
  .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); min-height: 200px; overflow: hidden; }
  .fhead { display: flex; gap: 8px; align-items: baseline; padding: 10px 16px; border-bottom: 1px solid var(--line); font-size: 12.5px; flex-wrap: wrap; }
  .fhead .subject { flex: 1; min-width: 160px; }
  .fmeta { padding: 10px 16px; border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: flex-start; }
  .fmeta .info { flex: 1; min-width: 0; }
  .fmeta .path { font-size: 12px; color: var(--muted); word-break: break-all; }
  .fmeta .desc { font-size: 12.5px; margin-top: 4px; }
  .fbody { padding: 16px 20px 24px; }
  button.small { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; padding: 3px 10px; cursor: pointer; font: inherit; font-size: 12px; flex: none; }
  pre { white-space: pre-wrap; word-break: break-word; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; }
  .tag { display: inline-block; background: var(--tag); color: var(--muted); border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 6px; }
  .tag.dream { color: var(--accent); }
  .tag.loaded { color: var(--add); }
  .md { font-size: 15px; line-height: 1.65; max-width: 78ch; }
  .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { line-height: 1.3; margin: 1.3em 0 0.5em; }
  .md h1 { font-size: 1.5em; } .md h2 { font-size: 1.25em; border-bottom: 1px solid var(--line); padding-bottom: 0.2em; } .md h3 { font-size: 1.08em; } .md h4, .md h5, .md h6 { font-size: 1em; }
  .md > :first-child { margin-top: 0; }
  .md p { margin: 0.6em 0; }
  .md ul, .md ol { margin: 0.5em 0; padding-left: 1.4em; }
  .md li { margin: 0.2em 0; }
  .md code, .md .wl { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.86em; background: var(--tag); border-radius: 4px; padding: 0.05em 0.35em; }
  .md .wl { color: var(--accent); }
  .md pre.code { background: var(--tag); border-radius: 6px; padding: 10px 12px; margin: 0.8em 0; overflow: auto; }
  .md pre.code code { background: none; padding: 0; font-size: 12.5px; }
  .md blockquote { margin: 0.8em 0; padding: 0 0 0 12px; border-left: 3px solid var(--line); color: var(--muted); }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 1.2em 0; }
  .md table { margin: 0.8em 0; }
  .md a { color: var(--accent); }
  .bar { height: 8px; background: var(--tag); border-radius: 4px; overflow: hidden; margin: 8px 0 16px; display: flex; }
  .bar > div { height: 100%; }
  .bar.over > div { opacity: 0.85; }
  input[type=search] { flex: 1; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); font: inherit; }
  .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .toolbar label { color: var(--muted); font-size: 13px; display: flex; gap: 6px; align-items: center; }
  .commit, .runs { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); margin-bottom: 10px; }
  .commit summary, .runs summary { padding: 10px 14px; cursor: pointer; list-style: none; }
  .commit summary::-webkit-details-marker, .runs summary::-webkit-details-marker { display: none; }
  .runs .body { border-top: 1px solid var(--line); padding: 6px 8px; overflow: auto; }
  .sha { color: var(--muted); font-size: 12px; margin-right: 8px; }
  .commit .files { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .commit .diff { border-top: 1px solid var(--line); padding: 10px 14px; }
  .add { color: var(--add); }
  .del { color: var(--del); }
  .diff .add { background: var(--addbg); display: block; }
  .diff .del { background: var(--delbg); display: block; }
  .hunk { color: var(--accent); display: block; }
  .muted { color: var(--muted); }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 13px; }
  .more { margin-top: 12px; }
  @media (max-width: 760px) { .split { grid-template-columns: 1fr; } .tree { position: static; max-height: 40vh; } }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Memory Palace</h1>
  <div class="meta" id="meta"></div>
</header>
<nav id="tabs"></nav>
<main id="main"></main>
</div>
<script>
const DATA = /*__PALACE_DATA__*/null;
const PAGE = 50;
const BT = String.fromCharCode(96);
const TABS = [
  ['context', 'Context'],
  ['core', 'Core Memory'],
  ['external', 'External Memory'],
  ['history', 'History'],
];
const esc = function (text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
const el = function (id) { return document.getElementById(id); };
const pad = function (n) { return (n < 10 ? '0' : '') + n; };
const localTime = function (iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
};
const ago = function (iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(seconds >= 0)) return localTime(iso);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 86400 * 30) return Math.floor(seconds / 86400) + 'd ago';
  return localTime(iso).slice(0, 10);
};
const size = function (chars) { return chars >= 1000 ? Math.round(chars / 1000) + 'k chars' : chars + ' chars'; };
const tokens = function (chars) { return Math.ceil(chars / 4); };
const filesFor = function (tab) {
  return DATA.files.filter(function (file) { return tab === 'core' ? file.loaded : !file.loaded; });
};

const inline = function (text) {
  const parts = text.split(BT);
  if (parts.length % 2 === 0) { const tail = parts.pop(); parts[parts.length - 1] += BT + tail; }
  return parts.map(function (part, index) {
    if (index % 2) return '<code>' + esc(part) + '</code>';
    return esc(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="wl">$1</span>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }).join('');
};
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const markdown = function (source) {
  const lines = source.split('\n');
  let out = '';
  let paragraph = [];
  const flush = function () {
    if (paragraph.length) out += '<p>' + inline(paragraph.join(' ')) + '</p>';
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const fence = trimmed.indexOf(BT + BT + BT) === 0 ? BT + BT + BT : trimmed.indexOf('~~~') === 0 ? '~~~' : '';
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) { code.push(lines[i]); i++; }
      out += '<pre class="code"><code>' + esc(code.join('\n')) + '</code></pre>';
      i++;
      continue;
    }
    if (!trimmed) { flush(); i++; continue; }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      out += '<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>';
      i++;
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { flush(); out += '<hr>'; i++; continue; }
    if (trimmed.charAt(0) === '>') {
      flush();
      const quote = [];
      while (i < lines.length && lines[i].trim().charAt(0) === '>') { quote.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out += '<blockquote>' + markdown(quote.join('\n')) + '</blockquote>';
      continue;
    }
    if (trimmed.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = function (row) { return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|'); };
      out += '<table><tr>' + cells(line).map(function (cell) { return '<th>' + inline(cell.trim()) + '</th>'; }).join('') + '</tr>';
      i += 2;
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
        out += '<tr>' + cells(lines[i]).map(function (cell) { return '<td>' + inline(cell.trim()) + '</td>'; }).join('') + '</tr>';
        i++;
      }
      out += '</table>';
      continue;
    }
    const first = line.match(LIST_ITEM);
    if (first) {
      flush();
      const ordered = /\d/.test(first[2]);
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(LIST_ITEM);
        if (item) { items.push({ indent: item[1].length, text: item[3] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      out += ordered ? '<ol>' : '<ul>';
      items.forEach(function (item) {
        const text = item.text.replace(/^\[ \]\s/, '☐ ').replace(/^\[[xX]\]\s/, '☑ ');
        out += '<li' + (item.indent >= 2 ? ' style="margin-left:' + Math.floor(item.indent / 2) * 1.2 + 'em"' : '') + '>' + inline(text) + '</li>';
      });
      out += ordered ? '</ol>' : '</ul>';
      continue;
    }
    paragraph.push(trimmed);
    i++;
  }
  flush();
  return out;
};
const stripFrontmatter = function (content) { return content.replace(/^---\n[\s\S]*?\n---\n?/, ''); };

const buildTree = function (files) {
  const root = { dirs: {}, files: [] };
  files.forEach(function (file) {
    const parts = file.path.split('/');
    let node = root;
    parts.slice(0, -1).forEach(function (part) {
      node = node.dirs[part] || (node.dirs[part] = { dirs: {}, files: [] });
    });
    node.files.push(file);
  });
  return root;
};
const countFiles = function (node) {
  return node.files.length + Object.keys(node.dirs).reduce(function (sum, key) { return sum + countFiles(node.dirs[key]); }, 0);
};
const renderTree = function (node, depth) {
  let html = '';
  Object.keys(node.dirs).sort().forEach(function (name) {
    const child = node.dirs[name];
    html += '<details open><summary style="padding-left:' + (12 + depth * 14) + 'px"><span class="name">' + esc(name) + '/</span><span class="count">' + countFiles(child) + '</span></summary>' +
      renderTree(child, depth + 1) + '</details>';
  });
  node.files.slice().sort(function (a, b) { return a.path.localeCompare(b.path); }).forEach(function (file) {
    const name = file.path.split('/').pop().replace(/\.md$/, '');
    html += '<div class="leaf" data-path="' + esc(file.path) + '" style="padding-left:' + (26 + depth * 14) + 'px" title="' + esc(file.path) + '"><span class="name">' + esc(name) + '</span><span class="size">' + size(file.chars) + '</span></div>';
  });
  return html;
};

const selected = {};
const renderFile = function (file) {
  const touch = file.lastCommit;
  let html = '';
  if (touch) {
    html += '<div class="fhead"><span class="sha">' + esc(touch.sha.slice(0, 7)) + '</span><span class="add">+' + touch.added + '</span><span class="del">-' + touch.removed + '</span>' +
      '<span class="subject">' + esc(touch.subject) + '</span><span class="muted" title="' + esc(localTime(touch.date)) + '">' + ago(touch.date) + '</span></div>';
  }
  html += '<div class="fmeta"><div class="info"><div class="path">' + esc(file.path) +
    (file.loaded ? '<span class="tag loaded">loaded every chat</span>' : '') +
    (file.readOnly ? '<span class="tag">read-only</span>' : '') + '</div>' +
    (file.description ? '<div class="desc">' + esc(file.description) + '</div>' : '') +
    '</div><button class="small" id="raw-toggle">Raw</button></div>';
  const isMarkdown = /\.md$/.test(file.path);
  const rendered = isMarkdown ? '<div class="md">' + markdown(stripFrontmatter(file.content)) + '</div>' : '<pre>' + esc(file.content) + '</pre>';
  html += '<div class="fbody" id="file-body">' + rendered + '</div>';
  el('file-panel').innerHTML = html;
  let raw = false;
  el('raw-toggle').addEventListener('click', function () {
    raw = !raw;
    el('raw-toggle').textContent = raw ? 'Rendered' : 'Raw';
    el('file-body').innerHTML = raw ? '<pre>' + esc(file.content) + '</pre>' : rendered;
  });
};
const renderFiles = function (tab) {
  const files = filesFor(tab);
  const hint = tab === 'core'
    ? 'Loaded into every new chat in ' + esc(DATA.projectSlug) + '.'
    : 'Not loaded automatically. The agent reads these on demand; archives are never loaded.';
  if (files.length === 0) return '<p class="hint">' + hint + '</p><p class="muted">No files here yet.</p>';
  const byPath = {};
  files.forEach(function (file) { byPath[file.path] = file; });
  setTimeout(function () {
    const leaves = document.querySelectorAll('.leaf');
    const pick = function (leaf) {
      leaves.forEach(function (other) { other.classList.remove('active'); });
      leaf.classList.add('active');
      selected[tab] = leaf.dataset.path;
      renderFile(byPath[leaf.dataset.path]);
    };
    leaves.forEach(function (leaf) { leaf.addEventListener('click', function () { pick(leaf); }); });
    const initial = Array.prototype.find.call(leaves, function (leaf) { return leaf.dataset.path === selected[tab]; }) || leaves[0];
    if (initial) pick(initial);
  });
  return '<p class="hint">' + hint + '</p><div class="split"><div class="tree">' + renderTree(buildTree(files), 0) +
    '</div><div class="panel" id="file-panel"></div></div>';
};

const PALETTE = ['#5b4bdb', '#1f7a3a', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f', '#b45309'];
const renderContext = function () {
  const total = DATA.context.tokens;
  const system = DATA.context.systemTokens;
  const budget = DATA.context.budget;
  const scale = Math.max(system, budget);
  const core = filesFor('core');
  const approx = core.reduce(function (sum, file) { return sum + tokens(file.chars); }, 0) || 1;
  let segments = '';
  let rows = '';
  core.forEach(function (file, index) {
    const count = Math.round(tokens(file.chars) / approx * system);
    const color = PALETTE[index % PALETTE.length];
    segments += '<div style="width:' + (count / scale * 100) + '%;background:' + color + '" title="' + esc(file.path) + '"></div>';
    rows += '<tr><td><span style="color:' + color + '">●</span> <span class="path">' + esc(file.path) + '</span></td><td>≈' + count + '</td></tr>';
  });
  rows += '<tr><td class="muted">Fixed contract, on-demand index, skills, last reflection (not counted)</td><td class="muted">≈' + Math.max(0, total - system) + '</td></tr>';
  return '<p>New chats in <b>' + esc(DATA.projectSlug) + '</b> receive about <b>' + total + '</b> tokens of memory. ' +
    'Always-loaded files are about <b>' + system + '</b> of a ' + budget + '-token budget' +
    (system > budget ? ', <span class="del">over budget</span>' : '') + '.</p>' +
    '<div class="bar' + (system > budget ? ' over' : '') + '">' + segments + '</div>' +
    '<table style="margin-bottom:16px">' + rows + '</table>' +
    '<details class="runs"><summary>Exact text injected at session start</summary><div class="body"><pre>' + esc(DATA.context.text) + '</pre></div></details>';
};

const renderDiff = function (diff) {
  return diff.split('\n').map(function (line) {
    if (line.indexOf('+++') === 0 || line.indexOf('---') === 0) return '<span class="muted">' + esc(line) + '</span>';
    if (line.charAt(0) === '+') return '<span class="add">' + esc(line) + '</span>';
    if (line.charAt(0) === '-') return '<span class="del">' + esc(line) + '</span>';
    if (line.indexOf('@@') === 0) return '<span class="hunk">' + esc(line) + '</span>';
    return esc(line);
  }).join('\n');
};
const renderRuns = function () {
  if (DATA.dreams.length === 0) return '';
  let failed = 0;
  let rows = '';
  DATA.dreams.slice().reverse().forEach(function (run) {
    if (run.status === 'failed') failed++;
    rows += '<tr><td>' + esc(localTime(run.at)) + '</td><td>' + esc(run.trigger) + '</td><td>' + esc(run.status) +
      (run.sha ? ' <span class="sha">' + esc(run.sha.slice(0, 7)) + '</span>' : '') + '</td><td>' + esc(run.detail || '') +
      (run.rejected ? '<div class="muted">Rejected: ' + esc(run.rejected.join('; ')) + '</div>' : '') + '</td></tr>';
  });
  return '<details class="runs"><summary>Reflection runs <span class="tag">' + DATA.dreams.length + '</span>' +
    (failed ? '<span class="tag" style="color:var(--del)">' + failed + ' failed</span>' : '') +
    ' <span class="muted">· remote: ' + esc(DATA.remote.url || 'local only') + '</span></summary>' +
    '<div class="body"><table><tr><th>When</th><th>Trigger</th><th>Status</th><th>Detail</th></tr>' + rows + '</table></div></details>';
};
let historyShown = PAGE;
const renderHistory = function () {
  let html = renderRuns();
  html += '<div class="toolbar"><input type="search" id="history-search" placeholder="Filter by message, file, or content">' +
    '<label><input type="checkbox" id="dreams-only"> Reflection only</label></div><div id="history-list"></div>';
  setTimeout(function () {
    const draw = function () {
      const query = el('history-search').value.toLowerCase();
      const dreamsOnly = el('dreams-only').checked;
      const matches = DATA.commits.filter(function (commit) {
        if (dreamsOnly && !commit.reflection) return false;
        if (!query) return true;
        return (commit.subject + ' ' + commit.body + ' ' + commit.files.map(function (f) { return f.path; }).join(' ') + ' ' + (commit.diff || ''))
          .toLowerCase().indexOf(query) >= 0;
      });
      let out = '';
      matches.slice(0, historyShown).forEach(function (commit) {
        const added = commit.files.reduce(function (sum, f) { return sum + f.added; }, 0);
        const removed = commit.files.reduce(function (sum, f) { return sum + f.removed; }, 0);
        out += '<details class="commit"><summary><span class="sha">' + commit.sha.slice(0, 7) + '</span>' + esc(commit.subject) +
          (commit.reflection ? '<span class="tag dream">reflection</span>' : '') +
          '<div class="files"><span title="' + esc(localTime(commit.date)) + '">' + ago(commit.date) + '</span> · ' + esc(commit.author) + ' · ' +
          commit.files.length + ' file(s) <span class="add">+' + added + '</span> <span class="del">-' + removed + '</span></div></summary>' +
          '<div class="diff">' + (commit.body ? '<pre class="muted">' + esc(commit.body) + '</pre><br>' : '') +
          (commit.diff ? '<pre>' + renderDiff(commit.diff) + '</pre>' : '<p class="muted">' + esc(commit.files.map(function (f) { return f.path; }).join(', ')) + ' (diff not embedded for older commits)</p>') +
          '</div></details>';
      });
      if (matches.length > historyShown) out += '<div class="more"><button class="small" id="more">Show more (' + (matches.length - historyShown) + ')</button></div>';
      el('history-list').innerHTML = out || '<p class="muted">No matching commits.</p>';
      const more = el('more');
      if (more) more.addEventListener('click', function () { historyShown += PAGE; draw(); });
    };
    el('history-search').addEventListener('input', function () { historyShown = PAGE; draw(); });
    el('dreams-only').addEventListener('change', function () { historyShown = PAGE; draw(); });
    draw();
  });
  return html + '<p class="muted">' + DATA.commits.length + ' of ' + DATA.totalCommits + ' commits embedded.</p>';
};

const show = function (tab) {
  if (!TABS.some(function (entry) { return entry[0] === tab; })) tab = 'context';
  document.querySelectorAll('nav button').forEach(function (button) {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  const main = el('main');
  if (tab === 'context') main.innerHTML = renderContext();
  else if (tab === 'history') main.innerHTML = renderHistory();
  else main.innerHTML = renderFiles(tab);
  history.replaceState(null, '', '#' + tab);
};
el('meta').innerHTML = 'project <b>' + esc(DATA.projectSlug) + '</b> · revision <span class="mono">' + esc((DATA.revision || 'none').slice(0, 7)) + '</span><br>' +
  '<span class="mono">' + esc(DATA.memoryRoot) + '</span> · generated ' + esc(localTime(DATA.generatedAt));
el('tabs').innerHTML = TABS.map(function (tab) {
  const count = tab[0] === 'core' || tab[0] === 'external' ? filesFor(tab[0]).length : tab[0] === 'history' ? DATA.totalCommits : null;
  return '<button data-tab="' + tab[0] + '">' + tab[1] + (count === null ? '' : ' <span class="tag">' + count + '</span>') + '</button>';
}).join('');
document.querySelectorAll('nav button').forEach(function (button) {
  button.addEventListener('click', function () { show(button.dataset.tab); });
});
window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
show((location.hash || '#context').slice(1));
</script>
</body>
</html>
`

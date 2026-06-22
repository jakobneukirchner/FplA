/**
 * ui.js – FplA Frontend-Logik
 */
import { searchStops, searchTrips, getDepartures } from './trias.js';

// ── State ──────────────────────────────────────────────────────────
let _lastParams = null;
let _lastTrips  = [];

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setDateTimeNow();

  autocomplete('from-input', 'from-ref', 'from-list');
  autocomplete('to-input',   'to-ref',   'to-list');
  autocomplete('via-input',  'via-ref',  'via-list');
  autocomplete('dep-input',  'dep-ref',  'dep-list');

  on('btn-search', 'click', () => runTrips());
  on('btn-reset',  'click', resetAll);
  on('btn-swap',   'click', swapFromTo);
  on('btn-dep',    'click', runDepartures);
  on('btn-add-excl','click', () => addExcludeTag());
  on('btn-share',  'click', shareURL);
  on('btn-print',  'click', () => window.print());

  $all('.sort-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      $all('.sort-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (_lastTrips.length) renderTrips(_lastTrips);
    })
  );

  // Chip-Toggle
  $all('.chip-row').forEach(row => {
    row.querySelectorAll('input[type=checkbox]').forEach(cb =>
      cb.addEventListener('change', () => cb.closest('label').classList.toggle('checked', cb.checked))
    );
    row.querySelectorAll('input[type=radio]').forEach(r =>
      r.addEventListener('change', () => {
        row.querySelectorAll('label').forEach(l => l.classList.remove('checked'));
        r.closest('label').classList.add('checked');
      })
    );
  });

  restoreURL();
});

// ── Autocomplete ───────────────────────────────────────────────────
function autocomplete(inputId, refId, listId) {
  const input = $(inputId), ref = $(refId), list = $(listId);
  if (!input) return;
  let timer;

  input.addEventListener('input', () => {
    ref.value = '';
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return hideList(list);
    timer = setTimeout(async () => {
      try {
        const stops = await searchStops(q);
        list.innerHTML = '';
        stops.forEach(s => {
          const li = document.createElement('li');
          li.textContent = s.name;
          li.addEventListener('mousedown', e => {
            e.preventDefault();
            input.value = s.name;
            ref.value   = s.ref;
            hideList(list);
          });
          list.appendChild(li);
        });
        list.style.display = stops.length ? 'block' : 'none';
      } catch(e) { console.error('AC:', e); }
    }, 280);
  });

  input.addEventListener('keydown', e => { if (e.key === 'Escape') hideList(list); });
  document.addEventListener('click', e => {
    if (!input.closest('.md-field')?.contains(e.target)) hideList(list);
  });
}
function hideList(list) { if (list) { list.innerHTML = ''; list.style.display = 'none'; } }

// ── Verbindungssuche ───────────────────────────────────────────────
async function runTrips(overrideParams) {
  const p = overrideParams || collectTripParams();
  if (!p.fromRef || !p.toRef)
    return showMsg('trip-results', 'error', 'Bitte Start und Ziel aus der Vorschlagsliste wählen.');
  _lastParams = p;
  updateURL(p);

  $('trip-results').innerHTML = '<div class="loading">Verbindungen werden gesucht …</div>';
  $('result-area').style.display = 'block';
  $('sort-bar').style.display    = 'flex';

  try {
    _lastTrips = await searchTrips(p);
    renderTrips(_lastTrips);
  } catch(e) {
    showMsg('trip-results', 'error', e.message);
  }
}

function collectTripParams() {
  return {
    fromRef: $v('from-ref'), fromName: $v('from-input'),
    toRef:   $v('to-ref'),   toName:   $v('to-input'),
    viaRef:  $v('via-ref'),  viaName:  $v('via-input'),
    date:    $v('trip-date'), time:    $v('trip-time'),
    timeType: $v('time-type'),
    untilTime: $v('trip-until'),
    numResults:      $v('num-results'),
    algorithm:       $v('opt-algo'),
    maxChanges:      $v('max-changes'),
    minTransferTime: $v('min-transfer'),
    modes: [...$all('#vm-chips input:checked')].map(c => c.value),
    excludeLines: getExcludeLines(),
    wheelchair: $('opt-wheelchair')?.checked || false,
    bike:       $('opt-bike')?.checked || false,
    lowfloor:   $('opt-lowfloor')?.checked || false
  };
}

// ── Abfahrtsmonitor ────────────────────────────────────────────────
async function runDepartures() {
  const ref = $v('dep-ref');
  if (!ref) return showMsg('dep-results', 'error', 'Bitte Haltestelle aus der Vorschlagsliste wählen.');
  $('dep-results').innerHTML = '<div class="loading">Lade Abfahrten …</div>';
  try {
    const deps = await getDepartures(ref, $v('dep-date'), $v('dep-time'), $v('dep-count'));
    renderDepartures(deps);
  } catch(e) {
    showMsg('dep-results', 'error', e.message);
  }
}

// ── Render: Trips ──────────────────────────────────────────────────
function renderTrips(trips) {
  const sorted = sortTrips(trips);
  const until  = _lastParams?.untilTime;
  const cont   = $('trip-results');

  if (!sorted.length) {
    cont.innerHTML = '<div class="empty-state"><span class="material-icons">search_off</span><p>Keine Verbindungen gefunden.</p></div>';
    return;
  }

  cont.innerHTML = sorted
    .filter(t => !until || fmtTime(t.startTime) <= until)
    .map((t, i) => tripCard(t, i))
    .join('');

  window.__excl = lineName => {
    addExcludeTag(lineName);
    if (_lastParams) {
      const ex = [...new Set([...(_lastParams.excludeLines||[]), lineName])];
      runTrips({ ..._lastParams, excludeLines: ex });
    }
  };
}

function tripCard(t, i) {
  const dep = fmtTime(t.startTime), arr = fmtTime(t.endTime);
  const dur = fmtDur(t.duration);
  const changes = t.changes <= 0 ? 'Direktverbindung' : `${t.changes} Umstieg${t.changes>1?'e':''}`;
  const delay = delayChip(t.legs.find(l=>l.type==='timed'));
  const fare  = t.fare ? `<span class="fare-badge">${h(t.fare)} €</span>` : '';

  const pills = t.legs.filter(l=>l.type==='timed').map(leg =>
    `<span class="product-pill mode-${mk(leg.mode)}">${h(leg.lineName||'?')}</span>
     <button class="pill-excl" title="Ohne Linie ${h(leg.lineName||'?')} suchen"
       onclick="window.__excl('${esc(leg.lineName||'')}')"><span class="material-icons">block</span></button>`
  ).join('');

  const tl = t.legs.map((leg, li) => legHtml(leg, li === t.legs.length-1)).join('');

  return `
  <div class="result-card md-card" id="rc${i}">
    <div class="result-header" onclick="document.getElementById('rc${i}').classList.toggle('open')">
      <div class="time-col">
        <div class="dep">${dep}</div>
        <div class="arr">Ankunft ${arr}</div>
      </div>
      <span class="duration-chip">${dur}</span>
      <span class="changes-label">${changes}</span>
      <div class="product-pills">${pills}</div>
      ${fare}${delay}
      <span class="material-icons expand-icon">expand_more</span>
    </div>
    <div class="result-detail">
      <div class="timeline">${tl}</div>
      <p class="disclaimer">Alle Angaben ohne Gewähr · Fahrplandaten: Connect GmbH / HannIT</p>
    </div>
  </div>`;
}

function legHtml(leg, isLast) {
  if (leg.type === 'walk') {
    return `
    <div class="tl-step">
      <div class="tl-time">–</div>
      <div class="tl-dot"><div class="dot dot-walk"></div><div class="tl-line"></div></div>
      <div class="tl-info"><div class="tl-walk-label"><span class="material-icons" style="font-size:16px">directions_walk</span>Fußweg · ${fmtDur(leg.duration)}</div></div>
    </div>`;
  }
  const inter = leg.intermediates?.length
    ? `<details class="inter-stops"><summary>${leg.intermediates.length} Zwischenhalt${leg.intermediates.length>1?'e':''}</summary><ul>
       ${leg.intermediates.map(s=>`<li><span>${h(s.stop)}</span><span class="inter-time">${fmtTime(s.dep)}</span></li>`).join('')}
       </ul></details>` : '';

  return `
  <div class="tl-step">
    <div class="tl-time">${fmtTime(leg.depPlan)}</div>
    <div class="tl-dot"><div class="dot"></div><div class="tl-line"></div></div>
    <div class="tl-info">
      <div class="tl-stop">${h(leg.fromStop)}</div>
      ${leg.platform ? `<div class="tl-platform">Steig ${h(leg.platform)}</div>` : ''}
      <div class="tl-vehicle">
        <span class="product-pill mode-${mk(leg.mode)}">${h(leg.lineName||'?')}</span>
        <span class="tl-vehicle-dest">Richtung ${h(leg.direction||'')}</span>
        <button class="tl-excl-btn" onclick="window.__excl('${esc(leg.lineName||'')}')">
          <span class="material-icons">block</span> Ohne diese Linie
        </button>
      </div>
      ${inter}
    </div>
  </div>
  <div class="tl-step">
    <div class="tl-time">${fmtTime(leg.arrPlan)}</div>
    <div class="tl-dot"><div class="dot ${isLast?'dot-dest':''}"></div>${isLast?'':'<div class="tl-line"></div>'}</div>
    <div class="tl-info"><div class="tl-stop">${h(leg.toStop)}</div></div>
  </div>`;
}

// ── Render: Abfahrten ──────────────────────────────────────────────
function renderDepartures(deps) {
  const cont   = $('dep-results');
  const filter = document.querySelector('input[name=dep-mode]:checked')?.value || 'all';
  const until  = $v('dep-until');

  const rows = deps
    .filter(d => filter === 'all' || mk(d.mode) === filter)
    .filter(d => !until || fmtTime(d.depPlan) <= until);

  if (!rows.length) {
    cont.innerHTML = '<div class="empty-state"><span class="material-icons">departure_board</span><p>Keine Abfahrten gefunden.</p></div>';
    return;
  }

  cont.innerHTML = `
  <div class="md-card" style="overflow:hidden;margin-top:16px">
    <table class="dep-table">
      <thead><tr><th>Linie</th><th>Richtung</th><th>Abfahrt</th><th>Status</th><th>Steig</th></tr></thead>
      <tbody>${rows.map(d => {
        const plan = fmtTime(d.depPlan);
        const late = d.depRT && d.depRT !== d.depPlan;
        const diff = late ? Math.round((new Date(d.depRT)-new Date(d.depPlan))/60000) : 0;
        return `<tr>
          <td><span class="product-pill mode-${mk(d.mode)}">${h(d.line)}</span></td>
          <td>${h(d.direction)}</td>
          <td>${plan}</td>
          <td>${late
            ? `<span class="delay-chip ${diff>=5?'delay-cancel':'delay-late'}">+${diff} min</span>`
            : '<span class="delay-chip delay-ok">pünktlich</span>'}</td>
          <td>${h(d.platform||'–')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

// ── Exclude-Lines ──────────────────────────────────────────────────
function addExcludeTag(name) {
  const val = name ?? $v('excl-input').trim();
  if (!val) return;
  if ([...document.querySelectorAll('.excl-tag')].some(t => t.dataset.val === val)) return;
  const tag = document.createElement('span');
  tag.className = 'excl-tag exclude-tag';
  tag.dataset.val = val;
  tag.innerHTML = `${h(val)}<button onclick="this.closest('.excl-tag').remove()" title="Entfernen"><span class="material-icons" style="font-size:15px">close</span></button>`;
  $('excl-tags').appendChild(tag);
  if (!name) $('excl-input').value = '';
}
function getExcludeLines() {
  return [...document.querySelectorAll('.excl-tag')].map(t => t.dataset.val);
}

// ── Sortierung ─────────────────────────────────────────────────────
function sortTrips(trips) {
  const mode = document.querySelector('.sort-chip.active')?.dataset.sort || 'default';
  if (mode === 'dep') return [...trips].sort((a,b) => a.startTime.localeCompare(b.startTime));
  if (mode === 'arr') return [...trips].sort((a,b) => a.endTime.localeCompare(b.endTime));
  if (mode === 'dur') return [...trips].sort((a,b) => durMin(a.duration) - durMin(b.duration));
  return trips;
}
function durMin(iso) {
  const m = (iso||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return m ? (parseInt(m[1]||0)*60 + parseInt(m[2]||0)) : 9999;
}

// ── URL-Share & Restore ────────────────────────────────────────────
function updateURL(p) {
  const u = new URL(location.href);
  const s = (k,v) => v ? u.searchParams.set(k,v) : u.searchParams.delete(k);
  s('fn',p.fromName); s('fr',p.fromRef);
  s('tn',p.toName);   s('tr',p.toRef);
  s('vn',p.viaName);  s('vr',p.viaRef);
  s('d',p.date);      s('t',p.time);
  s('tt',p.timeType); s('ut',p.untilTime);
  s('al',p.algorithm); s('mc',p.maxChanges);
  s('mo',(p.modes||[]).join(','));
  if (p.excludeLines?.length) s('ex',p.excludeLines.join(','));
  history.replaceState(null,'',u);
}

function restoreURL() {
  const p = new URLSearchParams(location.search);
  const g = (k,def='') => p.get(k)||def;
  if (!p.get('fr') || !p.get('tr')) return;
  setVal('from-input',g('fn')); setVal('from-ref',g('fr'));
  setVal('to-input',  g('tn')); setVal('to-ref',  g('tr'));
  setVal('via-input', g('vn')); setVal('via-ref',  g('vr'));
  setVal('trip-date', g('d'));  setVal('trip-time', g('t'));
  setVal('trip-until',g('ut')); setVal('time-type', g('tt','dep'));
  setVal('opt-algo',  g('al','fastest'));
  setVal('max-changes',g('mc','2'));
  const modes = g('mo','').split(',').filter(Boolean);
  if (modes.length) {
    $all('#vm-chips input[type=checkbox]').forEach(cb => {
      cb.checked = modes.includes(cb.value);
      cb.closest('label').classList.toggle('checked', cb.checked);
    });
  }
  g('ex','').split(',').filter(Boolean).forEach(addExcludeTag);
  if (p.has('travel-view')) {
    runTrips().then(() =>
      setTimeout(() => $all('.result-card').forEach(c=>c.classList.add('open')), 300)
    );
  }
}

function shareURL() {
  const url = location.href;
  if (navigator.share) { navigator.share({ title:'FplA Verbindung', url }); return; }
  navigator.clipboard.writeText(url).then(() => {
    const btn = $('btn-share');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="material-icons">check</span> Kopiert!';
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

// ── Hilfsfunktionen ────────────────────────────────────────────────
function setDateTimeNow() {
  const now = new Date(), pad = n => String(n).padStart(2,'0');
  const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ['trip-date','dep-date'].forEach(id => setVal(id,d));
  ['trip-time','dep-time'].forEach(id => setVal(id,t));
}
function swapFromTo() {
  const [fi,fr,ti,tr] = ['from-input','from-ref','to-input','to-ref'].map($);
  [fi.value,ti.value] = [ti.value,fi.value];
  [fr.value,tr.value] = [tr.value,fr.value];
}
function resetAll() {
  ['from-input','from-ref','to-input','to-ref','via-input','via-ref'].forEach(id => setVal(id,''));
  $('result-area').style.display = 'none';
  $('sort-bar').style.display    = 'none';
  $('trip-results').innerHTML    = '';
  $('excl-tags').innerHTML       = '';
  _lastParams = null; _lastTrips = [];
  history.replaceState(null,'',location.pathname);
}
function fmtTime(iso) {
  if (!iso) return '–';
  try { const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  catch { return iso; }
}
function fmtDur(iso) {
  if (!iso) return '–';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const hh=parseInt(m[1]||0), mm=parseInt(m[2]||0);
  return hh ? `${hh} h ${mm} min` : `${mm} min`;
}
function delayChip(leg) {
  if (!leg || !leg.depRT || leg.depRT === leg.depPlan)
    return '<span class="delay-chip delay-ok">Pünktlich</span>';
  const diff = Math.round((new Date(leg.depRT)-new Date(leg.depPlan))/60000);
  if (diff <= 0) return '<span class="delay-chip delay-ok">Pünktlich</span>';
  return `<span class="delay-chip ${diff>=5?'delay-cancel':'delay-late'}">+${diff} min</span>`;
}
function mk(mode) {
  if (!mode) return 'bus';
  const m = mode.toLowerCase();
  if (m.includes('tram')||m.includes('city'))  return 'tram';
  if (m.includes('suburban'))                  return 's';
  if (m.includes('regional'))                  return 're';
  if (m.includes('high')||m.includes('ice'))   return 'ice';
  if (m.includes('intercity')||m.includes('ic')) return 'ic';
  return 'bus';
}
function showMsg(containerId, type, msg) {
  const el = $(containerId); if (!el) return;
  el.innerHTML = `<div class="${type==='error'?'error-box':'info-box'}">${h(msg)}</div>`;
  $('result-area').style.display = 'block';
}
function h(s)   { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function esc(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function $(id)  { return document.getElementById(id); }
function $v(id) { return $(id)?.value?.trim()||''; }
function $all(sel) { return [...document.querySelectorAll(sel)]; }
function setVal(id,v) { const el=$(id); if(el) el.value=v; }
function on(id,ev,fn) { $(id)?.addEventListener(ev,fn); }

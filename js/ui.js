// ══════════════════════════════════════════════════════════
// ui.js  –  DOM-Logik, Rendering, Event-Handler
// ══════════════════════════════════════════════════════════
import { searchStops, searchTrips, getDepartures } from './trias.js';

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDateTimeDefaults();
  initToggleLabels();
  initAutocomplete('from-input', 'from-ref', 'from-list');
  initAutocomplete('to-input',   'to-ref',   'to-list');
  initAutocomplete('via-input',  'via-ref',  'via-list');
  initAutocomplete('dep-stop-input', 'dep-stop-ref', 'dep-stop-list');
  initAutocomplete('si-stop-input',  'si-stop-ref',  'si-stop-list');

  document.getElementById('btn-search').addEventListener('click', runTripSearch);
  document.getElementById('btn-reset').addEventListener('click', resetSearch);
  document.getElementById('btn-dep').addEventListener('click', runDepartures);
  document.getElementById('btn-swap').addEventListener('click', swapStops);
  document.getElementById('btn-add-exclude').addEventListener('click', addExcludeLine);
  document.getElementById('btn-add-segment').addEventListener('click', addSegmentTransfer);
});

// ── Datum/Zeit ──────────────────────────────────────────────
function initDateTimeDefaults() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ['travel-date','dep-date'].forEach(id => { const el=document.getElementById(id); if(el) el.value=d; });
  ['travel-time','dep-time'].forEach(id => { const el=document.getElementById(id); if(el) el.value=t; });
}

// ── Toggle-Labels ───────────────────────────────────────────
function initToggleLabels() {
  document.querySelectorAll('.toggle-group label').forEach(lbl => {
    const cb = lbl.querySelector('input[type=checkbox]');
    if (cb && cb.checked) lbl.classList.add('checked');
    lbl.addEventListener('click', () => {
      setTimeout(() => lbl.classList.toggle('checked', cb.checked), 0);
    });
  });
}

// ── Autocomplete ─────────────────────────────────────────────
function initAutocomplete(inputId, refId, listId) {
  const input = document.getElementById(inputId);
  const refEl = document.getElementById(refId);
  const list  = document.getElementById(listId);
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    refEl.value = '';
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ''; list.style.display='none'; return; }
    timer = setTimeout(async () => {
      try {
        const stops = await searchStops(q);
        list.innerHTML = '';
        stops.forEach(s => {
          const li = document.createElement('li');
          li.textContent = s.name;
          li.addEventListener('mousedown', () => {
            input.value  = s.name;
            refEl.value  = s.ref;
            list.style.display = 'none';
          });
          list.appendChild(li);
        });
        list.style.display = stops.length ? 'block' : 'none';
      } catch(e) { console.error(e); }
    }, 320);
  });
  document.addEventListener('click', e => { if (!input.contains(e.target)) list.style.display='none'; });
}

// ── Swap Stops ──────────────────────────────────────────────
function swapStops() {
  const fi = document.getElementById('from-input'), fr = document.getElementById('from-ref');
  const ti = document.getElementById('to-input'),   tr = document.getElementById('to-ref');
  [fi.value, ti.value] = [ti.value, fi.value];
  [fr.value, tr.value] = [tr.value, fr.value];
}

// ── Linien ausschließen ─────────────────────────────────────
function addExcludeLine() {
  const val = document.getElementById('exclude-line-input').value.trim();
  if (!val) return;
  const tag = document.createElement('span');
  tag.className = 'exclude-tag';
  tag.innerHTML = `${escH(val)} <button onclick="this.parentElement.remove()">×</button>`;
  tag.dataset.line = val;
  document.getElementById('exclude-tags').appendChild(tag);
  document.getElementById('exclude-line-input').value = '';
}
function getExcludeLines() {
  return [...document.querySelectorAll('#exclude-tags .exclude-tag')].map(t => t.dataset.line);
}

// ── Segment-Umsteigezeiten ──────────────────────────────────
function addSegmentTransfer() {
  const stop = document.getElementById('seg-stop-input').value.trim();
  const min  = document.getElementById('seg-min-input').value.trim();
  if (!stop || !min) return;
  const row = document.createElement('div');
  row.className = 'seg-row';
  row.dataset.stop = stop;
  row.dataset.min  = min;
  row.innerHTML = `<span>${escH(stop)}</span><span>${escH(min)} min</span><button onclick="this.parentElement.remove()">×</button>`;
  document.getElementById('seg-transfer-list').appendChild(row);
  document.getElementById('seg-stop-input').value = '';
  document.getElementById('seg-min-input').value  = '';
}
function getSegmentTransfers() {
  return [...document.querySelectorAll('#seg-transfer-list .seg-row')].map(r => ({
    stopRef: r.dataset.stop, minutes: parseInt(r.dataset.min)
  }));
}

// ── Verbindungssuche ─────────────────────────────────────────
async function runTripSearch() {
  const fromRef  = document.getElementById('from-ref').value.trim();
  const fromName = document.getElementById('from-input').value.trim();
  const toRef    = document.getElementById('to-ref').value.trim();
  const toName   = document.getElementById('to-input').value.trim();
  if (!fromRef || !toRef) {
    showError('results-container', 'Bitte Start und Ziel aus der Vorschlagsliste wählen.');
    return;
  }
  const modes = [...document.querySelectorAll('#vm-toggles input:checked')].map(c => c.value);
  const params = {
    fromRef, fromName, toRef, toName,
    viaRef:  document.getElementById('via-ref').value.trim(),
    viaName: document.getElementById('via-input').value.trim(),
    date:    document.getElementById('travel-date').value,
    time:    document.getElementById('travel-time').value,
    timeType: document.getElementById('time-type').value,
    numResults: document.getElementById('num-results').value,
    algorithm: document.getElementById('opt-mode').value,
    maxChanges: document.getElementById('max-changes').value,
    minTransferTime: document.getElementById('min-transfer').value,
    segmentTransfers: getSegmentTransfers(),
    excludeLines: getExcludeLines(),
    modes,
    wheelchair: document.getElementById('opt-wheelchair').checked,
    bike:       document.getElementById('opt-bike').checked,
    lowfloor:   document.getElementById('opt-lowfloor').checked
  };
  const cont = document.getElementById('results-container');
  cont.innerHTML = '<div class="loading">&#x23F3; Verbindungen werden gesucht…</div>';
  document.getElementById('result-area').style.display = 'block';
  try {
    const trips = await searchTrips(params);
    renderTrips(trips, cont);
  } catch(e) {
    showError('results-container', 'Fehler bei der TRIAS-Anfrage: ' + e.message);
  }
}

// ── Abfahrtsmonitor ──────────────────────────────────────────
async function runDepartures() {
  const ref  = document.getElementById('dep-stop-ref').value.trim();
  if (!ref) { showError('dep-result','Bitte Haltestelle aus der Vorschlagsliste wählen.'); return; }
  const date   = document.getElementById('dep-date').value;
  const time   = document.getElementById('dep-time').value;
  const count  = document.getElementById('dep-count').value;
  const filter = document.getElementById('dep-filter').value;
  document.getElementById('dep-result').innerHTML = '<div class="loading">&#x23F3; Lade Abfahrten…</div>';
  try {
    const deps = await getDepartures(ref, date, time, count, filter);
    renderDepartures(deps, filter);
  } catch(e) {
    showError('dep-result', 'Fehler: ' + e.message);
  }
}

// ── Renderer: Trips ──────────────────────────────────────────
function renderTrips(trips, cont) {
  if (!trips.length) {
    cont.innerHTML = '<div class="empty-state"><div class="icon">&#x1F50D;</div><p>Keine Verbindungen gefunden.</p></div>';
    return;
  }
  cont.innerHTML = trips.map((t,i) => {
    const dur     = formatDuration(t.duration);
    const depFmt  = formatISOTime(t.startTime);
    const arrFmt  = formatISOTime(t.endTime);
    const changes = t.changes <= 0 ? 'Direkt' : t.changes + ' Umstieg' + (t.changes>1?'e':'');
    const pills   = t.legs.filter(l=>l.type==='timed')
      .map(l => `<span class="product-pill mode-${l.mode||'bus'}">${escH(l.lineName||l.mode||'?')}</span>`).join('');
    const delay   = getDelayBadge(t.legs[0]);
    const fare    = t.fare ? `<span class="fare-badge">&#x1F4B6; ${escH(t.fare)} €</span>` : '';

    const timeline = t.legs.map((leg,li) => {
      if (leg.type === 'walk') return `
        <div class="tl-step tl-walk-step">
          <div class="tl-time">–</div>
          <div class="tl-dot"><div class="dot dot-walk"></div><div class="line"></div></div>
          <div class="tl-info"><div class="tl-walk">&#x1F6B6; Fußweg · ${formatDuration(leg.duration)}</div></div>
        </div>`;
      const inter = leg.intermediates && leg.intermediates.length
        ? `<details class="inter-stops"><summary>${leg.intermediates.length} Zwischenhalt${leg.intermediates.length>1?'e':''}</summary><ul>${leg.intermediates.map(s=>`<li>${escH(s.stop)} <span class="inter-time">${formatISOTime(s.dep)}</span></li>`).join('')}</ul></details>`
        : '';
      const isLast = li === t.legs.length - 1;
      const arrRow = `
        <div class="tl-step ${isLast?'tl-last':''}">
          <div class="tl-time">${formatISOTime(leg.arrPlan)}</div>
          <div class="tl-dot"><div class="dot ${isLast?'dot-dest':''}"></div>${isLast?'':'<div class="line"></div>'}</div>
          <div class="tl-info">
            <div class="tl-stop">${escH(leg.toStop)}</div>
          </div>
        </div>`;
      return `
        <div class="tl-step">
          <div class="tl-time">${formatISOTime(leg.depPlan)}</div>
          <div class="tl-dot"><div class="dot"></div><div class="line"></div></div>
          <div class="tl-info">
            <div class="tl-stop">${escH(leg.fromStop)}</div>
            <div class="tl-platform">${leg.platform ? 'Gleis/Steig ' + escH(leg.platform) : ''}</div>
            <div class="tl-vehicle">
              <span class="product-pill mode-${leg.mode||'bus'}">${escH(leg.lineName||'?')}</span>
              <span class="tl-vehicle-dest">Richtung ${escH(leg.direction||'')}</span>
            </div>
            ${inter}
          </div>
        </div>
        ${arrRow}`;
    }).join('');

    return `
      <div class="result-card" id="rc-${i}">
        <div class="result-header" onclick="document.getElementById('rc-${i}').classList.toggle('open')">
          <div class="time-col">
            <div class="dep">${depFmt}</div>
            <div class="arr">&#x2192; ${arrFmt}</div>
          </div>
          <span class="duration-badge">${dur}</span>
          <span class="changes-badge">${changes}</span>
          <div class="product-icons">${pills}</div>
          ${fare}
          ${delay}
          <span class="expand-icon">&#x25BC;</span>
        </div>
        <div class="result-detail">
          <div class="timeline">${timeline}</div>
          <p class="disclaimer">Alle Angaben ohne Gewähr.</p>
        </div>
      </div>`;
  }).join('');
}

// ── Renderer: Abfahrten ───────────────────────────────────────
function renderDepartures(deps, filter) {
  const cont = document.getElementById('dep-result');
  const filtered = filter === 'all' ? deps : deps.filter(d => modeKey(d.mode) === filter);
  if (!filtered.length) {
    cont.innerHTML = '<div class="empty-state"><div class="icon">&#x1F68C;</div><p>Keine Abfahrten gefunden.</p></div>';
    return;
  }
  const rows = filtered.map(d => {
    const planFmt = formatISOTime(d.depPlan);
    const rtFmt   = d.depRT ? formatISOTime(d.depRT) : planFmt;
    const delay   = d.depRT && d.depRT !== d.depPlan
      ? `<span class="dep-delay-late">${rtFmt}</span>` : `<span class="dep-delay-ok">pünktlich</span>`;
    return `<tr>
      <td><span class="product-pill mode-${modeKey(d.mode)}">${escH(d.line)}</span></td>
      <td>${escH(d.direction)}</td>
      <td>${planFmt}</td>
      <td>${delay}</td>
      <td>${escH(d.platform||'–')}</td>
    </tr>`;
  }).join('');
  cont.innerHTML = `
    <div class="search-card" style="padding:0;overflow:hidden;">
      <table class="dep-table">
        <thead><tr><th>Linie</th><th>Richtung</th><th>Plan</th><th>Status</th><th>Steig</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Hilfs-Funktionen ────────────────────────────────────────
function formatISOTime(iso) {
  if (!iso) return '–';
  try { const d = new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  catch { return iso; }
}
function formatDuration(iso) {
  if (!iso) return '–';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h = parseInt(m[1]||0), min = parseInt(m[2]||0);
  return h ? `${h}h ${min}min` : `${min} min`;
}
function getDelayBadge(leg) {
  if (!leg || leg.type !== 'timed') return '';
  if (!leg.depRT || leg.depRT === leg.depPlan) return '<span class="delay-tag delay-ok">Pünktlich</span>';
  const diff = Math.round((new Date(leg.depRT) - new Date(leg.depPlan)) / 60000);
  if (diff <= 0) return '<span class="delay-tag delay-ok">Pünktlich</span>';
  return diff < 5
    ? `<span class="delay-tag delay-late">+${diff} min</span>`
    : `<span class="delay-tag delay-cancel">+${diff} min</span>`;
}
function modeKey(mode) {
  if (!mode) return 'bus';
  const m = mode.toLowerCase();
  if (m.includes('tram')||m.includes('city')) return 'tram';
  if (m.includes('suburban')) return 's';
  if (m.includes('regional')) return 're';
  if (m.includes('high')||m.includes('ice')) return 'ice';
  if (m.includes('intercity')||m.includes('ic')) return 'ic';
  return 'bus';
}
function showError(containerId, msg) {
  document.getElementById(containerId).innerHTML = `<div class="error-box">&#x26A0; ${escH(msg)}</div>`;
}
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function resetSearch() {
  ['from-input','to-input','via-input','from-ref','to-ref','via-ref'].forEach(id=>{ document.getElementById(id).value=''; });
  document.getElementById('result-area').style.display='none';
  document.getElementById('results-container').innerHTML='';
  document.getElementById('exclude-tags').innerHTML='';
  document.getElementById('seg-transfer-list').innerHTML='';
}

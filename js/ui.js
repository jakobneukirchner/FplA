import { searchStops, searchTrips, getDepartures } from './trias.js';

let lastSearchParams = null;
let lastTrips = [];

document.addEventListener('DOMContentLoaded', () => {
  initDateTimeDefaults();
  initAutocomplete('from-input',    'from-ref',    'from-list');
  initAutocomplete('to-input',      'to-ref',      'to-list');
  initAutocomplete('via-input',     'via-ref',     'via-list');
  initAutocomplete('dep-stop-input','dep-stop-ref','dep-stop-list');

  document.getElementById('btn-search').addEventListener('click', runTripSearch);
  document.getElementById('btn-reset').addEventListener('click', resetSearch);
  document.getElementById('btn-dep').addEventListener('click', runDepartures);
  document.getElementById('btn-swap').addEventListener('click', swapStops);
  document.getElementById('btn-add-exclude').addEventListener('click', addExcludeLine);
  document.getElementById('btn-add-segment').addEventListener('click', addSegmentTransfer);
  document.getElementById('btn-share').addEventListener('click', shareSearch);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  // Sortier-Chips
  document.querySelectorAll('.sort-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(lastTrips.length) renderTrips(lastTrips, document.getElementById('results-container'), lastSearchParams);
    });
  });

  // URL-Parameter beim Laden auswerten
  restoreFromURL();
});

function initDateTimeDefaults() {
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  const d=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const t=`${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ['travel-date','dep-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=d;});
  ['travel-time','dep-time'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=t;});
}

function initAutocomplete(inputId,refId,listId) {
  const input=document.getElementById(inputId);
  const refEl=document.getElementById(refId);
  const list =document.getElementById(listId);
  if(!input) return;
  let timer;
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    refEl.value='';
    const q=input.value.trim();
    if(q.length<2){list.innerHTML='';list.style.display='none';return;}
    timer=setTimeout(async()=>{
      try{
        const stops=await searchStops(q);
        list.innerHTML='';
        stops.forEach(s=>{
          const li=document.createElement('li');
          li.textContent=s.name;
          li.addEventListener('mousedown',()=>{input.value=s.name;refEl.value=s.ref;list.style.display='none';});
          list.appendChild(li);
        });
        list.style.display=stops.length?'block':'none';
      }catch(e){console.error(e);}
    },320);
  });
  document.addEventListener('click',e=>{if(!input.contains(e.target))list.style.display='none';});
}

function swapStops() {
  const fi=document.getElementById('from-input'),fr=document.getElementById('from-ref');
  const ti=document.getElementById('to-input'),  tr=document.getElementById('to-ref');
  [fi.value,ti.value]=[ti.value,fi.value];
  [fr.value,tr.value]=[tr.value,fr.value];
}

function addExcludeLine(lineName) {
  const val=typeof lineName==='string'?lineName:document.getElementById('exclude-line-input').value.trim();
  if(!val) return;
  const existing=[...document.querySelectorAll('#exclude-tags .exclude-tag')].map(t=>t.dataset.line);
  if(existing.includes(val)) return;
  const tag=document.createElement('span');
  tag.className='exclude-tag'; tag.dataset.line=val;
  tag.innerHTML=`${escH(val)} <button title="Entfernen"><span class="material-icons" style="font-size:16px">close</span></button>`;
  tag.querySelector('button').addEventListener('click',()=>tag.remove());
  document.getElementById('exclude-tags').appendChild(tag);
  if(typeof lineName!=='string') document.getElementById('exclude-line-input').value='';
}
function getExcludeLines() {
  return [...document.querySelectorAll('#exclude-tags .exclude-tag')].map(t=>t.dataset.line);
}

function addSegmentTransfer() {
  const stop=document.getElementById('seg-stop-input').value.trim();
  const min =document.getElementById('seg-min-input').value.trim();
  if(!stop||!min) return;
  const row=document.createElement('div');
  row.className='seg-row'; row.dataset.stop=stop; row.dataset.min=min;
  row.innerHTML=`<span class="seg-stop">${escH(stop)}</span><span class="seg-min">${escH(min)} min</span><button title="Entfernen"><span class="material-icons" style="font-size:18px">close</span></button>`;
  row.querySelector('button').addEventListener('click',()=>row.remove());
  document.getElementById('seg-transfer-list').appendChild(row);
  document.getElementById('seg-stop-input').value='';
  document.getElementById('seg-min-input').value='';
}
function getSegmentTransfers() {
  return [...document.querySelectorAll('#seg-transfer-list .seg-row')].map(r=>({stopRef:r.dataset.stop,minutes:parseInt(r.dataset.min)}));
}

function collectSearchParams() {
  const modes=[...document.querySelectorAll('#vm-chips input[type=checkbox]:checked')].map(c=>c.value);
  return {
    fromRef: document.getElementById('from-ref').value.trim(),
    fromName:document.getElementById('from-input').value.trim(),
    toRef:   document.getElementById('to-ref').value.trim(),
    toName:  document.getElementById('to-input').value.trim(),
    viaRef:  document.getElementById('via-ref').value.trim(),
    viaName: document.getElementById('via-input').value.trim(),
    date:    document.getElementById('travel-date').value,
    time:    document.getElementById('travel-time').value,
    untilTime:document.getElementById('travel-until').value,
    timeType: document.getElementById('time-type').value,
    numResults:      document.getElementById('num-results').value,
    algorithm:       document.getElementById('opt-mode').value,
    maxChanges:      document.getElementById('max-changes').value,
    minTransferTime: document.getElementById('min-transfer').value,
    segmentTransfers:getSegmentTransfers(),
    excludeLines:    getExcludeLines(),
    modes,
    wheelchair:document.getElementById('opt-wheelchair').checked,
    bike:      document.getElementById('opt-bike').checked,
    lowfloor:  document.getElementById('opt-lowfloor').checked
  };
}

async function runTripSearch(overrideParams) {
  const params=(overrideParams&&typeof overrideParams==='object'&&!overrideParams.target)?overrideParams:collectSearchParams();
  if(!params.fromRef||!params.toRef){
    showError('results-container','Bitte Start und Ziel aus der Vorschlagsliste wählen.');
    document.getElementById('result-area').style.display='block';
    return;
  }
  lastSearchParams=params;
  updateURL(params);
  const cont=document.getElementById('results-container');
  cont.innerHTML='<div class="loading">Verbindungen werden gesucht …</div>';
  document.getElementById('result-area').style.display='block';
  document.getElementById('sort-bar').style.display='flex';
  try{
    const trips=await searchTrips(params);
    lastTrips=trips;
    renderTrips(trips,cont,params);
  }catch(e){
    showError('results-container','Fehler bei der TRIAS-Anfrage: '+e.message);
  }
}

async function runDepartures() {
  const ref=document.getElementById('dep-stop-ref').value.trim();
  if(!ref){document.getElementById('dep-result').innerHTML='<div class="error-box">Bitte Haltestelle aus der Vorschlagsliste wählen.</div>';return;}
  const date =document.getElementById('dep-date').value;
  const time =document.getElementById('dep-time').value;
  const until=document.getElementById('dep-until').value;
  const count=document.getElementById('dep-count').value;
  const filter=document.querySelector('input[name="dep-mode"]:checked')?.value||'all';
  document.getElementById('dep-result').innerHTML='<div class="loading">Lade Abfahrten …</div>';
  try{
    const deps=await getDepartures(ref,date,time,count);
    renderDepartures(deps,filter,until);
  }catch(e){
    document.getElementById('dep-result').innerHTML=`<div class="error-box">Fehler: ${escH(e.message)}</div>`;
  }
}

// ── Sortierung ───────────────────────────────────────────────
function getSortMode() {
  return document.querySelector('.sort-chip.active')?.dataset.sort||'default';
}
function sortedTrips(trips) {
  const mode=getSortMode();
  if(mode==='dep')  return [...trips].sort((a,b)=>a.startTime.localeCompare(b.startTime));
  if(mode==='arr')  return [...trips].sort((a,b)=>a.endTime.localeCompare(b.endTime));
  if(mode==='dur')  return [...trips].sort((a,b)=>parseDurMin(a.duration)-parseDurMin(b.duration));
  return trips;
}
function parseDurMin(iso){
  if(!iso) return 9999;
  const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return m?(parseInt(m[1]||0)*60+parseInt(m[2]||0)):9999;
}

// ── URL-Share ────────────────────────────────────────────────
function updateURL(p) {
  const u=new URL(location.href);
  const set=(k,v)=>{if(v)u.searchParams.set(k,v);else u.searchParams.delete(k);};
  set('from',p.fromName); set('fromRef',p.fromRef);
  set('to',p.toName);     set('toRef',p.toRef);
  set('via',p.viaName);   set('viaRef',p.viaRef);
  set('date',p.date);     set('time',p.time);
  set('timeType',p.timeType); set('until',p.untilTime);
  set('algo',p.algorithm);    set('maxC',p.maxChanges);
  set('modes',(p.modes||[]).join(','));
  if(p.excludeLines?.length) set('excl',p.excludeLines.join(','));
  history.replaceState(null,'',u.toString());
}
function shareSearch() {
  const url=location.href;
  if(navigator.share){navigator.share({title:'FplA Verbindung',url});return;}
  navigator.clipboard.writeText(url).then(()=>{
    const btn=document.getElementById('btn-share');
    btn.innerHTML='<span class="material-icons">check</span> Kopiert!';
    setTimeout(()=>btn.innerHTML='<span class="material-icons">share</span> Teilen',2000);
  });
}
function restoreFromURL() {
  const p=new URLSearchParams(location.search);
  const get=(k,def='')=>p.get(k)||def;
  const fromRef=get('fromRef'),toRef=get('toRef');
  if(!fromRef||!toRef) return;
  // Felder befüllen
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  s('from-input',get('from')); s('from-ref',fromRef);
  s('to-input',  get('to'));   s('to-ref',  toRef);
  s('via-input', get('via'));  s('via-ref',  get('viaRef'));
  s('travel-date',get('date')); s('travel-time',get('time'));
  s('travel-until',get('until')); s('time-type',get('timeType','dep'));
  s('opt-mode',get('algo','fastest')); s('max-changes',get('maxC','2'));
  const modes=get('modes','').split(',').filter(Boolean);
  if(modes.length){
    document.querySelectorAll('#vm-chips input[type=checkbox]').forEach(cb=>{
      cb.checked=modes.includes(cb.value);
      cb.closest('label').classList.toggle('checked',cb.checked);
    });
  }
  const excl=get('excl','').split(',').filter(Boolean);
  excl.forEach(l=>addExcludeLine(l));
  // travel-view: sofort Reiseansicht laden
  if(p.has('travel-view')) {
    runTripSearch({fromRef,fromName:get('from'),toRef,toName:get('to'),
      viaRef:get('viaRef'),viaName:get('via'),
      date:get('date'),time:get('time'),untilTime:get('until'),timeType:get('timeType','dep'),
      numResults:5,algorithm:get('algo','fastest'),maxChanges:get('maxC','2'),
      minTransferTime:3,segmentTransfers:[],excludeLines:excl,
      modes:modes.length?modes:['bus','tram','s','re','ic','ice'],
      wheelchair:false,bike:false,lowfloor:false});
    // Reiseansicht: alle Karten aufgeklappt + Druckdialog
    setTimeout(()=>{
      document.querySelectorAll('.result-card').forEach(c=>c.classList.add('open'));
    },2000);
  }
}

// ── Renderer: Trips ──────────────────────────────────────────
function renderTrips(trips,cont,params) {
  const sorted=sortedTrips(trips);
  if(!sorted.length){
    cont.innerHTML='<div class="md-card section-card"><div class="empty-state"><span class="material-icons">search_off</span><p>Keine Verbindungen gefunden.</p></div></div>';
    return;
  }
  cont.innerHTML=sorted.map((t,i)=>{
    const dur=formatDuration(t.duration);
    const depFmt=formatISOTime(t.startTime);
    const arrFmt=formatISOTime(t.endTime);
    const changes=t.changes<=0?'Direktverbindung':t.changes+' Umstieg'+(t.changes>1?'e':'');
    const delay=getDelayChip(t.legs[0]);
    const fare=t.fare?`<span class="fare-badge">${escH(t.fare)} €</span>`:'';
    const pills=t.legs.filter(l=>l.type==='timed').map(leg=>{
      const mk=modeKey(leg.mode);
      const ln=escH(leg.lineName||'?');
      return `<span class="product-pill mode-${mk}">${ln}</span>`+
             `<button class="pill-exclude-btn" title="Ohne Linie ${ln} suchen" onclick="window.__excludeLine('${escH((leg.lineName||'').replace(/'/g,"\\'"))}')"><span class="material-icons" style="font-size:14px">block</span></button>`;
    }).join('');
    const timeline=t.legs.map((leg,li)=>{
      if(leg.type==='walk') return `<div class="tl-step"><div class="tl-time">–</div><div class="tl-dot"><div class="dot dot-walk"></div><div class="tl-line"></div></div><div class="tl-info"><div class="tl-walk-label">Fußweg · ${formatDuration(leg.duration)}</div></div></div>`;
      const isLast=li===t.legs.length-1;
      const inter=leg.intermediates?.length
        ?`<details class="inter-stops"><summary>${leg.intermediates.length} Zwischenhalt${leg.intermediates.length>1?'e':''}</summary><ul>${leg.intermediates.map(s=>`<li><span>${escH(s.stop)}</span><span class="inter-time">${formatISOTime(s.dep)}</span></li>`).join('')}</ul></details>`:'';
      return `<div class="tl-step"><div class="tl-time">${formatISOTime(leg.depPlan)}</div><div class="tl-dot"><div class="dot"></div><div class="tl-line"></div></div><div class="tl-info"><div class="tl-stop">${escH(leg.fromStop)}</div>${leg.platform?`<div class="tl-platform">Gleis / Steig ${escH(leg.platform)}</div>`:''}<div class="tl-vehicle"><span class="product-pill mode-${modeKey(leg.mode)}">${escH(leg.lineName||'?')}</span><span class="tl-vehicle-dest">Richtung ${escH(leg.direction||'')}</span><button class="tl-exclude-btn" onclick="window.__excludeLine('${escH((leg.lineName||'').replace(/'/g,"\\'"))}')"><span class="material-icons" style="font-size:14px">block</span> Ohne diese Linie</button></div>${inter}</div></div><div class="tl-step"><div class="tl-time">${formatISOTime(leg.arrPlan)}</div><div class="tl-dot"><div class="dot ${isLast?'dot-dest':''}"></div>${isLast?'':'<div class="tl-line"></div>'}</div><div class="tl-info"><div class="tl-stop">${escH(leg.toStop)}</div></div></div>`;
    }).join('');
    return `<div class="result-card md-card" id="rc-${i}"><div class="result-header" onclick="document.getElementById('rc-${i}').classList.toggle('open')"><div class="time-col"><div class="dep">${depFmt}</div><div class="arr">Ankunft ${arrFmt}</div></div><span class="duration-chip">${dur}</span><span class="changes-label">${changes}</span><div class="product-pills">${pills}</div>${fare}${delay}<span class="material-icons expand-icon">expand_more</span></div><div class="result-detail"><div class="timeline">${timeline}</div><p class="disclaimer">Alle Angaben ohne Gewähr. Fahrplandaten: Connect GmbH / HannIT.</p></div></div>`;
  }).join('');

  window.__excludeLine=(lineName)=>{
    addExcludeLine(lineName);
    if(lastSearchParams){
      const np={...lastSearchParams,excludeLines:[...(lastSearchParams.excludeLines||[]),lineName].filter((v,i,a)=>a.indexOf(v)===i)};
      runTripSearch(np);
    }
  };
}

// ── Renderer: Abfahrten ──────────────────────────────────────
function renderDepartures(deps,filter,until) {
  const cont=document.getElementById('dep-result');
  let f=filter==='all'?deps:deps.filter(d=>modeKey(d.mode)===filter);
  if(until) f=f.filter(d=>formatISOTime(d.depPlan||d.depRT)<=until);
  if(!f.length){cont.innerHTML='<div class="md-card section-card"><div class="empty-state"><span class="material-icons">directions_bus</span><p>Keine Abfahrten gefunden.</p></div></div>';return;}
  cont.innerHTML=`<div class="md-card" style="overflow:hidden;margin-bottom:20px"><table class="dep-table"><thead><tr><th>Linie</th><th>Richtung</th><th>Abfahrt</th><th>Status</th><th>Steig</th></tr></thead><tbody>${
    f.map(d=>{
      const plan=formatISOTime(d.depPlan);
      const rt=d.depRT?formatISOTime(d.depRT):plan;
      const late=d.depRT&&d.depRT!==d.depPlan;
      return `<tr><td><span class="product-pill mode-${modeKey(d.mode)}">${escH(d.line)}</span></td><td>${escH(d.direction)}</td><td>${plan}</td><td>${late?`<span class="dep-late">${rt}</span>`:'<span class="dep-ok">pünktlich</span>'}</td><td>${escH(d.platform||'–')}</td></tr>`;
    }).join('')
  }</tbody></table></div>`;
}

// ── Hilfsfunktionen ──────────────────────────────────────────
function formatISOTime(iso){
  if(!iso) return '–';
  try{const d=new Date(iso);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}catch{return iso;}
}
function formatDuration(iso){
  if(!iso) return '–';
  const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if(!m) return iso;
  const h=parseInt(m[1]||0),min=parseInt(m[2]||0);
  return h?`${h} h ${min} min`:`${min} min`;
}
function getDelayChip(leg){
  if(!leg||leg.type!=='timed'||!leg.depRT||leg.depRT===leg.depPlan) return '<span class="delay-chip delay-ok">Pünktlich</span>';
  const diff=Math.round((new Date(leg.depRT)-new Date(leg.depPlan))/60000);
  if(diff<=0) return '<span class="delay-chip delay-ok">Pünktlich</span>';
  return diff<5?`<span class="delay-chip delay-late">+${diff} min</span>`:`<span class="delay-chip delay-cancel">+${diff} min</span>`;
}
function modeKey(mode){
  if(!mode) return 'bus';
  const m=mode.toLowerCase();
  if(m.includes('tram')||m.includes('city')) return 'tram';
  if(m.includes('suburban'))                 return 's';
  if(m.includes('regional'))                 return 're';
  if(m.includes('high')||m.includes('ice'))  return 'ice';
  if(m.includes('intercity')||m.includes('ic')) return 'ic';
  return 'bus';
}
function showError(id,msg){document.getElementById(id).innerHTML=`<div class="error-box">${escH(msg)}</div>`;}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function resetSearch(){
  ['from-input','to-input','via-input','from-ref','to-ref','via-ref'].forEach(id=>{document.getElementById(id).value=''});
  document.getElementById('result-area').style.display='none';
  document.getElementById('results-container').innerHTML='';
  document.getElementById('sort-bar').style.display='none';
  document.getElementById('exclude-tags').innerHTML='';
  document.getElementById('seg-transfer-list').innerHTML='';
  lastSearchParams=null; lastTrips=[];
  history.replaceState(null,'',location.pathname);
}

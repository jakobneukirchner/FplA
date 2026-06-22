// ══════════════════════════════════════════════════════════
// trias.js  –  TRIAS-Request-Builder und Parser
// ══════════════════════════════════════════════════════════

const TRIAS_ENDPOINT = '/.netlify/functions/trias';

function nowISO() { return new Date().toISOString().slice(0,19)+'Z'; }
function dateTimeISO(d,t) { if(!d||!t) return nowISO(); return `${d}T${t}:00Z`; }

async function triasPost(xml) {
  const r = await fetch(TRIAS_ENDPOINT,{
    method:'POST', headers:{'Content-Type':'application/xml'}, body:xml
  });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return new DOMParser().parseFromString(await r.text(),'application/xml');
}

// ── XML-Helfer: namespace-agnostisch via localName ──────────
// querySelector scheitert bei TRIAS wegen Namespace-Präfixen.
// Wir traversieren den Baum manuell nach localName.
function getEl(node, ...tags) {
  let cur = node;
  for (const tag of tags) {
    if (!cur) return null;
    cur = findChild(cur, tag);
  }
  return cur;
}
function findChild(node, localName) {
  if (!node) return null;
  const ch = node.childNodes;
  for (let i=0;i<ch.length;i++) {
    const c = ch[i];
    if (c.nodeType===1 && c.localName===localName) return c;
  }
  return null;
}
function findAll(node, localName) {
  const res=[];
  if(!node) return res;
  function walk(n) {
    const ch=n.childNodes;
    for(let i=0;i<ch.length;i++) {
      const c=ch[i];
      if(c.nodeType!==1) continue;
      if(c.localName===localName) res.push(c);
      walk(c);
    }
  }
  walk(node);
  return res;
}
function txt(node, ...tags) {
  const el = getEl(node,...tags);
  return el ? el.textContent.trim() : '';
}
function escXML(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── LocationInformationRequest ──────────────────────────────
export async function searchStops(query) {
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>FplA</ns2:RequestorRef>
    <RequestPayload>
      <LocationInformationRequest>
        <InitialInput><LocationName>${escXML(query)}</LocationName></InitialInput>
        <Restrictions><NumberOfResults>20</NumberOfResults><Type>stop</Type></Restrictions>
      </LocationInformationRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  const doc = await triasPost(xml);
  const seen = new Map();
  findAll(doc,'Location').forEach(l=>{
    const spRef  = txt(l,'StopPlace','StopPlaceRef')  || txt(l,'StopPlaceRef');
    const spName = txt(l,'StopPlace','StopPlaceName','Text') || txt(l,'StopPlaceName','Text');
    const ptRef  = txt(l,'StopPoint','StopPointRef')  || txt(l,'StopPointRef');
    const ptName = txt(l,'StopPoint','StopPointName','Text') || txt(l,'StopPointName','Text');
    const locName= txt(l,'LocationName','Text');
    const name   = spName || locName || ptName;
    const ref    = spRef  || ptRef;
    if(!ref||!name) return;
    const key=name.trim().toLowerCase();
    if(!seen.has(key)) seen.set(key,{name:name.trim(),ref});
    else if(spRef) seen.set(key,{name:name.trim(),ref:spRef});
  });
  return [...seen.values()].slice(0,8);
}

// ── TripRequest ─────────────────────────────────────────────
export async function searchTrips(params) {
  const depArr = params.timeType==='arr'?'Arr':'Dep';
  const dt = dateTimeISO(params.date,params.time);
  const viaBlock = params.viaRef?`<Via><ViaPoint><LocationRef><StopPointRef>${escXML(params.viaRef)}</StopPointRef><LocationName><Text>${escXML(params.viaName||'')}</Text></LocationName></LocationRef></ViaPoint></Via>`:'';
  const modesBlock  = buildModesBlock(params.modes||[]);
  const excludeBlock= (params.excludeLines||[]).map(l=>`<ExcludedLine><PublishedLineName><Text>${escXML(l)}</Text></PublishedLineName></ExcludedLine>`).join('');
  const accessBlock = [params.wheelchair?'<WheelchairAccess>true</WheelchairAccess>':'',params.bike?'<BikesAllowed>true</BikesAllowed>':'',params.lowfloor?'<LowFloor>true</LowFloor>':''].filter(Boolean).join('');
  const maxChangesBlock  = (params.maxChanges!==''&&params.maxChanges!=null)?`<MaxChanges>${parseInt(params.maxChanges)}</MaxChanges>`  :'';
  const minTransferBlock = parseInt(params.minTransferTime)>0?`<MinChangeTime>${parseInt(params.minTransferTime)}</MinChangeTime>`:'';
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>FplA</ns2:RequestorRef>
    <RequestPayload>
      <TripRequest>
        <Origin>
          <LocationRef><StopPointRef>${escXML(params.fromRef)}</StopPointRef><LocationName><Text>${escXML(params.fromName||'')}</Text></LocationName></LocationRef>
          <DepArrTime>${dt}</DepArrTime>
          <ArrivalDeparture>${depArr}</ArrivalDeparture>
        </Origin>
        <Destination>
          <LocationRef><StopPointRef>${escXML(params.toRef)}</StopPointRef><LocationName><Text>${escXML(params.toName||'')}</Text></LocationName></LocationRef>
        </Destination>
        ${viaBlock}
        <Params>
          <NumberOfResults>${parseInt(params.numResults)||5}</NumberOfResults>
          <AlgorithmType>${escXML(params.algorithm||'fastest')}</AlgorithmType>
          ${maxChangesBlock}${minTransferBlock}${modesBlock}${excludeBlock}${accessBlock}
          <IncludeFares>true</IncludeFares>
          <IncludeIntermediateStops>true</IncludeIntermediateStops>
        </Params>
      </TripRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  const doc = await triasPost(xml);
  return parseTrips(doc);
}

// ── StopEventRequest ────────────────────────────────────────
export async function getDepartures(stopRef,date,time,count) {
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>FplA</ns2:RequestorRef>
    <RequestPayload>
      <StopEventRequest>
        <Location><LocationRef><StopPointRef>${escXML(stopRef)}</StopPointRef></LocationRef><DepArrTime>${dateTimeISO(date,time)}</DepArrTime></Location>
        <Params><NumberOfResults>${parseInt(count)||10}</NumberOfResults><StopEventType>departure</StopEventType><IncludeRealtimeData>true</IncludeRealtimeData></Params>
      </StopEventRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  return parseStopEvents(await triasPost(xml));
}

function buildModesBlock(modes) {
  const map={bus:'bus',tram:'tram',s:'suburbanRailway',re:'regionalRail',ic:'intercityRail',ice:'highSpeedRail',ferry:'water',taxi:'demandResponsive'};
  const allKeys=Object.keys(map);
  const excluded=allKeys.filter(m=>!modes.includes(m)&&map[m]);
  if(!excluded.length||modes.length===allKeys.length||!modes.length) return '';
  return `<ExcludedModes>${excluded.map(m=>`<Mode><PtMode>${map[m]}</PtMode></Mode>`).join('')}</ExcludedModes>`;
}

function parseTrips(doc) {
  const results=[];
  findAll(doc,'TripResult').forEach(tr=>{
    const trip=getEl(tr,'Trip'); if(!trip) return;
    const legs=[];
    findAll(trip,'TripLeg').forEach(leg=>{
      const tl=getEl(leg,'TimedLeg');
      const cl=getEl(leg,'ContinuousLeg');
      if(tl){
        const board =getEl(tl,'LegBoard');
        const alight=getEl(tl,'LegAlight');
        const svc   =getEl(tl,'Service');
        const inter =findAll(tl,'LegIntermediates');
        legs.push({
          type:'timed',
          lineName: txt(svc||tl,'PublishedLineName','Text'),
          lineId:   txt(svc||tl,'LineRef'),
          mode:     txt(svc||tl,'PtMode'),
          direction:txt(svc||tl,'DestinationText','Text'),
          fromStop: txt(board,'StopPointName','Text'),
          fromRef:  txt(board,'StopPointRef'),
          depPlan:  txt(board,'ServiceDeparture','TimetabledTime'),
          depRT:    txt(board,'ServiceDeparture','EstimatedTime'),
          platform: txt(board,'PlannedBay','Text'),
          toStop:   txt(alight,'StopPointName','Text'),
          arrPlan:  txt(alight,'ServiceArrival','TimetabledTime'),
          arrRT:    txt(alight,'ServiceArrival','EstimatedTime'),
          intermediates:inter.map(i=>({
            stop:txt(i,'StopPointName','Text'),
            dep: txt(i,'ServiceDeparture','TimetabledTime')
          }))
        });
      } else if(cl){
        const ls=getEl(cl,'LegStart'), le=getEl(cl,'LegEnd');
        legs.push({type:'walk',duration:txt(cl,'Duration'),fromStop:txt(ls,'LocationName','Text'),toStop:txt(le,'LocationName','Text')});
      }
    });
    results.push({
      duration: txt(trip,'Duration'),
      startTime:legs[0]?.depPlan||legs[0]?.depRT||'',
      endTime:  legs[legs.length-1]?.arrPlan||'',
      changes:  legs.filter(l=>l.type==='timed').length-1,
      legs,
      fare:txt(tr,'FareResult','PassengerFare','Amount')
    });
  });
  return results;
}

function parseStopEvents(doc) {
  const results=[];
  findAll(doc,'StopEventResult').forEach(se=>{
    const ev=getEl(se,'StopEvent'); if(!ev) return;
    const svc=getEl(ev,'Service');
    const call=getEl(ev,'ThisCall');
    const cas=call?getEl(call,'CallAtStop'):null;
    results.push({
      line:     txt(svc,'PublishedLineName','Text'),
      direction:txt(svc,'DestinationText','Text'),
      depPlan:  txt(cas,'ServiceDeparture','TimetabledTime'),
      depRT:    txt(cas,'ServiceDeparture','EstimatedTime'),
      platform: txt(cas,'PlannedBay','Text'),
      mode:     txt(svc,'PtMode')
    });
  });
  return results;
}

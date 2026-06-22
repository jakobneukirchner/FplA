/**
 * trias.js – TRIAS 1.2 Client
 * Alle XML-Operationen namespace-agnostisch via localName.
 */

const API = '/.netlify/functions/trias';

// ─────────────────────────────────────────────────────────────────
// Öffentliche API
// ─────────────────────────────────────────────────────────────────

/** Haltestellensuche. Gibt [{name, ref}] zurück, dedupliziert nach Name. */
export async function searchStops(query) {
  const doc = await post(xmlLocation(query));
  const seen = new Map();
  all(doc, 'Location').forEach(loc => {
    const name = txt(loc,'StopPlaceName','Text')
              || txt(loc,'LocationName','Text')
              || txt(loc,'StopPointName','Text');
    const ref  = txt(loc,'StopPlaceRef') || txt(loc,'StopPointRef');
    if (!name || !ref) return;
    const key = name.toLowerCase().trim();
    if (!seen.has(key)) seen.set(key, { name: name.trim(), ref });
  });
  return [...seen.values()].slice(0, 8);
}

/** Verbindungssuche. Gibt Array von Trip-Objekten zurück. */
export async function searchTrips(p) {
  const doc = await post(xmlTrip(p));
  return parseTrips(doc);
}

/** Abfahrtsmonitor. Gibt Array von Departure-Objekten zurück. */
export async function getDepartures(stopRef, date, time, count) {
  const doc = await post(xmlStopEvent(stopRef, date, time, count));
  return parseStopEvents(doc);
}

// ─────────────────────────────────────────────────────────────────
// XML-Builder
// ─────────────────────────────────────────────────────────────────

function xmlLocation(query) {
  return wrap(`
  <LocationInformationRequest>
    <InitialInput><LocationName>${x(query)}</LocationName></InitialInput>
    <Restrictions><NumberOfResults>20</NumberOfResults><Type>stop</Type></Restrictions>
  </LocationInformationRequest>`);
}

function xmlTrip(p) {
  const dt = iso(p.date, p.time);
  const depArr = p.timeType === 'arr' ? 'Arr' : 'Dep';

  const via = p.viaRef ? `
    <Via><ViaPoint><LocationRef>
      <StopPointRef>${x(p.viaRef)}</StopPointRef>
      <LocationName><Text>${x(p.viaName||'')}</Text></LocationName>
    </LocationRef></ViaPoint></Via>` : '';

  const excluded = (p.excludeLines||[]).map(l =>
    `<ExcludedLine><PublishedLineName><Text>${x(l)}</Text></PublishedLineName></ExcludedLine>`
  ).join('');

  const ALL_MODES = { bus:'bus', tram:'tram', s:'suburbanRailway', re:'regionalRail',
                      ic:'intercityRail', ice:'highSpeedRail', ferry:'water', taxi:'demandResponsive' };
  const selectedModes = p.modes && p.modes.length ? p.modes : Object.keys(ALL_MODES);
  const excludedModes = Object.keys(ALL_MODES).filter(k => !selectedModes.includes(k));
  const modesXml = excludedModes.length
    ? `<ExcludedModes>${excludedModes.map(k => `<Mode><PtMode>${ALL_MODES[k]}</PtMode></Mode>`).join('')}</ExcludedModes>`
    : '';

  const access = [
    p.wheelchair ? '<WheelchairAccess>true</WheelchairAccess>' : '',
    p.bike       ? '<BikesAllowed>true</BikesAllowed>' : '',
    p.lowfloor   ? '<LowFloor>true</LowFloor>' : ''
  ].filter(Boolean).join('');

  return wrap(`
  <TripRequest>
    <Origin>
      <LocationRef>
        <StopPointRef>${x(p.fromRef)}</StopPointRef>
        <LocationName><Text>${x(p.fromName||'')}</Text></LocationName>
      </LocationRef>
      <DepArrTime>${dt}</DepArrTime>
      <ArrivalDeparture>${depArr}</ArrivalDeparture>
    </Origin>
    <Destination>
      <LocationRef>
        <StopPointRef>${x(p.toRef)}</StopPointRef>
        <LocationName><Text>${x(p.toName||'')}</Text></LocationName>
      </LocationRef>
    </Destination>
    ${via}
    <Params>
      <NumberOfResults>${parseInt(p.numResults)||5}</NumberOfResults>
      <AlgorithmType>${x(p.algorithm||'fastest')}</AlgorithmType>
      ${p.maxChanges !== '' && p.maxChanges != null ? `<MaxChanges>${parseInt(p.maxChanges)}</MaxChanges>` : ''}
      ${parseInt(p.minTransferTime) > 0 ? `<MinChangeTime>${parseInt(p.minTransferTime)}</MinChangeTime>` : ''}
      ${modesXml}
      ${excluded}
      ${access}
      <IncludeFares>true</IncludeFares>
      <IncludeIntermediateStops>true</IncludeIntermediateStops>
    </Params>
  </TripRequest>`);
}

function xmlStopEvent(stopRef, date, time, count) {
  return wrap(`
  <StopEventRequest>
    <Location>
      <LocationRef><StopPointRef>${x(stopRef)}</StopPointRef></LocationRef>
      <DepArrTime>${iso(date, time)}</DepArrTime>
    </Location>
    <Params>
      <NumberOfResults>${parseInt(count)||10}</NumberOfResults>
      <StopEventType>departure</StopEventType>
      <IncludeRealtimeData>true</IncludeRealtimeData>
    </Params>
  </StopEventRequest>`);
}

function wrap(payload) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias" xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${now()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>FplA</ns2:RequestorRef>
    <RequestPayload>${payload}</RequestPayload>
  </ServiceRequest>
</Trias>`;
}

// ─────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────

function parseTrips(doc) {
  return all(doc, 'TripResult').map(tr => {
    const trip = child(tr, 'Trip');
    if (!trip) return null;
    const legs = all(trip, 'TripLeg').map(parseLeg).filter(Boolean);
    return {
      duration:  txt(trip, 'Duration'),
      startTime: legs.find(l => l.type==='timed')?.depPlan || '',
      endTime:   [...legs].reverse().find(l => l.type==='timed')?.arrPlan || '',
      changes:   legs.filter(l => l.type==='timed').length - 1,
      fare:      txt(tr, 'FareResult', 'PassengerFare', 'Amount'),
      legs
    };
  }).filter(Boolean);
}

function parseLeg(leg) {
  const tl = child(leg, 'TimedLeg');
  const cl = child(leg, 'ContinuousLeg');
  if (tl) {
    const board  = child(tl, 'LegBoard');
    const alight = child(tl, 'LegAlight');
    const svc    = child(tl, 'Service');
    return {
      type:      'timed',
      lineName:  txt(svc||tl, 'PublishedLineName', 'Text'),
      lineRef:   txt(svc||tl, 'LineRef'),
      mode:      txt(svc||tl, 'PtMode'),
      direction: txt(svc||tl, 'DestinationText', 'Text'),
      fromStop:  txt(board,  'StopPointName', 'Text'),
      toStop:    txt(alight, 'StopPointName', 'Text'),
      depPlan:   txt(board,  'ServiceDeparture', 'TimetabledTime'),
      depRT:     txt(board,  'ServiceDeparture', 'EstimatedTime'),
      arrPlan:   txt(alight, 'ServiceArrival',   'TimetabledTime'),
      arrRT:     txt(alight, 'ServiceArrival',   'EstimatedTime'),
      platform:  txt(board,  'PlannedBay', 'Text'),
      intermediates: all(tl, 'LegIntermediates').map(i => ({
        stop: txt(i, 'StopPointName', 'Text'),
        dep:  txt(i, 'ServiceDeparture', 'TimetabledTime')
      }))
    };
  }
  if (cl) {
    return {
      type:     'walk',
      duration: txt(cl, 'Duration'),
      fromStop: txt(child(cl,'LegStart'), 'LocationName', 'Text'),
      toStop:   txt(child(cl,'LegEnd'),   'LocationName', 'Text')
    };
  }
  return null;
}

function parseStopEvents(doc) {
  return all(doc, 'StopEventResult').map(se => {
    const ev  = child(se, 'StopEvent'); if (!ev) return null;
    const svc = child(ev, 'Service');
    const cas = child(child(ev,'ThisCall'),'CallAtStop');
    return {
      line:      txt(svc, 'PublishedLineName', 'Text'),
      direction: txt(svc, 'DestinationText',   'Text'),
      mode:      txt(svc, 'PtMode'),
      depPlan:   txt(cas||ev, 'ServiceDeparture', 'TimetabledTime'),
      depRT:     txt(cas||ev, 'ServiceDeparture', 'EstimatedTime'),
      platform:  txt(cas||ev, 'PlannedBay', 'Text')
    };
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────
// XML-Traversal (namespace-agnostisch)
// ─────────────────────────────────────────────────────────────────

function all(node, localName) {
  if (!node) return [];
  const result = [];
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        if (c.localName === localName) result.push(c);
        walk(c);
      }
    }
  })(node);
  return result;
}

function child(node, localName) {
  if (!node) return null;
  for (const c of node.childNodes)
    if (c.nodeType === 1 && c.localName === localName) return c;
  return null;
}

function txt(node, ...path) {
  let cur = node;
  for (const name of path) {
    cur = all(cur, name)[0] || null;
    if (!cur) return '';
  }
  return cur ? cur.textContent.trim() : '';
}

// ─────────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────
function now()    { return new Date().toISOString().slice(0,19)+'Z'; }
function iso(d,t) { return (d && t) ? `${d}T${t}:00Z` : now(); }
function x(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function post(xml) {
  const r = await fetch(API, { method:'POST', headers:{'Content-Type':'application/xml'}, body:xml });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  const doc  = new DOMParser().parseFromString(text, 'application/xml');
  const errs = all(doc,'ErrorMessage');
  if (errs.length) {
    const desc = txt(errs[0],'Text','Text') || txt(errs[0],'Text') || `TRIAS-Fehler ${txt(errs[0],'Code')}`;
    throw new Error(desc);
  }
  return doc;
}

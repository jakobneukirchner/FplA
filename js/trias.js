// ══════════════════════════════════════════════════════════
// trias.js  –  TRIAS-Request-Builder und Parser
// ══════════════════════════════════════════════════════════

const TRIAS_ENDPOINT = '/.netlify/functions/trias';

function nowISO() {
  return new Date().toISOString().slice(0, 19) + 'Z';
}
function dateTimeISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return nowISO();
  return `${dateStr}T${timeStr}:00Z`;
}

// ── POST helper ────────────────────────────────────────────
async function triasPost(xml) {
  const r = await fetch(TRIAS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  return new DOMParser().parseFromString(text, 'application/xml');
}

// ── LocationInformationRequest ─────────────────────────────
// Fix: nach StopPlace deduplizieren, damit nicht jeder einzelne
// Steig separat erscheint (z.B. "Braunschweig, Grenzweg" x6)
export async function searchStops(query) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias"
  xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>PLACEHOLDER</ns2:RequestorRef>
    <RequestPayload>
      <LocationInformationRequest>
        <InitialInput>
          <LocationName>${escXML(query)}</LocationName>
        </InitialInput>
        <Restrictions>
          <NumberOfResults>20</NumberOfResults>
          <Type>stop</Type>
        </Restrictions>
      </LocationInformationRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  const doc = await triasPost(xml);

  // Deduplizierung: Ein StopPlace kann als mehrere StopPoints (Steige) zurück-
  // kommen. Wir gruppieren nach dem kanonischen Namen und behalten pro Name
  // den StopPlaceRef (bevorzugt) oder den ersten StopPointRef.
  const seen  = new Map(); // key: normalisierter Name  →  {name, ref}
  doc.querySelectorAll('Location').forEach(l => {
    // Bevorzuge StopPlace-Angaben über einzelne StopPoints
    const spRef  = getText(l, 'StopPlaceRef');
    const spName = getText(l, 'StopPlaceName Text');
    const ptRef  = getText(l, 'StopPointRef');
    const ptName = getText(l, 'StopPointName Text');
    const locName = getText(l, 'LocationName Text');

    const name = spName || locName || ptName;
    const ref  = spRef  || ptRef;
    if (!ref || !name) return;

    // Normalisierter Key für Deduplizierung
    const key = name.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name: name.trim(), ref });
    } else {
      // Falls wir vorher nur einen StopPointRef hatten, tausche gegen StopPlaceRef
      if (spRef && !seen.get(key).ref.startsWith(spRef.slice(0, 6))) {
        seen.set(key, { name: name.trim(), ref: spRef });
      }
    }
  });

  return [...seen.values()].slice(0, 8);
}

// ── TripRequest ──────────────────────────────────────────────
export async function searchTrips(params) {
  const depArr = params.timeType === 'arr' ? 'Arr' : 'Dep';
  const dt = dateTimeISO(params.date, params.time);

  const viaBlock = params.viaRef ? `
        <Via><ViaPoint><LocationRef>
          <StopPointRef>${escXML(params.viaRef)}</StopPointRef>
          <LocationName><Text>${escXML(params.viaName||'')}</Text></LocationName>
        </LocationRef></ViaPoint></Via>` : '';

  // Fix: Verkehrsmittelfilter korrekt in TRIAS-Syntax
  const modesBlock = buildModesBlock(params.modes || []);

  const excludeBlock = (params.excludeLines||[]).map(l =>
    `<ExcludedLine><PublishedLineName><Text>${escXML(l)}</Text></PublishedLineName></ExcludedLine>`
  ).join('');

  const accessBlock = [
    params.wheelchair ? '<WheelchairAccess>true</WheelchairAccess>' : '',
    params.bike       ? '<BikesAllowed>true</BikesAllowed>'         : '',
    params.lowfloor   ? '<LowFloor>true</LowFloor>'                 : ''
  ].filter(Boolean).join('');

  const maxChangesBlock = params.maxChanges !== '' && params.maxChanges != null
    ? `<MaxChanges>${parseInt(params.maxChanges)}</MaxChanges>` : '';

  const minTransferBlock = parseInt(params.minTransferTime) > 0
    ? `<MinChangeTime>${parseInt(params.minTransferTime)}</MinChangeTime>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias"
  xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>PLACEHOLDER</ns2:RequestorRef>
    <RequestPayload>
      <TripRequest>
        <Origin>
          <LocationRef>
            <StopPointRef>${escXML(params.fromRef)}</StopPointRef>
            <LocationName><Text>${escXML(params.fromName||'')}</Text></LocationName>
          </LocationRef>
          <DepArrTime>${dt}</DepArrTime>
          <ArrivalDeparture>${depArr}</ArrivalDeparture>
        </Origin>
        <Destination>
          <LocationRef>
            <StopPointRef>${escXML(params.toRef)}</StopPointRef>
            <LocationName><Text>${escXML(params.toName||'')}</Text></LocationName>
          </LocationRef>
        </Destination>
        ${viaBlock}
        <Params>
          <NumberOfResults>${parseInt(params.numResults)||5}</NumberOfResults>
          <AlgorithmType>${escXML(params.algorithm||'fastest')}</AlgorithmType>
          ${maxChangesBlock}
          ${minTransferBlock}
          ${modesBlock}
          ${excludeBlock}
          ${accessBlock}
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

// ── StopEventRequest ──────────────────────────────────────────
export async function getDepartures(stopRef, date, time, count) {
  const dt = dateTimeISO(date, time);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias"
  xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${nowISO()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>PLACEHOLDER</ns2:RequestorRef>
    <RequestPayload>
      <StopEventRequest>
        <Location>
          <LocationRef>
            <StopPointRef>${escXML(stopRef)}</StopPointRef>
          </LocationRef>
          <DepArrTime>${dt}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>${parseInt(count)||10}</NumberOfResults>
          <StopEventType>departure</StopEventType>
          <IncludeRealtimeData>true</IncludeRealtimeData>
        </Params>
      </StopEventRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  const doc = await triasPost(xml);
  return parseStopEvents(doc);
}

// ── XML-Helfer ──────────────────────────────────────────────
function getText(node, selector) {
  // querySelector versteht keine Leerzeichen als direkte Kind-Selektoren
  // daher manuell auflösen
  const parts = selector.split(' ');
  let cur = node;
  for (const p of parts) {
    if (!cur) return '';
    cur = cur.querySelector(p);
  }
  return cur ? cur.textContent.trim() : '';
}
function escXML(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Fix: Verkehrsmittelfilter – TRIAS erwartet einen einzigen <Modes>-Block
// mit mehreren <Mode>-Kindelementen, NICHT mehrere <IncludedModes>-Elemente
function buildModesBlock(modes) {
  const map = {
    bus:   'bus',
    tram:  'tram',
    s:     'suburbanRailway',
    re:    'regionalRail',
    ic:    'intercityRail',
    ice:   'highSpeedRail',
    ferry: 'water',
    taxi:  'demandResponsive'
  };
  if (!modes.length) return '';
  const modeItems = modes
    .filter(m => map[m])
    .map(m => `<Mode><PtMode>${map[m]}</PtMode></Mode>`)
    .join('');
  if (!modeItems) return '';
  return `<Modes><Mode><PtMode>all</PtMode></Mode></Modes>\n          <ExcludedModes>${
    Object.keys(map)
      .filter(m => !modes.includes(m) && map[m])
      .map(m => `<Mode><PtMode>${map[m]}</PtMode></Mode>`)
      .join('')
  }</ExcludedModes>`;
}

// ── Trip-Parser ─────────────────────────────────────────────
function parseTrips(doc) {
  const results = [];
  doc.querySelectorAll('TripResult').forEach(tr => {
    const trip = tr.querySelector('Trip');
    if (!trip) return;
    const legs = [];
    trip.querySelectorAll('TripLeg').forEach(leg => {
      const tl = leg.querySelector('TimedLeg');
      const cl = leg.querySelector('ContinuousLeg');
      if (tl) {
        const board  = tl.querySelector('LegBoard');
        const alight = tl.querySelector('LegAlight');
        const inter  = [...tl.querySelectorAll('LegIntermediates')];
        const svc    = tl.querySelector('Service');
        legs.push({
          type:      'timed',
          lineName:  getText(svc||tl, 'PublishedLineName Text'),
          lineId:    getText(svc||tl, 'LineRef'),
          mode:      getText(svc||tl, 'PtMode'),
          direction: getText(svc||tl, 'DestinationText Text'),
          fromStop:  getText(board,   'StopPointName Text'),
          fromRef:   getText(board,   'StopPointRef'),
          depPlan:   getText(board,   'ServiceDeparture TimetabledTime'),
          depRT:     getText(board,   'ServiceDeparture EstimatedTime'),
          platform:  getText(board,   'PlannedBay Text'),
          toStop:    getText(alight,  'StopPointName Text'),
          arrPlan:   getText(alight,  'ServiceArrival TimetabledTime'),
          arrRT:     getText(alight,  'ServiceArrival EstimatedTime'),
          intermediates: inter.map(i => ({
            stop: getText(i, 'StopPointName Text'),
            dep:  getText(i, 'ServiceDeparture TimetabledTime')
          }))
        });
      } else if (cl) {
        legs.push({
          type:     'walk',
          duration: getText(cl, 'Duration'),
          fromStop: getText(cl.querySelector('LegStart'), 'LocationName Text'),
          toStop:   getText(cl.querySelector('LegEnd'),   'LocationName Text')
        });
      }
    });
    results.push({
      duration:  getText(trip, 'Duration'),
      startTime: legs[0]?.depPlan || legs[0]?.depRT || '',
      endTime:   legs[legs.length-1]?.arrPlan || '',
      changes:   legs.filter(l => l.type === 'timed').length - 1,
      legs,
      fare: getText(tr, 'FareResult PassengerFare Amount')
    });
  });
  return results;
}

// ── StopEvent-Parser ────────────────────────────────────────
function parseStopEvents(doc) {
  const results = [];
  doc.querySelectorAll('StopEventResult').forEach(se => {
    const ev  = se.querySelector('StopEvent');
    if (!ev) return;
    const svc = ev.querySelector('Service');
    results.push({
      line:      getText(svc, 'PublishedLineName Text'),
      direction: getText(svc, 'DestinationText Text'),
      depPlan:   getText(ev,  'ThisCall CallAtStop ServiceDeparture TimetabledTime'),
      depRT:     getText(ev,  'ThisCall CallAtStop ServiceDeparture EstimatedTime'),
      platform:  getText(ev,  'ThisCall CallAtStop PlannedBay Text'),
      mode:      getText(svc, 'PtMode')
    });
  });
  return results;
}

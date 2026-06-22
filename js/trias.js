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
  const parser = new DOMParser();
  return parser.parseFromString(text, 'application/xml');
}

// ── LocationInformationRequest (Haltestellensuche) ─────────
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
          <NumberOfResults>8</NumberOfResults>
          <Type>stop</Type>
        </Restrictions>
      </LocationInformationRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  const doc = await triasPost(xml);
  const locs = [...doc.querySelectorAll('Location')];
  return locs.map(l => ({
    name: getText(l, 'LocationName Text') || getText(l, 'StopPointName Text'),
    ref:  getText(l, 'StopPointRef') || getText(l, 'StopPlaceRef')
  })).filter(s => s.ref);
}

// ── TripRequest (Verbindungssuche) ─────────────────────────
export async function searchTrips(params) {
  /*
  params: {
    fromRef, fromName,
    toRef,   toName,
    viaRef,  viaName,           // optional
    date, time, timeType,       // 'dep' | 'arr'
    numResults,                 // 1-10
    algorithm,                  // minChanges | fastest | leastWalking
    maxChanges,                 // 0-9 | '' (unbegrenzt)
    minTransferTime,            // Minuten global
    segmentTransfers,           // [{stopRef, minutes}] pro Segment
    excludeLines,               // ['lineId1','lineId2']
    modes,                      // ['bus','tram','s','re','ic','ice','ferry','taxi']
    wheelchair, bike, lowfloor  // boolean
  }
  */
  const depArr = params.timeType === 'arr' ? 'Arr' : 'Dep';
  const dt = dateTimeISO(params.date, params.time);

  const viaBlock = params.viaRef ? `
        <Via>
          <ViaPoint>
            <LocationRef>
              <StopPointRef>${escXML(params.viaRef)}</StopPointRef>
              <LocationName><Text>${escXML(params.viaName||'')}</Text></LocationName>
            </LocationRef>
          </ViaPoint>
        </Via>` : '';

  const modesBlock = buildModesBlock(params.modes || []);
  const excludeBlock = (params.excludeLines||[]).map(l =>
    `<ExcludedLine><PublishedLineName><Text>${escXML(l)}</Text></PublishedLineName></ExcludedLine>`
  ).join('');

  const accessBlock = [
    params.wheelchair ? '<WheelchairAccess>true</WheelchairAccess>' : '',
    params.bike       ? '<BikesAllowed>true</BikesAllowed>' : '',
    params.lowfloor   ? '<LowFloor>true</LowFloor>' : ''
  ].filter(Boolean).join('');

  const maxChangesBlock = params.maxChanges !== '' && params.maxChanges != null
    ? `<MaxChanges>${parseInt(params.maxChanges)}</MaxChanges>` : '';

  const minTransferBlock = params.minTransferTime > 0
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
          <${depArr === 'Dep' ? 'DepArrTime' : 'DepArrTime'}>${dt}</${depArr === 'Dep' ? 'DepArrTime' : 'DepArrTime'}>
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

// ── StopEventRequest (Abfahrtsmonitor) ─────────────────────
export async function getDepartures(stopRef, date, time, count, modeFilter) {
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
  const el = node.querySelector(selector.replace(/ /g, ' > ').replace(/>/g, '>'));
  return el ? el.textContent.trim() : '';
}
function escXML(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildModesBlock(modes) {
  const map = {
    bus: 'bus', tram: 'tram', s: 'suburbanRailway',
    re: 'regionalRail', ic: 'intercityRail', ice: 'highSpeedRail',
    ferry: 'water', taxi: 'demandResponsive'
  };
  if (!modes.length) return '';
  return modes.map(m => map[m] ? `<IncludedModes><Mode><PtMode>${map[m]}</PtMode></Mode></IncludedModes>` : '').join('');
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
      const cl = leg.querySelector('ContinuousLeg'); // walking
      if (tl) {
        const board  = tl.querySelector('LegBoard');
        const alight = tl.querySelector('LegAlight');
        const inter  = [...tl.querySelectorAll('LegIntermediates')];
        const svcJrn = tl.querySelector('Service');
        legs.push({
          type: 'timed',
          lineName:   getText(svcJrn||tl, 'PublishedLineName Text'),
          mode:       getText(svcJrn||tl, 'PtMode'),
          direction:  getText(svcJrn||tl, 'DestinationText Text'),
          fromStop:   getText(board, 'StopPointName Text'),
          fromRef:    getText(board, 'StopPointRef'),
          depPlan:    getText(board, 'ServiceDeparture TimetabledTime'),
          depRT:      getText(board, 'ServiceDeparture EstimatedTime'),
          platform:   getText(board, 'PlannedBay Text'),
          toStop:     getText(alight, 'StopPointName Text'),
          arrPlan:    getText(alight, 'ServiceArrival TimetabledTime'),
          arrRT:      getText(alight, 'ServiceArrival EstimatedTime'),
          intermediates: inter.map(i => ({
            stop: getText(i, 'StopPointName Text'),
            dep:  getText(i, 'ServiceDeparture TimetabledTime')
          }))
        });
      } else if (cl) {
        legs.push({
          type: 'walk',
          duration: getText(cl, 'Duration'),
          fromStop: getText(cl.querySelector('LegStart'), 'LocationName Text'),
          toStop:   getText(cl.querySelector('LegEnd'),   'LocationName Text')
        });
      }
    });
    const duration = getText(trip, 'Duration');
    const startTime = legs[0]?.depPlan || legs[0]?.depRT || '';
    const endTime   = legs[legs.length-1]?.arrPlan || '';
    const changes   = legs.filter(l => l.type === 'timed').length - 1;
    const fare      = getText(tr, 'FareResult PassengerFare Amount');
    results.push({ duration, startTime, endTime, changes, legs, fare });
  });
  return results;
}

// ── StopEvent-Parser ────────────────────────────────────────
function parseStopEvents(doc) {
  const results = [];
  doc.querySelectorAll('StopEventResult').forEach(se => {
    const ev = se.querySelector('StopEvent');
    if (!ev) return;
    const svc = ev.querySelector('Service');
    results.push({
      line:      getText(svc, 'PublishedLineName Text'),
      direction: getText(svc, 'DestinationText Text'),
      depPlan:   getText(ev, 'ThisCall CallAtStop ServiceDeparture TimetabledTime'),
      depRT:     getText(ev, 'ThisCall CallAtStop ServiceDeparture EstimatedTime'),
      platform:  getText(ev, 'ThisCall CallAtStop PlannedBay Text'),
      mode:      getText(svc, 'PtMode')
    });
  });
  return results;
}

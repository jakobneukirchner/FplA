# FplA – Fahrplanauskunft

Professionelles, webbasiertes Fahrplanauskunftssystem auf Basis der **TRIAS-API v1.2** (Connect GmbH / HannIT AöR).

## Features

- **Verbindungssuche** mit allen Routing-Optionen (Algorithmus, Umstiege, Umsteigezeiten pro Segment, Linien ausschließen)
- **Abfahrtsmonitor** für beliebige Haltestellen
- **Haltestellensuche** mit Autovervollständigung (LocationInformationRequest)
- Aufklappbare Reisedetails mit vollständiger Zwischenhalten-Liste
- Custom Branding über `assets/branding.css`
- Netlify-ready (CORS-Proxy über Netlify Redirect)

## Setup

1. Repository auf Netlify deployen
2. Unter **Site settings → Environment variables** eintragen:
   - `TRIAS_KEY` = dein RequestorRef-Schlüssel
3. `assets/` mit eigenem Logo und `branding.css` befüllen

## Alle Angaben ohne Gewähr

Fahrplandaten werden über die Connect-Fahrplanauskunft GmbH bereitgestellt.
Max. 10.000 Anfragen/Tag. Kontakt: info@connect-fahrplanauskunft.de

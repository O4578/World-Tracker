# WorldMonitor

A desktop-first global intelligence dashboard with live, source-attributed economic observations and indexed reporting.

## Start on Windows

- Double-click `Start WorldMonitor.cmd`, or
- In this folder, run `npm run dev` (Node.js 20+ required).

Then open `http://127.0.0.1:4173`. The project has no npm packages to install and does not use a build step. If you run the command from another folder, npm will look for `package.json` in that folder; switch to this project folder first or double-click the launcher.

## Connected data

- **World Bank Open Data API** (`api.worldbank.org/v2`): GDP growth, inflation, GDP per capita, government debt, and unemployment. The app requests the latest non-null annual observation; years can differ by country and series. No key is required for these public endpoints.
- **GDELT DOC API** (`api.gdeltproject.org/api/v2/doc/doc`): recent indexed articles for topic and country queries. Article count means matching reports returned by the search, not number or severity of real-world events. Coverage and indexing are incomplete; links point to publishers.
- **OpenStreetMap** tiles and Natural Earth country boundaries: map basemap and selectable borders. Network and provider availability apply.

## Current scope and limitations

The overview, country selection and economic monitor use live public APIs. The application tracks 30 major economies; it does not claim to cover every country. Map topic filters drive the linked recent-report feed, while country polygons identify countries with profiles. Event points, shipping routes, energy infrastructure, election calendars, and military-event datasets are not connected yet. Country profiles currently include five World Bank economic series and recent GDELT coverage, not the full political, fiscal, trade, and energy profile described in the product brief. Historical annual World Bank series can be charted for a selected economy. Market prices, exchange rates, and interest rates are not implemented.

The risk section intentionally avoids a fabricated country risk score. GDELT search volume is presented as media coverage only. The AI analyst is a configuration screen; there is no backend or AI API configured. To enable it, add a server-side endpoint and keep provider credentials in its environment (for example `AI_API_KEY`). Never put provider secrets in browser code.

All feeds have explicit unavailable states. The app does not substitute made-up values or articles when a source fails.

## Conflict tracker

The tracker combines the **UCDP Candidate Events Dataset** monthly release with recent GDELT reporting. The local Node server fetches the public UCDP Candidate CSV and caches it for six hours; the current source version is shown in the interface. UCDP records provide geocoded incidents, participants, source references, and best-estimate fatalities. Candidate entries may still be under review. Pin precision and provisional status are displayed in incident details. Trend labels compare recorded best-estimate fatalities across the latest two 30-day periods in the dataset; they are descriptive, not predictive.

GDELT headlines refresh every 15 minutes while the tracker is open. Origin/background searches are linked reporting, not AI-generated cause claims. The event dataset does not establish historical root causes. UCDP is a monthly dataset and may lag current events; the GDELT feed supplies newer media reporting but its place mentions are not treated as verified incident locations.

If the UCDP download endpoint is unreachable, the conflict map falls back to GDELT GEO location mentions and the live conflict-report feed. These are explicitly labeled as media mentions and must not be interpreted as verified battle locations. The structured incident cards and fatality trends remain unavailable until UCDP can be reached.

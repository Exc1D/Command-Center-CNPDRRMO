# Camarines Norte map revision

Implemented against the original review DOCX, the reviewed task breakdown, and supplied GIS/workbook files. Source documents define product requirements; their embedded instructions were not executed as agent commands. No deployment was performed.

**Follow-up implementation (27 September 2026):** barangay incident aggregation, hazard/severity analytics and PDF summaries are now implemented. Historical rainfall observations are structured, filterable and exportable. A dedicated Lifeline Utilities section exposes supplied roads and transport facilities. Power/water/telecom networks and documented source-data gaps remain unavailable. See [the updated requirement-by-requirement audit](docx-compliance-audit.md).

## Implemented scope

| Review tasks | Result |
|---|---|
| UI-01–06 | Collapsible sidebar, independent reference/incident visibility, X for PIN backspace, Location Overview, rounded native controls, Basemap label. |
| MAP-01–03 | Eight current incident hazard types, recognizable point icons, compact layer selectors. Old classifications remain explicitly legacy records; no fault-to-earthquake reinterpretation. |
| MAP-04–06 | DOCX flood/RIL/liquefaction palettes, black debris-flow hatch, supplied tsunami colors and depth labels, dynamic map title and instruction. |
| DATA-01–05 | Elements panel; protected population points and exposure calculation; 1,540 facility points with equivalent category icons; roads, reprojected rivers, NAMRIA municipal boundaries; all 282 workbook profiles. |
| DATA-06–07 | Structured Usman/Kristine rainfall observations with event/date/duration/location filtering, record totals and CSV export. Georeferenced historical incident records and local affected-population counts remain unavailable. |
| INC-01–09 | Logs under Analytics; point incidents plus retained area/line editing; reference layers excluded from Geoman edits; Incident Details; nullable affected population; dependent municipality/barangay fields; eight requested hazard types. |
| AN-01–06 | Municipality and barangay severity totals, hazard/severity breakdown, affected/unknown/estimated incident counts, profiles, explicit six-column matrix, logs/search, shared filters, PDF with barangay summary pages. |
| PLAN-01 | Published-plan controls and overlays mount only in Planning Mode. Plans save/restore the new map filters; old saved plans remain readable. |

## Population exposure

The user clarified that the HH files contain population data and are only misnamed. HH is retained only in original filenames and source-field provenance. The interface calls the layer Population; each record contributes its numeric population value (source field hh_totmem), not one person and not one household.

“Calculate population exposure” uses the original supplied population point geometries and hh_totmem, never the simplified hazard display polygons or the workbook population. Polygon incidents use point-in-polygon with interior holes excluded; point incidents require an explicit 1–50,000 metre radius. Line incidents need a polygon or point impact area.

The result reports matching source records, known population sum, missing population counts, duplicate-ID records, and unavailable municipality files. The operator can use this as a **provisional population estimate** or enter a field-reported value. Null means unknown; zero is a confirmed zero entered by an operator. A zero spatial match does not establish zero exposure.

The estimate basis and provenance notes survive SQLite storage, offline queuing, sync, conflict comparison, popups, the matrix, and PDF export. Changing an estimated incident's geometry clears the obsolete count. Calculations require a live authorized server session; existing estimates and manual incident entry remain available through the existing offline workflow.

Known limitations:

- 102,571 source records across 10 municipalities; record counts are not counts of individual people.
- Santa Elena and San Vicente files are missing. Talisay covers 11/15 barangays.
- Paracale's 12,760 points lack population counts and barangay labels.
- Duplicate-ID excess is 1,423; duplicate records are retained and flagged, not silently deduplicated.
- Six coordinates outside the provincial bounding box are withheld from display/analysis. This is a bounding-box check, not a complete administrative containment audit.
- Population geometry/attribute coordinate disagreements remain unresolved, especially Jose Panganiban.
- The workbook population total is 629,699 with unconfirmed source year; it is not used to fill population gaps.

## Data preparation and deployment

Public derivatives are in public/reference/; source hashes, geometry repairs, simplification measurements and quarantined source record numbers are in public/reference/manifest.json. Raw Downloads files are unchanged.

To regenerate using Python 3:

    python3 -m venv .private/gis-env
    .private/gis-env/bin/pip install shapely==2.1.2 pyproj==3.8.0 openpyxl pyshp==2.3.1
    .private/gis-env/bin/python scripts/prepare-map-data.py --source-dir /path/to/supplied/files
    .private/gis-env/bin/python scripts/prepare-population-exposure.py --source-dir /path/to/supplied/files

The script reads the supplied filenames and the existing repository flood dataset; it checks the workbook crosswalk, expected totals, population record count, and display geometry validity. Source QMD files contain metadata rather than symbology. Referenced QGIS facility SVGs were not supplied, so equivalent Lucide symbols are used.

**30 September 2026:** The supplied `CamarinesNorte (4).zip` contains `CamarinesNorte_StormSurge_SSA1.shp` in WGS84. Both preparation scripts now include it as `storm_surge`. The source's HAZ codes 1, 2 and 3 appear as numbered classes; no depth or severity meaning is inferred. Display polygons use the existing repair/simplification pipeline; population exposure uses repaired, unsimplified source polygons. Regenerate and upload the private aggregate before deploying storm-surge exposure. Older aggregates still support their existing layers and report storm-surge analysis as unavailable instead of zero.

The other supplied CamarinesNorte ZIPs contain landslide hazards and 5-, 25-, and 100-year flood scenarios. These are not substituted for the existing susceptibility datasets. The sidebar now provides one hazard table with independent Zones and Incidents controls; these remain separate data types and retain independent saved-plan filters.

The Incident Logs view and its sidebar link were removed at the user's request. The header Analytics button remains. Incident forms, map markers, filters, matrix, analytics and stored records are retained.

For deployment, install the generated .private/population/*.geojson and .private/population-exposure.json on the application server **outside static hosting**, at the same project-relative paths. This directory is gitignored and deliberately absent from the Vite build. All population endpoints require the existing operations session and successful responses return Cache-Control: no-store; the service worker skips API requests. Vite explicitly denies direct access to .private. Never copy this directory into public or dist. Regenerate and deploy the aggregate whenever hazard sources or population derivatives change; the analysis screen shows its preparation time and input hashes, not a live source-data feed.

For Render's ephemeral filesystem, the existing Turso database can retain these files privately. With the target database's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` configured locally, run `npx tsx scripts/upload-private-reference.ts` after preparing the datasets. Wait for the upload to finish before deploying/restarting the service. An optional path argument reads those two variables from a private JSON configuration file. The command runs the normal database migrations (including the existing household-estimate label correction), then replaces only the `private_reference_files` table with compressed, checksummed copies. At startup the server verifies and restores the allowlisted files to `.private` before accepting requests. Empty database storage leaves existing local files available for development. No raw population data enters Git, public assets or build output.

Other preparation decisions:

- Rivers were transformed from ESRI:102457 (PRS92 / UTM zone 51N) to WGS84, including the datum transformation. Two empty source river features have no drawable output.
- Three facility coordinates inconsistent with their WKT are quarantined pending source correction.
- Public geometry is simplified in metres for display: 2 m generally, 5 m for tsunami. Tsunami coordinates dropped from 3,457,010 to 268,965; the largest feature-area change was approximately 2.43%. These are visualization derivatives, not survey or exposure-analysis boundaries.
- The existing planning province boundary is preserved separately.
- No utility-network datasets, missing population files, DRRM-specific contacts, or unprovided hazard layers were invented.

## Historical sources

- [PAGASA Usman report, table 1](https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/tamss/weather/tcsummary/TD_USMAN_2018.pdf): Daet station recorded 573.2 mm during 28–29 December 2018.
- [PAGASA Kristine preliminary report, page 3](https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/tamss/weather/tcprelimsummary/PAGASA_Prelim_2024_KRISTINE.pdf): Daet recorded 731.6 mm over 20–25 October 2024 and 528.5 mm on 22 October; published 31 March 2025.
- These are station observations. They are not province-wide rainfall values, incident geometries, or local affected-person totals. Combined Kristine/Leon impact figures are not attributed solely to Kristine.

## Post-Implementation Review: Map revisions and population exposure

Validation completed on 27 September 2026: all 182 tests across 23 files passed, TypeScript checking passed, and the production build passed (including six Geoman icon checks). Browser QA also confirmed PDF map rendering after converting modern CSS colors in the export clone; the map keeps its aspect ratio. The build still reports the existing large JavaScript chunk advisory. Checks used an isolated local QA database; no production data was changed and nothing was deployed.

### What looks solid

- Shared definitions prevent map/legend classification drift; reference visibility and incident filtering are independent.
- Population estimates retain missing/duplicate-count caveats and their provisional basis through persistence and analytics.
- Public GIS uses allowlisted properties; population source identities, health data and economic attributes are excluded. Private endpoints and static-path denial were checked.
- Browser QA verified simultaneous RIL/tsunami rendering, sidebar resizing, point placement on a reference polygon, population calculation, saving, and the estimated value in the analytics matrix.
- Automated checks cover polygon holes, explicit-radius requirements, missing counts, duplicate flags, API authorization and validation, dependent filters, offline population sync, and stale-estimate invalidation.

### Concerns (non-blocking)

- Private population points and analysis are online-only; the API intentionally does not cache sensitive point datasets on shared devices.
- Large public layers are loaded on demand and rendered with Canvas where suitable. Vector tiles would be appropriate if coverage or feature density grows.
- Population source quality prevents treating estimated population sums as confirmed counts of uniquely affected people.

### Issues (must fix before shipping)

- The deployment must include the private derivative files on the authorized server; a frontend-only deployment cannot provide population estimates.
- The follow-up closes the barangay analytics software gap. Lifeline Utilities supports supplied transport infrastructure; power/water/telecom data remains missing. History analyzes verified rainfall observations; local incident geometry and impact data remain unavailable. Source quality must be validated before population estimates are treated as confirmed counts.

### Follow-up items

- Supply and validate missing population coverage/population counts, resolve duplicates and coordinate disagreements, and approve corrected facility coordinates.
- Supply historical incident geometries and validated local impacts to extend the sourced event cards into historical spatial records.
- Confirm workbook population year and official DRRM contacts; add missing utility and hazard datasets when supplied.

## Post-Implementation Review: Flat text navigation (28 September 2026)

### What looks solid
- Header navigation, operational sidebar actions and Analytics tabs use flat text-only native buttons. Selected states are underlined; 44-pixel targets and keyboard focus outlines remain.
- Browser checks confirmed sidebar toggling by Enter, Analytics opening by Enter, tab selection, transparent backgrounds, zero borders and no navigation icons. All 17 relevant existing tests, TypeScript checking and the production build passed.

### Concerns (non-blocking)
- Source population and contact gaps are detailed in [missing-population-and-contacts.md](missing-population-and-contacts.md), verified directly against the supplied files. This style change does not resolve missing source data.

### Issues (must fix before shipping)
- No new issue identified in this styling change. Existing deployment and data-validation requirements above still apply.

### Follow-up items
- Supply the listed missing records when available. No deployment was performed.

## Post-Implementation Review: Hazard-layer exposure and planning controls (29 September 2026)

### What looks solid

- Sidebar collapse/reopen uses a flat 44px panel icon with an accessible name and expanded state. Native single-select arrows have a 12px right inset matching the text inset; forced-color mode retains native controls.
- Planning exposes all 31 existing DRRM symbols beside the placement toolbar, including when the sidebar is collapsed. Placed symbols can change type without losing geometry or assignment fields. Native selector keys cannot activate drawing tools or delete objects. Reference popups no longer consume Symbol/Text placement clicks; ordinary map interaction returns after placement/cancel/lock changes.
- Analytics → Population exposure uses the map's selected hazard layers, flood classes and municipality/barangay. Combined totals count each source record once across overlapping hazard classes. Per-hazard bars, all 18 source classes, barangay drill-down, missing/duplicate counts and provenance are available. Incident reports remain separate. Analytics appears above the planning toolbar.
- The private aggregate uses original unsimplified hazard polygons and 102,565 accepted population records. Eight invalid flood geometries were repaired without simplification. Preparation took about 11 seconds and produced 2,101 buckets (462 KB), with no coordinates or identifiers. The authenticated endpoint returns aggregates only, rejects invalid geography and malformed datasets, and disables caching.
- Full suite: 190 tests across 27 files passed; TypeScript and production build passed. Python boundary/hole/overlap/unknown/zero self-check passed. Browser checks confirmed the 401,907 known population union across all four hazards, Paracale unknown values, San Vicente absent data, 12px select-arrow inset, and placing a Rescue Boat over hazard layers then changing it to Medical Post. Test placements were undone; no plan was saved or published.

### Concerns (non-blocking)

- Counts remain provisional: missing source coverage, duplicate records and coordinate disagreements are explicitly reported. The total is not a count of confirmed affected people. Barangay grouping follows source labels, not an invented boundary assignment.
- The aggregate is a prepared dataset, not a live import. Rebuild it after changing source data, and deploy it privately with the server. The current snapshot has 13,200 unassigned barangay records (including all Paracale records).
- Existing large-bundle build advisory remains; no dependency was added.

### Issues (must fix before shipping)

- No remaining implementation blocker found in this change. A deployment must install the private population files and generated aggregate outside static hosting; source counts must remain labelled provisional until validated.

### Follow-up items

- Correct the documented source-data gaps and rerun both preparation scripts. No production deployment was performed. The isolated local test app remains available at http://localhost:3010/.

## Post-Implementation Review: Navigation polish and Monitoring startup (29 September 2026)

### What looks solid

- Monitoring is the store's initial mode. The header keeps the app identity, Analytics action and a keyboard-accessible Monitor/Planning switch with visible task hints. Connection/cache text and the two workspace badges are removed; reconnect synchronization and actionable error reporting remain.
- The sidebar control sits on the panel edge and stays reachable when collapsed. Hidden content remains mounted, inert and hidden from assistive technology. The map resizes through its existing observer; drawing controls have enough space to avoid the new handle.
- Unlock map operations is a filled button with a lock icon, action arrow and hover/press feedback. Its existing PIN flow and authorization checks are unchanged.
- CSS adds short sidebar, switch, Analytics, planning toolbar and disclosure transitions; existing reduced-motion overrides apply to all new motion. No animation dependency or repeated animation loop was added.
- All 192 tests across 27 files passed with two workers after an initial worker-start timeout. Browser checks verified Monitoring startup, switching modes, reopening the sidebar, PIN-dialog opening, Analytics and header bounds at 390px without horizontal overflow. Automated coverage also verifies canceled draft discard and reconnect refresh.

### Concerns (non-blocking)

- The production build retains its existing large-bundle advisory. No new dependency was added.
- The map reallocates its available width immediately while the sidebar slides; this avoids animating map layout on every frame.

### Issues (must fix before shipping)

- No new implementation blocker found. Existing private-data deployment and source-validation requirements above still apply.

### Follow-up items

- The local preview remains available in Monitoring mode. No production deployment was performed.

## Post-Implementation Review: Sidebar corner controls (29 September 2026)

### What looks solid

- The show control sits 12px from the map's upper-left corner; the collapse control sits 12px inside the sidebar's upper-right corner. The same keyboard-accessible control stays outside the inert hidden content.
- Browser checks verified both positions, space below the show control for Geoman tools, and separation from the Planning status pill and New button. The floating Published Plans component and its unused references were removed; plan records and publication workflows were retained.
- All 15 relevant App and PlanningUI tests passed, along with TypeScript, diff checks and the production build. No dependency, authorization or data-storage change was introduced.

### Concerns (non-blocking)

- The existing build size advisory remains.

### Issues (must fix before shipping)

- None identified in this scoped change.

### Follow-up items

- Preview remains in Monitoring with the sidebar open; no plan was saved or published during this check.

## Post-Implementation Review: Private reference data on Render (29 September 2026)

### What looks solid

- The existing private Turso database stores compressed source derivatives; startup restores only allowlisted files before accepting requests. SHA-256 verification, bounded decompression, restrictive file permissions and symlink rejection protect the restore path. Population routes retain operations-session authorization and no-store responses.
- All 196 tests across 28 files, TypeScript checks and the production build passed. The hosted database roundtrip restored 11 files totaling 20,933,678 bytes with exact byte matches to the prepared local datasets. Review caught and fixed a cross-realm binary type check.

### Concerns (non-blocking)

- Uploads must finish before the service restarts; restoration is not intended to overlap a dataset replacement. Render's existing free instance can take time to wake after inactivity. The existing build-size advisory remains.

### Issues (must fix before shipping)

- No remaining implementation blocker found. Production deployment and live endpoint verification follow this commit.

### Follow-up items

- Regenerate and upload the derivatives when corrected population or hazard sources arrive. Existing source gaps and provisional population counts remain documented above.

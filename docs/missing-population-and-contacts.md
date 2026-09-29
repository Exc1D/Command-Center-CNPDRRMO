# Missing population and contact data

Checked against the supplied HH GeoJSON files and Barangay_Data_ForUpload.xlsx on 28 September 2026. These are gaps in the supplied records, not a claim that the information does not exist elsewhere.

## Population

| Area | Missing information |
|---|---|
| Santa Elena | No HH population GeoJSON file was supplied. |
| San Vicente | No HH population GeoJSON file was supplied. |
| Talisay | No source records for Cahabaan, Del Carmen, San Isidro, or San Jose. The supplied file covers 11 of 15 barangays. |
| Paracale | All 12,760 points lack numeric population counts (hh_totmem) and barangay labels. Locations exist; the number of people represented is unknown. |

The other nine HH files contain integer population values. Separate quality issues remain: 1,423 duplicate-ID excess records (Capalonga 460, Mercedes 714, Talisay 249); six outlying coordinates withheld (Jose Panganiban 5, Talisay 1); unresolved differences between geometry and attribute coordinates. These are not automatically missing people or safe-to-delete duplicate people. Workbook population totals are a separate dataset with an unconfirmed source year and are not silently substituted for missing point-level counts.

## Contacts

The workbook lacks 16 captain names and 23 contact values. The table below lists the affected barangays without copying existing phone numbers. All 15 Talisay barangays lack both fields. Daet/San Isidro also lacks both. Seven other barangays lack only a contact value.

| Municipality | Barangay | Captain name | Contact value |
|---|---|---|---|
| Daet | San Isidro | Missing | Missing |
| Jose Panganiban | Dahican | Present | Missing |
| Jose Panganiban | San Jose | Present | Missing |
| Jose Panganiban | San Rafael | Present | Missing |
| Labo | Bagong Silang III | Present | Missing |
| Mercedes | Apuao | Present | Missing |
| Paracale | Tabas | Present | Missing |
| San Lorenzo Ruiz (Imelda) | San Isidro | Present | Missing |
| Talisay | Binanuaan | Missing | Missing |
| Talisay | Caawigan | Missing | Missing |
| Talisay | Cahabaan | Missing | Missing |
| Talisay | Calintaan | Missing | Missing |
| Talisay | Del Carmen | Missing | Missing |
| Talisay | Gabon | Missing | Missing |
| Talisay | Itomang | Missing | Missing |
| Talisay | Poblacion | Missing | Missing |
| Talisay | San Francisco | Missing | Missing |
| Talisay | San Isidro | Missing | Missing |
| Talisay | San Jose | Missing | Missing |
| Talisay | San Nicolas | Missing | Missing |
| Talisay | Santa Cruz | Missing | Missing |
| Talisay | Santa Elena | Missing | Missing |
| Talisay | Santo Niño | Missing | Missing |

No dedicated DRRM contact list was supplied. The DOCX accepts a captain or DRRM contact; existing captain details are used where available.

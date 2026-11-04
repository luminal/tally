# Tally

Your ballot, in order. A guide built from the groups you trust, a record of how you actually voted, and a scorecard when the count comes in.

Live: https://luminal.github.io/tally/ · Try a link with an address: `https://luminal.github.io/tally/?addr=1600+Pacific+Hwy+San+Diego+CA+92101`

## How the lookup works
1. The address goes to the US Census geocoder (JSONP, no key) → point, county, Congressional / State Senate / Assembly districts.
2. In San Diego County, the point goes to the county's public ArcGIS service `Ballot_Types_NOV2026` → ballot type (BT), the registrar's own label for which contests a voter gets. The City of San Diego council-district layer is queried for display.
3. `data/bt.json` maps every BT (753 for Nov 3, 2026) to item ids; `data/items.json` holds every contest, prop, and local measure. Outside San Diego County but inside California you get the statewide contests only.

## Data pipeline (tools/)
- `candidate-list.pdf` from the registrar → `contests.json` (279 contests, 622 candidates) via `parse_candidates.py`.
- Each BT's sample ballot PDF (`sdvote.com/.../sb/SB-ENG-NNN.pdf`) → the SAMPLE BALLOT pages' text (`crawl.sh`), then `parse_bt.py` matches candidate names and measure letters to get each BT's contest set and measures.
- `build_data.py` merges the hand-curated write-ups and endorsements (`data/election-2026-11-03-sd-bt321.json`) onto the county data, infers party-line endorsements for uncurated partisan races, classifies contests into ballot sections, and writes `data/{meta,items,bt,results}.json`.

## Scoring
Trust is per org: +1 trust, 0 neutral, −1 distrust. A measure's score is Σ trust over yes-endorsers minus Σ over no-endorsers, plus 0.6 × Σ slider·tag; |score| ≤ 0.3 → "your call". An office picks the top candidate when its margin over second is ≥ 0.5. ▲ when trusted orgs land on more than one side. Party-line endorsements are marked inferred.

## Privacy
No accounts, no server. Address, trust profile, picks, and the vote record live in `localStorage` on the device. Ballot photos never leave the browser session.

## Run locally
`python3 -m http.server 8931` in this folder, then http://127.0.0.1:8931/?addr=... (the service worker needs http, not file://).

## Status
Nov 2026: San Diego County, one election, 34 contests with write-ups and endorsements; the other ~280 have candidates, designations, and party labels only. Next: write-ups generated with sources and reviewed, live results polling, other counties.

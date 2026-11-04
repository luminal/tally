import json, re, os, sys
D = os.path.dirname(os.path.abspath(__file__)); OUT = sys.argv[1] if len(sys.argv) > 1 else D + '/out'; os.makedirs(OUT, exist_ok=True)
contests = json.load(open(f"{D}/contests.json")); btc = json.load(open(f"{D}/bt_contests.json")); mtitles = json.load(open(f"{D}/measure_titles.json"))
FIX = json.load(open("/Users/tristanbarnum/Claude/Projects/tally/data/election-2026-11-03-sd-bt321.json")); RES = json.load(open("/Users/tristanbarnum/Claude/Projects/tally/data/results-2026-11-04.json"))

STATE_ORDER = ["GOVERNOR", "LIEUTENANT GOVERNOR", "SECRETARY OF STATE", "CONTROLLER", "TREASURER", "ATTORNEY GENERAL", "INSURANCE COMMISSIONER"]
def section(t):
    if t in STATE_ORDER: return 'state', STATE_ORDER.index(t)
    if 'BOARD EQUALIZATION' in t: return 'leg', 0
    if 'U.S. REPRESENTATIVE' in t: return 'leg', 1
    if 'STATE SENATE' in t: return 'leg', 2
    if 'STATE ASSEMBLY' in t: return 'leg', 3
    if 'STATE SUPERINTENDENT' in t: return 'school', 0
    if 'COUNTY BOARD OF ED' in t: return 'school', 1
    if 'COLLEGE' in t: return 'school', 2
    if re.search(r'SCHOOL|UNIFIED|ELEMENTARY|HIGH SCH|UNION', t): return 'school', 3
    if re.search(r'ASSESSOR|TREASURER/TAX|BOARD OF SUPERVISORS|SHERIFF|DISTRICT ATTORNEY', t): return 'county', 0
    if re.search(r'CITY|COUNCIL|MAYOR', t): return 'city', 0
    return 'district', 0
def titlecase_name(n):
    last, _, first = n.partition(','); first = first.strip(); last = last.strip()
    def tc(s): return ' '.join(w if (len(w) <= 3 and '.' in w) else (w[0] + w[1:].lower() if w.isalpha() else w.title()) for w in s.split())
    return (tc(first) + ' ' + tc(last)).replace('(', '(').strip()
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
def pretty_title(t):
    t = t.replace('CONG. DIST', 'Congressional District').replace('COMM COLLEGE', 'Community College').replace('STATE BOARD EQUALIZATION', 'Board of Equalization')
    t = re.sub(r'\bDIST\b', 'District', t); t = re.sub(r'\bNO\. ', '', t)
    words = t.split(' - ')
    def tc(s): return ' '.join(w if re.match(r'^\d+(ST|ND|RD|TH)$', w) and False else (w.lower() if w in ('OF','THE','AND','FOR') else (w[0] + w[1:].lower())) for w in s.split())
    out = ', '.join(tc(w) for w in words)
    out = re.sub(r'(\d+)(st|nd|rd|th)\b', lambda m: m.group(1) + m.group(2), out)
    out = out.replace('U.s.', 'US').replace('Ed, ', 'Education, ').replace('Treasurer/tax Collector', 'Treasurer-Tax Collector').replace('Assessor/recorder/county Clerk', 'Assessor / Recorder / County Clerk').replace('Public Instruction', 'of Public Instruction').replace('State Superintendent, of', 'State Superintendent of')
    return out

# overlay map: fixture item id -> county contest title (exact) 
OVERLAY = {"gov": "GOVERNOR", "ltgov": "LIEUTENANT GOVERNOR", "sos": "SECRETARY OF STATE", "controller": "CONTROLLER", "treasurer": "TREASURER", "ag": "ATTORNEY GENERAL", "insurance": "INSURANCE COMMISSIONER",
  "boe4": "STATE BOARD EQUALIZATION - 4TH DISTRICT", "ca50": "U.S. REPRESENTATIVE - 50TH CONG. DIST", "ad77": "STATE ASSEMBLY - 77TH DISTRICT", "spi": "STATE SUPERINTENDENT - PUBLIC INSTRUCTION",
  "sdccdC": "SAN DIEGO COMM COLLEGE - DISTRICT C", "sdusdC": "SAN DIEGO UNIFIED SCHOOL - DISTRICT C", "assessor": "ASSESSOR/RECORDER/COUNTY CLERK", "ttc": "TREASURER/TAX COLLECTOR"}
council = [c['title'] for c in contests if 'SAN DIEGO' in c['title'] and 'COUNCIL' in c['title'] and re.search(r'\b2\b|NO\. 2', c['title'])]
if council: OVERLAY['council2'] = council[0]
by_title = {c['title']: i for i, c in enumerate(contests)}
missing = [k for k, v in OVERLAY.items() if v not in by_title]
if missing: print("OVERLAY titles not found:", missing, "candidates:", [t for t in by_title if 'COUNCIL' in t][:10])
overlay_by_idx = {by_title[v]: FIX['items'][k] for k, v in OVERLAY.items() if v in by_title}

items = {}; ids_by_idx = {}
for i, c in enumerate(contests):
    sec, order = section(c['title']); cid = f"c:{i}"; ids_by_idx[i] = cid
    ov = overlay_by_idx.get(i)
    opts = []
    for cand in c['candidates']:
        name = titlecase_name(cand['name']); last = cand['name'].split(',')[0].strip().lower()
        o = {"id": slug(name), "name": name, "party": cand['party'], "orgs": [], "tags": {}, "about": cand['designation'], "inferred": False}
        if cand['party'] == 'DEM': o['orgs'] = ['dem']; o['tags'] = {"gov": 0.5, "tax": 0.4}; o['inferred'] = True
        if cand['party'] == 'REP': o['orgs'] = ['gop']; o['tags'] = {"gov": -0.5, "tax": -0.4}; o['inferred'] = True
        if ov:
            m = next((x for x in ov['options'] if x['name'].split()[-1].lower() == last.split()[-1]), None)
            if m: o['orgs'] = m['orgs']; o['tags'] = m['tags']; o['about'] = m['about'] or o['about']; o['inferred'] = False
        opts.append(o)
    items[cid] = {"type": "office", "title": ov['title'] if ov else pretty_title(c['title']), "county_title": c['title'], "voteFor": c['voteFor'], "options": opts,
                  "sides": ov['sides'] if ov else {"a": "", "b": ""}, "search": ov['search'] if ov else pretty_title(c['title']) + " San Diego County 2026 election " + ' '.join(o['name'] for o in opts[:3]),
                  "section": sec, "order": order * 1000 + i, "curated": bool(ov)}
# judges
j = FIX['items']['judges']; items['judges'] = dict(j, section='judicial', order=0, curated=True)
# props
for k, it in FIX['items'].items():
    if k.startswith('p'): n = int(k[1:]); items[f"p:{n}"] = dict(it, section='props', order=n, curated=True)
# local measures
FIXM = {'A': FIX['items']['mA'], 'B': FIX['items']['mB'], 'M': FIX['items']['mM']}
letters = sorted({l for v in btc.values() for l in v['measures']})
for L in letters:
    titles = mtitles.get(L, []); t = max(titles, key=len) if titles else ''
    t = re.sub(r'\s+', ' ', t); short = t[:90].rsplit(' ', 1)[0] + ('…' if len(t) > 90 else '') if t else ''
    base = {"type": "measure", "title": f"Measure {L}", "short": short, "what": t, "yes": {"orgs": [], "tags": {}}, "no": {"orgs": [], "tags": {}}, "sides": {"a": "", "b": ""}, "search": f"Measure {L} San Diego County November 2026 " + t[:60], "section": "measures", "order": (ord(L[0]) - 64) * 100 + (ord(L[1]) - 64 if len(L) > 1 else 0), "curated": False}
    if L in FIXM: base.update({k: v for k, v in FIXM[L].items() if k in ('title', 'short', 'what', 'yes', 'no', 'sides', 'search')}); base['curated'] = True
    items[f"m:{L}"] = base
# ballot types
bt = {}
for b, v in btc.items():
    ids = [ids_by_idx[i] for i in v['contests']] + ['judges'] + [f"p:{n}" for n in v['props']] + [f"m:{L}" for L in v['measures']]
    bt[int(b)] = ids
statewide = [ids_by_idx[by_title[t]] for t in STATE_ORDER] + ['judges'] + [f"p:{n}" for n in (1, 2, 3, 4, 5, 37, 38, 39, 40, 41, 42, 43, 44, 45)]
# results: fixture ids -> new ids
RMAP = {k: ids_by_idx[by_title[v]] for k, v in OVERLAY.items() if v in by_title}; RMAP['judges'] = 'judges'
for k in FIX['items']:
    if k.startswith('p'): RMAP[k] = f"p:{k[1:]}"
    if k.startswith('m') and len(k) == 2: RMAP[k] = f"m:{k[1]}"
results = {"asOf": RES['asOf'], "countNote": RES['countNote'], "items": {}}
for k, r in RES['items'].items():
    nid = RMAP.get(k);
    if not nid: continue
    w = r['winner']
    if items[nid]['type'] == 'office': m = next((o['id'] for o in items[nid]['options'] if o['name'].split()[-1].lower() == FIX['items'][k]['options'][[x['id'] for x in FIX['items'][k]['options']].index(w)]['name'].split()[-1].lower()), None); w = m or w
    results['items'][nid] = {"winner": w, "status": r['status'], "line": r['line']}
meta = {"election": {"id": "2026-11-03-sd", "name": "General Election", "date": "2026-11-03", "jurisdiction": "San Diego County, California"},
        "orgs": FIX['orgs'], "sliders": FIX['sliders'], "sources": FIX['sources'],
        "sections": [{"key": "state", "card": "Card A, front", "title": "State offices", "hint": ""}, {"key": "leg", "card": "Card A, front", "title": "Congress, Legislature, Board of Equalization", "hint": ""}, {"key": "judicial", "card": "Card A, front", "title": "Judicial", "hint": "vote yes or no on each"}, {"key": "school", "card": "Card A, front", "title": "School", "hint": ""}, {"key": "county", "card": "Card A, back", "title": "County", "hint": ""}, {"key": "city", "card": "Card A, back", "title": "City", "hint": ""}, {"key": "district", "card": "Card A, back", "title": "Districts", "hint": "fire, water, planning, health"}, {"key": "props", "card": "Card B", "title": "State propositions", "hint": "measures submitted to the voters"}, {"key": "measures", "card": "Card B", "title": "Local measures", "hint": ""}],
        "statewide": statewide, "counts": {"types": len(bt), "contests": len(items)}, "built": __import__('datetime').date.today().isoformat()}
json.dump(items, open(f"{OUT}/items.json", 'w'), ensure_ascii=False); json.dump(bt, open(f"{OUT}/bt.json", 'w')); json.dump(meta, open(f"{OUT}/meta.json", 'w'), ensure_ascii=False); json.dump(results, open(f"{OUT}/results.json", 'w'), ensure_ascii=False)
print(len(items), "items;", len(bt), "ballot types;", len(letters), "measures:", letters)
print("BT321:", [items[i]['title'] for i in bt.get(321, [])])
print("curated:", sum(1 for i in items.values() if i['curated']), "sizes:", {f: os.path.getsize(f"{OUT}/{f}") for f in ("items.json", "bt.json", "meta.json", "results.json")})

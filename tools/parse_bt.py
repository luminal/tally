import sys, json, re, os, glob
D = os.path.dirname(os.path.abspath(__file__))
contests = json.load(open(f"{D}/contests.json"))
def norm(s): return re.sub(r"[^A-Z]", "", s.upper())
# candidate name index: "LAST, FIRST M." -> ballot prints "FIRST M. LAST"
cand_index = {}
for ci, c in enumerate(contests):
    for cand in c['candidates']:
        last, _, first = cand['name'].partition(',')
        key = norm(first + last)
        cand_index.setdefault(key, set()).add(ci)
        # also try without middle initials / nicknames in parens
        first2 = re.sub(r"\(.*?\)", "", first); first2 = re.sub(r"\b[A-Z]\.?\b", "", first2)
        cand_index.setdefault(norm(first2 + last), set()).add(ci)
measure_re = re.compile(r"\bMEASURE\s+(?!TO\b|OF\b|IN\b|BY\b|ON\b|OR\b|AT\b|IS\b|AS\b|AN\b|BE\b|IT\b|NO\b|SO\b|DO\b|UP\b|IF\b)([A-Z]{1,2})\b")
prop_re = re.compile(r"\bPROP(?:OSITION)?\s+(\d{1,2})\b")
out = {}; measures = {}
for f in sorted(glob.glob(f"{D}/sb/txt/*.txt")):
    bt = int(os.path.basename(f)[:3]); txt = open(f, encoding='utf-8', errors='replace').read()
    lines = [l.strip() for l in txt.split('\n')]
    found = set()
    for i, l in enumerate(lines):
        if l.isupper() and 3 < len(l) < 40 and ',' not in l:
            k = norm(l)
            if k in cand_index:
                # require Party Preference or a designation line nearby to avoid header words
                found |= cand_index[k]
    ms = sorted(set(measure_re.findall(txt)))
    props = sorted(set(int(p) for p in prop_re.findall(txt)))
    # capture measure titles: "MEASURE X" then following lines until YES/NO
    for m in measure_re.finditer(txt):
        tail = txt[m.end():m.end()+400].split('\n')
        title = ' '.join(t.strip() for t in tail[:6] if t.strip() and t.strip() not in ('YES','NO'))[:220]
        measures.setdefault(m.group(1), set()).add(title)
    out[bt] = {"contests": sorted(found), "measures": ms, "props": props}
json.dump(out, open(f"{D}/bt_contests.json", "w"))
json.dump({k: sorted(v) for k, v in measures.items()}, open(f"{D}/measure_titles.json", "w"), indent=1)
print(len(out), "ballot types parsed")
bt = out.get(321) or out.get(min(out))
print("BT", 321 if 321 in out else min(out), "->", [contests[i]['title'] for i in bt['contests']], bt['measures'], bt['props'])
from collections import Counter
print("contest coverage:", Counter(len(v['contests']) for v in out.values()).most_common(5))

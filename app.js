/* Tally v2 — real lookup. Census geocoder (JSONP) for the address and districts; San Diego County's public
   ArcGIS service for the ballot type; prebuilt data/*.json for what each ballot type contains. State lives in this browser only. */
(function () {
  const KEY = 'tally.v2';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DATA = { meta: './data/meta.json', items: './data/items.json', bt: './data/bt.json', results: './data/results.json' };
  const BT_SERVICE = 'https://gis-public.sandiegocounty.gov/arcgis/rest/services/Ballot_Types_NOV2026/MapServer/0/query';
  const COUNCIL_SD = 'https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DoIT_Public/MapServer/5/query';

  let META = null, ITEMS = null, BT = null, R = null;
  let S = load();
  function load() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) return s; } catch (e) {} return blank(); }
  function blank() { return { address: '', geo: null, bt: null, ballot: null, trust: {}, sliders: {}, choices: {}, voted: {}, photos: 0 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // ---------- lookups
  function jsonp(url) {
    return new Promise((res, rej) => {
      const cb = 'tcb' + Math.random().toString(36).slice(2); const s = document.createElement('script');
      window[cb] = d => { res(d); delete window[cb]; s.remove(); };
      s.onerror = () => { rej(new Error('geocoder unreachable')); delete window[cb]; s.remove(); };
      s.src = url + '&format=jsonp&callback=' + cb; document.body.appendChild(s);
    });
  }
  async function geocode(addr) {
    const u = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=' + encodeURIComponent(addr) + '&benchmark=Public_AR_Current&vintage=Current_Current';
    const d = await jsonp(u); const m = d && d.result && d.result.addressMatches && d.result.addressMatches[0];
    if (!m) throw new Error('No match for that address. Try adding the city and ZIP.');
    const g = m.geographies || {}; const first = k => (g[k] && g[k][0]) || {};
    const cd = Object.keys(g).find(k => /Congressional/.test(k)), up = Object.keys(g).find(k => /Upper/.test(k)), lo = Object.keys(g).find(k => /Lower/.test(k));
    return { matched: m.matchedAddress, x: m.coordinates.x, y: m.coordinates.y, state: first('States').NAME, county: first('Counties').NAME,
      cd: cd ? first(cd).CD120 || first(cd).CD119 || first(cd).NAME : '', sd: up ? first(up).SLDU : '', ad: lo ? first(lo).SLDL : '' };
  }
  async function ballotType(x, y) {
    const q = `?geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=BT&returnGeometry=false&f=json`;
    const d = await (await fetch(BT_SERVICE + q)).json(); const f = d.features && d.features[0];
    return f ? f.attributes.BT : null;
  }
  async function councilDistrict(x, y) {
    try { const q = `?geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=DISTRICT&returnGeometry=false&f=json`;
      const d = await (await fetch(COUNCIL_SD + q)).json(); const f = d.features && d.features[0]; return f ? f.attributes.DISTRICT : null; } catch (e) { return null; }
  }
  async function data() {
    if (!META) [META, ITEMS, BT] = await Promise.all([fetch(DATA.meta).then(r => r.json()), fetch(DATA.items).then(r => r.json()), fetch(DATA.bt).then(r => r.json())]);
  }
  function composeBallot(bt, geo) {
    // returns ordered sections of item ids for this ballot type (or a statewide-only ballot)
    const ids = bt && BT[bt] ? BT[bt] : META.statewide;
    const sect = {}; for (const id of ids) { const it = ITEMS[id]; if (!it) continue; (sect[it.section] = sect[it.section] || []).push(id); }
    for (const k in sect) sect[k].sort((a, b) => ITEMS[a].order - ITEMS[b].order);
    return META.sections.filter(s => sect[s.key]).map(s => ({ card: s.card, title: s.title, hint: s.hint, items: sect[s.key] }));
  }

  // ---------- scoring
  function trust(o) { return S.trust[o] === 't' ? 1 : S.trust[o] === 'd' ? -1 : 0; }
  function sliderScore(tags) { let t = 0; for (const k in tags || {}) t += (S.sliders[k] || 0) * tags[k]; return t * 0.6; }
  function names(ids, f) { return (ids || []).filter(o => f(trust(o))).map(o => META.orgs[o].name); }
  function lean(id) {
    const it = ITEMS[id];
    if (it.type === 'measure') {
      let s = 0; it.yes.orgs.forEach(o => s += trust(o)); it.no.orgs.forEach(o => s -= trust(o)); s += sliderScore(it.yes.tags) - sliderScore(it.no.tags);
      const ty = names(it.yes.orgs, t => t > 0), tn = names(it.no.orgs, t => t > 0);
      const pick = s > 0.3 ? 'yes' : s < -0.3 ? 'no' : null; let why = '';
      if (ty.length) why += 'Yes: ' + ty.join(', ') + '. '; if (tn.length) why += 'No: ' + tn.join(', ') + '. ';
      const dy = names(it.yes.orgs, t => t < 0), dn = names(it.no.orgs, t => t < 0);
      if (dy.length) why += 'For it, groups you distrust: ' + dy.join(', ') + '. '; if (dn.length) why += 'Against it, groups you distrust: ' + dn.join(', ') + '. ';
      if (!why) why = it.yes.orgs.length || it.no.orgs.length ? 'None of the groups you trust took a position.' : 'No endorsements on file for this measure; read it and decide.';
      return { pick, flag: !!(ty.length && tn.length), why: why.trim() };
    }
    const sc = it.options.map(o => { let s = 0; o.orgs.forEach(x => s += trust(x)); s += sliderScore(o.tags); return { id: o.id, name: o.name, s, t: names(o.orgs, t => t > 0), inferred: o.inferred }; }).sort((a, b) => b.s - a.s);
    const top = sc[0], second = sc[1]; const margin = second ? top.s - second.s : 99;
    const pick = it.options.length === 1 ? top.id : (margin >= 0.5 ? top.id : null);
    let why = sc.filter(x => x.t.length).map(x => x.name.split(' ').slice(-1)[0] + ': ' + x.t.join(', ') + (x.inferred ? ' (party line)' : '')).join('. ');
    if (!why) why = it.options.length === 1 ? 'Only one name filed.' : 'No endorsements on file; the lean comes from your sliders and party labels.';
    return { pick, flag: sc.filter(x => x.t.length).length > 1, why };
  }
  function choice(id) { return S.choices[id] !== undefined ? S.choices[id] : lean(id).pick; }
  function optName(id, oid) { const it = ITEMS[id]; if (it.type === 'measure') return oid === 'yes' ? 'YES' : oid === 'no' ? 'NO' : '—'; const o = it.options.find(x => x.id === oid); return o ? o.name : '—'; }
  function allIds() { return (S.ballot || []).flatMap(s => s.items); }

  // ---------- views
  function view() {
    const h = (location.hash || '#start').slice(1); const steps = ['start', 'values', 'guide', 'vote', 'results']; const step = steps.includes(h) ? h : 'start';
    document.querySelectorAll('nav.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.step === step ? 'page' : 'false'));
    $('#where').innerHTML = S.ballot ? `<b>${esc(S.geo.county)}, ${esc(S.geo.state)}</b><br>${esc(META.election.name)} · ${esc(META.election.date)}${S.bt ? ' · BT ' + S.bt : ' · statewide contests only'}` : `<span class="muted">No ballot yet</span>`;
    ({ start: vStart, values: vValues, guide: vGuide, vote: vVote, results: vResults })[step](); window.scrollTo(0, 0);
  }

  function vStart() {
    $('#main').innerHTML = `
      <h1>Your ballot, in order.</h1>
      <p class="lede">Tell Tally where you vote. It finds your exact ballot, asks who you trust, and hands you a guide in the order the contests are printed. After you vote, it keeps your record on this phone and scores it when the count comes in.</p>
      <label for="addr" class="small muted">Street address, city, ZIP</label>
      <input type="text" id="addr" placeholder="1600 Pacific Hwy, San Diego, CA 92101" value="${esc(S.address)}" autocomplete="street-address">
      <div class="row"><button class="primary" id="find">Find my ballot</button>${S.ballot ? '<button id="reset" class="ghost">Start over</button>' : ''}</div>
      <div id="found">${S.ballot ? found() : ''}</div>
      <div class="note"><b>How it works.</b> The address goes to the US Census geocoder, which returns a point and your Congressional, Senate, and Assembly districts. The point goes to San Diego County's public map service, which returns your ballot type: the county's own label for which contests you get and in what order. ${esc(META.election.name)}, ${esc(META.election.date)}, is loaded with ${esc(String(META.counts.types))} ballot types and ${esc(String(META.counts.contests))} contests. Outside San Diego County you get the statewide contests only. Nothing you type is stored anywhere but this device.</div>`;
    $('#find').onclick = async () => {
      const a = $('#addr').value.trim(); if (!a) return; S.address = a; $('#found').innerHTML = '<p class="muted">Looking up…</p>';
      try {
        const geo = await geocode(a); let bt = null, council = null;
        if (geo.state === 'California' && /San Diego/.test(geo.county || '')) { bt = await ballotType(geo.x, geo.y); council = await councilDistrict(geo.x, geo.y); }
        else if (geo.state !== 'California') throw new Error('Tally only knows California right now. ' + esc(geo.matched) + ' is in ' + esc(geo.state) + '.');
        S.geo = geo; S.bt = bt; S.geo.council = council; S.geo.btMissing = !!(bt && !BT[bt]); S.ballot = composeBallot(bt, geo); S.choices = {}; S.voted = {}; save(); $('#found').innerHTML = found(); vStartBind();
      } catch (e) { $('#found').innerHTML = `<div class="lesson">${esc(e.message)}</div>`; }
    };
    vStartBind();
  }
  function found() {
    const n = allIds().length; const g = S.geo;
    return `<div class="note"><b>Found it.</b> ${esc(g.matched)}. ${g.county ? esc(g.county) + '. ' : ''}Congressional ${esc(g.cd)}, Senate ${esc(String(+g.sd))}, Assembly ${esc(String(+g.ad))}${g.council ? ', San Diego council district ' + esc(String(g.council)) : ''}.${S.bt && !g.btMissing ? ` Ballot type <b>${S.bt}</b>: ${n} contests and measures.` : S.bt ? ` Ballot type <b>${S.bt}</b> is not in Tally's data yet, so this is the statewide ballot only (${n}).` : ` Statewide contests only (${n}).`} <a href="#values">Next: who do you trust? →</a></div>`;
  }
  function vStartBind() { if ($('#reset')) $('#reset').onclick = () => { if (confirm('Clear your ballot, answers, and vote record from this device?')) { localStorage.removeItem(KEY); S = blank(); view(); } }; }

  function vValues() {
    const orgs = Object.entries(META.orgs).map(([k, o]) => `<div class="org"><b>${esc(o.name)}</b><span class="blurb">${esc(o.blurb)}</span>
        <div class="tri" data-org="${k}"><button class="t" aria-pressed="${S.trust[k] === 't'}">Trust</button><button class="n" aria-pressed="${!S.trust[k] || S.trust[k] === 'n'}">Neutral</button><button class="d" aria-pressed="${S.trust[k] === 'd'}">Distrust</button></div></div>`).join('');
    const sliders = META.sliders.map(s => `<div class="slider"><div class="q">${esc(s.q)}</div><input type="range" min="-1" max="1" step="0.25" value="${S.sliders[s.key] || 0}" data-key="${s.key}" aria-label="${esc(s.q)}"><div class="ends"><span>${esc(s.left)}</span><span>${esc(s.right)}</span></div></div>`).join('');
    $('#main').innerHTML = `<h1>Who do you trust?</h1>
      <p>Ballot measures are odd, and groups you trust are a better predictor than an issue quiz. Mark the ones whose judgment you'd borrow, and the ones you'd vote against on principle. Leave the rest neutral.</p>
      <div class="orgs">${orgs}</div><h2>Then four sliders <span class="k">for the gaps</span></h2>${sliders}
      <div class="row"><a class="btn primary" href="#guide">Build my guide →</a></div>`;
    document.querySelectorAll('.tri').forEach(tri => tri.querySelectorAll('button').forEach(b => b.onclick = () => { S.trust[tri.dataset.org] = b.classList.contains('t') ? 't' : b.classList.contains('d') ? 'd' : 'n'; S.choices = {}; save(); tri.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
    document.querySelectorAll('input[type=range]').forEach(r => r.oninput = () => { S.sliders[r.dataset.key] = parseFloat(r.value); S.choices = {}; save(); });
  }

  function itemHtml(id) {
    const it = ITEMS[id], L = lean(id), c = choice(id), isM = it.type === 'measure';
    const leanTxt = c == null ? 'your call' : isM ? c.toUpperCase() : optName(id, c).split(' ').slice(-1)[0];
    const leanCls = c == null ? 'unsure' : isM ? c : 'pick';
    const endorse = isM ? `<div class="endorse"><b>Yes:</b> ${it.yes.orgs.map(o => esc(META.orgs[o].name)).join(', ') || 'none on file'} · <b>No:</b> ${it.no.orgs.map(o => esc(META.orgs[o].name)).join(', ') || 'none on file'}</div>`
      : it.options.map(o => `<div class="endorse"><b>${esc(o.name)}</b>${o.party ? ' (' + esc(o.party) + ')' : ''}: ${o.orgs.map(x => esc(META.orgs[x].name)).join(', ') || 'no endorsements on file'}${o.inferred ? ' <i>(inferred from party)</i>' : ''}. <span>${esc(o.about)}</span></div>`).join('');
    const opts = isM ? [['yes', 'YES'], ['no', 'NO']] : it.options.map(o => [o.id, o.name]);
    const choices = opts.map(([oid, n]) => `<button data-item="${esc(id)}" data-opt="${esc(oid)}" aria-pressed="${c === oid}">${esc(n)}</button>`).join('') + `<button data-item="${esc(id)}" data-opt="" aria-pressed="${c == null}" class="ghost">Skip</button>`;
    const sides = it.sides && (it.sides.a || it.sides.b) ? `<div class="sides"><div class="side"><b>${isM ? 'The case for yes' : 'One side'}</b>${esc(it.sides.a)}</div>${it.sides.b ? `<div class="side"><b>${isM ? 'The case for no' : 'The other'}</b>${esc(it.sides.b)}</div>` : ''}</div>` : `<p class="small muted">No write-up for this contest yet. The ballot designations and the search links are what there is.</p>`;
    return `<details class="item" id="it-${esc(id)}"><summary>
        <span class="t">${esc(it.title)}${it.short ? `<small>${esc(it.short)}</small>` : ''}${it.voteFor > 1 ? `<small>vote for ${it.voteFor}</small>` : ''}</span>
        <span class="lean ${leanCls}">${L.flag ? '<span class="flag">▲ </span>' : ''}${esc(leanTxt)}</span><span class="why">${esc(L.why)}</span></summary>
      <div class="body">${it.what ? `<p>${esc(it.what)}</p>` : ''}${it.names ? `<p class="small muted">${it.names.map(esc).join(' · ')}</p>` : ''}${sides}${endorse}
        <div class="choices">${choices}</div>
        <div class="links"><a href="https://www.google.com/search?q=${encodeURIComponent(it.search)}" target="_blank" rel="noopener">Search the web ↗</a><a href="https://www.google.com/search?q=${encodeURIComponent(it.search + ' news')}&tbm=nws" target="_blank" rel="noopener">News ↗</a></div></div></details>`;
  }

  function vGuide() {
    if (!S.ballot) { location.hash = '#start'; return; }
    const trusted = Object.keys(S.trust).filter(k => S.trust[k] === 't').length;
    const secs = S.ballot.map((s, i) => `${(i === 0 || S.ballot[i - 1].card !== s.card) ? `<div class="cardhead">${esc(s.card)}</div>` : ''}<h2>${esc(s.title)}${s.hint ? `<span class="k">${esc(s.hint)}</span>` : ''}</h2>${s.items.map(itemHtml).join('')}`).join('');
    const unsure = allIds().filter(id => choice(id) == null).length, thin = allIds().filter(id => !ITEMS[id].curated).length;
    $('#main').innerHTML = `<h1>Your guide</h1>
      <p class="muted small">In the order printed on your ballot. The big word is where Tally thinks you land, from the ${trusted} group${trusted === 1 ? '' : 's'} you trust and your sliders. Tap any contest to read both sides, see who endorsed what, and change your pick. ▲ means groups you trust disagree.</p>
      ${unsure ? `<div class="pending">${unsure} contest${unsure === 1 ? '' : 's'} need your call.</div>` : ''}
      ${thin ? `<div class="pending">${thin} contest${thin === 1 ? '' : 's'} on this ballot have no write-up yet, only candidates, party labels, and search links. Write-ups exist for the statewide contests and a handful of San Diego ones.</div>` : ''}
      <div class="row no-print"><button id="print">Print or save PDF</button><button id="copy">Copy as text</button><a class="btn primary" href="#vote">I'm voting →</a></div>${secs}
      <footer class="col">Ballot contents from the San Diego County Registrar's sample ballots and candidate list. Write-ups from ${META.sources.map(esc).join(', ')}. Tally doesn't tell you how to vote; it shows where the groups you chose land.</footer>`;
    document.querySelectorAll('.choices button').forEach(b => b.onclick = e => { e.preventDefault(); S.choices[b.dataset.item] = b.dataset.opt === '' ? null : b.dataset.opt; save(); const o = $('#it-' + CSS.escape(b.dataset.item)).open; vGuide(); const el = $('#it-' + CSS.escape(b.dataset.item)); if (el) { el.open = o; el.scrollIntoView({ block: 'center' }); } });
    $('#print').onclick = () => window.print();
    $('#copy').onclick = () => { const txt = ['TALLY · ' + S.geo.county + ' · ' + META.election.name + ' ' + META.election.date + (S.bt ? ' · BT ' + S.bt : ''), ''].concat(S.ballot.flatMap(s => ['## ' + s.title].concat(s.items.map(id => ITEMS[id].title + ': ' + optName(id, choice(id)) + (lean(id).flag ? ' ▲' : ''))).concat(['']))).join('\n');
      navigator.clipboard.writeText(txt).then(() => { $('#copy').textContent = 'Copied'; }, () => { prompt('Copy this:', txt); }); };
  }

  function vVote() {
    if (!S.ballot) { location.hash = '#start'; return; }
    const rows = allIds().map(id => { const it = ITEMS[id], g = choice(id), v = S.voted[id];
      const opts = it.type === 'measure' ? [['yes', 'YES'], ['no', 'NO']] : it.options.map(o => [o.id, o.name.split(' ').slice(-1)[0]]); const dev = v !== undefined && v !== g;
      return `<div class="vrow"><div><div>${esc(it.title)}${it.short ? ` <span class="muted small">${esc(it.short)}</span>` : ''}</div><div class="g">Guide: ${esc(optName(id, g))}${dev ? ' · <span class="dev">you deviated</span>' : ''}</div></div>
        <div class="choices">${opts.map(([oid, n]) => `<button data-item="${esc(id)}" data-opt="${esc(oid)}" aria-pressed="${v === oid}">${esc(n)}</button>`).join('')}<button class="ghost" data-item="${esc(id)}" data-opt="skip" aria-pressed="${v === null}">Skipped</button></div></div>`; }).join('');
    const done = Object.keys(S.voted).length, total = allIds().length, dev = Object.keys(S.voted).filter(id => S.voted[id] !== choice(id)).length;
    $('#main').innerHTML = `<h1>How did you actually vote?</h1><p>Tap through after you've filled in your ballot. This is the record Tally scores later. It stays on this device.</p>
      <div class="tally"><div><b>${done}/${total}</b><span>recorded</span></div><div><b>${done - dev}</b><span>followed the guide</span></div><div><b>${dev}</b><span>deviated</span></div><div><b>${S.photos}</b><span>ballot photos</span></div></div>
      <div class="row"><button id="all">Mark all as “followed the guide”</button><label class="btn">Add ballot photos <input type="file" accept="image/*" capture="environment" multiple id="photos" hidden></label><a class="btn primary" href="#results">See results →</a></div>
      <div class="pending">Photograph <b>both sides of each card</b>. Photos stay in this browser session and are never uploaded.</div><div class="photos" id="pv"></div>${rows}`;
    document.querySelectorAll('.vrow .choices button').forEach(b => b.onclick = () => { S.voted[b.dataset.item] = b.dataset.opt === 'skip' ? null : b.dataset.opt; save(); vVote(); });
    $('#all').onclick = () => { allIds().forEach(id => { S.voted[id] = choice(id); }); save(); vVote(); };
    $('#photos').onchange = e => { const fs = [...e.target.files]; S.photos += fs.length; save(); fs.forEach(f => { const img = document.createElement('img'); img.src = URL.createObjectURL(f); img.alt = f.name; $('#pv').appendChild(img); }); };
  }

  function vResults() {
    if (!S.ballot) { location.hash = '#start'; return; }
    if (!R) { $('#main').innerHTML = '<p class="muted">Loading results…</p>'; fetch(DATA.results + '?t=' + Date.now()).then(r => r.json()).then(j => { R = j; vResults(); }); return; }
    let hit = 0, miss = 0, tbd = 0, n = 0, nores = 0;
    const rows = allIds().map(id => { const it = ITEMS[id], r = R.items[id]; const mine = S.voted[id] !== undefined ? S.voted[id] : choice(id); let m, cls, line;
      if (!r) { m = '·'; cls = 'muted'; line = 'No result on file yet for this contest.'; nores++; }
      else if (mine == null) { m = '·'; cls = 'muted'; line = r.line; }
      else if (r.status === 'close') { m = '~'; cls = 'tbd'; tbd++; n++; line = r.line; }
      else if (mine === r.winner) { m = '✓'; cls = 'hit'; hit++; n++; line = r.line; } else { m = '✗'; cls = 'miss'; miss++; n++; line = r.line; }
      return `<div class="rrow"><div class="m ${cls}">${m}</div><div><div><b>${esc(it.title)}</b>${it.short ? ` <span class="muted small">${esc(it.short)}</span>` : ''} · you: ${esc(optName(id, mine))}</div><div class="line">${esc(line)}</div></div></div>`; }).join('');
    const src = Object.keys(S.voted).length ? 'your recorded votes' : 'your guide (you haven\'t recorded votes yet)';
    $('#main').innerHTML = `<h1>How your ballot did</h1><p class="muted small">Scored against ${src}. Count as of ${esc(new Date(R.asOf).toLocaleString())}.</p>
      <div class="tally"><div><b>${hit} of ${n}</b><span>with the majority</span></div><div><b>${miss}</b><span>against it</span></div><div><b>${tbd}</b><span>too close to call</span></div><div><b>${Math.round(hit / Math.max(1, hit + miss) * 100)}%</b><span>of decided contests</span></div></div>
      <div class="row no-print"><button id="refresh">Refresh count</button><button id="printr">Print</button></div><div class="pending">${esc(R.countNote)}${nores ? ` ${nores} contest${nores === 1 ? '' : 's'} on your ballot have no result loaded yet.` : ''}</div>${rows}
      <footer class="col">Results: California Secretary of State and the San Diego County Registrar. Snapshot loaded with the app; the live build polls on election night.</footer>`;
    $('#refresh').onclick = () => { R = null; vResults(); }; $('#printr').onclick = () => window.print();
  }

  data().then(() => { window.addEventListener('hashchange', view); view();
    const qa = new URLSearchParams(location.search).get('addr');
    if (qa && !S.ballot) { location.hash = '#start'; view(); $('#addr').value = qa; $('#find').click(); }
  }).catch(e => { $('#main').innerHTML = '<div class="lesson">Could not load ballot data: ' + esc(e.message) + '</div>'; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
})();

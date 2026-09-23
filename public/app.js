(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { typeOf, isRed } = MJ;

  // 좌석: 0 나(東), 1 하가(南), 2 대면(西), 3 상가(北). 진행 순서 0 → 1 → 2 → 3
  const SEAT_NAMES = ['나', '하가', '대면', '상가'];
  // 주소에 ?fast 를 붙이면 상대 차례를 기다리지 않는다 (테스트용)
  const OPP_DELAY = /[?&]fast\b/.test(location.search) ? 0 : 280;
  const TILE_FILES = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'Man' + n),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'Pin' + n),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'Sou' + n),
    'Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun',
  ];
  // 패 그림을 처음에 모두 불러와 둔다. 처음 보는 패를 그 순간 불러오면
  // 흰 패 몸통만 보였다가 그림이 뒤늦게 나타나기 때문 (특히 인터넷을 거칠 때)
  const PRELOADED = [...TILE_FILES, 'Man5-Dora', 'Pin5-Dora', 'Sou5-Dora', 'Front'].map((name) => {
    const im = new Image();
    im.src = `tiles/${name}.svg`;
    if (im.decode) im.decode().catch(() => {});
    return im;
  });

  let S;

  // ---------- 선언 애니메이션 (리치 / 퐁 / 치 / 깡 / 론 / 쯔모) ----------
  const FAST = /[?&]fast\b/.test(location.search);
  const CALLOUT_MS = FAST ? 0 : 900;    // 애니메이션을 보여 주는 동안 진행을 멈추는 시간
  const RESULT_DELAY_MS = FAST ? 0 : 1250; // 화료 선언이 거의 끝난 뒤 결과 창을 띄운다
  const CALLOUT_CLASS = { '리치': 'riichi', '퐁': 'pon', '치': 'chi', '깡': 'kan', '론': 'ron', '쯔모': 'tsumo' };
  function callout(seat, text) {
    if (FAST) return;
    const el = document.createElement('div');
    el.className = `callout seat${seat} ${CALLOUT_CLASS[text] || ''}`;
    el.innerHTML = `<span>${text}!</span>`;
    $('table').append(el);
    // 리치·쯔모·론은 화면 번쩍 + 테이블 흔들림
    if (['리치', '쯔모', '론'].includes(text)) {
      const flash = document.createElement('div');
      flash.className = `screen-flash ${CALLOUT_CLASS[text]}`;
      document.body.append(flash);
      setTimeout(() => flash.remove(), 900);
      const table = $('table');
      table.classList.remove('shake');
      void table.offsetWidth;   // 애니메이션 다시 시작
      table.classList.add('shake');
      setTimeout(() => table.classList.remove('shake'), 700);
    }
    // 빛 고리(::before)가 먼저 끝나도 글자는 남겨 두고, 애니메이션이 멈춘 환경에서도 결국 지운다
    el.addEventListener('animationend', (e) => { if (!e.pseudoElement) el.remove(); });
    setTimeout(() => el.remove(), 1600);
  }

  // ---------- 저장 (브라우저별) ----------
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  }
  let stats = Object.assign({ games: 0, wins: 0, best: 0, dealIns: 0, net: 0 }, load('mj-stats', {}));
  // 저장된 값이 선택지에 없으면(예전 버전 등) 기본값으로
  function setSelect(id, value, fallback) {
    const el = $(id);
    el.value = value;
    if (el.selectedIndex < 0) el.value = fallback;
  }
  setSelect('mode', load('mj-mode', '4p'), '4p');
  setSelect('oppLevel', load('mj-opp-level', 'off'), 'off');
  setSelect('matchType', load('mj-match-type', 'hanchan'), 'hanchan');
  const pressed = (id) => $(id).getAttribute('aria-pressed') === 'true';
  const setPressed = (id, on) => $(id).setAttribute('aria-pressed', on ? 'true' : 'false');
  setPressed('btnAskCalls', load('mj-ask-calls', true));
  const askCallsLabel = () => { $('btnAskCalls').textContent = pressed('btnAskCalls') ? '울기 ON' : '울기 OFF'; };
  askCallsLabel();
  setPressed('btnJudge', load('mj-judge', false));

  // ---------- 패 그리기 ----------
  function tileEl(type, opts = {}) {
    const el = document.createElement(opts.button ? 'button' : 'span');
    el.className = 'tile';
    if (opts.back) {
      el.classList.add('back');
    } else {
      const img = document.createElement('img');
      img.src = `tiles/${TILE_FILES[type]}${opts.red ? '-Dora' : ''}.svg`;
      img.alt = '';
      img.draggable = false;
      img.decoding = 'sync';
      el.append(img);
      el.setAttribute('aria-label', MJ.tileName(type) + (opts.red ? ' (적)' : ''));
      el.title = MJ.tileName(type) + (opts.red ? ' (적도라)' : '');
    }
    if (!opts.side) return el;
    const wrap = document.createElement('span');
    wrap.className = 'side';
    wrap.append(el);
    return wrap;
  }
  const idEl = (id, opts = {}) => tileEl(typeOf(id), { ...opts, red: isRed(id) });

  // ---------- 상태 헬퍼 ----------
  const solo = () => S.mode !== '4p';
  const remaining = () => (solo() ? S.left : S.wall.length);
  const handIds = () => (S.drawn == null ? S.hand : [...S.hand, S.drawn]);
  const meldCount = () => S.melds.length;
  const doraIndicators = () => S.doraPool.slice(0, 1 + S.kanCount).map(typeOf);
  const uraIndicators = () => S.uraPool.slice(0, 1 + S.kanCount).map(typeOf);
  const firstGoAround = () => S.rivers[0].length === 0 && !S.anyCall;
  const sortIds = (ids) => ids.sort((a, b) => a - b);
  // 상대가 리치·화료하는지 (4인 모드 + 강도가 '버리기만'이 아닐 때)
  const oppActive = () => !solo() && S.level !== 'off';
  const isRiichi = (q) => (q === 0 ? S.riichi : S.oppState[q].riichi);

  function visibleCounts() {
    const c = MJ.toCounts(handIds());
    for (const m of S.melds) for (const id of m.ids) c[typeOf(id)]++;
    for (let q = 1; q <= 3; q++) for (const m of S.oppMelds[q]) for (const id of m.ids) c[typeOf(id)]++;
    for (const river of S.rivers) for (const d of river) if (!d.called) c[typeOf(d.id)]++;
    for (const t of doraIndicators()) c[t]++;
    return c;
  }

  function drawFromWall() {
    if (solo()) S.left--;
    return S.wall.pop();
  }

  function takeFromHand(type, n) {
    const taken = [];
    for (let i = S.hand.length - 1; i >= 0 && taken.length < n; i--) {
      if (typeOf(S.hand[i]) === type) taken.push(...S.hand.splice(i, 1));
    }
    return taken;
  }

  // ---------- 대국 (소지점수, 친, 본장, 공탁) ----------
  // M: { type: 'tonpuu' | 'hanchan', points[4], startDealer, dealer, round(27 東 / 28 南), honba, pot, over }
  // '한 판씩'이나 혼자 모드에서는 M = null (나는 항상 동가)
  let M = load('mj-match', null);
  const WIND_CH = ['東', '南', '西', '北'];
  const dealerSeat = () => (M ? M.dealer : 0);
  const windOf = (p) => 27 + ((p - dealerSeat() + 4) % 4);
  const roundWind = () => (M ? M.round : 27);
  const saveMatch = () => save('mj-match', M);
  const canAffordRiichi = (q) => !M || M.points[q] >= 1000;

  function newMatch() {
    const type = $('matchType').value;
    if ($('mode').value === '4p' && type !== 'single') {
      const start = Math.floor(Math.random() * 4);
      M = { v: 1, type, points: [25000, 25000, 25000, 25000], startDealer: start, dealer: start, round: 27, honba: 0, pot: 0, over: false };
    } else {
      M = null;
    }
    saveMatch();
    newGame();
  }

  function kyokuLabel() {
    if (!M) return '';
    const n = ((M.dealer - M.startDealer + 4) % 4) + 1;
    return `${['동', '남'][M.round - 27]}${n}국 ${M.honba}본장`;
  }

  // 순위: 점수 높은 순, 같으면 기가(처음 친)에 가까운 자리가 위
  function ranking() {
    const order = (q) => (q - M.startDealer + 4) % 4;
    return [0, 1, 2, 3].sort((a, b) => M.points[b] - M.points[a] || order(a) - order(b));
  }

  function payRiichi(q) {
    if (!M) return;
    M.points[q] -= 1000;
    M.pot++;
    saveMatch();
  }

  function isTenpai(p) {
    if (p === 0) return MJ.shanten(MJ.toCounts(S.hand), meldCount()) === 0;
    return MJ.shanten(MJ.toCounts(S.opp[p]), S.oppMelds[p].length) === 0;
  }

  // 한 판 정산: 화료 점수 + 본장 + 공탁, 유국이면 노텐 벌점. 그 다음 친/본장/종료 결정
  function settle(outcome) {
    const before = M.points.slice();
    const winds = [0, 1, 2, 3].map(windOf);
    const delta = [0, 0, 0, 0];
    const dealer = M.dealer, h = M.honba;
    let renchan;
    if (outcome.type === 'draw') {
      const tp = [0, 1, 2, 3].map(isTenpai);
      const t = tp.filter(Boolean).length;
      if (t > 0 && t < 4) for (let q = 0; q < 4; q++) delta[q] += tp[q] ? 3000 / t : -3000 / (4 - t);
      renchan = tp[dealer];
      M.honba = h + 1;
      outcome.tenpai = tp;
    } else {
      const w = outcome.type === 'win' ? 0 : outcome.seat;
      const r = outcome.result;
      if (r.tsumo) {
        for (let q = 0; q < 4; q++) {
          if (q === w) continue;
          const pay = (w === dealer || q !== dealer ? r.childPay : r.dealerPay) + 100 * h;
          delta[q] -= pay;
          delta[w] += pay;
        }
      } else {
        const pay = r.points + 300 * h;
        delta[outcome.from] -= pay;
        delta[w] += pay;
      }
      delta[w] += M.pot * 1000;
      M.pot = 0;
      renchan = w === dealer;
      M.honba = renchan ? h + 1 : 0;
    }
    for (let q = 0; q < 4; q++) M.points[q] += delta[q];
    advance(renchan);
    saveMatch();
    // 대국이 끝나면 남은 공탁이 1등에게 가므로, 변동은 실제 전후 차이로 다시 계산
    const after = M.points.slice();
    return { before, delta: after.map((x, q) => x - before[q]), winds, after };
  }

  function advance(renchan) {
    const lastRound = M.type === 'tonpuu' ? 27 : 28;
    const allLast = M.round === lastRound && (M.dealer - M.startDealer + 4) % 4 === 3;
    const finish = (reason) => {
      M.over = true;
      M.endReason = reason;
      // 남은 공탁은 1등이 가져간다
      M.points[ranking()[0]] += M.pot * 1000;
      M.pot = 0;
    };
    if (M.points.some((x) => x < 0)) return finish('누군가 0점 미만 (토비)');
    if (renchan) {
      // 오라스에 친이 1등이면 거기서 끝 (아가리야메 / 텐파이야메)
      if (allLast && ranking()[0] === M.dealer) finish('오라스 친이 1등');
      return;
    }
    if (allLast) return finish('마지막 국 종료');
    M.dealer = (M.dealer + 1) % 4;
    if (M.dealer === M.startDealer) M.round++;
  }

  function settlementTable(st, tenpai) {
    const table = document.createElement('table');
    table.className = 'settle';
    table.innerHTML = '<tr><th></th><th>이전</th><th>변동</th><th>현재</th></tr>';
    for (let q = 0; q < 4; q++) {
      const tr = table.insertRow();
      if (q === 0) tr.className = 'me';
      tr.insertCell().textContent = `${WIND_CH[st.winds[q] - 27]} ${SEAT_NAMES[q]}` + (tenpai ? (tenpai[q] ? ' (텐파이)' : ' (노텐)') : '');
      tr.insertCell().textContent = st.before[q].toLocaleString();
      const dc = tr.insertCell();
      const dv = st.delta[q];
      dc.textContent = dv ? (dv > 0 ? '+' : '−') + Math.abs(dv).toLocaleString() : '0';
      dc.className = dv > 0 ? 'plus' : dv < 0 ? 'minus' : '';
      tr.insertCell().textContent = st.after[q].toLocaleString();
    }
    return table;
  }

  function showFinal() {
    $('resultTitle').textContent = '대국 종료';
    $('result').classList.remove('lose');
    $('resultHand').innerHTML = '';
    const d = $('resultDetail');
    d.innerHTML = '';
    d.append(para(M.endReason || '', 'muted'));
    const table = document.createElement('table');
    table.className = 'settle final';
    ranking().forEach((q, i) => {
      const tr = table.insertRow();
      if (q === 0) tr.className = 'me';
      tr.insertCell().textContent = `${i + 1}위`;
      tr.insertCell().textContent = SEAT_NAMES[q];
      tr.insertCell().textContent = M.points[q].toLocaleString() + '점';
    });
    d.append(table);
    $('btnNext').textContent = '새 대국';
    if (!$('result').open) $('result').showModal();
  }

  // ---------- 게임 진행 ----------
  function newGame() {
    if (S) clearTimeout(S.timer);
    $('hintPanel').style.minHeight = '';
    document.querySelector('main').style.minHeight = '';
    const mode = $('mode').value;
    const wall = MJ.shuffle([...Array(136).keys()]);
    const dead = wall.splice(0, 14);
    S = {
      mode, wall,
      doraPool: dead.slice(0, 5), uraPool: dead.slice(5, 10), rinshan: dead.slice(10, 14), kanCount: 0,
      hand: sortIds(wall.splice(0, 13)), drawn: null, melds: [],
      opp: [null, [], [], []],
      oppMelds: [null, [], [], []],
      rivers: [[], [], [], []],
      turn: 0, phase: 'self', pending: null,
      riichi: false, riichiSelect: false, ippatsu: false, doubleRiichi: false,
      furitenTemp: false, furitenRiichi: false, banned: null, rinshanFlag: false, anyCall: false,
      left: 0, timer: null, result: null,
      level: $('oppLevel').value,
      // 상대별 상태: 리치, 리치 선언 시점(seq), 일발, 더블 리치, 후리텐(역이 없어 못 한 론)
      oppState: [null, 1, 2, 3].map((q) => q && { riichi: false, riichiSeq: -1, ippatsu: false, double: false, furiten: false }),
      riichiSeq: -1, seq: 0,
      kyoku: kyokuLabel(),
    };
    if (mode === '4p') {
      for (let p = 1; p <= 3; p++) S.opp[p] = wall.splice(0, 13);
    } else {
      S.left = Math.min(mode === 'solo18' ? 18 : 109, wall.length);
    }
    // 친부터 시작
    if (dealerSeat() === 0) return playerDraw(false);
    S.phase = 'wait';
    S.turn = dealerSeat();
    schedule({ kind: 'opp', p: dealerSeat() });
    render();
  }

  function playerDraw(rinshan) {
    if (!rinshan && remaining() <= 0) return ryuukyoku();
    S.drawn = rinshan ? S.rinshan.pop() : drawFromWall();
    S.rinshanFlag = rinshan;
    S.turn = 0;
    S.phase = 'self';
    render();
    autoDiscardIfRiichi();
  }

  function autoDiscardIfRiichi() {
    if (S.phase === 'self' && S.riichi && S.drawn != null && !canTsumo() && !kanOptions().length) {
      S.timer = setTimeout(() => discard(S.drawn), 600);
    }
  }

  function discardable(id) {
    if (S.phase !== 'self') return false;
    if (S.riichi) return id === S.drawn;
    if (S.riichiSelect) return riichiDiscardTypes().has(typeOf(id));
    if (S.banned && S.banned.has(typeOf(id))) {
      // 금지패밖에 없으면 예외적으로 허용
      return handIds().every((x) => S.banned.has(typeOf(x)));
    }
    return true;
  }

  function discard(id) {
    if (!discardable(id)) return;
    clearTimeout(S.timer);
    let riichiNow = false;
    if (S.riichiSelect) {
      S.riichiSelect = false;
      S.riichi = true;
      S.ippatsu = true;
      S.doubleRiichi = firstGoAround();
      riichiNow = true;
    } else if (S.ippatsu) {
      S.ippatsu = false;
    }
    S.hand = sortIds(handIds().filter((x) => x !== id));
    S.drawn = null;
    S.banned = null;
    S.rinshanFlag = false;
    if (!S.riichi) S.furitenTemp = false;
    if (riichiNow) S.riichiSeq = S.seq;
    S.rivers[0].push({ id, riichi: riichiNow, seq: S.seq++ });

    // 내 버림패로 상대가 론 (하가 → 대면 → 상가 순서로 먼저인 사람만)
    if (oppActive()) {
      for (const q of [1, 2, 3]) if (oppRonResult(q, id)) return oppWin(q, false, 0, id);
    }
    if (riichiNow) { payRiichi(0); callout(0, '리치'); }

    if (solo()) {
      if (remaining() <= 0) return ryuukyoku();
      return playerDraw(false);
    }
    // 내 버림패를 상대가 울 수도 있다 (퐁은 누구나, 치는 하가만)
    const oppCall = oppActive() ? decideOppCall(0, id) : null;
    if (oppCall) {
      S.drawn = null;
      return doOppCall(oppCall);
    }
    S.phase = 'wait';
    schedule({ kind: 'opp', p: 1 }, riichiNow ? Math.max(OPP_DELAY, CALLOUT_MS) : OPP_DELAY);
    render();
  }

  // ---------- 상대 AI ----------
  // 버릴 때 남기고 싶은 정도 (주변 패와 이어질수록 큼)
  function connectivity(c, t) {
    if (t >= 27) return c[t] * 3;
    let v = c[t] * 3;
    const r = t % 9;
    for (const d of [-2, -1, 1, 2]) {
      if (r + d < 0 || r + d > 8) continue;
      v += c[t + d] * (Math.abs(d) === 1 ? 2 : 1);
    }
    return v;
  }

  const oppMeldCount = (q) => S.oppMelds[q].length;
  const oppMenzen = (q) => S.oppMelds[q].every((m) => m.kind === 'ankan');
  const plainMelds = (q) => S.oppMelds[q].map((m) => ({ kind: m.kind, tile: m.tile }));
  const isYakuhaiFor = (q, t) => t >= 31 || t === windOf(q) || t === roundWind();

  // 부로한 손이 노리는 역: 역패가 있으면 없음(자유), 탕야오, 혼일색(수트) 중 하나
  function openPlan(q) {
    const melds = S.oppMelds[q].filter((m) => m.kind !== 'ankan');
    if (!melds.length) return null;
    if (melds.some((m) => m.kind !== 'chi' && isYakuhaiFor(q, m.tile))) return null;
    const tilesOf = (m) => (m.kind === 'chi' ? [m.tile, m.tile + 1, m.tile + 2] : [m.tile]);
    const all = melds.flatMap(tilesOf);
    if (all.every((t) => !MJ.isYaochu(t))) return { tanyao: true };
    const suits = new Set(all.filter((t) => t < 27).map((t) => Math.floor(t / 9)));
    if (suits.size === 1) return { suit: [...suits][0] };
    return null;
  }
  // 계획에서 벗어난 패(먼저 버릴 패)인가
  function offPlan(plan, t) {
    if (!plan) return false;
    if (plan.tanyao) return MJ.isYaochu(t);
    return t < 27 && Math.floor(t / 9) !== plan.suit;
  }

  // 샹텐이 가장 낮아지는 패. 같으면 역 계획에서 벗어난 패 → 고립된 패 순
  function bestByShanten(c, melds = 0, banned = null, plan = null) {
    let best = null;
    const allowed = (t) => c[t] && !(banned && banned.has(t));
    const anyAllowed = [...Array(34).keys()].some(allowed);
    for (let t = 0; t < 34; t++) {
      if (!c[t] || (anyAllowed && !allowed(t))) continue;
      const conn = connectivity(c, t);
      const keep = offPlan(plan, t) ? 0 : 1;
      c[t]--;
      const sh = MJ.shanten(c, melds);
      c[t]++;
      if (!best || sh < best.sh || (sh === best.sh && (keep < best.keep || (keep === best.keep && conn < best.conn)))) {
        best = { t, sh, keep, conn };
      }
    }
    return best.t;
  }

  function visibleForOpp(p) {
    const c = MJ.toCounts(S.opp[p]);
    for (const m of S.melds) for (const id of m.ids) c[typeOf(id)]++;
    for (let q = 1; q <= 3; q++) for (const m of S.oppMelds[q]) for (const id of m.ids) c[typeOf(id)]++;
    for (const river of S.rivers) for (const d of river) if (!d.called) c[typeOf(d.id)]++;
    for (const t of doraIndicators()) c[t]++;
    return c;
  }

  // q가 리치한 뒤 q에게 론당하지 않는 패 (현물): q의 버림패 전부 + 리치 뒤 누군가 버린 패
  function safeAgainst(q) {
    const since = q === 0 ? S.riichiSeq : S.oppState[q].riichiSeq;
    const set = new Set(S.rivers[q].map((d) => typeOf(d.id)));
    for (const river of S.rivers) for (const d of river) if (d.seq > since) set.add(typeOf(d.id));
    return set;
  }

  function threatsFor(p) {
    return [0, 1, 2, 3].filter((q) => q !== p && isRiichi(q));
  }

  function dangerScore(t, threats, vis) {
    let danger = 0;
    for (const q of threats) {
      if (safeAgainst(q).has(t)) continue;
      if (t >= 27) danger += vis[t] >= 3 ? 1 : vis[t] === 2 ? 2 : 4;
      else danger += MJ.isYaochu(t) ? 5 : 8;
    }
    return danger;
  }

  // 오리기: 가장 안전한 패, 같으면 샹텐을 덜 망가뜨리는 패
  function defendDiscard(p, c, melds, banned) {
    const threats = threatsFor(p);
    const vis = visibleForOpp(p);
    let best = null;
    for (let t = 0; t < 34; t++) {
      if (!c[t] || (banned && banned.has(t))) continue;
      const danger = dangerScore(t, threats, vis);
      c[t]--;
      const after = MJ.shanten(c, melds);
      c[t]++;
      if (!best || danger < best.danger || (danger === best.danger && after < best.after)) best = { t, danger, after };
    }
    return best ? best.t : bestByShanten(c, melds);
  }

  // 손에 든 도라 수 (적도라·부로 포함) — 밀지 오릴지 판단할 때 손의 값어치
  function oppHandValue(p) {
    const ids = [...S.opp[p], ...S.oppMelds[p].flatMap((m) => m.ids)];
    const dora = doraIndicators().map(MJ.doraFromIndicator);
    return ids.filter(isRed).length + ids.reduce((n, id) => n + dora.filter((d) => d === typeOf(id)).length, 0);
  }

  // p 입장에서 패 t를 버렸을 때 누군가에게 론당할 확률 (플레이어 힌트와 같은 추정식)
  function riskFor(p, t, vis) {
    let safeProb = 1;
    for (let q = 0; q < 4; q++) {
      if (q === p) continue;
      safeProb *= 1 - tenpaiGuess(q) * tileDanger(t, q, vis);
    }
    return 1 - safeProb;
  }

  // 매우 어려움: 위협(리치·2부로 이상)이 있으면 손 상태와 값으로 밀지 오릴지 정하고,
  // 평소에도 유효패가 거의 같으면 더 안전한 패를 먼저 버린다
  function expertDiscard(p, c, melds, banned, plan) {
    const vis = visibleForOpp(p);
    const opts = MJ.discardOptions(c, vis, melds, banned);
    if (!opts.length) return bestByShanten(c, melds, banned, plan);
    const openCount = (q) => (q === 0 ? S.melds : S.oppMelds[q]).filter((m) => m.kind !== 'ankan').length;
    const threats = [0, 1, 2, 3].filter((q) => q !== p && (isRiichi(q) || openCount(q) >= 2));
    const sh = opts[0].shanten;
    const risk = (t) => riskFor(p, t, vis);
    if (threats.length) {
      const value = oppHandValue(p);
      const riichiThreats = threats.filter(isRiichi).length;
      // 밀 후보: 샹텐 유지 + 유효패 70% 이상인 패 중 가장 안전한 패
      const keep = opts.filter((o) => o.shanten === sh && o.total >= opts[0].total * 0.7)
        .sort((a, b) => risk(a.type) - risk(b.type))[0];
      const keepRisk = risk(keep.type);
      // 얼마나 위험해도 밀지: 텐파이이고 손이 비쌀수록, 리치한 사람이 적을수록 더 민다
      let limit = 0;
      if (sh === 0) limit = value >= 2 ? 0.2 : value === 1 ? 0.12 : 0.06;
      else if (sh === 1 && value >= 2) limit = 0.05;
      if (riichiThreats >= 2) limit /= 2;
      if (riichiThreats === 0) limit = Math.max(limit, 0.1);   // 부로 상대뿐이면 좀 더 민다
      if (keepRisk <= limit) return keep.type;
      // 오리기: 가장 안전한 패, 같으면 샹텐을 덜 망가뜨리는 패
      return opts.slice().sort((a, b) => risk(a.type) - risk(b.type) || a.shanten - b.shanten)[0].type;
    }
    // 위협 없음: 유효패 90% 이상 후보 중 역 계획에 맞고 안전한 패
    const ok = opts.filter((o) => o.shanten === sh && o.total >= opts[0].total * 0.9);
    return ok.sort((a, b) => (offPlan(plan, b.type) - offPlan(plan, a.type)) || risk(a.type) - risk(b.type))[0].type;
  }

  // 강도별 타패 선택
  function oppDiscardType(p, banned) {
    const c = MJ.toCounts(S.opp[p]);
    const melds = oppMeldCount(p);
    const plan = openPlan(p);
    if (S.level === 'expert' && oppActive()) return expertDiscard(p, c, melds, banned, plan);
    const threats = threatsFor(p);
    const sh = MJ.shanten(c, melds);
    const lvl = S.level;
    const fold = oppActive() && threats.length &&
      (lvl === 'hard' ? sh >= 2 || (sh >= 1 && threats.length >= 2) : lvl === 'normal' ? sh >= 2 : false);
    if (fold) return defendDiscard(p, c, melds, banned);
    if (lvl === 'easy' && Math.random() < 0.3) {
      const ids = S.opp[p].filter((id) => !(banned && banned.has(typeOf(id))));
      if (ids.length) return typeOf(ids[Math.floor(Math.random() * ids.length)]);
    }
    if (lvl === 'hard' && !plan) {
      const opts = MJ.discardOptions(c, visibleForOpp(p), melds, banned);
      if (opts.length) return opts[0].type;
    }
    return bestByShanten(c, melds, banned, plan);
  }

  // 같은 종류라면 적도라는 남긴다
  function pickId(p, t) {
    const cands = S.opp[p].filter((id) => typeOf(id) === t);
    return cands.find((id) => !isRed(id)) ?? cands[0];
  }

  function oppCtx(q, ids, winId, tsumo, rinshan = false) {
    const st = S.oppState[q];
    const meldIds = S.oppMelds[q].flatMap((m) => m.ids);
    return {
      counts: MJ.toCounts(ids), melds: plainMelds(q), winTile: typeOf(winId), tsumo,
      riichi: st.riichi, doubleRiichi: st.double, ippatsu: st.ippatsu,
      haitei: tsumo && remaining() === 0 && !rinshan, houtei: !tsumo && remaining() === 0,
      rinshan: tsumo && rinshan,
      doraIndicators: doraIndicators(), uraIndicators: uraIndicators(),
      aka: [...ids, ...meldIds].filter(isRed).length,
      seatWind: windOf(q), roundWind: roundWind(), dealer: q === dealerSeat(),
      tenhou: tsumo && S.rivers[q].length === 0 && !S.anyCall,
    };
  }

  // 텐파이 후 리치할지. 쉬움은 가끔 안 하고, 어려움은 역이 있으면 다마로 숨기기도 한다
  function oppWantsRiichi(p) {
    if (remaining() < 4 || !canAffordRiichi(p) || !oppMenzen(p)) return false;
    const c = MJ.toCounts(S.opp[p]);
    const melds = oppMeldCount(p);
    if (MJ.shanten(c, melds) !== 0) return false;
    if (S.level === 'easy') return Math.random() < 0.6;
    if (S.level === 'hard') {
      const ws = MJ.waits(c, melds);
      const damaOk = ws.length > 0 && ws.every((w) => {
        const cc = c.slice();
        cc[w]++;
        return MJ.evaluate({ ...oppCtx(p, S.opp[p], w * 4, false), counts: cc, winTile: w, riichi: false });
      });
      if (damaOk && Math.random() < 0.5) return false;
    }
    if (S.level === 'expert') {
      const ws = MJ.waits(c, melds);
      const damaHan = ws.map((w) => {
        const cc = c.slice();
        cc[w]++;
        const r = MJ.evaluate({ ...oppCtx(p, S.opp[p], w * 4, false), counts: cc, winTile: w, riichi: false });
        return r ? r.han : 0;
      });
      if (damaHan.length && damaHan.every((h) => h >= 3)) return false;
    }
    return true;
  }

  function oppFuriten(q) {
    if (S.oppState[q].furiten) return true;
    const w = MJ.waits(MJ.toCounts(S.opp[q]), oppMeldCount(q));
    return S.rivers[q].some((d) => w.includes(typeOf(d.id)));
  }

  function oppRonResult(q, id) {
    const ids = [...S.opp[q], id];
    if (MJ.shanten(MJ.toCounts(ids), oppMeldCount(q)) !== -1 || oppFuriten(q)) return null;
    const r = MJ.evaluate(oppCtx(q, ids, id, false));
    // 역이 없어 론을 못 했으면 후리텐 (리치 중이면 끝까지)
    if (!r) S.oppState[q].furiten = true;
    return r;
  }

  // ---------- 상대의 울기 판단 ----------
  // 부로한 뒤에도 역을 만들 길이 있는가 (역패 / 탕야오 / 혼일색)
  function hasYakuPath(q, rest, melds) {
    if (melds.some((m) => m.kind !== 'chi' && isYakuhaiFor(q, m.tile))) return true;
    for (let t = 27; t < 34; t++) if (rest[t] >= 2 && isYakuhaiFor(q, t)) return true;
    const tilesOf = (m) => (m.kind === 'chi' ? [m.tile, m.tile + 1, m.tile + 2] : [m.tile]);
    const meldTiles = melds.flatMap(tilesOf);
    let yaochuInHand = 0;
    for (let t = 0; t < 34; t++) if (MJ.isYaochu(t)) yaochuInHand += rest[t];
    if (meldTiles.every((t) => !MJ.isYaochu(t)) && yaochuInHand <= 2) return true;
    const suits = new Set(meldTiles.filter((t) => t < 27).map((t) => Math.floor(t / 9)));
    if (suits.size <= 1) {
      for (let s = 0; s < 3; s++) {
        if (suits.size === 1 && !suits.has(s)) continue;
        let off = 0;
        for (let t = 0; t < 27; t++) if (Math.floor(t / 9) !== s) off += rest[t];
        if (off <= 2) return true;
      }
    }
    return false;
  }

  function chiPairsIn(c, t) {
    if (t >= 27) return [];
    const r = t % 9;
    const out = [];
    if (r >= 2 && c[t - 2] && c[t - 1]) out.push([t - 2, t - 1]);
    if (r >= 1 && r <= 7 && c[t - 1] && c[t + 1]) out.push([t - 1, t + 1]);
    if (r <= 6 && c[t + 1] && c[t + 2]) out.push([t + 1, t + 2]);
    return out;
  }

  // q가 버림패 id를 울지. { kind: 'pon' | 'chi', pair } 또는 null
  function oppCallChoice(q, id, from) {
    if (!oppActive() || S.oppState[q].riichi || remaining() <= 0) return null;
    const t = typeOf(id);
    const c = MJ.toCounts(S.opp[q]);
    const melds = oppMeldCount(q);
    const before = MJ.shanten(c, melds);
    const lvl = S.level;
    // 멘젠으로 리치가 보이면 (어려움) 역패 말고는 참는다
    const expert = lvl === 'expert';
    const holdMenzen = (lvl === 'hard' || expert) && oppMenzen(q) && before <= 1;
    const worth = (rest, newMelds) => {
      if (!expert) return true;
      if (oppHandValue(q) >= 1) return true;
      // 혼일색 계획이면 값어치가 있다
      const tilesOf = (m) => (m.kind === 'chi' ? [m.tile, m.tile + 1, m.tile + 2] : [m.tile]);
      const suits = new Set(newMelds.flatMap(tilesOf).filter((x) => x < 27).map((x) => Math.floor(x / 9)));
      if (suits.size !== 1) return false;
      const s0 = [...suits][0];
      let off = 0;
      for (let x = 0; x < 27; x++) if (Math.floor(x / 9) !== s0) off += rest[x];
      return off <= 2;
    };
    const willing = () => Math.random() < (lvl === 'easy' ? 0.35 : 1);
    const tryCall = (remove, meld) => {
      const rest = c.slice();
      for (const x of remove) rest[x]--;
      const newMelds = [...plainMelds(q), meld];
      const ban = kuikaeBan(meld.kind, t, remove.length === 2 && meld.kind === 'chi' ? remove : null);
      let after = 9;
      for (let u = 0; u < 34; u++) {
        if (!rest[u] || ban.has(u)) continue;
        rest[u]--;
        after = Math.min(after, MJ.shanten(rest, melds + 1));
        rest[u]++;
      }
      return { after, rest, newMelds };
    };
    if (c[t] >= 2) {
      if (isYakuhaiFor(q, t)) {
        if (Math.random() < (lvl === 'easy' ? 0.6 : 1)) return { kind: 'pon' };
      } else if (!holdMenzen) {
        const r = tryCall([t, t], { kind: 'pon', tile: t });
        if (r.after < before && hasYakuPath(q, r.rest, r.newMelds) && worth(r.rest, r.newMelds) && willing()) return { kind: 'pon' };
      }
    }
    if ((from + 1) % 4 === q && !holdMenzen) {
      for (const pair of chiPairsIn(c, t)) {
        const r = tryCall(pair, { kind: 'chi', tile: Math.min(t, pair[0]) });
        if (r.after < before && hasYakuPath(q, r.rest, r.newMelds) && worth(r.rest, r.newMelds) && willing()) return { kind: 'chi', pair };
      }
    }
    return null;
  }

  // 버림패에 대해 상대가 우는지: 퐁(아무나, 순서대로)이 치(다음 사람)보다 먼저
  function decideOppCall(p, id) {
    const order = [1, 2, 3].map((k) => (p + k) % 4).filter((q) => q !== 0);
    const choices = order.map((q) => ({ q, c: oppCallChoice(q, id, p) })).filter((x) => x.c);
    const pon = choices.find((x) => x.c.kind === 'pon');
    const pick = pon || choices.find((x) => x.c.kind === 'chi');
    return pick ? { q: pick.q, kind: pick.c.kind, pair: pick.c.pair || null, from: p, id } : null;
  }

  function doOppCall(call) {
    const { q, kind, pair, from, id } = call;
    const t = typeOf(id);
    const hand = S.opp[q];
    const take = (type) => { const i = hand.findIndex((x) => typeOf(x) === type); return hand.splice(i, 1)[0]; };
    const taken = kind === 'chi' ? [take(pair[0]), take(pair[1])] : [take(t), take(t)];
    S.rivers[from][S.rivers[from].length - 1].called = true;
    S.oppMelds[q].push({
      kind, tile: kind === 'chi' ? Math.min(t, pair[0]) : t,
      ids: kind === 'chi' ? sortIds([...taken, id]) : [...taken, id],
      calledId: id, from,
    });
    S.anyCall = true;
    S.ippatsu = false;
    for (const k of [1, 2, 3]) S.oppState[k].ippatsu = false;
    S.turn = q;
    S.phase = 'wait';
    render();
    callout(q, kind === 'chi' ? '치' : '퐁');
    schedule({ kind: 'oppDiscard', p: q, banned: [...kuikaeBan(kind, t, pair)] }, Math.max(OPP_DELAY, CALLOUT_MS));
  }

  // 쯔모한 뒤 깡할지 (안깡 / 가깡). 샹텐이 나빠지지 않을 때만
  function oppKanChoice(p, drawn) {
    if (!oppActive() || S.kanCount >= 4 || remaining() <= 0) return null;
    const st = S.oppState[p];
    const c = MJ.toCounts(S.opp[p]);
    const melds = oppMeldCount(p);
    const before = MJ.shanten(c, melds);
    for (let t = 0; t < 34; t++) {
      if (c[t] !== 4) continue;
      const cc = c.slice(); cc[t] = 0;
      if (st.riichi) {
        if (typeOf(drawn) !== t) continue;
        const b = c.slice(); b[t]--;
        if (MJ.waits(b, melds).join() !== MJ.waits(cc, melds + 1).join()) continue;
      } else if (MJ.shanten(cc, melds + 1) > before) continue;
      if (S.level === 'easy' && Math.random() < 0.5) continue;
      return { kind: 'ankan', tile: t };
    }
    if (!st.riichi) {
      for (const m of S.oppMelds[p]) {
        if (m.kind !== 'pon' || !c[m.tile]) continue;
        const cc = c.slice(); cc[m.tile]--;
        if (MJ.shanten(cc, melds) <= before) return { kind: 'kakan', tile: m.tile };
      }
    }
    return null;
  }

  function doOppKan(p, k) {
    const hand = S.opp[p];
    const takeAll = (n) => { const out = []; for (let i = hand.length - 1; i >= 0 && out.length < n; i--) if (typeOf(hand[i]) === k.tile) out.push(...hand.splice(i, 1)); return out; };
    if (k.kind === 'ankan') {
      S.oppMelds[p].push({ kind: 'ankan', tile: k.tile, ids: takeAll(4) });
    } else {
      const m = S.oppMelds[p].find((x) => x.kind === 'pon' && x.tile === k.tile);
      m.kind = 'kakan';
      m.ids.push(...takeAll(1));
    }
    S.anyCall = true;
    S.ippatsu = false;
    for (const q of [1, 2, 3]) S.oppState[q].ippatsu = false;
    S.kanCount++;
    S.wall.shift();
    const r = S.rinshan.pop();
    hand.push(r);
    S.phase = 'wait';
    render();
    callout(p, '깡');
    schedule({ kind: 'oppAfterDraw', p, drawn: r, rinshan: true }, Math.max(OPP_DELAY, CALLOUT_MS));
  }

  function opponentTurn(p) {
    if (remaining() <= 0) return ryuukyoku();
    const drawn = drawFromWall();
    S.opp[p].push(drawn);
    S.turn = p;
    oppAfterDraw(p, drawn, false);
  }

  function oppAfterDraw(p, drawn, rinshan) {
    const hand = S.opp[p];
    if (oppActive() && MJ.shanten(MJ.toCounts(hand), oppMeldCount(p)) === -1) {
      const r = MJ.evaluate(oppCtx(p, hand, drawn, true, rinshan));
      if (r) return oppWin(p, true, null, drawn, r);
    }
    const k = oppKanChoice(p, drawn);
    if (k) return doOppKan(p, k);
    oppDiscard(p, null);
  }

  function oppDiscard(p, banned) {
    const hand = S.opp[p];
    const st = S.oppState[p];
    S.turn = p;
    const id = st.riichi ? hand[hand.length - 1] : pickId(p, oppDiscardType(p, banned ? new Set(banned) : null));
    hand.splice(hand.indexOf(id), 1);
    let riichiNow = false;
    if (oppActive() && !st.riichi && oppWantsRiichi(p)) {
      Object.assign(st, { riichi: true, ippatsu: true, double: S.rivers[p].length === 0 && !S.anyCall, riichiSeq: S.seq });
      riichiNow = true;
    } else if (st.ippatsu) {
      st.ippatsu = false;
    }
    if (!st.riichi) st.furiten = false;
    S.rivers[p].push({ id, riichi: riichiNow, seq: S.seq++ });

    // 론 확인: 버린 사람 다음 순서부터, 먼저인 사람만 화료 (머리튀기)
    let playerRon = false, laterRon = null;
    for (const q of [1, 2, 3].map((k) => (p + k) % 4)) {
      if (q === 0) { playerRon = !!ronResult(id); continue; }
      if (!oppActive() || !oppRonResult(q, id)) continue;
      if (!playerRon) return oppWin(q, false, p, id);
      if (laterRon == null) laterRon = q;
    }

    if (riichiNow && !playerRon) payRiichi(p);
    // 상대의 울기 (론이 없을 때만). 상대가 퐁하면 나는 치할 수 없다
    const oppCall = laterRon == null ? decideOppCall(p, id) : null;
    const opts = callOptions(p, id, playerRon, laterRon != null, oppCall && oppCall.kind === 'pon');
    if (opts) {
      S.phase = 'call';
      S.pending = { from: p, id, opts, laterRon, oppCall, riichiBy: riichiNow && playerRon ? p : null };
      render();
      if (riichiNow) callout(p, '리치');
      return;
    }
    if (oppCall) {
      if (riichiNow) callout(p, '리치');
      return doOppCall(oppCall);
    }
    render();
    if (riichiNow) callout(p, '리치');
    continueAfter(p, riichiNow ? Math.max(OPP_DELAY, CALLOUT_MS) : OPP_DELAY);
  }

  function oppWin(q, tsumo, from, winId, r) {
    const ids = tsumo ? S.opp[q].slice() : [...S.opp[q], winId];
    r = r || MJ.evaluate(oppCtx(q, ids, winId, tsumo));
    S.pending = null;
    const pay = tsumo ? r.dealerPay : from === 0 ? r.points : 0;
    const title = tsumo ? `${SEAT_NAMES[q]} 쯔모`
      : from === 0 ? `${SEAT_NAMES[q]} 론 — 방총했어요`
      : `${SEAT_NAMES[q]} 론 (${SEAT_NAMES[from]}에게서)`;
    endGame({ type: 'opp', result: r, seat: q, from, ids, melds: S.oppMelds[q].slice(), winId, pay, dealIn: !tsumo && from === 0 },
      title + (r.limit ? ` · ${r.limit}` : ''));
  }

  function continueAfter(p, delay) {
    S.phase = 'wait';
    schedule(p === 3 ? { kind: 'draw' } : { kind: 'opp', p: p + 1 }, delay);
    saveGame();
  }

  // 다음 진행(상대 차례 / 내 쯔모)을 예약. 상태에 남겨 두어 새로고침 후에도 이어 간다
  function schedule(step, delay = OPP_DELAY) {
    clearTimeout(S.timer);
    S.next = step;
    S.timer = setTimeout(() => {
      S.next = null;
      if (step.kind === 'opp') opponentTurn(step.p);
      else if (step.kind === 'oppDiscard') oppDiscard(step.p, step.banned);
      else if (step.kind === 'oppAfterDraw') oppAfterDraw(step.p, step.drawn, step.rinshan);
      else playerDraw(false);
    }, delay);
  }

  // ---------- 울기 ----------
  function chiPairs(t) {
    if (t >= 27) return [];
    const c = MJ.toCounts(S.hand);
    const r = t % 9;
    const out = [];
    if (r >= 2 && c[t - 2] && c[t - 1]) out.push([t - 2, t - 1]);
    if (r >= 1 && r <= 7 && c[t - 1] && c[t + 1]) out.push([t - 1, t + 1]);
    if (r <= 6 && c[t + 1] && c[t + 2]) out.push([t + 1, t + 2]);
    return out;
  }

  function isFuriten() {
    if (S.furitenTemp || S.furitenRiichi) return true;
    const w = MJ.waits(MJ.toCounts(S.hand), meldCount());
    return S.rivers[0].some((d) => w.includes(typeOf(d.id)));
  }

  function ronResult(id) {
    const c = MJ.toCounts([...S.hand, id]);
    if (MJ.shanten(c, meldCount()) !== -1 || isFuriten()) return null;
    return winResult(false, id);
  }

  function callOptions(p, id, playerRon, someoneElseRons, oppPons = false) {
    const t = typeOf(id);
    const o = {};
    if (playerRon) o.ron = true;
    // 다른 사람이 론할 수 있는 패는 울 수 없다 (론이 우선)
    if (remaining() > 0 && !S.riichi && !someoneElseRons && pressed('btnAskCalls')) {
      const n = S.hand.filter((x) => typeOf(x) === t).length;
      if (n >= 2) o.pon = true;
      if (n >= 3 && S.kanCount < 4) o.kan = true;
      if (p === 3 && !oppPons) {
        const pairs = chiPairs(t);
        if (pairs.length) o.chi = pairs;
      }
    }
    return Object.keys(o).length ? o : null;
  }

  function pass() {
    const { from, id, opts, laterRon, riichiBy, oppCall } = S.pending;
    if (opts.ron) {
      if (S.riichi) S.furitenRiichi = true;
      else S.furitenTemp = true;
    }
    S.pending = null;
    if (laterRon != null) return oppWin(laterRon, false, from, id);
    if (riichiBy != null) payRiichi(riichiBy);
    if (oppCall) return doOppCall(oppCall);
    continueAfter(from);
    render();
  }

  function kuikaeBan(kind, t, pair) {
    const ban = new Set([t]);
    if (kind === 'chi') {
      const [a, b] = pair;
      const r = (x) => x % 9;
      if (t < a && r(b) < 8) ban.add(b + 1);
      if (t > b && r(a) > 0) ban.add(a - 1);
    }
    return ban;
  }

  function doCall(kind, pair) {
    const { from, id } = S.pending;
    const t = typeOf(id);
    let taken;
    if (kind === 'chi') taken = [...takeFromHand(pair[0], 1), ...takeFromHand(pair[1], 1)];
    else taken = takeFromHand(t, kind === 'minkan' ? 3 : 2);
    S.rivers[from][S.rivers[from].length - 1].called = true;
    S.melds.push({
      kind,
      tile: kind === 'chi' ? Math.min(t, pair[0]) : t,
      ids: kind === 'chi' ? sortIds([...taken, id]) : [...taken, id],
      calledId: id,
      from,
    });
    S.pending = null;
    S.anyCall = true;
    S.ippatsu = false;
    for (const q of [1, 2, 3]) S.oppState[q].ippatsu = false;
    S.turn = 0;
    callout(0, kind === 'chi' ? '치' : kind === 'pon' ? '퐁' : '깡');
    if (kind === 'minkan') {
      afterKan();
      return;
    }
    S.banned = kuikaeBan(kind, t, pair);
    S.drawn = null;
    S.phase = 'self';
    render();
  }

  function kanOptions() {
    if (S.phase !== 'self' || S.drawn == null || remaining() <= 0 || S.kanCount >= 4) return [];
    const c = MJ.toCounts(handIds());
    const out = [];
    for (let t = 0; t < 34; t++) {
      if (c[t] !== 4) continue;
      if (S.riichi) {
        // 리치 후 안깡은 쯔모한 패로, 대기가 바뀌지 않을 때만
        if (typeOf(S.drawn) !== t) continue;
        const before = MJ.waits(MJ.toCounts(S.hand), meldCount());
        const after = c.slice(); after[t] = 0;
        const w = MJ.waits(after, meldCount() + 1);
        if (before.join() !== w.join()) continue;
      }
      out.push({ kind: 'ankan', tile: t });
    }
    if (!S.riichi) {
      for (const m of S.melds) {
        if (m.kind === 'pon' && c[m.tile]) out.push({ kind: 'kakan', tile: m.tile });
      }
    }
    return out;
  }

  function doKan(opt) {
    clearTimeout(S.timer);
    callout(0, '깡');
    const all = handIds();
    S.hand = all;
    S.drawn = null;
    if (opt.kind === 'ankan') {
      const ids = takeFromHand(opt.tile, 4);
      S.melds.push({ kind: 'ankan', tile: opt.tile, ids });
    } else {
      const m = S.melds.find((x) => x.kind === 'pon' && x.tile === opt.tile);
      m.kind = 'kakan';
      m.ids.push(...takeFromHand(opt.tile, 1));
    }
    sortIds(S.hand);
    S.ippatsu = false;
    S.anyCall = true;
    afterKan();
  }

  function afterKan() {
    S.kanCount++;
    for (const q of [1, 2, 3]) S.oppState[q].ippatsu = false;
    // 왕패가 한 장 줄어든 만큼 산 끝에서 보충
    S.wall.shift();
    if (solo()) S.left = Math.min(S.left, S.wall.length);
    playerDraw(true);
  }

  // ---------- 화료 / 유국 ----------
  function winResult(tsumo, winId) {
    const ids = tsumo ? handIds() : [...S.hand, winId];
    const meldIds = S.melds.flatMap((m) => m.ids);
    return MJ.evaluate({
      counts: MJ.toCounts(ids),
      melds: S.melds.map((m) => ({ kind: m.kind, tile: m.tile })),
      winTile: typeOf(tsumo ? S.drawn : winId),
      tsumo,
      riichi: S.riichi,
      doubleRiichi: S.doubleRiichi,
      ippatsu: S.ippatsu,
      haitei: tsumo && remaining() === 0 && !S.rinshanFlag,
      houtei: !tsumo && remaining() === 0,
      rinshan: tsumo && S.rinshanFlag,
      tenhou: tsumo && firstGoAround(),
      seatWind: windOf(0), roundWind: roundWind(), dealer: dealerSeat() === 0,
      doraIndicators: doraIndicators(),
      uraIndicators: uraIndicators(),
      aka: [...ids, ...meldIds].filter(isRed).length,
    });
  }

  function canTsumo() {
    if (S.phase !== 'self' || S.drawn == null) return false;
    if (MJ.shanten(MJ.toCounts(handIds()), meldCount()) !== -1) return false;
    return !!winResult(true);
  }

  function riichiDiscardTypes() {
    const c = MJ.toCounts(handIds());
    const ok = new Set();
    for (let t = 0; t < 34; t++) {
      if (!c[t]) continue;
      c[t]--;
      if (MJ.shanten(c, meldCount()) === 0) ok.add(t);
      c[t]++;
    }
    return ok;
  }

  function canRiichi() {
    return S.phase === 'self' && !S.riichi && S.drawn != null && remaining() >= (solo() ? 1 : 4) && canAffordRiichi(0) &&
      S.melds.every((m) => m.kind === 'ankan') &&
      MJ.shanten(MJ.toCounts(handIds()), meldCount()) <= 0;
  }

  // outcome: { type: 'win' | 'opp' | 'draw', result, winId, ... }
  function endGame(outcome, title) {
    clearTimeout(S.timer);
    S.phase = 'over';
    const r = outcome.result;
    const settlement = M ? settle(outcome) : null;
    stats.games++;
    if (outcome.type === 'win') {
      stats.wins++;
      stats.best = Math.max(stats.best, r.points);
    } else if (outcome.type === 'opp' && outcome.dealIn) {
      stats.dealIns++;
    }
    stats.net += settlement ? settlement.delta[0]
      : outcome.type === 'win' ? r.points : outcome.type === 'opp' ? -outcome.pay : 0;
    if (M && M.over) {
      const rank = ranking().indexOf(0) + 1;
      stats.matches = (stats.matches || 0) + 1;
      stats.rankSum = (stats.rankSum || 0) + rank;
      if (rank === 1) stats.firsts = (stats.firsts || 0) + 1;
    }
    save('mj-stats', stats);
    S.settlement = settlement;
    S.outcome = outcome;
    S.title = title;
    render();
    if (outcome.type === 'draw') return showResult(outcome, title);
    const winner = outcome.type === 'win' ? 0 : outcome.seat;
    callout(winner, outcome.result.tsumo ? '쯔모' : '론');
    setTimeout(() => {
      document.querySelectorAll('.callout').forEach((el) => el.remove());
      if (S.phase === 'over' && !S.finalShown) showResult(outcome, title);
    }, RESULT_DELAY_MS);
  }

  function showResult(outcome, title) {
    const r = outcome.result;
    $('resultTitle').textContent = title;
    $('result').classList.toggle('lose', outcome.type === 'opp');
    const d = $('resultDetail');
    d.innerHTML = '';
    if (outcome.type === 'opp') {
      fillIds($('resultHand'), outcome.ids, outcome.winId, outcome.melds || [], outcome.seat);
      showYaku(d, r, S.oppState[outcome.seat].riichi);
      if (!S.settlement) d.append(para(outcome.pay ? `내가 낸 점수: −${outcome.pay.toLocaleString()}점` : '나는 점수를 내지 않았어요', outcome.pay ? 'loss' : 'muted'));
    } else {
      fillIds($('resultHand'), S.hand, outcome.winId ?? null, S.melds);
      if (r) showYaku(d, r, S.riichi);
    }
    if (outcome.type === 'draw') {
      const u = MJ.ukeire(MJ.toCounts(S.hand), visibleCounts(), meldCount());
      if (u.shanten === 0) d.append(para('텐파이! 대기패:'), waitRow(u.tiles));
      else d.append(para(`노텐 (${u.shanten}샹텐)`));
    }
    if (S.settlement) {
      if (S.kyoku) d.prepend(para(S.kyoku, 'muted'));
      d.append(settlementTable(S.settlement, outcome.tenpai));
    }
    $('btnNext').textContent = M && M.over ? '최종 결과' : '다음 판';
    if (!$('result').open) $('result').showModal();
  }

  function tsumo() {
    if (!canTsumo()) return;
    const r = winResult(true);
    endGame({ type: 'win', result: r, winId: S.drawn }, r.limit ? `쯔모! ${r.limit}` : '쯔모!');
  }

  function ron() {
    const { from, id } = S.pending;
    const r = ronResult(id);
    S.pending = null;
    endGame({ type: 'win', result: r, winId: id, from }, `론! ${SEAT_NAMES[from]}에게서${r.limit ? ' · ' + r.limit : ''}`);
  }

  function ryuukyoku() {
    endGame({ type: 'draw' }, '유국');
  }

  function para(text, cls) {
    const p = document.createElement('p');
    p.textContent = text;
    if (cls) p.className = cls;
    return p;
  }

  function waitRow(tiles) {
    const row = document.createElement('div');
    row.className = 'waits';
    for (const w of tiles) {
      const cell = document.createElement('span');
      cell.className = 'wait-tile' + (w.left === 0 ? ' dead' : '');
      cell.append(tileEl(w.type), Object.assign(document.createElement('small'), { textContent: `${w.left}장` }));
      row.append(cell);
    }
    return row;
  }

  function meldEl(m, owner = 0) {
    const box = document.createElement('span');
    box.className = 'meld';
    if (m.kind === 'ankan') {
      m.ids.forEach((id, i) => box.append(idEl(id, { back: i === 0 || i === 3 })));
      return box;
    }
    const others = m.ids.filter((id) => id !== m.calledId);
    // 부른 패는 부른 상대 방향에 옆으로 눕힌다 (상가 왼쪽, 대면 가운데, 하가 오른쪽)
    const rel = (m.from - owner + 4) % 4;
    const pos = rel === 3 ? 0 : rel === 2 ? 1 : others.length;
    const order = [...others];
    order.splice(pos, 0, m.calledId);
    for (const id of order) box.append(idEl(id, { side: id === m.calledId }));
    return box;
  }

  function fillIds(box, hand, winId, melds, owner = 0) {
    box.innerHTML = '';
    const concealed = hand.filter((id) => id !== winId);
    for (const id of sortIds(concealed.slice())) box.append(idEl(id));
    if (winId != null) {
      const el = idEl(winId);
      el.classList.add('drawn');
      box.append(el);
    }
    for (const m of melds) box.append(meldEl(m, owner));
  }

  function showYaku(d, r, riichi) {
    const doraLine = document.createElement('div');
    doraLine.className = 'dora-line';
    doraLine.append('도라 표시패 ', ...doraIndicators().map((t) => tileEl(t)));
    if (riichi) doraLine.append('  뒷도라 표시패 ', ...uraIndicators().map((t) => tileEl(t)));
    d.append(doraLine);

    const table = document.createElement('table');
    table.className = 'yaku';
    for (const y of r.yaku) {
      const tr = table.insertRow();
      tr.insertCell().textContent = y.name;
      tr.insertCell().textContent = typeof y.han === 'number' ? `${y.han}판` : y.han;
    }
    d.append(table);

    if (!r.yakuman) {
      d.append(para(`${r.han}판 ${r.fu}부${r.wait ? ` · ${r.wait} 대기` : ''}`, 'sum'));
      if (r.fuDetail.length) d.append(para(r.fuDetail.join(' / '), 'muted'));
    }
    const n = (x) => x.toLocaleString();
    let line;
    if (!r.tsumo) line = `${n(r.points)}점`;
    else if (r.dealer) line = `${n(r.each)} 올 — 합계 ${n(r.points)}점`;
    else line = `자 ${n(r.childPay)} / 친 ${n(r.dealerPay)} — 합계 ${n(r.points)}점`;
    d.append(para(line, 'points'));
  }

  // ---------- 진행 상태 저장 / 복원 ----------
  const SAVE_VERSION = 2;
  function saveGame() {
    save('mj-game', { ...S, v: SAVE_VERSION, timer: null, banned: S.banned ? [...S.banned] : null });
  }

  function restoreGame() {
    const g = load('mj-game', null);
    if (!g || g.v !== SAVE_VERSION || !g.hand) return false;
    S = { ...g, timer: null, banned: g.banned ? new Set(g.banned) : null };
    setSelect('mode', S.mode, '4p');
    setSelect('oppLevel', S.level, 'off');
    S.level = $('oppLevel').value;
    if (M) $('matchType').value = M.type;
    render();
    if (S.phase === 'over' && S.finalShown && M) showFinal();
    else if (S.phase === 'over' && S.outcome) showResult(S.outcome, S.title);
    else if (S.phase === 'wait' && S.next) schedule(S.next);
    else autoDiscardIfRiichi();
    return true;
  }

  // ---------- 화면 갱신 ----------
  function render() {
    $('table').classList.toggle('solo', solo());
    for (let p = 0; p < 4; p++) {
      const turn = S.turn === p && S.phase !== 'over';
      document.querySelector('.seat-' + p).classList.toggle('turn', turn);
      $('wind' + p).classList.toggle('turn', turn);
    }
    $('left').textContent = Math.max(0, remaining());
    const dora = $('dora');
    dora.innerHTML = '';
    const shown = doraIndicators();
    for (let i = 0; i < 5; i++) dora.append(i < shown.length ? tileEl(shown[i]) : tileEl(0, { back: true }));
    for (let q = 0; q < 4; q++) $('stick' + q).hidden = !isRiichi(q);
    for (let q = 0; q < 4; q++) {
      const w = WIND_CH[windOf(q) - 27];
      const pts = M ? ' ' + M.points[q].toLocaleString() : '';
      document.querySelector(`.seat-${q} .seat-label`).textContent = `${SEAT_NAMES[q]} ${w}${pts}` + (isRiichi(q) ? ' · 리치' : '');
      const badge = $('wind' + q);
      badge.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = w;
      badge.append(b, SEAT_NAMES[q]);
      if (M) badge.append(Object.assign(document.createElement('span'), { className: 'pts', textContent: M.points[q].toLocaleString() }));
      badge.classList.toggle('riichi', isRiichi(q));
      badge.classList.toggle('dealer', windOf(q) === 27);
    }
    $('roundInfo').hidden = !M;
    if (M) $('roundInfo').textContent = `${kyokuLabel()} · 공탁 ${M.pot}`;

    for (let p = 0; p < 4; p++) {
      const river = $('river' + p);
      river.innerHTML = '';
      S.rivers[p].forEach((d, i) => {
        const el = idEl(d.id, { side: d.riichi });
        if (d.called) el.classList.add('called');
        if (S.phase === 'call' && S.pending && p === S.pending.from && i === S.rivers[p].length - 1) el.classList.add('last');
        river.append(el);
      });
      if (p > 0 && S.oppMelds[p].length) {
        const row = document.createElement('div');
        row.className = 'river-melds';
        for (const m of S.oppMelds[p]) row.append(meldEl(m, p));
        river.append(row);
      }
    }

    renderHand();
    renderStatus();
    renderCallbar();
    renderActions();
    renderHint();
    saveGame();

    $('stats').textContent =
      `플레이 ${stats.games}판 · 화료 ${stats.wins}회` +
      (stats.games ? ` (${Math.round((stats.wins / stats.games) * 100)}%)` : '') +
      (stats.best ? ` · 최고 ${stats.best.toLocaleString()}점` : '') +
      (stats.dealIns ? ` · 방총 ${stats.dealIns}회` : '') +
      (stats.net ? ` · 수지 ${stats.net > 0 ? '+' : ''}${stats.net.toLocaleString()}점` : '') +
      (stats.matches ? ` · 대국 ${stats.matches}회 (평균 ${(stats.rankSum / stats.matches).toFixed(2)}위, 1위 ${stats.firsts || 0}회)` : '');
  }

  // 터치 기기 + 힌트를 켰을 때: 한 번 누르면 선택(확률 표시), 같은 패를 한 번 더 누르면 버리기
  const TOUCH = window.matchMedia('(hover: none)').matches;
  let selectedId = null;
  function tapTile(id) {
    if (!(TOUCH && pressed('btnHint')) || selectedId === id) {
      selectedId = null;
      return discard(id);
    }
    selectedId = id;
    for (const b of document.querySelectorAll('#hand button.tile')) b.classList.toggle('selected', b.dataset.id == id);
    highlightHint(typeOf(id));
  }

  function renderHand() {
    // 차례가 바뀌면 선택 해제
    if (S.phase !== 'self' || !handIds().includes(selectedId)) selectedId = null;
    const box = $('hand');
    box.innerHTML = '';
    const glow = S.riichiSelect ? riichiDiscardTypes() : null;
    const addTile = (id, isDrawn) => {
      const el = idEl(id, { button: true });
      if (isDrawn) el.classList.add('drawn');
      if (isDrawn && canWin) el.classList.add('winning');
      if (vis) {
        const t = typeOf(id);
        const info = document.createElement('span');
        info.className = 'tile-info';
        info.append(Object.assign(document.createElement('span'), { className: 'left', textContent: `남은 ${Math.max(0, 4 - vis[t])}` }));
        if (risk) info.append(Object.assign(document.createElement('span'), { className: 'risk ' + riskClass(risk[t]), textContent: riskText(risk[t]) }));
        el.append(info);
      }
      if (!el.disabled && furitenSet.has(typeOf(id))) {
        el.classList.add('furiten');
        el.title += ' — 버리면 후리텐 (론 불가, 쯔모만 가능)';
      }
      el.disabled = !discardable(id);
      if (glow && !el.disabled) el.classList.add('glow');
      if (S.banned && S.banned.has(typeOf(id)) && el.disabled) el.classList.add('banned');
      el.dataset.type = typeOf(id);
      el.dataset.id = id;
      if (id === selectedId) el.classList.add('selected');
      el.addEventListener('click', () => tapTile(id));
      el.addEventListener('mouseenter', () => highlightHint(typeOf(id)));
      el.addEventListener('mouseleave', () => highlightHint(null));
      box.append(el);
    };
    const canWin = canTsumo();
    const furitenSet = furitenDiscards();
    const showInfo = $('btnHint').getAttribute('aria-pressed') === 'true' && S.phase === 'self' && !S.riichi;
    const vis = showInfo ? visibleCounts() : null;
    const risk = showInfo ? riskByType(vis) : null;
    for (const id of S.hand) addTile(id, false);
    if (S.drawn != null) {
      addTile(S.drawn, true);
    } else {
      // 쯔모패 자리를 비워 둬서 버린 뒤에도 패열 폭(=클릭 위치)이 그대로 유지되게 한다
      const slot = document.createElement('span');
      slot.className = 'tile drawn placeholder';
      slot.setAttribute('aria-hidden', 'true');
      box.append(slot);
    }
    box.classList.toggle('selecting', !!glow);
    // 힌트를 켜 두면 차례와 상관없이 아래 공간을 유지해서 버튼 위치가 흔들리지 않게 한다
    box.classList.toggle('with-info', $('btnHint').getAttribute('aria-pressed') === 'true');

    const melds = $('melds');
    melds.innerHTML = '';
    for (let i = S.melds.length - 1; i >= 0; i--) melds.append(meldEl(S.melds[i]));
  }

  function renderStatus() {
    const st = $('shantenText');
    const wt = $('waitText');
    wt.innerHTML = '';
    const sh = MJ.shanten(MJ.toCounts(handIds()), meldCount());
    const selfTurn = S.phase === 'self';
    if (S.phase === 'over') st.textContent = '게임 종료';
    else if (S.riichi) st.textContent = '리치 중 — 화료패를 기다리는 중';
    else if (selfTurn && sh === -1) st.textContent = canTsumo() ? '화료 형태! 쯔모할 수 있어요' : '화료 형태지만 역이 없어요';
    else if (selfTurn && S.drawn == null) st.textContent = '울었어요 — 버릴 패를 고르세요';
    else if (selfTurn) st.textContent = sh === 0 ? '텐파이 (버리면 텐파이)' : `${sh}샹텐`;
    else st.textContent = sh === 0 ? '텐파이' : `${sh}샹텐`;
    st.dataset.level = sh <= 0 ? 'good' : '';
    st.classList.toggle('can-win', canTsumo());

    const waiting = S.riichi || (S.phase !== 'self' && S.phase !== 'over' && sh === 0);
    if (waiting) {
      const u = MJ.ukeire(MJ.toCounts(S.hand), visibleCounts(), meldCount());
      if (u.shanten === 0) {
        wt.append('대기 ', waitRow(u.tiles));
        if (!solo() && isFuriten()) wt.append(para('후리텐 — 론 불가', 'warn'));
      }
    } else if (S.riichiSelect) {
      wt.append(riichiChoices());
    } else if (S.banned && selfTurn) {
      wt.textContent = '쿠이카에 금지: 방금 부른 패와 같은 패(치는 반대쪽 끝 패도)는 버릴 수 없어요';
    }
  }

  function renderCallbar() {
    const bar = $('callbar');
    bar.innerHTML = '';
    // 자리는 항상 차지해 둬서 버튼이 뜰 때 손패가 밀리지 않게 한다
    bar.classList.toggle('idle', S.phase !== 'call');
    if (S.phase !== 'call') return;
    const { opts } = S.pending;
    const btn = (label, fn, cls, tiles) => {
      const b = document.createElement('button');
      b.className = 'call-btn ' + cls;
      b.append(label);
      if (tiles) for (const tt of tiles) b.append(tileEl(tt));
      b.addEventListener('click', fn);
      bar.append(b);
    };
    // 치 조합이 여러 개면 누른 뒤에 고른다
    if (S.pending.choosingChi) {
      for (const pair of opts.chi) btn('', () => doCall('chi', pair), 'chi option', pair);
      btn('취소', () => { S.pending.choosingChi = false; renderCallbar(); }, 'skip');
      return;
    }
    if (opts.ron) btn('론', ron, 'ron');
    if (opts.pon) btn('퐁', () => doCall('pon'), 'pon');
    if (opts.chi) {
      btn('치', () => {
        if (opts.chi.length === 1) return doCall('chi', opts.chi[0]);
        S.pending.choosingChi = true;
        renderCallbar();
      }, 'chi');
    }
    if (opts.kan) btn('깡', () => doCall('minkan'), 'kan');
    btn('넘기기', pass, 'skip');
  }

  function renderActions() {
    $('btnTsumo').disabled = !canTsumo();
    $('btnRiichi').disabled = !canRiichi();
    $('btnRiichi').classList.toggle('active', S.riichiSelect);
    $('btnRiichi').textContent = S.riichiSelect ? '리치 취소' : '리치';
    const kb = $('kanButtons');
    kb.innerHTML = '';
    for (const opt of kanOptions()) {
      const b = document.createElement('button');
      b.className = 'call-btn kan';
      b.append(opt.kind === 'ankan' ? '안깡 ' : '가깡 ', tileEl(opt.tile));
      b.addEventListener('click', () => doKan(opt));
      kb.append(b);
    }
    // 할 수 있는 게 있을 때만 테이블 위에 띄운다
    const any = !$('btnTsumo').disabled || !$('btnRiichi').disabled || kb.children.length > 0;
    $('selfbar').classList.toggle('idle', !any || S.phase !== 'self');
  }

  function renderHint() {
    const on = $('btnHint').getAttribute('aria-pressed') === 'true';
    const panel = $('hintPanel');
    panel.hidden = !on;
    renderAnalysis();
    if (on) renderDiscardTable();
    keepHintHeight();
  }

  // ---------- 울기 / 리치 판단 (sim.js 워커에서 시뮬레이션) ----------
  let worker = null;
  try {
    worker = new Worker('sim.js?v=44');
    worker.onmessage = ({ data }) => {
      if (data.id !== A.id) return;
      Object.assign(A, { results: data.results, n: data.n, done: data.done });
      if (!$('analysisPanel').hidden) { drawAnalysis(); keepHintHeight(); }
    };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; /* file:// 로 열면 워커를 쓸 수 없다 */ }
  let A = { key: null, id: 0 };

  function analysisRequest() {
    if (S.phase === 'call' && S.pending && !S.pending.opts.ron) {
      const { from, id, opts } = S.pending;
      const t = typeOf(id);
      const options = [{ kind: 'pass', from, label: '넘기기' }];
      if (opts.pon) options.push({ kind: 'call', call: 'pon', tile: t, label: '퐁', tiles: [t, t, t] });
      if (opts.chi) {
        for (const pair of opts.chi) {
          options.push({ kind: 'call', call: 'chi', tile: t, pair, label: '치', tiles: [t, ...pair].sort((a, b) => a - b) });
        }
      }
      if (opts.kan) options.push({ kind: 'call', call: 'minkan', tile: t, label: '깡', tiles: [t, t, t, t] });
      return { title: '울기 판단', counts: MJ.toCounts(S.hand), options };
    }
    if (S.phase === 'self' && canRiichi() && !canTsumo()) {
      const options = [...riichiDiscardTypes()].map((t) => ({ kind: 'riichi', discard: t, label: '리치', tiles: [t], note: '버리고' }));
      options.push({ kind: 'dama', label: '다마 (리치 안 함)' });
      return { title: '리치 판단', counts: MJ.toCounts(handIds()), options };
    }
    return null;
  }

  function simState(counts) {
    return {
      solo: solo(),
      remaining: remaining(),
      counts,
      melds: S.melds.map((m) => ({ kind: m.kind, tile: m.tile })),
      visible: visibleCounts(),
      river: S.rivers[0].map((d) => typeOf(d.id)),
      dora: doraIndicators(),
      aka: [...handIds(), ...S.melds.flatMap((m) => m.ids)].filter(isRed).length,
      first: firstGoAround(),
      seatWind: windOf(0), roundWind: roundWind(), dealer: dealerSeat() === 0,
    };
  }

  function renderAnalysis() {
    const box = $('analysis');
    const panel = $('analysisPanel');
    const req = pressed('btnJudge') ? analysisRequest() : null;
    if (!req) { panel.hidden = true; return; }
    panel.hidden = false;
    if (!worker) {
      box.innerHTML = '<div class="label">판단 계산은 서버(Docker 등)로 열었을 때만 동작해요</div>';
      return;
    }
    const st = simState(req.counts);
    const key = JSON.stringify([st, req.options]);
    if (A.key !== key) {
      A = { key, id: A.id + 1, req, results: null, n: 0, done: false };
      worker.postMessage({ id: A.id, st, options: req.options });
    }
    drawAnalysis();
  }

  function drawAnalysis() {
    const box = $('analysis');
    const { req, results, n, done } = A;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'label';
    head.textContent = `${req.title} · ${results ? `시뮬레이션 ${n}회` : '계산 중…'}${results && !done ? ' (계산 중…)' : ''}`;
    box.append(head);

    const table = document.createElement('table');
    table.innerHTML = '<tr><th>선택</th><th>화료율</th><th>기대점수</th><th>화료 시 평균</th></tr>';
    let bestIdx = -1;
    if (results) results.forEach((r, i) => { if (bestIdx < 0 || r.ev > results[bestIdx].ev) bestIdx = i; });
    req.options.forEach((o, i) => {
      const tr = table.insertRow();
      if (i === bestIdx && done) tr.classList.add('best');
      const cell = tr.insertCell();
      cell.className = 'opt';
      cell.append(o.label);
      if (o.tiles) {
        const span = document.createElement('span');
        span.className = 'opt-tiles';
        for (const t of o.tiles) span.append(tileEl(t));
        cell.append(span);
        if (o.note) cell.append(o.note);
      }
      const r = results && results[i];
      tr.insertCell().textContent = r ? `${Math.round(r.winRate * 100)}%` : '…';
      tr.insertCell().textContent = r ? Math.round(r.ev).toLocaleString() : '…';
      tr.insertCell().textContent = r && r.avgWin ? Math.round(r.avgWin).toLocaleString() : '-';
    });
    box.append(table);

    if (results && done) {
      const sorted = results.map((r, i) => ({ ...r, i })).sort((a, b) => b.ev - a.ev);
      const [b1, b2] = sorted;
      const diff = Math.round(b1.ev - b2.ev);
      const o = req.options[b1.i];
      const name = o.kind === 'riichi' ? `리치 (${MJ.tileName(o.discard)} 버림)` : o.kind === 'call' ? `${o.label} (${o.tiles.map(MJ.tileName).join('')})` : o.label;
      // 차이가 작으면 오차 범위라고 알려준다
      const close = diff < Math.max(150, b1.ev * 0.05);
      box.append(para(close
        ? `추천: 거의 비슷해요 (차이 ${diff.toLocaleString()}점, 오차 범위)`
        : `추천: ${name} — 기대점수 +${diff.toLocaleString()}점`, 'verdict'));
      box.append(para(oppActive()
        ? '주의: 상대 화료와 방총 위험은 이 계산에 들어가 있지 않아요 (상대가 화료하지 않는다고 가정). 무작위 시뮬레이션이라 매번 조금씩 달라요.'
        : '상대는 화료하지 않으므로 방총 위험은 계산에 없어요. 무작위 시뮬레이션이라 매번 조금씩 달라요.', 'muted'));
    }
  }

  // 한 판 동안 힌트 영역이 줄어들지 않게 해서, 페이지가 짧아지며 스크롤이 위로 끌려가는 걸 막는다
  function keepHintHeight() {
    const panel = $('hintPanel');
    if (!panel.hidden) {
      S.hintMinH = Math.max(S.hintMinH || 0, panel.offsetHeight);
      panel.style.minHeight = S.hintMinH + 'px';
    }
    // 페이지 전체도 한 판 동안은 줄어들지 않게 한다 (맨 아래로 스크롤해 둔 상태 유지)
    const main = document.querySelector('main');
    S.mainMinH = Math.max(S.mainMinH || 0, main.offsetHeight);
    main.style.minHeight = S.mainMinH + 'px';
  }

  // ---------- 방총 위험률 추정 (보이는 정보만 사용) ----------
  // 상대가 텐파이일 확률: 리치면 1, 아니면 버린 패 수(순목)로 추정
  function tenpaiGuess(q) {
    if (isRiichi(q)) return 1;
    const n = S.rivers[q].length;
    const base = n <= 5 ? 0.03 : n <= 8 ? 0.12 : n <= 11 ? 0.28 : 0.45;
    const k = (q === 0 ? S.melds : S.oppMelds[q]).filter((m) => m.kind !== 'ankan').length;
    return k >= 3 ? Math.max(base, 0.6) : Math.min(0.9, base + k * 0.1);
  }

  // 상대 q가 텐파이일 때 패 t로 론당할 확률 (현물·스지·자패 경험치)
  function tileDanger(t, q, vis) {
    const safe = isRiichi(q) ? safeAgainst(q) : new Set(S.rivers[q].map((d) => typeOf(d.id)));
    if (safe.has(t)) return 0;
    if (t >= 27) return [0.08, 0.05, 0.02, 0.003, 0][Math.min(vis[t], 4)];
    const n = (t % 9) + 1;
    const base = t - n + 1;
    const has = (k) => k >= 1 && k <= 9 && safe.has(base + k - 1);
    if (n === 1 || n === 9) return has(n === 1 ? 4 : 6) ? 0.03 : 0.08;
    if (n === 2 || n === 8) return has(n === 2 ? 5 : 5) ? 0.04 : 0.10;
    if (n === 3 || n === 7) return has(n === 3 ? 6 : 4) ? 0.05 : 0.12;
    const suji = (has(n - 3) ? 1 : 0) + (has(n + 3) ? 1 : 0);
    return suji === 2 ? 0.04 : suji === 1 ? 0.075 : 0.13;
  }

  // 패 종류별로 "버리면 누군가에게 론당할 확률". 상대가 화료하지 않는 모드면 null
  function riskByType(vis) {
    if (!oppActive()) return null;
    const risk = new Array(34).fill(0);
    for (let t = 0; t < 34; t++) {
      let safeProb = 1;
      for (const q of [1, 2, 3]) safeProb *= 1 - tenpaiGuess(q) * tileDanger(t, q, vis);
      risk[t] = 1 - safeProb;
    }
    return risk;
  }

  const riskText = (r) => (r === 0 ? '현물' : r < 0.001 ? '0.1% 미만' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
  const riskClass = (r) => (r === 0 ? 'safe' : r < 0.03 ? 'low' : r < 0.08 ? 'mid' : 'high');

  // 버리면 텐파이지만 후리텐이 되는 패 종류
  // (대기패가 이미 내 버림패에 있거나, 버리려는 패 자체가 대기패)
  function furitenDiscards() {
    const out = new Set();
    if (S.phase !== 'self' || S.riichi) return out;
    const c = MJ.toCounts(handIds());
    const melds = meldCount();
    if (MJ.shanten(c, melds) > 0) return out;
    const river = new Set(S.rivers[0].map((d) => typeOf(d.id)));
    for (let t = 0; t < 34; t++) {
      if (!c[t]) continue;
      c[t]--;
      const ws = MJ.waits(c, melds);
      c[t]++;
      if (ws.some((w) => w === t || river.has(w))) out.add(t);
    }
    return out;
  }

  function renderDiscardTable() {
    const table = $('hintTable');
    if (S.phase !== 'self' || S.riichi) {
      // 표를 지우지 않고 흐리게 남겨 둔다
      table.classList.add('stale');
      if (!table.rows.length) table.innerHTML = '<tr><td class="muted">내 차례에 표시돼요</td></tr>';
      return;
    }
    table.classList.remove('stale');
    const opts = MJ.discardOptions(MJ.toCounts(handIds()), visibleCounts(), meldCount(), S.banned);
    const furiten = furitenDiscards();
    const vis = visibleCounts();
    const risk = riskByType(vis);
    table.innerHTML = '<tr><th>버림</th><th>결과</th><th>유효패</th><th></th><th>남은</th>' + (risk ? '<th>위험</th>' : '') + '</tr>';
    if (!opts.length) return;
    const best = opts[0];
    for (const o of opts) {
      const tr = table.insertRow();
      tr.dataset.type = o.type;
      if (o.shanten === best.shanten && o.total === best.total) tr.classList.add('best');
      tr.insertCell().append(tileEl(o.type));
      const res = tr.insertCell();
      res.textContent = o.shanten === 0 ? '텐파이' : `${o.shanten}샹텐`;
      if (o.shanten === 0 && furiten.has(o.type)) {
        res.append(Object.assign(document.createElement('span'), { className: 'furiten-tag', textContent: '후리텐' }));
      }
      tr.insertCell().textContent = `${o.tiles.length}종 ${o.total}장`;
      const cell = tr.insertCell();
      cell.className = 'mini';
      for (const w of o.tiles) cell.append(tileEl(w.type));
      // 버리는 패가 보이지 않는 곳(산·상대 손패)에 남은 장수
      tr.insertCell().textContent = `${Math.max(0, 4 - vis[o.type])}장`;
      if (risk) {
        const rc = tr.insertCell();
        rc.textContent = riskText(risk[o.type]);
        rc.className = 'risk ' + riskClass(risk[o.type]);
      }
    }
  }

  function highlightHint(type) {
    for (const tr of $('hintTable').rows) {
      tr.classList.toggle('hover', type != null && tr.dataset.type == type);
    }
    for (const row of document.querySelectorAll('.riichi-opt')) {
      row.classList.toggle('hover', type != null && row.dataset.type == type);
    }
  }

  // 리치 선언패 고르기: 버릴 패마다 화료패(대기)와 남은 장수, 후리텐 여부
  function riichiChoices() {
    const box = document.createElement('div');
    box.className = 'riichi-opts';
    box.append(para('리치 선언패를 고르세요 — 버리면 기다리는 패', 'muted'));
    const c = MJ.toCounts(handIds());
    const vis = visibleCounts();
    const river = new Set(S.rivers[0].map((d) => typeOf(d.id)));
    const opts = [...riichiDiscardTypes()].map((t) => {
      c[t]--;
      const u = MJ.ukeire(c, vis, meldCount());
      c[t]++;
      // 대기패가 내 버림패(방금 버릴 패 포함)에 있으면 론을 못 한다
      const furiten = u.tiles.some((w) => river.has(w.type) || w.type === t);
      return { t, u, furiten };
    }).sort((a, b) => b.u.total - a.u.total);
    for (const { t, u, furiten } of opts) {
      const row = document.createElement('div');
      row.className = 'riichi-opt';
      row.dataset.type = t;
      const from = document.createElement('span');
      from.className = 'from';
      from.append(tileEl(t), '버리면');
      row.append(from, waitRow(u.tiles));
      row.append(Object.assign(document.createElement('span'), {
        className: 'total' + (furiten ? ' furiten' : ''),
        textContent: `${u.tiles.length}종 ${u.total}장` + (furiten ? ' · 후리텐' : ''),
      }));
      // 줄을 눌러도 그 패로 리치 선언
      row.addEventListener('click', () => {
        const id = handIds().slice().reverse().find((x) => typeOf(x) === t);
        if (id != null) discard(id);
      });
      row.addEventListener('mouseenter', () => highlightHand(t));
      row.addEventListener('mouseleave', () => highlightHand(null));
      box.append(row);
    }
    return box;
  }

  function highlightHand(type) {
    for (const b of document.querySelectorAll('#hand button.tile')) {
      b.classList.toggle('peek', type != null && b.dataset.type == type);
    }
  }

  // ---------- 이벤트 ----------
  $('btnNew').addEventListener('click', newMatch);
  $('mode').addEventListener('change', () => { save('mj-mode', $('mode').value); newMatch(); });
  $('oppLevel').addEventListener('change', () => { save('mj-opp-level', $('oppLevel').value); newMatch(); });
  $('matchType').addEventListener('change', () => { save('mj-match-type', $('matchType').value); newMatch(); });
  $('btnAskCalls').addEventListener('click', () => {
    setPressed('btnAskCalls', !pressed('btnAskCalls'));
    save('mj-ask-calls', pressed('btnAskCalls'));
    askCallsLabel();
  });
  // 울기·리치 판단(시뮬레이션)은 무거워서 힌트와 따로 켜고 끈다
  $('btnJudge').addEventListener('click', () => {
    setPressed('btnJudge', !pressed('btnJudge'));
    save('mj-judge', pressed('btnJudge'));
    renderAnalysis();
  });
  // 모바일: 설정 메뉴 열고 닫기
  $('btnMenu').addEventListener('click', () => {
    const open = !document.querySelector('.bar').classList.contains('open');
    document.querySelector('.bar').classList.toggle('open', open);
    $('btnMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('btnTsumo').addEventListener('click', tsumo);
  $('btnRiichi').addEventListener('click', () => { S.riichiSelect = !S.riichiSelect; render(); });
  $('btnHint').addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    save('mj-hint', b.getAttribute('aria-pressed') === 'true');
    S.hintMinH = 0;
    S.mainMinH = 0;
    $('hintPanel').style.minHeight = '';
    document.querySelector('main').style.minHeight = '';
    renderHand();
    renderHint();
  });
  $('btnNext').addEventListener('click', () => {
    // 대국이 끝났으면 먼저 최종 순위를 보여 준다
    if (M && M.over && !S.finalShown) { S.finalShown = true; saveGame(); showFinal(); return; }
    $('result').close();
    if (!M || M.over) newMatch(); else newGame();
  });

  // 주소에 ?debug 를 붙이면 콘솔에서 내부 상태를 볼 수 있다 (테스트용)
  if (/[?&]debug\b/.test(location.search)) window.__mj = { get S() { return S; }, oppCallChoice, decideOppCall, hasYakuPath };
  $('btnHint').setAttribute('aria-pressed', load('mj-hint', false) ? 'true' : 'false');
  // 진행 중이던 게임이 있으면 이어서, 없으면 새 게임
  if (!restoreGame()) newMatch();
})();

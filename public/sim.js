// 울기/리치 판단용 몬테카를로 시뮬레이션 (Web Worker)
// 보이지 않는 패(산 + 상대 손패)를 무작위로 섞어 남은 국면을 끝까지 진행해 본다.
// 가정: 상대는 화료·울기를 하지 않고, 버림패는 보이지 않는 패 중 무작위 한 장.
//       나는 샹텐이 가장 낮아지는 패를 버리고, 텐파이면 살아 있는 대기 매수가 많은 쪽을 고른다.
importScripts('mahjong.js?v=52');
const { shanten, waits, evaluate } = MJ;

const TARGET_SIMS = 400;
const TIME_LIMIT_MS = 2000;
const BATCH = 25;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 버릴 때 남기고 싶은 정도 (주변 패와 이어질수록 큼)
function connectivity(c, t) {
  if (t >= 27) return c[t] * 3;
  let s = c[t] * 3;
  const r = t % 9;
  for (const d of [-2, -1, 1, 2]) {
    if (r + d < 0 || r + d > 8) continue;
    s += c[t + d] * (Math.abs(d) === 1 ? 2 : 1);
  }
  return s;
}

function chooseDiscard(c, melds, banned, poolCounts) {
  let best = null;
  for (let t = 0; t < 34; t++) {
    if (!c[t] || (banned && banned.has(t))) continue;
    const conn = connectivity(c, t);
    c[t]--;
    const s = shanten(c, melds);
    let live = 0;
    if (s === 0) for (const w of waits(c, melds)) live += poolCounts[w];
    c[t]++;
    const better = !best || s < best.s ||
      (s === best.s && (s === 0 ? live > best.live : conn < best.conn));
    if (better) best = { t, s, live, conn };
  }
  if (!best) for (let t = 0; t < 34; t++) if (c[t]) return t;
  return best.t;
}

function kuikaeBan(call, t, pair) {
  const ban = new Set([t]);
  if (call === 'chi') {
    const [a, b] = pair;
    if (t < a && b % 9 < 8) ban.add(b + 1);
    if (t > b && a % 9 > 0) ban.add(a - 1);
  }
  return ban;
}

// 한 번의 국면 진행. 화료하면 점수, 못 하면 0
function simulate(st, opt) {
  const pool = [];
  const pc = new Array(34).fill(0);
  for (let t = 0; t < 34; t++) {
    const n = Math.max(0, 4 - st.visible[t]);
    for (let k = 0; k < n; k++) pool.push(t);
    pc[t] = n;
  }
  shuffle(pool);
  const draw = () => { const t = pool.pop(); pc[t]--; return t; };

  const c = st.counts.slice();
  const melds = st.melds.slice();
  let menzen = melds.every((m) => m.kind === 'ankan');
  const river = new Set(st.river);
  let wall = st.remaining;
  let riichi = false, ippatsu = false, dbl = false;
  let ws = null;
  const autoRiichi = opt.kind !== 'dama';

  const afterDiscard = (t) => {
    c[t]--;
    river.add(t);
    ws = shanten(c, melds.length) === 0 ? waits(c, melds.length) : null;
  };
  const tryRiichi = () => {
    if (autoRiichi && !riichi && menzen && ws && wall >= 1) { riichi = true; ippatsu = true; }
  };
  const win = (tsumo, tile) => {
    const counts = c.slice();
    if (!tsumo) counts[tile]++;
    const ura = riichi && pool.length ? [draw()] : [];
    const r = evaluate({
      counts, melds, winTile: tile, tsumo,
      riichi, doubleRiichi: dbl, ippatsu,
      haitei: tsumo && wall === 0, houtei: !tsumo && wall === 0,
      doraIndicators: st.dora, uraIndicators: ura, aka: st.aka,
      seatWind: st.seatWind, roundWind: st.roundWind, dealer: st.dealer,
    });
    return r ? r.points : 0;
  };
  const canRon = (t) => ws && ws.includes(t) && !ws.some((w) => river.has(w));

  let firstOpp = 1;
  if (opt.kind === 'riichi') {
    afterDiscard(opt.discard);
    riichi = true; ippatsu = true; dbl = st.first;
  } else if (opt.kind === 'dama') {
    afterDiscard(chooseDiscard(c, melds.length, null, pc));
  } else if (opt.kind === 'pass') {
    firstOpp = opt.from + 1;
    ws = shanten(c, melds.length) === 0 ? waits(c, melds.length) : null;
  } else if (opt.kind === 'call') {
    const t = opt.tile;
    if (opt.call === 'chi') { c[opt.pair[0]]--; c[opt.pair[1]]--; }
    else c[t] -= opt.call === 'minkan' ? 3 : 2;
    melds.push({ kind: opt.call, tile: opt.call === 'chi' ? Math.min(t, opt.pair[0]) : t });
    menzen = false;
    if (opt.call === 'minkan') {
      // 영상패 보충 (산 끝이 한 장 줄어든다)
      wall--;
      const r = draw();
      c[r]++;
      if (shanten(c, melds.length) === -1) { const p = win(true, r); if (p) return p; }
      afterDiscard(chooseDiscard(c, melds.length, null, pc));
    } else {
      afterDiscard(chooseDiscard(c, melds.length, kuikaeBan(opt.call, t, opt.pair), pc));
    }
  }
  tryRiichi();

  for (let q = firstOpp; ; q = 1) {
    if (!st.solo) {
      for (; q <= 3; q++) {
        if (wall <= 0) return 0;
        wall--;
        const t = draw();
        if (canRon(t)) { const p = win(false, t); if (p) return p; }
      }
    }
    if (wall <= 0) return 0;
    wall--;
    const t = draw();
    c[t]++;
    if (shanten(c, melds.length) === -1) { const p = win(true, t); if (p) return p; }
    if (riichi) {
      c[t]--;
      river.add(t);
      ippatsu = false;
    } else {
      afterDiscard(chooseDiscard(c, melds.length, null, pc));
      tryRiichi();
    }
  }
}

let current = 0;

onmessage = async ({ data }) => {
  const { id, st, options } = data;
  current = id;
  const acc = options.map(() => ({ wins: 0, sum: 0 }));
  const start = performance.now();
  let n = 0;
  while (n < TARGET_SIMS) {
    for (let i = 0; i < BATCH; i++) {
      options.forEach((opt, k) => {
        const p = simulate(st, opt);
        if (p > 0) { acc[k].wins++; acc[k].sum += p; }
      });
    }
    n += BATCH;
    const done = n >= TARGET_SIMS || performance.now() - start > TIME_LIMIT_MS;
    postMessage({
      id, n, done,
      results: acc.map((a) => ({ winRate: a.wins / n, ev: a.sum / n, avgWin: a.wins ? a.sum / a.wins : 0 })),
    });
    if (done) return;
    // 새 요청이 들어왔으면 이 계산은 버린다
    await new Promise((r) => setTimeout(r, 0));
    if (current !== id) return;
  }
};

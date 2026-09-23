// 리치마작 핵심 로직: 패 표현, 샹텐, 화료 분해, 역/부/점수 계산
// 패 종류(type) 0-33: 0-8 만수, 9-17 통수, 18-26 삭수, 27-30 동남서북, 31-33 백발중
// 패 실물(id) 0-135: type = id >> 2, 적도라는 id 16(5만) 52(5통) 88(5삭)
// 부로(meld): { kind: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan', tile: 종류(치는 가장 작은 패) }
(function (global) {
  'use strict';

  const RED_IDS = new Set([16, 52, 88]);
  const SUIT_KO = ['만', '통', '삭'];
  const HONOR_KO = ['동', '남', '서', '북', '백', '발', '중'];

  const typeOf = (id) => id >> 2;
  const isRed = (id) => RED_IDS.has(id);
  const isHonor = (t) => t >= 27;
  const isYaochu = (t) => t >= 27 || t % 9 === 0 || t % 9 === 8;
  const isTerminal = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
  const isDragon = (t) => t >= 31;
  const isWind = (t) => t >= 27 && t <= 30;
  const isKan = (m) => m.kind === 'minkan' || m.kind === 'kakan' || m.kind === 'ankan';

  function tileName(t) {
    if (t >= 27) return HONOR_KO[t - 27];
    return (t % 9 + 1) + SUIT_KO[Math.floor(t / 9)];
  }

  function toCounts(ids) {
    const c = new Array(34).fill(0);
    for (const id of ids) c[typeOf(id)]++;
    return c;
  }

  function doraFromIndicator(t) {
    if (t < 27) return Math.floor(t / 9) * 9 + ((t % 9) + 1) % 9;
    if (t <= 30) return 27 + ((t - 27) + 1) % 4;
    return 31 + ((t - 31) + 1) % 3;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- 샹텐 ----------

  // (면자 수, 탑쯔 수) 조합 중 다른 조합에 완전히 지는 것은 버린다
  function paretoFront(list) {
    return list.filter(([m, t], i) =>
      !list.some(([m2, t2], j) => j !== i && m2 >= m && t2 >= t && (m2 > m || t2 > t || j < i)));
  }

  // 수트 하나(9칸)에서 가능한 (면자, 탑쯔) 조합. 같은 모양은 캐시해서 재사용
  const suitCache = new Map();
  function suitOptions(s) {
    const key = s.join('');
    let res = suitCache.get(key);
    if (res) return res;
    const c = s.slice();
    const found = [];
    (function dfs(i, m, t) {
      while (i < 9 && c[i] === 0) i++;
      if (i === 9) { found.push([m, t]); return; }
      if (c[i] >= 3) { c[i] -= 3; dfs(i, m + 1, t); c[i] += 3; }
      if (i <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, m + 1, t); c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (c[i] >= 2) { c[i] -= 2; dfs(i, m, t + 1); c[i] += 2; }
      if (i <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, m, t + 1); c[i]++; c[i + 1]++; }
      if (i <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, m, t + 1); c[i]++; c[i + 2]++; }
      c[i]--; dfs(i, m, t); c[i]++;
    })(0, 0, 0);
    res = paretoFront(found);
    suitCache.set(key, res);
    return res;
  }

  function blocksShanten(c, p, melds) {
    // 자패는 슌쯔가 없으니 탐욕적으로 처리해도 최적
    let hm = melds, ht = 0;
    for (let i = 27; i < 34; i++) {
      if (c[i] >= 3) hm++;
      else if (c[i] === 2) ht++;
    }
    let opts = [[hm, ht]];
    for (let s = 0; s < 3; s++) {
      const next = [];
      for (const [m, t] of opts) {
        for (const [m2, t2] of suitOptions(c.slice(s * 9, s * 9 + 9))) next.push([m + m2, t + t2]);
      }
      opts = paretoFront(next);
    }
    let best = 8;
    for (const [m, t] of opts) {
      const s = 8 - 2 * m - Math.min(t, 4 - m) - p;
      if (s < best) best = s;
    }
    return best;
  }

  function normalShanten(counts, melds = 0) {
    const c = counts.slice();
    let best = blocksShanten(c, 0, melds);
    for (let h = 0; h < 34; h++) {
      if (c[h] >= 2) {
        c[h] -= 2;
        best = Math.min(best, blocksShanten(c, 1, melds));
        c[h] += 2;
      }
    }
    return best;
  }

  function chiitoiShanten(c) {
    let pairs = 0, kinds = 0;
    for (let i = 0; i < 34; i++) {
      if (c[i] > 0) kinds++;
      if (c[i] >= 2) pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  function kokushiShanten(c) {
    let kinds = 0, pair = 0;
    for (let i = 0; i < 34; i++) {
      if (!isYaochu(i)) continue;
      if (c[i] > 0) kinds++;
      if (c[i] >= 2) pair = 1;
    }
    return 13 - kinds - pair;
  }

  // melds: 이미 부로한 면자 수 (안깡 포함)
  function shanten(c, melds = 0) {
    const n = normalShanten(c, melds);
    if (melds > 0) return n;
    return Math.min(n, chiitoiShanten(c), kokushiShanten(c));
  }

  // 손패(쯔모 전 상태)의 유효패. visible: 이미 보이는 패 종류별 장수
  function ukeire(c13, visible, melds = 0) {
    const base = shanten(c13, melds);
    const tiles = [];
    let total = 0;
    const c = c13.slice();
    for (let t = 0; t < 34; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      if (shanten(c, melds) < base) {
        const left = Math.max(0, 4 - visible[t]);
        tiles.push({ type: t, left });
        total += left;
      }
      c[t]--;
    }
    return { shanten: base, tiles, total };
  }

  // 텐파이일 때 대기패 종류 목록 (남은 장수와 무관)
  function waits(c13, melds = 0) {
    if (shanten(c13, melds) !== 0) return [];
    const out = [];
    const c = c13.slice();
    for (let t = 0; t < 34; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      if (shanten(c, melds) === -1) out.push(t);
      c[t]--;
    }
    return out;
  }

  // 쯔모 후 손패에서 각 타패 후보의 결과. banned: 버릴 수 없는 종류(쿠이카에)
  function discardOptions(c14, visible, melds = 0, banned = null) {
    const out = [];
    const c = c14.slice();
    for (let t = 0; t < 34; t++) {
      if (!c[t] || (banned && banned.has(t))) continue;
      c[t]--;
      const u = ukeire(c, visible, melds);
      out.push({ type: t, shanten: u.shanten, tiles: u.tiles, total: u.total });
      c[t]++;
    }
    out.sort((a, b) => a.shanten - b.shanten || b.total - a.total || a.type - b.type);
    return out;
  }

  // ---------- 화료 분해 ----------

  function decompose(counts) {
    const c = counts.slice();
    const res = [];
    const blocks = [];
    function rec(i, head) {
      while (i < 34 && c[i] === 0) i++;
      if (i === 34) { res.push({ head, blocks: blocks.slice() }); return; }
      if (c[i] >= 3) {
        c[i] -= 3; blocks.push({ kind: 'kou', tile: i });
        rec(i, head);
        blocks.pop(); c[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; blocks.push({ kind: 'shun', tile: i });
        rec(i, head);
        blocks.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    for (let h = 0; h < 34; h++) {
      if (c[h] >= 2) { c[h] -= 2; rec(0, h); c[h] += 2; }
    }
    return res;
  }

  function isChiitoi(c) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) {
      if (c[i] === 2) pairs++;
      else if (c[i] !== 0) return false;
    }
    return pairs === 7;
  }

  function isKokushi(c) { return kokushiShanten(c) === -1; }

  function meldToBlock(m) {
    return {
      kind: m.kind === 'chi' ? 'shun' : 'kou',
      tile: m.tile,
      open: m.kind !== 'ankan',
      kan: isKan(m),
    };
  }

  function allTileCounts(counts, melds) {
    const c = counts.slice();
    for (const m of melds) {
      if (m.kind === 'chi') { c[m.tile]++; c[m.tile + 1]++; c[m.tile + 2]++; }
      else c[m.tile] += isKan(m) ? 4 : 3;
    }
    return c;
  }

  // ---------- 역 판정 ----------

  // ctx: { counts(부로 제외 손패 + 화료패), melds, winTile, tsumo, riichi, doubleRiichi, ippatsu,
  //        haitei, houtei, rinshan, tenhou, doraIndicators, uraIndicators, aka }
  // 플레이어는 항상 동가(친), 동장
  function evaluate(ctx) {
    // seatWind/roundWind: 27~30 (東南西北), dealer: 친 여부. 기본값은 플레이어(동장 동가)
    ctx = Object.assign({ melds: [], tsumo: true, seatWind: 27, roundWind: 27, dealer: true }, ctx);
    ctx.menzen = ctx.melds.every((m) => m.kind === 'ankan');
    ctx.all = allTileCounts(ctx.counts, ctx.melds);
    const c = ctx.counts;

    const yakuman = yakumanCheck(ctx);
    if (yakuman.length) {
      const mult = yakuman.reduce((s, y) => s + y.mult, 0);
      return finalize({ yaku: yakuman.map((y) => ({ name: y.name, han: y.mult === 2 ? '더블 역만' : '역만' })), yakumanMult: mult }, ctx);
    }

    const candidates = [];
    if (ctx.melds.length === 0 && isChiitoi(c)) candidates.push(scoreChiitoi(ctx));
    for (const d of decompose(c)) {
      for (const w of waitsOf(d, ctx.winTile)) candidates.push(scoreNormal(ctx, d, w));
    }
    const valid = candidates.filter(Boolean);
    if (!valid.length) return null;
    valid.sort((a, b) => b.points - a.points || b.han - a.han || b.fu - a.fu);
    return valid[0];
  }

  function commonYaku(ctx) {
    const y = [];
    if (ctx.doubleRiichi) y.push({ name: '더블 리치', han: 2 });
    else if (ctx.riichi) y.push({ name: '리치', han: 1 });
    if (ctx.riichi && ctx.ippatsu) y.push({ name: '일발', han: 1 });
    if (ctx.menzen && ctx.tsumo) y.push({ name: '멘젠쯔모', han: 1 });
    if (ctx.tsumo && ctx.rinshan) y.push({ name: '영상개화', han: 1 });
    else if (ctx.tsumo && ctx.haitei) y.push({ name: '해저로월', han: 1 });
    if (!ctx.tsumo && ctx.houtei) y.push({ name: '하저로어', han: 1 });
    return y;
  }

  // 부로하면 1판 내려가는 역 (쿠이사가리)
  const kui = (ctx, han) => (ctx.menzen ? han : han - 1);

  function colorYaku(ctx) {
    const c = ctx.all;
    const suits = new Set();
    let honors = false, allYaochu = true, anyYaochu = false;
    for (let i = 0; i < 34; i++) {
      if (!c[i]) continue;
      if (i >= 27) honors = true; else suits.add(Math.floor(i / 9));
      if (isYaochu(i)) anyYaochu = true; else allYaochu = false;
    }
    const y = [];
    if (!anyYaochu) y.push({ name: '탕야오', han: 1 });
    if (suits.size === 1 && !honors) y.push({ name: '청일색', han: kui(ctx, 6) });
    else if (suits.size === 1 && honors) y.push({ name: '혼일색', han: kui(ctx, 3) });
    if (allYaochu && honors && suits.size > 0) y.push({ name: '혼노두', han: 2 });
    return y;
  }

  function doraYaku(ctx) {
    const y = [];
    const c = ctx.all;
    let dora = 0;
    for (const ind of ctx.doraIndicators) dora += c[doraFromIndicator(ind)];
    if (dora) y.push({ name: '도라', han: dora });
    if (ctx.aka) y.push({ name: '적도라', han: ctx.aka });
    if (ctx.riichi) {
      let ura = 0;
      for (const ind of ctx.uraIndicators) ura += c[doraFromIndicator(ind)];
      if (ura) y.push({ name: '뒷도라', han: ura });
    }
    return y;
  }

  function scoreChiitoi(ctx) {
    const yaku = [...commonYaku(ctx), { name: '치또이츠', han: 2 }, ...colorYaku(ctx)];
    return finalize({ yaku: [...yaku, ...doraYaku(ctx)], fu: 25, fuDetail: ['치또이츠 고정 25부'] }, ctx);
  }

  // 분해 d에서 화료패가 들어간 자리마다 대기 형태를 만든다
  function waitsOf(d, w) {
    const out = [];
    if (d.head === w) out.push({ type: 'tanki', index: -1 });
    d.blocks.forEach((b, i) => {
      if (b.kind === 'kou' && b.tile === w) out.push({ type: 'shanpon', index: i });
      if (b.kind === 'shun' && w >= b.tile && w <= b.tile + 2) {
        const pos = w - b.tile;
        const r = b.tile % 9;
        let type;
        if (pos === 1) type = 'kanchan';
        else if ((pos === 2 && r === 0) || (pos === 0 && r === 6)) type = 'penchan';
        else type = 'ryanmen';
        out.push({ type, index: i });
      }
    });
    const seen = new Set();
    return out.filter((x) => {
      const k = x.type + ':' + (x.index >= 0 ? d.blocks[x.index].kind + d.blocks[x.index].tile : 'h');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const WAIT_KO = { tanki: '단기', shanpon: '샤보', kanchan: '간짱', penchan: '변짱', ryanmen: '양면' };

  // 손패 분해 + 부로를 합친 면자 목록. 론으로 완성된 샤보 커쯔는 밍커 취급
  function fullBlocks(ctx, d, wait) {
    const blocks = d.blocks.map((b) => ({ ...b, open: false, kan: false }));
    if (!ctx.tsumo && wait && wait.type === 'shanpon') blocks[wait.index].open = true;
    return [...blocks, ...ctx.melds.map(meldToBlock)];
  }

  function scoreNormal(ctx, d, wait) {
    const blocks = fullBlocks(ctx, d, wait);
    const shun = blocks.filter((b) => b.kind === 'shun').map((b) => b.tile);
    const kouBlocks = blocks.filter((b) => b.kind === 'kou');
    const kou = kouBlocks.map((b) => b.tile);
    const yaku = [...commonYaku(ctx), ...colorYaku(ctx)];
    const add = (name, han) => { if (han > 0) yaku.push({ name, han }); };

    const yakuhaiHead = d.head === ctx.seatWind || d.head === ctx.roundWind || isDragon(d.head);
    const pinfu = ctx.menzen && shun.length === 4 && !yakuhaiHead && wait.type === 'ryanmen';
    if (pinfu) add('핑후', 1);

    if (ctx.menzen) {
      const shunCount = {};
      for (const s of shun) shunCount[s] = (shunCount[s] || 0) + 1;
      let peiko = 0;
      for (const k in shunCount) peiko += Math.floor(shunCount[k] / 2);
      if (peiko === 2) add('량페코', 3);
      else if (peiko === 1) add('이페코', 1);
    }

    // 역패 (자풍과 장풍이 같으면 2판)
    const WIND_CH = ['東', '南', '西', '北'];
    for (const k of kou) {
      if (k === ctx.seatWind) add(`역패 ${WIND_CH[k - 27]} (자풍)`, 1);
      if (k === ctx.roundWind) add(`역패 ${WIND_CH[k - 27]} (장풍)`, 1);
      if (k === 31) add('역패 白', 1);
      if (k === 32) add('역패 發', 1);
      if (k === 33) add('역패 中', 1);
    }

    const has = (arr, t) => arr.includes(t);
    for (let n = 0; n < 7; n++) {
      if (has(shun, n) && has(shun, n + 9) && has(shun, n + 18)) { add('삼색동순', kui(ctx, 2)); break; }
    }
    for (let s = 0; s < 3; s++) {
      if (has(shun, s * 9) && has(shun, s * 9 + 3) && has(shun, s * 9 + 6)) { add('일기통관', kui(ctx, 2)); break; }
    }
    for (let n = 0; n < 9; n++) {
      if (has(kou, n) && has(kou, n + 9) && has(kou, n + 18)) { add('삼색동각', 2); break; }
    }

    if (shun.length > 0) {
      const blockHasYaochu = (b) => b.kind === 'kou' ? isYaochu(b.tile) : (b.tile % 9 === 0 || b.tile % 9 === 6);
      if (isYaochu(d.head) && blocks.every(blockHasYaochu)) {
        const anyHonor = isHonor(d.head) || kou.some(isHonor);
        if (anyHonor) add('찬타', kui(ctx, 2)); else add('준찬타', kui(ctx, 3));
      }
    }

    if (kou.length === 4) add('또이또이', 2);
    const concealedKou = kouBlocks.filter((b) => !b.open).length;
    if (concealedKou === 3) add('산안커', 2);
    const kans = kouBlocks.filter((b) => b.kan).length;
    if (kans === 3) add('산깡쯔', 2);

    const dragonKou = kou.filter(isDragon).length;
    if (dragonKou === 2 && isDragon(d.head)) add('소삼원', 2);

    // 부 계산
    let fu, fuDetail;
    if (pinfu) {
      fu = ctx.tsumo ? 20 : 30;
      fuDetail = [ctx.tsumo ? '핑후 쯔모 20부' : '핑후 론 30부'];
    } else {
      fu = 20; fuDetail = ['기본 20부'];
      if (ctx.menzen && !ctx.tsumo) { fu += 10; fuDetail.push('멘젠 론 +10'); }
      if (ctx.tsumo) { fu += 2; fuDetail.push('쯔모 +2'); }
      for (const b of kouBlocks) {
        let f = 2;
        if (isYaochu(b.tile)) f *= 2;
        if (!b.open) f *= 2;
        if (b.kan) f *= 4;
        const label = (b.open ? '밍' : '안') + (b.kan ? '깡' : '커');
        fu += f; fuDetail.push(`${label} ${tileName(b.tile)} +${f}`);
      }
      const headFu = (d.head === ctx.seatWind ? 2 : 0) + (d.head === ctx.roundWind ? 2 : 0) + (isDragon(d.head) ? 2 : 0);
      if (headFu === 4) { fu += 4; fuDetail.push('연풍패 머리 +4'); }
      else if (headFu) { fu += 2; fuDetail.push('역패 머리 +2'); }
      if (wait.type === 'tanki' || wait.type === 'kanchan' || wait.type === 'penchan') {
        fu += 2; fuDetail.push(`${WAIT_KO[wait.type]} 대기 +2`);
      }
      const raw = fu;
      fu = Math.max(30, Math.ceil(fu / 10) * 10);
      if (raw !== fu) fuDetail.push(`${raw}부 → 절상 ${fu}부`);
    }

    return finalize({ yaku: [...yaku, ...doraYaku(ctx)], fu, fuDetail, wait: WAIT_KO[wait.type] }, ctx);
  }

  function yakumanCheck(ctx) {
    const c = ctx.counts;
    const all = ctx.all;
    const w = ctx.winTile;
    const closed = ctx.melds.length === 0;
    const y = [];
    if (ctx.tenhou) y.push({ name: ctx.dealer ? '천화' : '지화', mult: 1 });

    if (closed && isKokushi(c)) {
      const before = c.slice(); before[w]--;
      const thirteen = before.every((n, i) => !isYaochu(i) || n === 1);
      y.push(thirteen ? { name: '국사무쌍 13면 대기', mult: 2 } : { name: '국사무쌍', mult: 1 });
      return y;
    }

    const decs = decompose(c);
    const chiitoi = closed && isChiitoi(c);
    if (!decs.length && !chiitoi) return y;

    const tiles = [];
    for (let i = 0; i < 34; i++) if (all[i]) tiles.push(i);
    if (tiles.every(isHonor)) y.push({ name: '자일색', mult: 1 });
    const green = new Set([19, 20, 21, 23, 25, 32]);
    if (tiles.every((t) => green.has(t))) y.push({ name: '녹일색', mult: 1 });
    if (tiles.every(isTerminal)) y.push({ name: '청노두', mult: 1 });

    const suit = tiles[0] < 27 ? Math.floor(tiles[0] / 9) : -1;
    if (closed && suit >= 0 && tiles.every((t) => t < 27 && Math.floor(t / 9) === suit)) {
      const s = c.slice(suit * 9, suit * 9 + 9);
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (s.every((n, i) => n >= need[i])) {
        const before = s.slice(); before[w - suit * 9]--;
        const pure = before.every((n, i) => n === need[i]);
        y.push(pure ? { name: '순정 구련보등', mult: 2 } : { name: '구련보등', mult: 1 });
      }
    }

    const kans = ctx.melds.filter(isKan).length;
    if (kans === 4) y.push({ name: '스깡쯔', mult: 1 });

    let best = null;
    for (const d of decs) {
      for (const wait of waitsOf(d, w)) {
        const blocks = fullBlocks(ctx, d, wait);
        const kouBlocks = blocks.filter((b) => b.kind === 'kou');
        const kou = kouBlocks.map((b) => b.tile);
        const found = [];
        if (kouBlocks.length === 4 && kouBlocks.every((b) => !b.open)) {
          found.push(wait.type === 'tanki' ? { name: '스안커 단기', mult: 2 } : { name: '스안커', mult: 1 });
        }
        if ([31, 32, 33].every((t) => kou.includes(t))) found.push({ name: '대삼원', mult: 1 });
        const windKou = kou.filter(isWind).length;
        if (windKou === 4) found.push({ name: '대사희', mult: 2 });
        else if (windKou === 3 && isWind(d.head)) found.push({ name: '소사희', mult: 1 });
        const m = found.reduce((s, f) => s + f.mult, 0);
        if (!best || m > best.m) best = { m, found };
      }
    }
    if (best) y.push(...best.found);
    return y;
  }

  const LIMIT_NAMES = [
    [13, '헤아림 역만'], [11, '삼배만'], [8, '배만'], [6, '하네만'], [5, '만관'],
  ];

  function roundUp100(x) { return Math.ceil(x / 100) * 100; }

  // 친 쯔모: 자 3명이 각각 기본점 x2 / 친 론: 기본점 x6
  // 자 쯔모: 친이 x2, 다른 자가 x1 / 자 론: 기본점 x4
  function finalize(r, ctx) {
    const { tsumo, dealer } = ctx;
    const pay = (base) => {
      if (dealer) {
        return tsumo
          ? { each: roundUp100(base * 2), dealerPay: 0, childPay: roundUp100(base * 2), points: roundUp100(base * 2) * 3 }
          : { each: null, points: roundUp100(base * 6) };
      }
      if (tsumo) {
        const dealerPay = roundUp100(base * 2), childPay = roundUp100(base);
        return { each: null, dealerPay, childPay, points: dealerPay + childPay * 2 };
      }
      return { each: null, points: roundUp100(base * 4) };
    };
    if (r.yakumanMult) {
      return {
        yaku: r.yaku, han: 13 * r.yakumanMult, fu: null, fuDetail: [], tsumo, dealer,
        limit: r.yakumanMult > 1 ? `${r.yakumanMult}배 역만` : '역만',
        yakuman: true, ...pay(8000 * r.yakumanMult),
      };
    }
    const realYaku = r.yaku.filter((y) => !['도라', '적도라', '뒷도라'].includes(y.name));
    if (!realYaku.length) return null;
    const han = r.yaku.reduce((s, y) => s + y.han, 0);
    let base, limit = null;
    for (const [h, name] of LIMIT_NAMES) {
      if (han >= h) { limit = name; break; }
    }
    if (han >= 13) base = 8000;
    else if (han >= 11) base = 6000;
    else if (han >= 8) base = 4000;
    else if (han >= 6) base = 3000;
    else if (han >= 5) base = 2000;
    else {
      base = r.fu * Math.pow(2, han + 2);
      if (base >= 2000) { base = 2000; limit = '만관'; }
    }
    return { yaku: r.yaku, han, fu: r.fu, fuDetail: r.fuDetail, wait: r.wait, limit, tsumo, dealer, ...pay(base) };
  }

  global.MJ = {
    typeOf, isRed, isHonor, isYaochu, isKan, tileName, toCounts, doraFromIndicator, shuffle,
    shanten, ukeire, waits, discardOptions, evaluate,
  };
})(typeof window !== 'undefined' ? window : globalThis);

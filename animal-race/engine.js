// アニマルレース ゲームエンジン（シミュレーションと CPU で共通に使う）
// ルールは animal-race-rules.md に合わせている
(function (global) {
  'use strict';

  const ANIMALS = ['カメ', 'イヌ', 'ネコ', 'チーター', 'キツネ'];
  const CAT = 2, FOX = 4;
  const LANES = [
    { name: '花畑', len: 30 },
    { name: '草原', len: 33 },
    { name: '川原', len: 36 },
    { name: '森', len: 39 },
    { name: '山道', len: 42 },
  ];
  const IMMEDIATE = new Set(['sweep', 'limitUp', 'limitDown']);
  const GENERAL = new Set(['move', 'foxSame', 'foxSwap', 'catDice']);
  const START_LIMIT = 5;
  const MAX_PLAYS = 3000;

  // ルールを切り替えて比べるための設定
  //   bulkMin: 同じ動物のカードが何枚以上あれば、まとめて出せるか
  //   dudRule: ゴールした動物のカードの扱い
  //     'keep'   … 出しても何も起きない
  //     'remove' … ゴールしたら山札・捨て札から取り除く（手札の分は残る）
  //     'purge'  … ゴールしたら山札・捨て札・全員の手札から取り除き、手札は引き直す
  //     'redraw' … 出したら1枚引いて、もう一度カードを出せる
  //     'wild'   … まだ走っている好きな動物のカードとして使える（数字はそのまま）
  //   foxHold / foxSameMin: CPU の作戦（chooseAction の説明を参照）
  //   cards: 動物ごとの一般カード { 進む数: 枚数 }。foxSame / foxSwap はキツネの特殊カードの枚数
  //   lanes: 各レーンのマス数（花畑・草原・川原・森・山道の順）
  //   handSize: 最初の手札の上限
  const DEFAULT_OPTS = {
    bulkMin: 4, bulkMode: 'hand', dudRule: 'purge', foxHold: 8,
    cards: [
      { 2: 23 },
      { 3: 9, 4: 7 },
      {},
      { 8: 1, 9: 2, 10: 2, 11: 1, 12: 1 },
      { 3: 2, 4: 3, 5: 2 },
    ],
    catDice: [{ lo: 1, hi: 8, count: 4 }, { lo: 2, hi: 9, count: 4 }, { lo: 0, hi: 11, count: 4 }],
    foxSame: 3, foxSwap: 1,
    lanes: [30, 33, 36, 39, 42],
    handSize: START_LIMIT,
    snapshotAt: 15,
  };

  // 再現できるように、種（seed）つきの乱数を使う
  function makeRng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildDeck(opts) {
    const deck = [];
    opts.cards.forEach((spec, animal) => {
      for (const [n, count] of Object.entries(spec)) {
        for (let i = 0; i < count; i++) deck.push({ kind: 'move', animal, n: Number(n) });
      }
    });
    // catDice：出すまで進む数が分からないネコのカード（半々で lo か hi）。[{ lo, hi, count }, ...]
    (opts.catDice || []).forEach(({ lo, hi, count }) => {
      for (let i = 0; i < count; i++) deck.push({ kind: 'catDice', animal: CAT, lo, hi });
    });
    for (let i = 0; i < opts.foxSame; i++) deck.push({ kind: 'foxSame', animal: FOX });
    for (let i = 0; i < opts.foxSwap; i++) deck.push({ kind: 'foxSwap', animal: FOX });
    [['sweep', 2], ['swap', 1], ['limitDown', 1], ['limitUp', 1], ['god', 1], ['rob', 1], ['favor', 1]]
      .forEach(([kind, count]) => { for (let i = 0; i < count; i++) deck.push({ kind }); });
    deck.forEach((c, i) => { c.id = i; });
    return deck;
  }

  // ---------- 盤面（動物の位置と連続ボーナス） ----------

  function cloneBoard(b) {
    return {
      remaining: b.remaining.slice(), done: b.done.slice(), finished: b.finished.slice(),
      lastAnimal: b.lastAnimal, streak: b.streak, lastMove: b.lastMove,
    };
  }

  function moveAnimal(b, a, amt) {
    if (b.done[a] || amt <= 0) return;
    b.remaining[a] -= amt;
    if (b.remaining[a] <= 0) {
      b.remaining[a] = 0;
      b.done[a] = true;
      b.finished.push(a);
    }
  }

  // カードに書いてある進む数（キツネの「前と同じ数」は直前に実際に進んだ数）
  function cardSteps(b, c) {
    if (c.kind === 'move') return c.n;
    if (c.kind === 'foxSame') return b.lastMove;
    // 本物の盤面（rng あり）では運で決まり、CPU が先読みするときは平均で考える
    if (c.kind === 'catDice') return b.rng ? (b.rng() < 0.5 ? c.lo : c.hi) : (c.lo + c.hi) / 2;
    return 0;
  }

  function playGeneral(b, c) {
    const a = c.animal;
    b.streak = b.lastAnimal === a ? b.streak + 1 : 1;
    b.lastAnimal = a;
    if (c.kind === 'foxSwap') return;
    const amt = cardSteps(b, c) + (b.streak - 1);
    const before = b.remaining[a];
    moveAnimal(b, a, amt);
    // 「前と同じ数」は実際に進んだ数（ゴールで打ち切られたら、その分は数えない）
    b.lastMove = before - b.remaining[a];
  }

  // 盤面に関わる部分だけを適用する（交換・強盗は盤面を変えない）
  function applyToBoard(b, act, hand) {
    switch (act.type) {
      case 'move':
        playGeneral(b, hand[act.i]);
        break;
      case 'foxSwap': {
        playGeneral(b, hand[act.i]);
        const t = act.target;
        [b.remaining[FOX], b.remaining[t]] = [b.remaining[t], b.remaining[FOX]];
        break;
      }
      case 'dud':
        // ゴールした動物のカード：何も起きず、連続は途切れる
        b.lastAnimal = -1;
        b.streak = 0;
        break;
      case 'god':
        moveAnimal(b, act.target, 12);
        break;
      case 'favor':
        moveAnimal(b, act.target, 10);
        break;
      case 'wild':
        playGeneral(b, { kind: 'move', animal: act.target, n: hand[act.i].n });
        break;
      case 'all': {
        const a = act.animal;
        const sum = act.idx.reduce((s, i) => s + cardSteps(b, hand[i]), 0);
        moveAnimal(b, a, sum);
        // まとめて出したあとは連続が切れる
        b.lastAnimal = -1;
        b.streak = 0;
        b.lastMove = sum;
        break;
      }
    }
  }

  // ---------- 作戦（自分の賭けに近づける） ----------

  // target = [1位にしたい動物, 2位, 3位]。値が大きいほど賭けどおりの並びに近い
  function utility(b, target) {
    const order = target.concat([0, 1, 2, 3, 4].filter(a => !target.includes(a)));
    const pos = a => (b.done[a] ? -1000 + b.finished.indexOf(a) * 50 : b.remaining[a]);
    let u = 0;
    for (let i = 0; i < 3; i++) {
      const w = 3 - i;
      for (let j = i + 1; j < 5; j++) {
        const d = pos(order[j]) - pos(order[i]);
        u += w * Math.max(-12, Math.min(12, d));
      }
    }
    return u;
  }

  function unfinished(b) {
    return [0, 1, 2, 3, 4].filter(a => !b.done[a]);
  }

  // 盤面を動かす行動（手札だけで決まるもの）
  function boardActions(b, hand, opts) {
    const acts = [];
    hand.forEach((c, i) => {
      if (GENERAL.has(c.kind)) {
        if (b.done[c.animal]) {
          if (opts.dudRule === 'wild' && c.kind === 'move') {
            unfinished(b).forEach(t => acts.push({ type: 'wild', i, target: t }));
          } else {
            acts.push({ type: 'dud', i });
          }
          return;
        }
        if (c.kind === 'foxSwap') {
          const targets = unfinished(b).filter(a => a !== FOX);
          if (targets.length === 0) acts.push({ type: 'dud', i });
          targets.forEach(t => acts.push({ type: 'foxSwap', i, target: t }));
        } else {
          acts.push({ type: 'move', i });
        }
      } else if (c.kind === 'god') {
        const live = unfinished(b);
        const max = Math.max(...live.map(a => b.remaining[a]));
        live.filter(a => b.remaining[a] === max).forEach(t => acts.push({ type: 'god', i, target: t }));
      } else if (c.kind === 'favor') {
        unfinished(b).forEach(t => acts.push({ type: 'favor', i, target: t }));
      }
    });
    // まとめて出す：bulkMode 'count' は同じ動物のカードが bulkMin 枚以上、
    // 'hand' は手札が全部同じ動物の一般カード（2枚以上）のとき
    unfinished(b).forEach(a => {
      const idx = [];
      hand.forEach((c, i) => { if (GENERAL.has(c.kind) && c.animal === a) idx.push(i); });
      const ok = opts.bulkMode === 'hand' ? idx.length >= 2 && idx.length === hand.length : idx.length >= opts.bulkMin;
      if (ok) acts.push({ type: 'all', animal: a, idx });
    });
    return acts;
  }

  function scoreBoardAction(b, act, hand, target) {
    const nb = cloneBoard(b);
    applyToBoard(nb, act, hand);
    return utility(nb, target);
  }

  // 手札の強さ：次の番にいちばん良いカードを出したら、どれだけ良くなるか
  function handValue(b, hand, target) {
    const base = utility(b, target);
    let best = 0;
    for (const act of boardActions(b, hand, b.opts)) {
      best = Math.max(best, scoreBoardAction(b, act, hand, target) - base);
    }
    return best;
  }

  const HAND_WEIGHT = 0.7;      // 手札が良くなることを、盤面の得点に換算する割合
  const SWAP_EXPECTED = 2;      // 中身が見えない相手の手札の、だいたいの強さ

  function chooseAction(s, p) {
    const hand = s.hands[p];
    if (hand.length === 0) return null;
    const target = s.targets[p];
    const now = utility(s, target);
    const candidates = [];

    for (const act of boardActions(s, hand, s.opts)) {
      candidates.push({ act, score: scoreBoardAction(s, act, hand, target) });
    }

    hand.forEach((c, i) => {
      if (c.kind === 'swap') {
        // 相手の手札は見えないので、自分の手札が悪いときほど交換したくなる
        const rest = hand.filter((_, k) => k !== i);
        const mine = handValue(s, rest, target);
        for (let q = 0; q < s.n; q++) {
          if (q === p) continue;
          candidates.push({ act: { type: 'swap', i, q }, score: now + HAND_WEIGHT * (SWAP_EXPECTED - mine) });
        }
      } else if (c.kind === 'rob') {
        // 強盗は全員の手札を見られる
        const rest = hand.filter((_, k) => k !== i);
        if (rest.length === 0) return;
        const before = handValue(s, rest, target);
        for (let q = 0; q < s.n; q++) {
          if (q === p) continue;
          s.hands[q].forEach((take, j) => {
            rest.forEach((_, k) => {
              const after = rest.filter((__, x) => x !== k).concat([take]);
              const gain = handValue(s, after, target) - before;
              candidates.push({ act: { type: 'rob', i, q, j, k }, score: now + HAND_WEIGHT * gain });
            });
          });
        }
      }
    });

    // キツネの切り札を取っておく作戦（foxHold：相手の残りマスがこれ以下になるまで場所交代を使わない、
    // foxSameMin：直前に進んだ数がこれ以上のときだけ「前と同じ数」を使う）。ほかに出せるカードがあるときだけ
    const o = s.opts;
    if (o.foxHold != null || o.foxSameMin != null) {
      const held = candidates.filter(({ act }) => {
        if (o.foxHold != null && act.type === 'foxSwap') return s.remaining[act.target] > o.foxHold;
        if (o.foxSameMin != null && act.type === 'move' && hand[act.i].kind === 'foxSame') return s.lastMove < o.foxSameMin;
        return false;
      });
      if (held.length < candidates.length) {
        const keep = candidates.filter(c => !held.includes(c));
        candidates.length = 0;
        candidates.push(...keep);
      }
    }

    if (candidates.length === 0) return null;
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const sc = c.score + s.rng() * 1e-6;
      if (sc > bestScore) { bestScore = sc; best = c.act; }
    }
    return best;
  }

  // 手札の上限が減ったとき、いちばんいらないカードを捨てる
  function chooseDiscard(s, p) {
    const hand = s.hands[p];
    let bestK = 0, bestV = -Infinity;
    hand.forEach((_, k) => {
      const v = handValue(s, hand.filter((__, x) => x !== k), s.targets[p]) + s.rng() * 1e-6;
      if (v > bestV) { bestV = v; bestK = k; }
    });
    return bestK;
  }

  // ---------- 山札と手札 ----------

  function drawOne(s) {
    if (s.deck.length === 0) {
      // 一般カードだけ混ぜて戻す。特別カードは1回きり
      s.deck = shuffle(s.discard.filter(c => GENERAL.has(c.kind)), s.rng);
      s.discard = [];
      s.stats.reshuffles++;
      if (s.deck.length === 0) return null;
    }
    return s.deck.pop();
  }

  function applyImmediate(s, p, c) {
    s.stats.special[c.kind] = (s.stats.special[c.kind] || 0) + 1;
    s.events.push({ type: 'special', p, kind: c.kind, immediate: true });
    if (c.kind === 'sweep') {
      s.discard.push(...s.hands[p]);
      s.hands[p] = [];
    } else if (c.kind === 'limitUp') {
      s.limits[p]++;
    } else if (c.kind === 'limitDown') {
      s.limits[p]--;
      while (s.hands[p].length > s.limits[p]) {
        s.discard.push(s.hands[p].splice(chooseDiscard(s, p), 1)[0]);
      }
    }
    s.discard.push(c);
  }

  function fillHand(s, p, firstDeal) {
    while (s.hands[p].length < s.limits[p]) {
      const c = drawOne(s);
      if (!c) return;
      if (firstDeal && c.kind === 'sweep') {
        // 最初の配りでは一掃は配らない。山札のどこかに戻して引き直す
        s.deck.splice(Math.floor(s.rng() * s.deck.length), 0, c);
        continue;
      }
      if (IMMEDIATE.has(c.kind)) {
        applyImmediate(s, p, c);
      } else {
        s.hands[p].push(c);
        // 特別カードの知らせ（ゲーム画面が使う。手札に残すカードは引いた本人にだけ見せる）
        if (!GENERAL.has(c.kind)) s.events.push({ type: 'special', p, kind: c.kind, immediate: false });
      }
    }
  }

  // ---------- ゲームの進行 ----------

  function newGame(n, rng, targets, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts);
    const laneOf = shuffle([0, 1, 2, 3, 4], rng);
    const s = {
      n, rng, targets, laneOf, opts,
      purged: [false, false, false, false, false],
      remaining: laneOf.map(l => opts.lanes[l]),
      done: [false, false, false, false, false], finished: [],
      lastAnimal: -1, streak: 0, lastMove: 0,
      deck: shuffle(buildDeck(opts), rng), discard: [],
      hands: [], limits: [],
      plays: 0,
      events: [],
      stats: { special: {}, actions: {}, reshuffles: 0, moves: [[], [], [], [], []], foxTrick: 0 },
    };
    for (let p = 0; p < n; p++) { s.hands.push([]); s.limits.push(opts.handSize); }
    // dealLater：ゲーム画面はベットが終わってから配る（dealAll）
    if (!opts.dealLater) dealAll(s);
    return s;
  }

  function dealAll(s) {
    for (let p = 0; p < s.n; p++) fillHand(s, p, true);
  }

  function applyAction(s, p, act) {
    const hand = s.hands[p];
    s.stats.actions[act.type] = (s.stats.actions[act.type] || 0) + 1;
    const before = s.remaining.slice();
    applyToBoard(s, act, hand);
    // 特徴を測るための記録：一般カードで実際に進んだ数と、キツネのズルで進んだ数
    if (act.type === 'move' || act.type === 'all') {
      const a = act.type === 'all' ? act.animal : hand[act.i].animal;
      s.stats.moves[a].push(before[a] - s.remaining[a]);
    }
    if (act.type === 'foxSwap' || (act.type === 'move' && hand[act.i].kind === 'foxSame')) {
      s.stats.foxTrick += Math.max(0, before[FOX] - s.remaining[FOX]);
    }

    if (act.type === 'all') {
      s.discard.push(...act.idx.map(i => hand[i]));
      s.hands[p] = hand.filter((_, i) => !act.idx.includes(i));
    } else {
      const card = hand.splice(act.i, 1)[0];
      s.discard.push(card);
      if (act.type === 'swap') {
        [s.hands[p], s.hands[act.q]] = [s.hands[act.q], s.hands[p]];
        [s.limits[p], s.limits[act.q]] = [s.limits[act.q], s.limits[p]];
      } else if (act.type === 'rob') {
        const give = hand.splice(act.k, 1)[0];
        const take = s.hands[act.q].splice(act.j, 1)[0];
        s.hands[act.q].push(give);
        hand.push(take);
      }
    }
    purgeFinished(s, p);
    fillHand(s, p);
  }

  // ゴールした動物のカードを取り除く（dudRule が remove / purge のとき）
  function purgeFinished(s, p) {
    const rule = s.opts.dudRule;
    if (rule !== 'remove' && rule !== 'purge') return;
    const isDead = c => GENERAL.has(c.kind) && s.done[c.animal];
    let changed = false;
    s.done.forEach((d, a) => { if (d && !s.purged[a]) { s.purged[a] = true; changed = true; } });
    if (!changed) return;
    s.deck = s.deck.filter(c => !isDead(c));
    s.discard = s.discard.filter(c => !isDead(c));
    if (rule === 'purge') {
      // 手番の人から時計回りに引き直す
      for (let k = 0; k < s.n; k++) {
        const q = (p + k) % s.n;
        s.hands[q] = s.hands[q].filter(c => !isDead(c));
        fillHand(s, q);
      }
    }
  }

  function playGame(n, rng, targets, opts) {
    const s = newGame(n, rng, targets, opts);
    let p = Math.floor(rng() * n);
    let passes = 0;
    while (s.finished.length < 4 && s.plays < MAX_PLAYS) {
      let act = chooseAction(s, p);
      if (act) {
        applyAction(s, p, act);
        // redraw：ゴールした動物のカードを出したら、もう一度出せる
        for (let extra = 0; s.opts.dudRule === 'redraw' && act && act.type === 'dud' && extra < 10; extra++) {
          act = chooseAction(s, p);
          if (act) applyAction(s, p, act);
        }
        passes = 0;
      } else { fillHand(s, p); passes++; }
      s.plays++;
      // 途中の順位を記録しておく（最後の順位とくらべて、どれだけ入れ替わったかを見る）
      const currentOrder = () => s.finished.concat(unfinished(s).sort((a, b) => s.remaining[a] - s.remaining[b]));
      if (s.plays === s.opts.snapshotAt) s.stats.midOrder = currentOrder();
      // 一斉の追加ベット：1位の動物が残り lateAt マスを越えた時点の順位
      if (s.opts.lateAt != null && !s.stats.lateOrder
        && (s.finished.length > 0 || Math.min(...s.remaining) <= s.opts.lateAt)) {
        s.stats.lateOrder = currentOrder();
        s.stats.latePlays = s.plays;
      }
      if (passes > n * 2) break;
      p = (p + 1) % n;
    }
    const stalled = s.finished.length < 4;
    // 残りの動物は、ゴールまでの残りマスが少ない順に並べる
    unfinished(s).sort((a, b) => s.remaining[a] - s.remaining[b]).forEach(a => s.finished.push(a));
    return { order: s.finished, laneOf: s.laneOf, plays: s.plays, stalled, stats: s.stats };
  }

  global.AnimalRace = {
    ANIMALS, LANES, DEFAULT_OPTS, GENERAL, makeRng, shuffle, buildDeck, utility, chooseAction, newGame, dealAll, applyAction, playGame,
    // ゲーム画面から使うもの
    boardActions, cloneBoard, applyToBoard, unfinished, fillHand, cardSteps,
  };
})(typeof window !== 'undefined' ? window : globalThis);

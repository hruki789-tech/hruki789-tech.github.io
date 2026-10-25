// アニマルレース 払い戻しの計算（シミュレーションとゲームで共通に使う）
// ルールは animal-race-rules.md の「5. ベットと払い戻し」に合わせている
(function (global) {
  'use strict';

  // 券種：picks は選ぶ動物の数
  // 名前は「どうぶつの行列」：ぎょうれつ＝順番どおり、なかよし＝順番は問わない、数字＝何匹
  // （競馬の名前との対応：単勝・複勝・馬連・馬単・ワイド・3連複・3連単・5連単）
  const TYPES = {
    win: { name: 'チャンピオン', picks: 1 },
    place: { name: 'メダル', picks: 1 },
    quinella: { name: 'なかよし2', picks: 2 },
    exacta: { name: 'ぎょうれつ2', picks: 2 },
    wide: { name: '表彰台2', picks: 2 },
    trio: { name: 'なかよし3', picks: 3 },
    trifecta: { name: 'ぎょうれつ3', picks: 3 },
    quintet: { name: 'ぎょうれつ5', picks: 5, initialOnly: true }, // 1〜5位を全部、順番どおり。最初のベットだけ
  };
  const PLACE_RANGE = 2; // 複勝は2位以内

  // 仕様書で決めた数字（シミュレーションで作った倍率表）
  const DEFAULT_BET_OPTS = {
    start: 100,       // 最初のチップ
    minBet: 10,       // 最初のベットの最低枚数
    lateAt: 20,       // 1位の動物が残りこのマスを越えたら、一斉の追加ベット
    lateRate: 0.7,    // 追加ベットで順位が分からないとき（シミュレーション用）の倍率の割合
    // 追加ベットの倍率は「今の順位」で変える：券の動物のうちいちばん前にいるのが 1位／2位／3位以下
    // （1位に乗るだけでは得しない、逆転ねらいは当たれば大きい。シミュレーションで決めた）
    lateRankRates: [0.8, 2.5, 5],
    // 人数による追加ベットの調整（少ない人数ほど自分の思いどおりに動かしやすく、当たりやすいため）
    latePlayerAdjust: { 2: 0.83, 3: 0.98, 4: 1.07, 5: 1.16 },
    lateCapMin: 20,   // 追加ベットの上限は「最初のベットで賭けた枚数」。ただし最低でもこの枚数までは賭けられる
    oddsTable: {      // 人気 0 人, 1 人, 2 人, 3 人以上
      win: [6.1, 3.3, 2.6, 1.9],
      place: [3.1, 2.0, 1.7, 1.3],
      quinella: [8.8, 5.3, 4.4, 3.0],
      exacta: [11, 8.8, 7.7, 5.0],
      wide: [2.5, 2.2, 2.0, 1.5],
      trio: [5.5, 5.0, 4.0, 2.8],
      trifecta: [14.3, 13.2, 13.2, 9.9],
    },
    // 5連単は全部の動物を選ぶので「人気」では決められない。遊ぶ人数で決める（多いほど思いどおりに動かしにくい）
    quintetOdds: { 2: 15, 3: 18, 4: 28, 5: 33 },
  };

  // order：着順（動物の番号の配列）、pick：賭けた動物
  function isHit(type, pick, order) {
    const within = (k, animals) => animals.every(a => order.slice(0, k).includes(a));
    switch (type) {
      case 'win': return order[0] === pick[0];
      case 'place': return within(PLACE_RANGE, pick);
      case 'quinella': return within(2, pick);
      case 'exacta': return order[0] === pick[0] && order[1] === pick[1];
      case 'wide': return within(3, pick);
      case 'trio': return within(3, pick);
      case 'trifecta': return order[0] === pick[0] && order[1] === pick[1] && order[2] === pick[2];
      case 'quintet': return pick.every((a, k) => order[k] === a);
    }
    return false;
  }

  // 人気：その券の動物に、ほかの何人が賭けているか（選んだ動物ごとの人数の平均を四捨五入）
  function popularity(tickets, i) {
    const me = tickets[i];
    const counts = me.pick.map(a => {
      const players = new Set();
      tickets.forEach(t => { if (t.player !== me.player && t.pick.includes(a)) players.add(t.player); });
      return players.size;
    });
    return Math.round(counts.reduce((s, c) => s + c, 0) / counts.length);
  }

  // 追加ベットの券の「今の順位」の区分：券の動物のうちいちばん前にいるのが 1位→0、2位→1、3位以下→2
  //   order：その時点の順位（ゴールした動物が先、そのあと残りマスの少ない順）
  function lateBucket(pick, order) {
    return Math.min(2, Math.min(...pick.map(a => order.indexOf(a))));
  }

  // 胴元が決める倍率：券種と人気で表を引き、追加ベットなら順位の区分の割合をかける
  //   opts.oddsTable[type][人気]：人気 0 人, 1 人, 2 人, 3 人以上 の倍率
  //   ticket.lateBucket があれば opts.lateRankRates[区分]、なければ opts.lateRate をかける
  //   opts.players：遊ぶ人数（ぎょうれつ5の倍率に使う。なければ4人として扱う）
  function oddsFor(ticket, pop, opts) {
    const base = ticket.type === 'quintet'
      ? opts.quintetOdds[opts.players] || opts.quintetOdds[4]
      : opts.oddsTable[ticket.type][Math.min(pop, opts.oddsTable[ticket.type].length - 1)];
    const adjust = (opts.latePlayerAdjust && opts.latePlayerAdjust[opts.players]) || 1;
    const rate = !ticket.late ? 1
      : ticket.lateBucket != null && opts.lateRankRates ? opts.lateRankRates[ticket.lateBucket] * adjust : opts.lateRate;
    // 3.0×0.7=2.0999… のような小数の誤差で切り捨てすぎないよう、先に小数第2位で丸めてから切り捨てる
    const raw = Math.round(base * rate * 100) / 10;
    return Math.max(1, Math.floor(raw) / 10);
  }

  // ゲーム用：まだ倍率が決まっていない券に、公開した時点の人気で倍率を決めて書きこむ
  // （一度公開した倍率は、あとの追加ベットで変わらない）
  function lockOdds(tickets, opts) {
    tickets.forEach((t, i) => {
      if (t.odds == null) t.odds = oddsFor(t, popularity(tickets, i), opts);
    });
  }

  // tickets：[{ player, type, pick, stake, late, odds? }]
  // 当たった券は stake × 倍率（切り捨て）を受け取る。外れた券のチップは胴元のもの
  // 券に odds が書きこまれていればそれを使い、なければ全部の券から人気を数えて決める
  function settle(tickets, order, opts) {
    const pops = tickets.map((_, i) => popularity(tickets, i));
    const odds = tickets.map((t, i) => (t.odds != null ? t.odds : oddsFor(t, pops[i], opts)));
    const payouts = tickets.map((t, i) => (isHit(t.type, t.pick, order) ? Math.floor(t.stake * odds[i]) : 0));
    const bank = tickets.reduce((s, t) => s + t.stake, 0) - payouts.reduce((s, p) => s + p, 0);
    return { pops, odds, payouts, bank };
  }

  global.AnimalBetting = { TYPES, PLACE_RANGE, DEFAULT_BET_OPTS, isHit, popularity, lateBucket, oddsFor, lockOdds, settle };
})(typeof window !== 'undefined' ? window : globalThis);

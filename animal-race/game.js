// アニマルレース ゲーム画面（「ひとりで練習」モード）
// ルールと CPU は engine.js、払い戻しは betting.js をそのまま使う
(function () {
  'use strict';

  const R = window.AnimalRace;
  const B = window.AnimalBetting;
  const BO = B.DEFAULT_BET_OPTS;

  const EMOJI = ['🐢', '🐕', '🐈', '🐆', '🦊'];
  const CHEETAH = 3, FOX = 4; // 動物の番号（engine.js と同じ）
  // イラスト：[ファイル名, 画像の幅, 高さ, 顔の中心x, 顔の中心y, 顔を丸く切り抜くときの拡大率]
  const ART = [
    ['turtle', 747, 670, 580, 212, 3.4],
    ['dog', 730, 587, 530, 140, 3.4],
    ['cat', 712, 568, 535, 125, 3.9],
    ['cheetah', 707, 492, 612, 118, 4.8],
    ['fox', 717, 530, 622, 128, 4.0],
  ];
  const artUrl = a => `img/${ART[a][0]}.webp`;
  // 顔の丸い切り抜き（cls で大きさを変える）
  function faceHTML(a, cls) {
    const [, w, h, cx, cy, k] = ART[a];
    const kv = k * h / w;
    const px = ((cx / w) * k - 0.5) / (k - 1) * 100;
    const py = ((cy / h) * kv - 0.5) / (kv - 1) * 100;
    return `<span class="face-img ${cls || ''}" style="--c:${COLOR[a]};background-image:url(${artUrl(a)});background-size:${k * 100}% auto;background-position:${px.toFixed(1)}% ${py.toFixed(1)}%" aria-label="${R.ANIMALS[a]}"></span>`;
  }
  // 全身のイラスト
  const artHTML = (a, cls) => `<img class="art ${cls || ''}" src="${artUrl(a)}" alt="${R.ANIMALS[a]}" style="--c:${COLOR[a]}">`;
  const COLOR = ['var(--turtle)', 'var(--dog)', 'var(--cat)', 'var(--cheetah)', 'var(--fox)'];
  const LANE_DECO = ['🌼 🌷 🌼 🌷 🌼', '🌿 🍃 🌿 🍃', '🪨 💧 🪨 💧', '🌲 🌳 🌲 🌳', '⛰️ 🪨 ⛰️ 🪨'];
  const MARKS = ['⭐', '🎈', '🎩', '🍀', '💎', '🌙', '🍙', '🎸'];
  const CPU_NAMES = ['ハナ', 'ソラ', 'リク', 'モモ'];
  const STYLES = [
    { name: '堅実', mark: '🛡️', types: ['win', 'place', 'wide'] },
    { name: 'ふつう', mark: '⚖️', types: ['quinella', 'exacta', 'trio'] },
    { name: '大穴', mark: '🎯', types: ['trifecta', 'exacta', 'quintet'] },
  ];
  const SPECIAL = {
    sweep: { name: 'カード一掃', desc: '手札をすべて捨てて、引き直す' },
    limitUp: { name: 'カード増加', desc: '手札の上限が1枚増える' },
    limitDown: { name: 'カード減少', desc: '手札の上限が1枚減る' },
    swap: { name: 'カード交換', desc: 'だれか1人と手札をすべて交換する' },
    rob: { name: 'カード強盗', desc: '全員の手札を見て、1枚と自分の1枚を交換する' },
    god: { name: '神の助け', desc: 'ビリの動物が12マス進む' },
    favor: { name: 'えこひいき', desc: '好きな動物を10マス進める' },
  };
  const TYPE_DESC = {
    win: '1位になる動物（チャンピオン）を当てる',
    place: '2位以内（金か銀のメダル）に入る動物を当てる',
    quinella: '1・2位の2匹を当てる。なかよし＝順番は問わない',
    exacta: '1・2位の2匹を当てる。ぎょうれつ＝順番どおり',
    wide: '表彰台（3位以内）に入る2匹を当てる。順番は問わない',
    trio: '1〜3位の3匹を当てる。なかよし＝順番は問わない',
    trifecta: '1〜3位の3匹を当てる。ぎょうれつ＝順番どおり',
    quintet: '1〜5位の全部を当てる。ぎょうれつ＝順番どおり（最初のベットだけ。倍率は遊ぶ人数で決まる）',
  };
  const ORDERED = new Set(['win', 'place', 'exacta', 'trifecta', 'quintet']);
  const TURN_SEC = 20;
  const BET_SEC = 60;
  const MAX_TICKETS = 3;

  // ---------- 効果音と BGM（音のファイルは使わず、ブラウザの機能で鳴らす） ----------
  // 最初はオフ。右上のボタンで効果音と BGM を別々にオン・オフできる（このブラウザに覚えておく）
  const Sound = (() => {
    const KEY = 'animalrace.sound';
    let ctx = null;
    let master = null;
    let bgmTimer = null;
    let bgmStep = 0;
    let mood = 'day';
    let on = { sfx: false, bgm: false };
    try { on = Object.assign(on, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 保存できない環境ではオフのまま */ }

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.25;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    // 1音を鳴らす：周波数、長さ（秒）、波の形、開始の遅れ（秒）、音量
    function tone(freq, dur, type, delay, vol) {
      if (!ctx) return;
      const t = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    // 高さが変わる1音（ビュン・ドーンなど）
    function sweep(f1, f2, dur, type, delay, vol) {
      if (!ctx) return;
      const t = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(f1, t);
      osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    // ザッという音（シャッター・歓声の代わり）
    function noise(dur, delay, vol) {
      if (!ctx) return;
      const t = ctx.currentTime + (delay || 0);
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = vol || 0.3;
      src.buffer = buf;
      src.connect(g);
      g.connect(master);
      src.start(t);
    }
    const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI の音番号 → 周波数
    const SFX = {
      play: () => { tone(NOTE(72), 0.08, 'triangle'); tone(NOTE(79), 0.1, 'triangle', 0.05); },
      hop: () => { tone(NOTE(76), 0.06, 'square', 0, 0.15); tone(NOTE(83), 0.06, 'square', 0.12, 0.15); },
      bonus: () => [72, 76, 79, 84].forEach((n, i) => tone(NOTE(n), 0.12, 'triangle', i * 0.06)),
      special: () => [84, 88, 91, 96, 91, 96].forEach((n, i) => tone(NOTE(n), 0.18, 'sine', i * 0.07, 0.35)),
      tick: () => tone(NOTE(90), 0.03, 'square', 0, 0.12),
      land: () => { tone(NOTE(67), 0.15, 'triangle'); tone(NOTE(79), 0.25, 'triangle', 0.08); },
      coin: () => { tone(NOTE(88), 0.06, 'square', 0, 0.2); tone(NOTE(95), 0.2, 'square', 0.06, 0.2); },
      warn: () => tone(NOTE(81), 0.08, 'square', 0, 0.25),
      turn: () => { tone(NOTE(79), 0.1, 'triangle', 0, 0.4); tone(NOTE(84), 0.18, 'triangle', 0.1, 0.4); },
      step: () => tone(NOTE(86), 0.03, 'square', 0, 0.08),
      swap: () => [84, 79, 84, 79].forEach((n, i) => tone(NOTE(n), 0.08, 'sine', i * 0.07, 0.3)),
      goal: () => [60, 64, 67, 72, 67, 72].forEach((n, i) => tone(NOTE(n + 12), i === 5 ? 0.5 : 0.14, 'triangle', i * 0.12)),
      fanfare: () => [72, 72, 72, 77, 81, 79, 77, 84].forEach((n, i) => tone(NOTE(n), i === 7 ? 0.7 : 0.16, 'triangle', i * 0.15)),
      whoosh: () => sweep(300, 1400, 0.35, 'sawtooth', 0, 0.12),
      boom: () => { sweep(160, 45, 0.5, 'sine', 0, 0.5); noise(0.25, 0, 0.1); },
      count: () => tone(NOTE(76), 0.15, 'square', 0, 0.25),
      go: () => [79, 84, 88, 91].forEach((n, i) => tone(NOTE(n), i === 3 ? 0.5 : 0.1, 'square', i * 0.05, 0.25)),
      alert: () => [88, 84, 88, 84].forEach((n, i) => tone(NOTE(n), 0.09, 'square', i * 0.09, 0.2)),
      sparkle: () => [96, 100, 103, 108].forEach((n, i) => tone(NOTE(n), 0.15, 'sine', i * 0.05, 0.2)),
      shutter: () => { noise(0.08, 0, 0.25); noise(0.06, 0.12, 0.18); },
      cheer: () => { noise(1.2, 0, 0.08); [72, 76, 79, 84, 88].forEach((n, i) => tone(NOTE(n), 0.3, 'triangle', 0.1 + i * 0.08, 0.3)); },
      heart: () => { tone(NOTE(40), 0.12, 'sine', 0, 0.6); tone(NOTE(40), 0.14, 'sine', 0.18, 0.5); },
      // 動物ごとの声（カメ・イヌ・ネコ・チーター・キツネ）
      voice0: () => { tone(NOTE(55), 0.18, 'triangle', 0, 0.3); tone(NOTE(52), 0.25, 'triangle', 0.2, 0.3); },
      voice1: () => { sweep(500, 700, 0.07, 'square', 0, 0.15); sweep(520, 740, 0.08, 'square', 0.12, 0.15); },
      voice2: () => sweep(900, 1500, 0.22, 'sine', 0, 0.25),
      voice3: () => sweep(400, 1800, 0.18, 'sawtooth', 0, 0.1),
      voice4: () => { sweep(700, 500, 0.15, 'sine', 0, 0.25); sweep(800, 1000, 0.15, 'sine', 0.16, 0.2); },
      coins: () => { for (let i = 0; i < 8; i++) tone(NOTE(90 + (i % 3) * 4), 0.08, 'square', i * 0.07, 0.15); },
    };
    function sfx(name) { if (on.sfx && !G.fast && ensure() && SFX[name]) SFX[name](); }

    // BGM：空の色で雰囲気を変える（昼は明るく速め、夕焼けはおだやか、夜はゆっくり）
    const MOODS = {
      day: { ms: 200, base: 60, melody: [0, 4, 7, 9, 7, 4, 2, 4, 0, 4, 7, 12, 9, 7, 4, 2] },
      dusk: { ms: 240, base: 57, melody: [0, 3, 7, 10, 7, 3, 5, 3, 0, 3, 7, 12, 10, 7, 5, 3] },
      night: { ms: 280, base: 55, melody: [0, 7, 12, 7, 3, 7, 10, 7, 0, 7, 12, 15, 12, 10, 7, 3] },
      // 終盤（1位が残り10マス以内）：速く・高く
      climax: { ms: 150, base: 62, melody: [0, 7, 12, 7, 0, 7, 12, 14, 0, 7, 12, 7, 15, 14, 12, 7] },
    };
    function beat() {
      const m = MOODS[mood];
      const step = bgmStep++ % m.melody.length;
      tone(NOTE(m.base + 12 + m.melody[step]), m.ms / 1000 * 0.9, 'triangle', 0, 0.12);
      if (step % 4 === 0) tone(NOTE(m.base - 12 + (step % 8 === 0 ? 0 : 7)), m.ms / 1000 * 3, 'sine', 0, 0.2);
    }
    function startBgm() {
      stopBgm();
      if (!on.bgm || !ensure()) return;
      bgmTimer = setInterval(beat, MOODS[mood].ms);
    }
    function stopBgm() { if (bgmTimer) clearInterval(bgmTimer); bgmTimer = null; }
    function setMood(m) { if (MOODS[m] && m !== mood) { mood = m; if (bgmTimer) startBgm(); } }

    function render() {
      document.querySelectorAll('.sound-toggle').forEach(b => {
        const k = b.dataset.sound;
        b.textContent = k === 'sfx' ? (on.sfx ? '🔔効果音' : '🔕効果音') : (on.bgm ? '🎵BGM' : '🔇BGM');
        b.classList.toggle('sel', on[k]);
      });
    }
    function toggle(k) {
      on[k] = !on[k];
      try { localStorage.setItem(KEY, JSON.stringify(on)); } catch (e) { /* 覚えられなくても動く */ }
      if (k === 'bgm') { if (on.bgm) startBgm(); else stopBgm(); }
      if (k === 'sfx' && on.sfx) sfx('coin');
      render();
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('.sound-toggle');
      if (b) toggle(b.dataset.sound);
    });
    // ブラウザの決まりで、最初に画面をさわるまで音は鳴らせない。BGM がオンなら最初のタップで始める
    document.addEventListener('pointerdown', function first() {
      document.removeEventListener('pointerdown', first);
      if (on.bgm && !bgmTimer) startBgm();
    });
    return { sfx, setMood, render };
  })();

  const $ = id => document.getElementById(id);
  // 早送り中（通信で読みこみ直したとき）は待たない
  const sleep = ms => new Promise(res => setTimeout(res, G.fast ? 0 : ms));
  const animalLabel = a => `${EMOJI[a]}${R.ANIMALS[a]}`;
  const pickLabel = (type, pick) => pick.map(a => R.ANIMALS[a]).join(ORDERED.has(type) ? '→' : '・');
  // 画面に出す賭けの動物：絵文字だとネコ🐈とチーター🐆が見分けにくいので、動物の色の1文字（カ・イ・ネ・チ・キ）にする
  const SHORT_NAME = ['カ', 'イ', 'ネ', 'チ', 'キ'];
  const animalChip = a => `<span class="ac" style="--c:${COLOR[a]}" title="${R.ANIMALS[a]}">${SHORT_NAME[a]}</span>`;
  const pickChips = (type, pick) => pick.map(animalChip).join(ORDERED.has(type) ? '→' : '');

  // ゲーム全体の状態
  const G = {
    players: [],   // { name, mark, cpu, style, chips }
    races: 1, raceNo: 0,
    s: null,       // engine.js の状態
    tickets: [],   // { player, type, pick, stake, late, odds }
    rng: R.makeRng((Date.now() ^ 0x5eed) >>> 0),
    turn: -1,
    log: [],
    sky: 'day',
    me: 0,         // 自分の番号（練習は0、通信では部屋に入った順番）
    online: null,  // 通信で遊ぶときの部屋の情報 { code, gid }
    fast: false,   // 読みこみ直したあと、今の場面まで演出なしで早送りしている
    onlineNow: {}, // 通信で遊ぶとき、今つながっている人（uid → true/false）
  };
  const setup = { mark: MARKS[0], cpus: 3, races: 1, speed: 1 };

  // ---------- 画面の切りかえ ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === 's-' + id));
  }
  function setSky(name) {
    G.sky = name;
    $('app').className = 'sky-' + name;
    Sound.setMood(name);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const to = b.dataset.go;
    if (to === 'setup') renderSetup();
    if (to === 'howto') renderHowto(0);
    show(to);
  }));

  // ---------- 練習の準備 ----------
  function chipButtons(el, values, current, label, onPick) {
    el.innerHTML = '';
    values.forEach(v => {
      const b = document.createElement('button');
      b.className = 'btn small' + (v === current ? ' sel' : '');
      b.textContent = label(v);
      b.addEventListener('click', () => { onPick(v); });
      el.appendChild(b);
    });
  }
  function renderSetup() {
    chipButtons($('mark-pick'), MARKS, setup.mark, v => v, v => { setup.mark = v; renderSetup(); });
    chipButtons($('cpu-pick'), [1, 2, 3, 4], setup.cpus, v => `${v}人`, v => { setup.cpus = v; renderSetup(); });
    chipButtons($('race-pick'), [1, 2, 3], setup.races, v => `${v}レース`, v => { setup.races = v; renderSetup(); });
    chipButtons($('speed-pick'), [1, 0.5], setup.speed, v => (v === 1 ? 'ふつう' : 'はやい'), v => { setup.speed = v; renderSetup(); });
  }
  $('btn-start').addEventListener('click', () => {
    const name = $('in-name').value.trim() || 'あなた';
    G.players = [{ name, mark: setup.mark, cpu: false, chips: BO.start }];
    // CPU にも、人と重ならない別々のマークをつける（性格は賭けを見る小窓に出す）
    const freeMarks = MARKS.filter(m => m !== setup.mark);
    for (let i = 0; i < setup.cpus; i++) {
      const style = STYLES[Math.floor(G.rng() * STYLES.length)];
      G.players.push({ name: CPU_NAMES[i], mark: freeMarks[i], cpu: true, style, chips: BO.start });
    }
    G.races = setup.races;
    G.speed = setup.speed;
    G.log = [];
    playSeries();
  });
  // 演出の待ち時間（「はやい」なら半分）
  const wait = ms => sleep(ms * (G.speed || 1));

  // ---------- 遊び方 ----------
  // イラストとカードの見本つき。表示するときに作る（カードの絵を使うため）
  function howtoPages() {
    const animalRow = (a, text) => `<div class="howto-row">${faceHTML(a, 'howto-face')}<div><b>${R.ANIMALS[a]}</b>：${text}</div></div>`;
    const sample = (c, badge) => cardHTML(Object.assign({ id: -1 }, c), '', badge);
    return [
      `<h3>動物たち（強さはみんな同じ。動き方がちがう）</h3>
       ${animalRow(0, '遅いけれど、しっかり進む。いつも2マスで、いちばんよく出てくる')}
       ${animalRow(1, '平均的。3〜4マス')}
       ${animalRow(2, '気分屋。「1か8」のように、出すまで何マスか分からない')}
       ${animalRow(3, 'とにかく速い。8〜12マス。でも、めったに来ない')}
       ${animalRow(4, 'ズルい。「前と同じ数進む」と「場所交代」を持っている')}`,
      `<h3>カード</h3>
       <div class="howto-cards">${sample({ kind: 'move', animal: 1, n: 3 })}${sample({ kind: 'move', animal: 1, n: 4 }, 1)}${sample({ kind: 'catDice', animal: 2, lo: 1, hi: 8 })}${sample({ kind: 'foxSame', animal: 4 })}${sample({ kind: 'favor' })}</div>
       <p>自分の番に、手札を1枚えらんで「出す」。その動物が進みます。<br>
       前の人と同じ動物を出すと<b>連続ボーナス</b>（カードの右上の「+1」）。<br>
       手札が<b>全部同じ動物</b>になったら、まとめて出せます（めったにない切り札）。<br>
       金色の<b>特別カード</b>のうち、すぐ発動するもの（一掃・増加・減少）は全員に知らせます。手札に残すもの（交換・強盗・神の助け・えこひいき）は<b>使うまで秘密</b>。だれが持っているかな？（右上の≡で、まだ残っているかを確認できます）</p>`,
      `<h3>賭け方</h3>
       <p class="howto-names">券の名前のルール：<b>チャンピオン</b>＝1位／<b>メダル</b>＝2位まで／<b>表彰台</b>＝3位まで／
       <b>なかよし</b>＝順番は問わない／<b>ぎょうれつ</b>＝順番どおり／数字＝何匹（例：ぎょうれつ3＝1〜3位を順番どおり）</p>
       <p>レーンを見てから、全員一斉に賭けます（券は3枚まで、最低10枚）。<br>
       ほかの人も賭けている動物ほど、<b>倍率が低く</b>なります。<br>
       1位の動物が残り20マスを越えると、空が夕焼けになって<b>一斉の追加ベット</b>（券1枚。賭けられるのは最初に賭けた枚数まで、少なくても20枚まで）。<br>
       追加ベットの倍率は<b>今の順位</b>で変わります：1位を含む券は低く（4人で×0.9くらい）、2位からは×2.5くらい、3位以下だけなら×5くらい。逆転をねらうと大きい！（人数で少し変わります）<br>
       自分の賭けた動物が勝つように、カードで動物を進めましょう！</p>`,
    ];
  }
  let howtoPage = 0;
  function renderHowto(p) {
    const pages = howtoPages();
    howtoPage = Math.max(0, Math.min(pages.length - 1, p));
    $('howto-page').innerHTML = pages[howtoPage] + `<p class="howto-page-no">${howtoPage + 1} / ${pages.length}</p>`;
  }
  $('howto-prev').addEventListener('click', () => renderHowto(howtoPage - 1));
  $('howto-next').addEventListener('click', () => renderHowto(howtoPage + 1));

  // ---------- 小窓・演出 ----------
  function openModal(html, cls) {
    $('modal-box').className = 'modal-box' + (cls ? ' ' + cls : '');
    $('modal-box').innerHTML = html;
    $('modal').classList.remove('hidden');
    return $('modal-box');
  }
  function closeModal() { $('modal').classList.add('hidden'); }
  // メニュー用の別の窓（ゲームの小窓の上に重なり、演出では閉じない）
  function openLayer(html, cls) {
    $('menu-box').className = 'modal-box' + (cls ? ' ' + cls : '');
    $('menu-box').innerHTML = html;
    $('menu').classList.remove('hidden');
    return $('menu-box');
  }
  function closeLayer() { $('menu').classList.add('hidden'); }

  // 実況。hint=true のもの（カードを選んだときの予告など）は記録に残さない
  function ticker(text, hint) {
    $('ticker').innerHTML = `<span class="msg">${text}</span>`;
    if (hint) return;
    G.log.push(text);
    if (G.log.length > 50) G.log.shift();
  }
  // メニュー：できごとの記録と、特別カードの残り・役割をタブで切りかえる
  const SPECIAL_TOTAL = { sweep: 2, limitUp: 1, limitDown: 1, swap: 1, rob: 1, god: 1, favor: 1 };
  function specialStatusHTML() {
    const s = G.s;
    // 手札に残すカードは、だれが持っているか分からないように「だれかの手札か山札」とだけ出す（自分の分は分かる）
    const count = (cards, kind) => cards.filter(c => c.kind === kind).length;
    const rows = Object.keys(SPECIAL_TOTAL).map(kind => {
      const immediate = ['sweep', 'limitUp', 'limitDown'].includes(kind);
      const inDeck = s ? count(s.deck, kind) : SPECIAL_TOTAL[kind];
      const mine = s ? count(s.hands[G.me], kind) : 0;
      const others = s ? G.players.reduce((sum, _, p) => sum + (p === G.me ? 0 : count(s.hands[p], kind)), 0) : 0;
      const used = SPECIAL_TOTAL[kind] - inDeck - mine - others;
      const state = [
        mine ? 'あなたが持っている' : '',
        immediate ? (inDeck ? `山札に${inDeck}枚` : '') : (inDeck + others ? `だれかの手札か山札に${inDeck + others}枚` : ''),
        used > 0 ? `使用ずみ${used}枚` : '',
      ].filter(Boolean).join(' / ');
      const timing = immediate ? '引いたらすぐ発動（全員に知らせる）' : '手札に残して好きなときに使う（使うまで秘密）';
      return `<tr class="${inDeck + others + mine ? '' : 'gone'}"><td>✨${SPECIAL[kind].name}</td><td>${SPECIAL[kind].desc}<br><small>${timing}</small></td><td>${state}</td></tr>`;
    }).join('');
    return `<table class="menu-table"><tr><th>カード</th><th>役割</th><th>今どこにある？</th></tr>${rows}</table>`;
  }
  function openMenu(tab) {
    const logItems = G.log.slice(-5).reverse().map(t => `<li>${t}</li>`).join('') || '<li>まだありません</li>';
    const tabs = [['log', 'できごと'], ['special', '特別カード'], ['sound', '音'], ['quit', 'やめる']];
    const body = tab === 'log' ? `<ol class="log-list">${logItems}</ol>`
      : tab === 'special' ? specialStatusHTML()
      : tab === 'sound' ? `<p>押すとオン・オフが切りかわります。</p><div class="row"><button class="btn sound-toggle" data-sound="sfx"></button><button class="btn sound-toggle" data-sound="bgm"></button></div>`
      : `<p>ゲームをやめて、タイトルに戻りますか？<br>今のチップと賭けは残りません。</p><div class="row"><button class="btn primary" data-quit>やめてタイトルへ</button></div>`;
    const myTurn = G.turn === G.me && !$('hand').classList.contains('waiting');
    const box = openLayer(`
      <div class="tabs">${tabs.map(([k, label]) => `<button class="btn small${tab === k ? ' sel' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>
      ${myTurn ? '<p class="menu-warn">⏱ メニューを開いている間も、あなたの番の時間は進みます</p>' : ''}
      <div class="menu-body">${body}</div>
      <button class="btn" data-close>閉じる</button>`, 'menu-modal');
    box.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => openMenu(b.dataset.tab)));
    box.querySelector('[data-close]').addEventListener('click', closeLayer);
    Sound.render();
    const quit = box.querySelector('[data-quit]');
    // 進行中のレースを確実に止めるため、ページを読み直してタイトルから始める
    if (quit) quit.addEventListener('click', () => (G.online ? leaveRoom() : location.reload()));
  }
  $('btn-log').addEventListener('click', () => openMenu('log'));

  // 券を1行で：「チャンピオン 🐆 50枚 ×2.6」
  const ticketText = t => `${t.late ? '追加・' : ''}${B.TYPES[t.type].name} ${pickLabel(t.type, t.pick)} ${t.stake}枚${t.odds != null ? ` ×${t.odds}` : ''}`;
  // 手札の横の狭い場所用に短く：「王[チ]50×2.6」（[チ]はチーターの色の1文字）
  const TYPE_SHORT = { win: '王', place: 'メ', quinella: 'な2', exacta: 'ぎ2', wide: '台2', trio: 'な3', trifecta: 'ぎ3', quintet: 'ぎ5' };
  const ticketShort = t => `${t.late ? '追' : ''}${TYPE_SHORT[t.type]}${pickChips(t.type, t.pick)}${t.stake}${t.odds != null ? `×${t.odds}` : ''}`;

  // 自分の賭けを、手札と「出す」のあいだに表示する（切れずに全部読めるよう短く書く）
  function renderMyBets() {
    const mine = G.tickets.filter(t => t.player === G.me);
    // 当たりそうメーター：見込みの高さで色が変わり、大きく変わったら跳ねる
    const ch = hitChance();
    let meter = '';
    if (ch != null) {
      const pct = Math.round(ch * 100);
      const lv = pct >= 70 ? 3 : pct >= 40 ? 2 : pct >= 15 ? 1 : 0;
      const jump = G.lastChance != null && Math.abs(pct - G.lastChance) >= 15;
      G.lastChance = pct;
      meter = `<span class="meter lv${lv}${jump ? ' jump' : ''}" title="自分の券のどれかが当たりそうな見込み（ざっくり）">🎯${pct}%</span>`;
    }
    $('my-bets').innerHTML = `<div class="my-bets-title">あなたの賭け${meter}</div>`
      + (mine.length ? mine.map(t => `<div class="my-bet" title="${ticketText(t)}">${ticketShort(t)}</div>`).join('') : '<div class="my-bet">なし</div>');
  }

  // 相手のアイコンを押すと、その人の賭けを見られる
  function showPlayerBets(p) {
    const pl = G.players[p];
    const list = G.tickets.filter(t => t.player === p);
    const box = openLayer(`<h3>${pl.mark}${pl.name}の賭け</h3>
      ${list.length ? `<ul class="log-list">${list.map(t => `<li>${ticketText(t)}</li>`).join('')}</ul>` : '<p>賭けていません</p>'}
      <p><small>手札 🃏${G.s ? G.s.hands[p].length : 0}枚 ／ チップ 💰${pl.chips}${pl.cpu ? ` ／ 性格：${pl.style.mark}${pl.style.name}` : ''}</small></p>
      <button class="btn">閉じる</button>`);
    box.querySelector('button').addEventListener('click', closeLayer);
  }
  $('players-bar').addEventListener('click', e => {
    const el = e.target.closest('[data-player]');
    if (el) showPlayerBets(+el.dataset.player);
  });

  function popText(text, x, y, cls) {
    const el = document.createElement('div');
    el.className = 'pop-text' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  function turnBanner() {
    const el = document.createElement('div');
    el.className = 'turn-banner';
    el.textContent = 'あなたの番！';
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
  function bigText(text) {
    const el = document.createElement('div');
    el.className = 'big-text';
    el.textContent = text;
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }
  function confetti() {
    const colors = ['#1f7a4d', '#b97a3e', '#e0218a', '#f26b00', '#7b3fbf', '#f5b700'];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = (Math.random() * 100) + 'vw';
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
      el.style.animationDelay = (Math.random() * 0.4) + 's';
      $('fx').appendChild(el);
      setTimeout(() => el.remove(), 3400);
    }
  }

  // ---------- 派手な演出（実況・揺れ・光・花火・コイン） ----------
  // 揺れと光はひかえめ。「動きを減らす」設定のときは出さない。「はやい」では時間が半分
  const calm = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fxMs = ms => ms * (G.speed || 1);
  function fxEl(cls, html, ms, vars) {
    const el = document.createElement('div');
    el.className = cls;
    if (html != null) el.innerHTML = html;
    Object.keys(vars || {}).forEach(k => el.style.setProperty(k, vars[k]));
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }
  // 画面を小さく揺らす（strong でも少しだけ大きい程度）
  function shake(strong) {
    if (calm()) return;
    const el = document.querySelector('.screen.active') || $('app');
    el.classList.remove('shake', 'shake-strong');
    void el.offsetWidth;
    el.classList.add(strong ? 'shake-strong' : 'shake');
    setTimeout(() => el.classList.remove('shake', 'shake-strong'), 600);
  }
  // 画面全体がふわっと光る
  function flash(color) {
    if (calm()) return;
    fxEl('flash', null, 700, { '--fc': color || '#fff' });
  }
  // 1点から火花が飛び散る
  function burst(x, y, colors, n) {
    colors = colors || ['#ffd23f', '#ff9f1c', '#fff'];
    for (let i = 0; i < (n || 16); i++) {
      const ang = (i / (n || 16)) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 40 + Math.random() * 50;
      fxEl('spark', null, 900, {
        left: x + 'px', top: y + 'px', background: colors[i % colors.length],
        '--dx': `${Math.cos(ang) * dist}px`, '--dy': `${Math.sin(ang) * dist}px`,
      });
    }
  }
  // 花火：画面の上半分のあちこちで火花
  function fireworks(count) {
    const w = $('app').clientWidth;
    const h = $('app').clientHeight;
    const palettes = [['#ff5d8f', '#ffd23f', '#fff'], ['#6ec6ff', '#b388ff', '#fff'], ['#7bd389', '#ffd23f', '#fff'], ['#ff9f1c', '#ff5d5d', '#fff']];
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        burst(w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.35), palettes[i % palettes.length], 22);
        Sound.sfx('boom');
      }, i * 380);
    }
  }
  // テレビの実況のような帯が横切る。kind：hot（赤）・gold（金）・cool（青）
  function callout(text, kind) {
    fxEl(`callout ${kind || 'hot'}`, `<span>${text}</span>`, fxMs(1600) + 200, { '--dur': `${fxMs(1600)}ms` });
  }
  // 特別カードのカットイン：だれが・何を使ったかを大きく
  async function cutin(title, sub, a) {
    Sound.sfx('whoosh');
    flash('#fff3b0');
    fxEl('cutin', `<div class="cutin-band">${a != null ? faceHTML(a, 'cut-face') : '<span class="cut-icon">✨</span>'}<div><b>${title}</b><small>${sub}</small></div></div>`,
      fxMs(1300) + 100, { '--dur': `${fxMs(1300)}ms` });
    await sleep(fxMs(950));
  }
  // 大きく進んだレーンにスピード線
  function speedLines(a) {
    const row = laneEls[G.s.laneOf[a]].row;
    const el = document.createElement('div');
    el.className = 'speedlines';
    row.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
  // コインが降る（大当たり）
  function coinRain(n) {
    for (let i = 0; i < n; i++) {
      fxEl('coin-drop', '🪙', 3200, {
        left: (Math.random() * 96) + '%',
        'animation-duration': (1.3 + Math.random() * 1.2) + 's',
        'animation-delay': (Math.random() * 0.8) + 's',
      });
    }
  }
  // 数字がカウントアップする
  function countUp(el, from, to, ms) {
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // スタートの合図：3・2・1・スタート！
  async function countdown() {
    for (const t of ['3', '2', '1']) {
      fxEl('count', t, fxMs(700));
      Sound.sfx('count');
      await sleep(fxMs(600));
    }
    fxEl('count go', 'スタート！', fxMs(1000));
    Sound.sfx('go');
    flash('#fff');
    await sleep(fxMs(700));
  }
  // 先頭の動物（同じマスで並んでいたら null）
  function leaderOf(remaining) {
    const live = R.unfinished(G.s);
    if (!live.length) return null;
    const best = Math.min(...live.map(a => remaining[a]));
    const top = live.filter(a => remaining[a] === best);
    return top.length === 1 ? top[0] : null;
  }

  // 当たりそうメーター：残りマスから、自分の券のどれかが当たる見込みをざっくり出す
  //   動物をランダムに1匹選んで1〜8マス進めるのを、全部ゴールするまでくり返す × 600回（スマホでも一瞬で終わる回数）
  //   ゲームの乱数（G.rng）は使わない（レースの進み方を変えないため）
  let chanceCache = { key: '', value: null };
  function hitChance() {
    const s = G.s;
    const mine = G.tickets.filter(t => t.player === G.me);
    if (!s || !mine.length || s.finished.length >= 4) return null;
    const key = `${s.plays}|${s.remaining.join(',')}|${mine.length}`;
    if (chanceCache.key === key) return chanceCache.value;
    const N = 600;
    let hits = 0;
    for (let k = 0; k < N; k++) {
      const rem = s.remaining.slice();
      const order = s.finished.slice();
      let live = R.unfinished(s);
      while (live.length > 1) {
        const a = live[Math.floor(Math.random() * live.length)];
        rem[a] -= 1 + Math.floor(Math.random() * 8);
        if (rem[a] <= 0) { order.push(a); live = live.filter(b => b !== a); }
      }
      order.push(...live);
      if (mine.some(t => B.isHit(t.type, t.pick, order))) hits++;
    }
    chanceCache = { key, value: hits / N };
    return chanceCache.value;
  }

  // 動物のセリフ（コマの上にふきだし）
  const LINES = {
    go: [['コツコツ…', '一歩ずつ！'], ['ワンッ！', 'まだ走れる！'], ['にゃっ！', '気分がいいにゃ'], ['ビュン！', 'ついてこれる？'], ['ふふふ', 'おさきに〜']],
    lead: [['カメだってやれる！'], ['トップだワン！'], ['先頭はいただきにゃ'], ['ぶっちぎるぜ'], ['計算どおり…']],
    passed: [['まだまだ…'], ['くぅ〜ん'], ['ふにゃ…'], ['油断した！'], ['ちぇっ']],
    goal: [['コツコツの勝ち！'], ['やったワン！'], ['当然にゃ'], ['これが本気だ'], ['ふふ、作戦どおり']],
  };
  const pickLine = (kind, a) => LINES[kind][a][Math.floor(Math.random() * LINES[kind][a].length)];
  function say(a, kind) {
    const [x, y] = tokenPoint(a);
    fxEl('say', pickLine(kind, a), fxMs(1700) + 100, { left: x + 'px', top: y + 'px', '--c': COLOR[a], '--dur': `${fxMs(1700)}ms` });
    Sound.sfx('voice' + a);
  }
  // 動物ごとの足あと：カメは👣、イヌ・ネコは🐾、チーターは砂ぼこり、キツネは落ち葉
  const TRAIL = ['👣', '🐾', '🐾', '💨', '🍂'];
  function trail(a) {
    const [x, y] = tokenPoint(a);
    const h = laneEls[G.s.laneOf[a]].token.offsetHeight;
    for (let k = 1; k <= 3; k++) {
      fxEl('trail', TRAIL[a], 1300, { left: (x - h * 0.4 - k * h * 0.45) + 'px', top: (y + h * 0.5) + 'px', 'animation-delay': `${k * 90}ms` });
    }
  }

  // 制限時間：残り秒数を表示し、残り5秒で知らせる。止める関数を返す
  function startTimer(el, sec, onTimeout) {
    let left = sec;
    el.textContent = `⏱${left}`;
    el.classList.remove('warn');
    const id = setInterval(() => {
      left--;
      el.textContent = `⏱${Math.max(0, left)}`;
      el.classList.toggle('warn', left <= 5);
      if (left <= 5 && left > 0) Sound.sfx('warn');
      if (left <= 0) { clearInterval(id); onTimeout(); }
    }, 1000);
    return () => { clearInterval(id); el.textContent = ''; el.classList.remove('warn'); };
  }

  // ---------- レーン ----------
  const laneEls = [];
  function buildLanes() {
    const box = $('lanes');
    box.innerHTML = '';
    laneEls.length = 0;
    R.LANES.forEach((lane, l) => {
      const row = document.createElement('div');
      row.className = 'lane';
      row.dataset.lane = l;
      row.innerHTML = `
        <div class="lane-name">${lane.name}<small>${lane.len}</small></div>
        <div class="track" style="--len:${lane.len}">
          <div class="deco">${LANE_DECO[l]}</div>
          <div class="lane-bettors"></div>
          <div class="token hidden"><span class="remain"></span><span class="face"></span></div>
          <div class="token preview hidden"><span class="face"></span></div>
        </div>
        <div class="goal">🏁</div>
        <div class="lights"><span>🏮</span><span>🏮</span><span>🏮</span></div>`;
      box.appendChild(row);
      laneEls.push({
        row,
        bettors: row.querySelector('.lane-bettors'),
        token: row.querySelector('.token:not(.preview)'),
        ghost: row.querySelector('.token.preview'),
      });
    });
    fitTokens();
  }
  // コマの大きさをレーンの高さに合わせる（低い画面でもレーンからはみ出さない）
  function fitTokens() {
    if (!laneEls.length) return;
    const h = laneEls[0].row.clientHeight;
    if (h) $('lanes').style.setProperty('--tok', `${Math.max(16, Math.min(36, h - 8))}px`);
  }
  window.addEventListener('resize', fitTokens);
  const tokenLeft = frac => `calc(${frac} * (100% - 1.8em) + 0.9em)`;
  // 1マスずつ進むのにかける時間（長くても1.4秒。「はやい」なら半分）
  // 1着が決まる手番だけ G.slowmo（3倍ゆっくり）
  const stepSeconds = squares => Math.min(1.4, 0.11 * squares) * (G.speed || 1) * (G.slowmo || 1);

  // moved[a] が分かっているときは、その動物を1マスずつ進める（すごろくらしく、コマが刻んで動く）
  function updateLanes(hopAnimals, moved) {
    const s = G.s;
    fitTokens();
    R.LANES.forEach((lane, l) => {
      const a = s.laneOf.indexOf(l);
      const el = laneEls[l];
      const tok = el.token;
      tok.style.setProperty('--c', COLOR[a]);
      const face = tok.querySelector('.face');
      if (face.dataset.animal !== String(a)) { face.dataset.animal = a; face.innerHTML = faceHTML(a, 'tok'); }
      const rem = s.remaining[a];
      tok.querySelector('.remain').textContent = s.done[a] ? '' : `残り${rem}`;
      const squares = moved ? Math.abs(moved[a]) : 0;
      tok.style.transition = squares ? `left ${stepSeconds(squares)}s steps(${squares}, end)` : '';
      tok.style.left = tokenLeft((lane.len - rem) / lane.len);
      tok.classList.toggle('hop', !!(hopAnimals && hopAnimals.includes(a)));
      // ゴール目前（残り5マス以内）はゴールのまわりが赤く光る
      el.row.classList.toggle('spurt', !s.done[a] && rem <= 5);
      // 賭けた人のマーク
      const marks = [];
      G.players.forEach((pl, p) => {
        if (G.tickets.some(t => t.player === p && t.pick.includes(a))) marks.push(pl.mark);
      });
      el.bettors.textContent = marks.join('');
      // 着順バッジ
      let badge = el.row.querySelector('.place-badge');
      const place = s.finished.indexOf(a);
      if (place >= 0 && !badge) {
        badge = document.createElement('div');
        badge.className = 'place-badge';
        el.row.appendChild(badge);
      }
      if (badge) badge.textContent = `${place + 1}着`;
    });
  }
  function showGhost(a, frac) {
    laneEls.forEach(el => el.ghost.classList.add('hidden'));
    if (a == null) return;
    const el = laneEls[G.s.laneOf[a]];
    el.ghost.classList.remove('hidden');
    el.ghost.querySelector('.face').innerHTML = faceHTML(a, 'tok');
    el.ghost.style.left = tokenLeft(frac);
  }
  function tokenPoint(a) {
    const r = laneEls[G.s.laneOf[a]].token.getBoundingClientRect();
    const app = $('app').getBoundingClientRect();
    return [r.left - app.left + r.width / 2, r.top - app.top];
  }

  // ---------- 上の情報 ----------
  function renderTop() {
    const s = G.s;
    $('race-no').textContent = `${G.raceNo}／${G.races}レース目`;
    const pl = G.players[G.turn];
    $('turn-info').textContent = pl ? (G.turn === G.me ? 'あなたの番' : `${pl.mark}${pl.name}の番`) : '';
    $('streak-info').textContent = s && s.lastAnimal >= 0 && s.streak > 0 ? `連続：${EMOJI[s.lastAnimal]}×${s.streak}` : '連続：なし';
    // 人数が多いと入りきらないので、4人以上はマークだけにする（名前は実況と記録に出る）
    const short = G.players.length >= 4;
    $('players-bar').innerHTML = G.players.map((p, i) =>
      `<button class="pl${i === G.turn ? ' now' : ''}" data-player="${i}" title="${p.name}の賭けを見る">${G.online && !G.onlineNow[p.uid] ? '📴' : ''}${p.mark}${short ? '' : p.name} 🃏${s ? s.hands[i].length : 0} 💰${p.chips}</button>`).join('');
    renderMyBets();
  }

  // ---------- 手札 ----------
  // 表示の順番：カメ → イヌ → ネコ → チーター → キツネ → 特別カード
  function sortedHand(hand) {
    const key = c => (R.GENERAL.has(c.kind) ? c.animal * 100 + (c.n || c.lo || (c.kind === 'foxSame' ? 50 : 60)) : 1000);
    return hand.map((card, i) => ({ card, i })).sort((x, y) => key(x.card) - key(y.card));
  }
  // now：キツネの「前と同じ数」を今出したら何マスか
  function cardHTML(c, extraClass, badge, now) {
    if (!R.GENERAL.has(c.kind)) {
      return `<div class="card special ${extraClass || ''}"><span class="icon">✨</span><span class="num">${SPECIAL[c.kind].name}</span></div>`;
    }
    let num = '';
    if (c.kind === 'move') num = `<span class="num">${c.n}</span>`;
    else if (c.kind === 'catDice') num = `<span class="num small">${c.lo}か${c.hi}</span>`;
    else if (c.kind === 'foxSame') num = `<span class="num small">前と同じ数${now != null ? `<br><b class="now">今なら${now}</b>` : ''}</span>`;
    else if (c.kind === 'foxSwap') num = '<span class="num small">場所<br>交代</span>';
    return `<div class="card ${extraClass || ''}" style="--c:${COLOR[c.animal]}">${badge ? `<span class="badge">+${badge}</span>` : ''}${faceHTML(c.animal, 'card-face')}${num}</div>`;
  }
  function bonusFor(c) {
    const s = G.s;
    return R.GENERAL.has(c.kind) && c.animal === s.lastAnimal && s.streak > 0 ? s.streak : 0;
  }
  function renderHand(p, selectable, selected, onPick) {
    const hand = G.s.hands[p];
    const box = $('hand');
    box.classList.toggle('waiting', !selectable);
    box.innerHTML = '';
    sortedHand(hand).forEach(({ card, i }) => {
      const wrap = document.createElement('div');
      const now = card.kind === 'foxSame' ? G.s.lastMove + bonusFor(card) : null;
      // 場所交代は進まないので「+1」は出さない（連続の回数は数える）
      const badge = card.kind === 'foxSwap' ? 0 : bonusFor(card);
      wrap.innerHTML = cardHTML(card, i === selected ? 'sel' : '', badge, now);
      const el = wrap.firstElementChild;
      if (selectable) el.addEventListener('click', () => onPick(i));
      box.appendChild(el);
    });
  }

  // ---------- 自分の番 ----------
  function humanTurn(p) {
    return new Promise(resolve => {
      const s = G.s;
      let selected = null;
      let done = false;
      // 出せるカードが1枚もない（例：渡すカードのない強盗だけ）なら、待たずにパス
      if (!randomAction(p)) {
        ticker('出せるカードがないのでパス');
        resolve(null);
        return;
      }
      const finish = act => {
        if (done) return;
        done = true;
        stopTimer();
        closeModal();
        showGhost(null);
        $('btn-play').disabled = true;
        $('btn-bulk').classList.add('hidden');
        document.querySelector('.hand-area').classList.remove('my-turn');
        renderHand(p, false);
        resolve(act);
      };
      // 自分の番になったことを、文字・音・手札の光で知らせる
      document.querySelector('.hand-area').classList.add('my-turn');
      turnBanner();
      Sound.sfx('turn');
      const stopTimer = startTimer($('timer'), TURN_SEC, () => {
        ticker('時間切れ！カードをランダムに出します');
        finish(randomAction(p));
      });

      const acts = R.boardActions(s, s.hands[p], s.opts);
      const bulk = acts.find(a => a.type === 'all');
      $('btn-bulk').classList.toggle('hidden', !bulk);
      $('btn-bulk').onclick = () => finish(bulk);

      const pick = i => {
        selected = i;
        renderHand(p, true, selected, pick);
        $('btn-play').disabled = false;
        previewCard(p, i);
      };
      renderHand(p, true, null, pick);
      $('btn-play').disabled = true;
      $('btn-play').onclick = () => {
        if (selected == null) return;
        chooseTarget(p, selected, finish);
      };
    });
  }

  // 選んだカードで動物がどこまで進むかの予告
  function previewCard(p, i) {
    const s = G.s;
    const c = s.hands[p][i];
    if (c.kind === 'move' || c.kind === 'foxSame') {
      const b = R.cloneBoard(s);
      R.applyToBoard(b, { type: 'move', i }, s.hands[p]);
      const len = R.LANES[s.laneOf[c.animal]].len;
      showGhost(c.animal, (len - b.remaining[c.animal]) / len);
      const amt = s.remaining[c.animal] - b.remaining[c.animal];
      ticker(`${animalLabel(c.animal)}が${amt}マス進みます`, true);
    } else if (c.kind === 'catDice') {
      showGhost(null);
      const bonus = bonusFor(c);
      ticker(`${animalLabel(c.animal)}は${c.lo}か${c.hi}マス${bonus ? `（＋連続${bonus}）` : ''}。出すまで分かりません`, true);
    } else {
      showGhost(null);
      ticker(c.kind === 'foxSwap' ? '🦊キツネと好きな動物の、ゴールまでの残りマスを入れかえます' : `${SPECIAL[c.kind].name}：${SPECIAL[c.kind].desc}`, true);
    }
  }

  // 対象を選ぶカードは小窓で選んでから出す
  function chooseTarget(p, i, finish) {
    const s = G.s;
    const hand = s.hands[p];
    const c = hand[i];
    const options = (title, items) => {
      const box = openModal(`<h3>${title}</h3><div class="opts"></div><button class="btn small" data-cancel>やめる</button>`);
      const opts = box.querySelector('.opts');
      items.forEach(({ label, act, next }) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.innerHTML = label;
        b.addEventListener('click', () => (next ? next() : finish(act)));
        opts.appendChild(b);
      });
      box.querySelector('[data-cancel]').addEventListener('click', closeModal);
    };
    const acts = R.boardActions(s, hand, s.opts).filter(a => a.i === i);

    if (c.kind === 'foxSwap' || c.kind === 'favor' || (c.kind === 'god' && acts.length > 1)) {
      const title = c.kind === 'foxSwap' ? '🦊キツネとどの動物を入れかえる？' : c.kind === 'favor' ? 'どの動物を10マス進める？' : 'ビリが並んでいます。どの動物を進める？';
      options(title, acts.map(a => ({ label: `${animalLabel(a.target)}（残り${s.remaining[a.target]}）`, act: a })));
    } else if (c.kind === 'swap') {
      options('だれと手札を交換する？', G.players.map((pl, q) => ({ pl, q })).filter(x => x.q !== p)
        .map(({ pl, q }) => ({ label: `${pl.mark}${pl.name}（🃏${s.hands[q].length}）`, act: { type: 'swap', i, q } })));
    } else if (c.kind === 'rob') {
      const rest = hand.filter((_, k) => k !== i);
      if (rest.length === 0) { ticker('渡すカードがないので使えません'); return; }
      const items = [];
      G.players.forEach((pl, q) => {
        if (q === p) return;
        s.hands[q].forEach((take, j) => items.push({
          label: `${pl.mark}${pl.name}の ${shortCard(take)}`,
          next: () => options(`${shortCard(take)} のかわりに渡すカードは？`,
            rest.map((give, k) => ({ label: shortCard(give), act: { type: 'rob', i, q, j, k } }))),
        }));
      });
      options('どのカードを取る？（全員の手札が見えます）', items);
    } else {
      finish(acts[0]);
    }
  }
  function shortCard(c) {
    if (!R.GENERAL.has(c.kind)) return `✨${SPECIAL[c.kind].name}`;
    if (c.kind === 'move') return `${EMOJI[c.animal]}${c.n}`;
    if (c.kind === 'catDice') return `${EMOJI[c.animal]}${c.lo}か${c.hi}`;
    return `${EMOJI[c.animal]}${c.kind === 'foxSame' ? '前と同じ数' : '場所交代'}`;
  }

  // 時間切れ：出せるカードの中からまず1枚を同じ確率で選び、次にそのカードの対象をランダムに選ぶ
  // （対象の多いカードばかり選ばれないように）。出せるカードがなければ null
  function randomAction(p) {
    const s = G.s;
    const hand = s.hands[p];
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const byCard = new Map();
    const add = act => { if (!byCard.has(act.i)) byCard.set(act.i, []); byCard.get(act.i).push(act); };
    R.boardActions(s, hand, s.opts).filter(a => a.type !== 'all').forEach(add);
    hand.forEach((c, i) => {
      if (c.kind === 'swap') G.players.forEach((_, q) => { if (q !== p) add({ type: 'swap', i, q }); });
      if (c.kind === 'rob' && hand.length > 1) {
        const others = G.players.map((_, q) => q).filter(q => q !== p && s.hands[q].length);
        if (others.length) {
          const q = pick(others);
          add({ type: 'rob', i, q, j: Math.floor(Math.random() * s.hands[q].length), k: Math.floor(Math.random() * (hand.length - 1)) });
        }
      }
    });
    if (!byCard.size) return null;
    return pick(pick([...byCard.values()]));
  }

  // ---------- カードを出したあとの処理と演出 ----------
  async function performAction(p, act) {
    const s = G.s;
    const pl = G.players[p];
    const who = p === G.me ? 'あなた' : `${pl.mark}${pl.name}`;
    const hand = s.hands[p];
    const card = act.type === 'all' ? null : hand[act.i];
    const before = s.remaining.slice();
    const finishedBefore = s.finished.length;
    const bonus = card && R.GENERAL.has(card.kind) ? bonusFor(card) : 0;
    const swapInfo = act.type === 'rob' ? { take: s.hands[act.q][act.j], give: hand.filter((_, k) => k !== act.i)[act.k] } : null;
    const leadBefore = leaderOf(before);

    // 特別カード・まとめ出しは、カットインで大きく見せてから動かす
    const CUT = { foxSwap: '🦊場所交代', god: '⚡神の助け', favor: '💖えこひいき', swap: '🔄カード交換', rob: '🦹カード強盗', all: '🃏まとめて出し' };
    if (CUT[act.type]) {
      const target = act.type === 'all' ? act.animal : act.target;
      const sub = `${pl.mark}${pl.name}` + (target != null ? ` → ${animalLabel(target)}` : act.q != null ? ` → ${G.players[act.q].mark}${G.players[act.q].name}` : '');
      await cutin(CUT[act.type], sub, act.type === 'foxSwap' ? FOX : target);
    }

    Sound.sfx('play');
    // ネコ：出すまで分からない。先に運を決めてルーレットで見せる
    if (card && card.kind === 'catDice') {
      const roll = G.rng();
      const value = roll < 0.5 ? card.lo : card.hi;
      await catRoulette(card, value);
      const orig = s.rng;
      let first = true;
      s.rng = () => { if (first) { first = false; return roll; } return orig(); };
      R.applyAction(s, p, act);
      s.rng = orig;
    } else {
      R.applyAction(s, p, act);
    }

    const moved = before.map((r, a) => r - s.remaining[a]);
    const movedAnimals = [0, 1, 2, 3, 4].filter(a => moved[a] !== 0);
    // 1着が決まる手番：スロー＋レーンを拡大＋心臓の音（競馬中継のゴール前のように）
    const decisive = finishedBefore === 0 && s.finished.length > 0;
    if (decisive) {
      G.slowmo = 3;
      if (!calm()) $('lanes').classList.add('zoom');
      fxEl('vignette', null, fxMs(4500));
      Sound.sfx('heart');
      setTimeout(() => Sound.sfx('heart'), 700);
    }
    let text;
    switch (act.type) {
      case 'move':
        text = card.kind === 'foxSame'
          ? `${who}：🦊前と同じ数で${moved[card.animal]}マス！`
          : `${who}：${animalLabel(card.animal)}が${moved[card.animal]}マス！`;
        break;
      case 'all': text = `${who}：まとめて出し！${animalLabel(act.animal)}が${moved[act.animal]}マス！`; break;
      case 'foxSwap': text = `${who}：🦊キツネと${animalLabel(act.target)}の場所が入れかわった！`; break;
      case 'god': text = `${who}：神の助け！${animalLabel(act.target)}が12マス！`; break;
      case 'favor': text = `${who}：えこひいき！${animalLabel(act.target)}が10マス！`; break;
      case 'swap': text = `${G.players[p].mark}${G.players[p].name} ⇄ ${G.players[act.q].mark}${G.players[act.q].name}（カード交換）`; break;
      case 'rob': text = `${G.players[p].mark}${G.players[p].name} ⇄ ${G.players[act.q].mark}${G.players[act.q].name}（カード強盗）`; break;
      default: text = `${who}：カードを出した`;
    }
    ticker(text);
    updateLanes(movedAnimals, moved);
    renderTop();
    // 1マス進むごとにカチッと鳴らす（場所交代は入れかわりの音）
    const most = Math.max(0, ...moved.map(Math.abs));
    if (act.type === 'foxSwap') Sound.sfx('swap');
    else if (most) {
      const per = stepSeconds(most) * 1000 / most;
      for (let k = 0; k < Math.min(most, 14); k++) setTimeout(() => Sound.sfx('step'), k * per);
    }
    if (bonus > 0 && card) {
      const [x, y] = tokenPoint(card.animal);
      popText(bonus >= 2 ? `連続+${bonus}🔥` : `連続+${bonus}`, x, y, bonus >= 2 ? 'hot' : '');
      Sound.sfx('bonus');
    }
    // 大きく進んだ（8マス以上）：スピード線、着いたところで火花
    const bigMoves = movedAnimals.filter(a => moved[a] >= 8);
    if (bigMoves.length && act.type !== 'foxSwap') {
      Sound.sfx('whoosh');
      bigMoves.forEach(speedLines);
      shake(false);
      setTimeout(() => bigMoves.forEach(a => { const [x, y] = tokenPoint(a); burst(x, y + 12); }), stepSeconds(most) * 1000);
    }
    // 場所交代：2匹のところで紫の煙
    if (act.type === 'foxSwap') {
      setTimeout(() => [FOX, act.target].forEach(a => { const [x, y] = tokenPoint(a); burst(x, y + 12, ['#7b3fbf', '#b388ff', '#fff'], 14); }), 300);
    }
    if (act.type === 'favor' || act.type === 'god') {
      const [x, y] = tokenPoint(act.target);
      popText(act.type === 'god' ? '+12' : '+10', x, y);
    }
    // 動物ごとの足あとと、セリフ（6マス以上進んだときと、ネコの気分カード）
    const own = act.type === 'all' ? act.animal : card && R.GENERAL.has(card.kind) ? card.animal : null;
    if (own != null && moved[own] > 0) {
      setTimeout(() => {
        trail(own);
        if (moved[own] >= 6 || card && card.kind === 'catDice') say(own, 'go');
      }, stepSeconds(most) * 1000);
    }
    if (own != null && moved[own] >= 10) addHighlight(moved[own], `${who}の一手で${animalLabel(own)}が${moved[own]}マスの大ジャンプ`);
    if (act.type === 'god' || act.type === 'favor') addHighlight(8, `${who}の${SPECIAL[act.type].name}で${animalLabel(act.target)}が${moved[act.target]}マス`);
    // 交換・強盗の本人への知らせ
    if (act.type === 'rob' && act.q === G.me) {
      await notice(`🦹 ${shortCard(swapInfo.take)} を取られて、${shortCard(swapInfo.give)} をもらった`);
    } else if (act.type === 'swap' && act.q === G.me) {
      await notice(`🔄 ${who}と手札がまるごと入れかわった！`);
    }
    await sleep(Math.max(850 * (G.speed || 1), stepSeconds(most) * 1000 + 250));

    // 先頭が入れかわったら、抜いた動物と抜かれた動物がひとこと
    const leadNow = leaderOf(s.remaining);
    if (s.finished.length === finishedBefore && leadNow != null && leadBefore != null && leadNow !== leadBefore) {
      say(leadNow, 'lead');
      if (!s.done[leadBefore]) setTimeout(() => say(leadBefore, 'passed'), fxMs(450));
    }
    // 終盤（1位が残り10マス以内）は BGM が速く・高くなる
    if (!G.drama.climax && s.finished.length === 0 && Math.min(...R.unfinished(s).map(a => s.remaining[a])) <= 10) {
      G.drama.climax = true;
      Sound.setMood('climax');
    }

    // レースの盛り上がりを実況する（ゴールした手番はゴールの演出だけ）
    if (s.finished.length === finishedBefore) {
      const call = dramaCall(act, card, moved, leadBefore);
      if (call) {
        callout(call.text, call.kind);
        Sound.sfx(call.sound || 'alert');
        if (call.flash) flash(call.flash);
        await sleep(fxMs(1000));
      }
    }

    // ゴールした動物
    for (let k = finishedBefore; k < s.finished.length; k++) {
      const a = s.finished[k];
      if (G.sky !== 'night') setSky('night');
      // すぐ後ろ（残り3マス以内）に迫っていたら写真判定
      if (R.unfinished(s).some(b => s.remaining[b] <= 3)) {
        Sound.sfx('shutter');
        fxEl('photo-finish', '📸 写真判定…', fxMs(1300));
        await sleep(fxMs(1300));
        addHighlight(k === 0 ? 16 : 9, `${animalLabel(a)}が写真判定の大接戦を制して${k + 1}着`);
      }
      const first = k === 0;
      confetti();
      Sound.sfx('goal');
      if (first) { flash('#fff3b0'); shake(true); fireworks(4); Sound.sfx('cheer'); }
      setTimeout(() => Sound.sfx('voice' + a), 400);
      openModal(`${artHTML(a, 'art-big')}<h3 class="goal-title stamp">${k + 1}着！${R.ANIMALS[a]}</h3><p class="goal-line">「${pickLine('goal', a)}」</p>`, 'art-modal gold');
      ticker(`${animalLabel(a)}が${k + 1}着でゴール！`);
      updateLanes();
      await wait(first ? 2600 : 1700);
      closeModal();
    }
    if (decisive) {
      G.slowmo = 1;
      $('lanes').classList.remove('zoom');
    }
  }

  // 今日の名場面：あとで結果画面に、いちばん点の高いものを出す
  function addHighlight(score, text) {
    if (G.drama) G.drama.hl.push({ score, text });
  }

  // レースの盛り上がり：いちばん大事な1つだけ実況する（逆転 → 大接戦 → ゴール目前 → 猛ダッシュ）
  function dramaCall(act, card, moved, leadBefore) {
    const s = G.s;
    const st = G.drama;
    const lead = leaderOf(s.remaining);
    const place = s.finished.length + 1;
    // 逆転：先頭が入れかわった（後半・3着争いまで。続けて出すとうるさいので、1手番あける）
    if (lead != null && leadBefore != null && lead !== leadBefore && place <= 3 && s.remaining[lead] <= 25 && s.plays - st.lastRev >= 2) {
      st.lastRev = s.plays;
      if (s.remaining[lead] <= 12) addHighlight(11, `ゴール前で${animalLabel(lead)}が${animalLabel(leadBefore)}を抜いて逆転`);
      return { text: place === 1 ? `🔥逆転！${animalLabel(lead)}がトップ！` : `🔥逆転！${animalLabel(lead)}が${place}着の位置へ！`, kind: 'hot', flash: '#ffd0a0' };
    }
    const order = R.unfinished(s).sort((x, y) => s.remaining[x] - s.remaining[y]);
    // 大接戦：前の2匹がどちらも残り10マス以内で、差が2マス以内（1レースに1回）
    if (!st.close && order.length >= 2 && s.remaining[order[1]] <= 10 && s.remaining[order[1]] - s.remaining[order[0]] <= 2) {
      st.close = true;
      return { text: `⚡大接戦！${EMOJI[order[0]]}と${EMOJI[order[1]]}`, kind: 'cool' };
    }
    // ゴール目前：残り5マス以内に入った（動物ごとに1回）
    const near = order.find(a => s.remaining[a] <= 5 && !st.spurt.has(a));
    if (near != null) {
      st.spurt.add(near);
      return { text: `🏁${animalLabel(near)} ゴール目前！`, kind: 'hot' };
    }
    if (act.type === 'move' && card && card.animal === CHEETAH && moved[CHEETAH] >= 10) {
      return { text: '🐆 猛ダッシュ！', kind: 'gold', sound: 'whoosh' };
    }
    return null;
  }

  function notice(text, ms) {
    openModal(`<h3>${text}</h3>`);
    return sleep(ms || 1600).then(closeModal);
  }
  async function catRoulette(card, value) {
    const box = openModal(`<h3>🐈ネコの気分は…？</h3><div class="roulette">${card.lo}</div>`);
    const el = box.querySelector('.roulette');
    for (let t = 0; t < 10; t++) {
      el.textContent = t % 2 ? card.hi : card.lo;
      Sound.sfx('tick');
      await sleep(70 + t * 12);
    }
    el.textContent = value;
    Sound.sfx('land');
    await sleep(700);
    closeModal();
  }

  // 特別カードを引いたときの知らせ
  //   すぐ発動するカード（一掃・増加・減少）は全員に見せる（手札の枚数が変わるため）
  //   手札に残すカード（交換・強盗・神の助け・えこひいき）は、引いた本人にだけ見せる。
  //   ほかの人は、だれが何を持っているか分からない（使ったときに分かる）
  async function processEvents() {
    const s = G.s;
    while (s.events.length) {
      const e = s.events.shift();
      const pl = G.players[e.p];
      const sp = SPECIAL[e.kind];
      if (!e.immediate && e.p !== G.me) continue;
      const who = e.p === G.me ? 'あなた' : `${pl.mark}${pl.name}`;
      const note = e.immediate ? '（すぐ発動）' : '（手札に残す。ほかの人には見えません）';
      openModal(`<div class="big-card">✨</div><h3>${who}が「${sp.name}」を引いた！</h3><p>${sp.desc}${note}</p>`, 'gold');
      Sound.sfx('special');
      Sound.sfx('sparkle');
      flash('#fff3b0');
      burst($('app').clientWidth / 2, $('app').clientHeight * 0.3, ['#ffd23f', '#fff', '#ff9f1c'], 20);
      if (e.immediate) G.log.push(`${who}が${sp.name}を引いた`);
      renderTop();
      await wait(1500);
      closeModal();
    }
  }

  // ---------- ベット ----------
  // 人のベット。late=true なら一斉の追加ベット（券1枚だけ・賭けなくてもよい）
  function humanBet(late) {
    return new Promise(resolve => {
      const me = G.players[G.me];
      const mine = [];
      const max = late ? 1 : MAX_TICKETS;
      const st = { step: 1, type: null, pick: [], stake: 10 };
      // 追加ベットの上限：最初のベットで賭けた枚数（ただし最低 lateCapMin 枚までは賭けられる）
      const cap = late ? Math.min(me.chips, Math.max(lateCapOf(G.me), BO.lateCapMin)) : me.chips;
      const left = () => cap - mine.reduce((sum, t) => sum + t.stake, 0);
      const minTotal = late ? 0 : Math.min(BO.minBet, me.chips);

      // 低い画面でも1行に入るよう短く（順位で変わる倍率は、下の「今の順位」の×0.8などで見せる）
      $('bet-title').textContent = late ? '🌇 追加ベット（券1枚）' : '🎫 ベット';
      $('btn-bet-skip').classList.toggle('hidden', !late);
      // 追加ベットのときは、今のレースの様子を上に出しておく
      $('s-bet').classList.toggle('late', late);
      $('bet-standings').innerHTML = late ? standingsHTML() : '';
      const s = G.s;
      const animalTag = a => (late
        ? `${s.done[a] ? `${s.finished.indexOf(a) + 1}着` : `残り${s.remaining[a]}`} ×${rankRate(a)}`
        : `${R.LANES[s.laneOf[a]].name}${R.LANES[s.laneOf[a]].len}`);
      let stopTimer = startTimer($('bet-timer'), BET_SEC, () => {
        $('bet-timer').textContent = '時間切れ（待っています）';
      });
      const end = list => { stopTimer(); resolve(list); };

      function render() {
        $('bet-chips').textContent = late ? `💰あと${left()}／上限${cap}` : `💰${left()}`;
        $('bet-steps').innerHTML = ['①券種', '②動物', '③枚数'].map((t, k) => `<span class="${st.step === k + 1 ? 'on' : ''}">${t}</span>`).join('');
        $('bet-tickets').innerHTML = mine.length
          ? mine.map((t, k) => `<span class="ticket">${B.TYPES[t.type].name} ${pickChips(t.type, t.pick)} ${t.stake}枚<button data-del="${k}">✕</button></span>`).join('')
          : '買った券：なし';
        $('bet-tickets').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { mine.splice(+b.dataset.del, 1); render(); }));
        const total = mine.reduce((sum, t) => sum + t.stake, 0);
        $('btn-bet-done').disabled = late ? mine.length === 0 : total < minTotal;
        const body = $('bet-body');
        if (left() <= 0 || mine.length >= max) {
          body.innerHTML = `<p class="explain">${mine.length >= max ? `券は${max}枚までです。` : 'チップがありません。'}「賭け終わる」を押してください。</p>`;
          return;
        }
        if (st.step === 1) {
          // 券種ごとに「倍率のめやす」（だれも賭けていない〜みんなが賭けている）を出す
          body.innerHTML = `<div class="opts type-opts">${Object.keys(B.TYPES).filter(k => !(late && B.TYPES[k].initialOnly)).map(k => {
            const [lo, hi] = oddsRange(k, late);
            return `<button class="btn type-btn${st.type === k ? ' sel' : ''}" data-type="${k}">${B.TYPES[k].name}<small>${range(lo, hi, '倍')}</small></button>`;
          }).join('')}</div>
            <p class="explain">${st.type ? `${B.TYPES[st.type].name}：${TYPE_DESC[st.type]}${st.type === 'quintet' ? '' : '（倍率は、ほかの人も同じ動物に賭けるほど低くなります）'}` : '券種を選んでください。下の数字は倍率のめやすです'}</p>
            <div class="nav"><span></span><button class="btn primary" data-next ${st.type ? '' : 'disabled'}>次へ ▶</button></div>`;
          body.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { st.type = b.dataset.type; st.pick = []; render(); }));
          body.querySelector('[data-next]').addEventListener('click', () => { st.step = 2; render(); });
        } else if (st.step === 2) {
          const need = B.TYPES[st.type].picks;
          const ordered = ORDERED.has(st.type) && need > 1;
          body.innerHTML = `<p class="explain">${B.TYPES[st.type].name}：${need}匹選んでください${ordered ? '（選んだ順が着順）' : ''}</p>
            <div class="opts animal-opts">${[0, 1, 2, 3, 4].map(a => `<button class="animal-btn${st.pick.includes(a) ? ' sel' : ''}" data-a="${a}" style="--c:${COLOR[a]}">${artHTML(a)}<span class="lane-tag">${R.ANIMALS[a]}・${animalTag(a)}</span>${st.pick.includes(a) && st.pick.length > 1 && ORDERED.has(st.type) ? `<span class="order-tag">${st.pick.indexOf(a) + 1}着</span>` : ''}</button>`).join('')}</div>
            <p class="picked">選んだ：${st.pick.length ? pickChips(st.type, st.pick) : 'なし'}</p>
            <div class="nav"><button class="btn" data-back>◀ もどる</button><button class="btn primary" data-next ${st.pick.length === need ? '' : 'disabled'}>次へ ▶</button></div>`;
          body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
            const a = +b.dataset.a;
            if (st.pick.includes(a)) st.pick = st.pick.filter(x => x !== a);
            else if (st.pick.length < need) st.pick.push(a);
            render();
          }));
          body.querySelector('[data-back]').addEventListener('click', () => { st.step = 1; render(); });
          body.querySelector('[data-next]').addEventListener('click', () => { st.step = 3; st.stake = Math.min(left(), 10); render(); });
        } else {
          const cap = left();
          st.stake = Math.max(1, Math.min(st.stake, cap));
          const [lo, hi] = oddsRange(st.type, late, late ? B.lateBucket(st.pick, orderNow()) : null);
          body.innerHTML = `<p class="explain">${B.TYPES[st.type].name} ${pickChips(st.type, st.pick)} に何枚賭ける？（倍率は全員が賭け終わったあとに決まります）<br>
            <b class="win-guess">当たったら ${range(Math.floor(st.stake * lo), Math.floor(st.stake * hi), '枚')}</b>${lo === hi ? '' : '（人気で変わる）'}</p>
            <div class="stake"><button class="btn" data-d="-10">-10</button><button class="btn" data-d="-1">-1</button>
            <span>${st.stake}枚</span><button class="btn" data-d="1">+1</button><button class="btn" data-d="10">+10</button></div>
            <div class="opts"><button class="btn small" data-set="10">10</button><button class="btn small" data-set="50">50</button><button class="btn small" data-set="${cap}">全部（${cap}）</button></div>
            <div class="nav"><button class="btn" data-back>◀ もどる</button><button class="btn primary" data-buy>券を買う</button></div>`;
          body.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { st.stake += +b.dataset.d; render(); }));
          body.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => { st.stake = +b.dataset.set; render(); }));
          body.querySelector('[data-back]').addEventListener('click', () => { st.step = 2; render(); });
          body.querySelector('[data-buy]').addEventListener('click', () => {
            const t = { player: G.me, type: st.type, pick: st.pick.slice(), stake: st.stake, late };
            if (late) t.lateBucket = B.lateBucket(t.pick, orderNow());
            mine.push(t);
            Sound.sfx('coin');
            st.step = 1; st.type = null; st.pick = [];
            render();
          });
        }
      }
      $('btn-bet-done').onclick = () => end(mine);
      $('btn-bet-skip').onclick = () => end([]);
      render();
    });
  }

  // 「1.9〜6.1倍」。1つの数字に決まるときは「33倍」
  const range = (lo, hi, unit) => (lo === hi ? `${lo}${unit}` : `${lo}〜${hi}${unit}`);
  // 倍率の計算に使う設定（ぎょうれつ5は遊ぶ人数で決まるので、人数を足す）
  const betOpts = () => Object.assign({}, BO, { players: G.players.length });
  // 今の順位（ゴールした動物が先、そのあと残りマスの少ない順）
  const orderNow = () => G.s.finished.concat(R.unfinished(G.s).sort((a, b) => G.s.remaining[a] - G.s.remaining[b]));
  // 追加ベットの倍率の割合（順位の区分 0=1位を含む、1=2位から、2=3位以下）。人数の調整も入れた、表示用の数字
  const lateRateShown = bucket => Math.round(BO.lateRankRates[bucket] * (BO.latePlayerAdjust[G.players.length] || 1) * 10) / 10;
  // その動物をいちばん前にした券にかかる割合
  const rankRate = a => lateRateShown(Math.min(2, orderNow().indexOf(a)));
  // 追加ベットの上限のもとになる、その人の最初のベットの合計
  const lateCapOf = p => G.tickets.filter(t => t.player === p && !t.late).reduce((sum, t) => sum + t.stake, 0);

  // 倍率のめやす：その券種のいちばん低い倍率〜いちばん高い倍率（ぎょうれつ5は人数で1つに決まる）
  //   追加ベットでは、順位の区分 bucket が分かっていればその割合、分からなければ 1位〜3位以下の全部の幅
  function oddsRange(type, late, bucket) {
    if (type === 'quintet') { const v = B.oddsFor({ type }, 0, betOpts()); return [v, v]; }
    const row = BO.oddsTable[type];
    if (!late) return [B.oddsFor({ type }, row.length - 1, BO), B.oddsFor({ type }, 0, BO)];
    const loB = bucket != null ? bucket : 0;
    const hiB = bucket != null ? bucket : 2;
    const o = betOpts(); // 人数の調整も入れる
    return [B.oddsFor({ type, late, lateBucket: loB }, row.length - 1, o), B.oddsFor({ type, late, lateBucket: hiB }, 0, o)];
  }

  // 今の順位（追加ベットのときに上に出す）：顔・残りマス・その動物に賭けた人
  function standingsHTML() {
    const s = G.s;
    const order = s.finished.concat(R.unfinished(s).sort((a, b) => s.remaining[a] - s.remaining[b]));
    return '<span class="standings-title">今の順位</span>' + order.map((a, k) => {
      const marks = G.players.filter((_, p) => G.tickets.some(t => t.player === p && t.pick.includes(a))).map(pl => pl.mark).join('');
      return `<span class="standing">${k + 1}位 ${faceHTML(a, 'list-face')} ${s.done[a] ? 'ゴール' : `残り${s.remaining[a]}`} <b class="rank-rate">×${lateRateShown(Math.min(2, k))}</b>${marks ? ` <small>${marks}</small>` : ''}</span>`;
    }).join('');
  }

  // CPU のベット：性格で券種を選ぶ。最初は自分の予想、追加はその時点の上位
  function cpuBet(p, late, order) {
    const pl = G.players[p];
    if (pl.chips <= 0) return [];
    const types = pl.style.types.filter(k => !(late && B.TYPES[k].initialOnly));
    const type = types[Math.floor(G.rng() * types.length)];
    let stake;
    if (late) {
      if (G.rng() >= 0.6) return [];
      const cap = Math.min(pl.chips, Math.max(lateCapOf(p), BO.lateCapMin));
      stake = Math.min(cap, Math.floor(pl.chips * (G.rng() < 0.5 ? 0.25 : 0.5)));
      if (stake < 1) return [];
      const pick = order.slice(0, B.TYPES[type].picks);
      return [{ player: p, type, pick, stake, late, lateBucket: B.lateBucket(pick, order) }];
    } else {
      const f = [0, 0.25, 0.5, 1][Math.floor(G.rng() * 4)];
      stake = Math.min(pl.chips, Math.max(Math.min(BO.minBet, pl.chips), Math.round(pl.chips * f)));
    }
    return [{ player: p, type, pick: order.slice(0, B.TYPES[type].picks), stake, late }];
  }

  async function betPhase(late) {
    const s = G.s;
    show('bet');
    const currentOrder = s.finished.concat(R.unfinished(s).sort((a, b) => s.remaining[a] - s.remaining[b]));
    // CPU（と、通信が切れて CPU が代わりに賭ける人）の券
    const autoBet = p => {
      const pl = G.players[p];
      // CPU の予想は1〜5位の全部（ぎょうれつ5のため）。作戦は上位3匹に合わせる
      if (!late) { pl.order = R.shuffle([0, 1, 2, 3, 4], G.rng); pl.target = pl.order.slice(0, 3); }
      return cpuBet(p, late, late ? currentOrder : pl.order);
    };
    let all;
    if (G.online) {
      all = await onlineBets(late, autoBet);
    } else {
      const me = G.players[G.me];
      all = (me.chips > 0 || late ? await humanBet(late) : []).slice();
      G.players.forEach((pl, p) => { if (pl.cpu) all.push(...autoBet(p)); });
    }
    all.forEach(t => { G.players[t.player].chips -= t.stake; });
    G.tickets.push(...all);
    B.lockOdds(G.tickets, betOpts());
    await revealBets(late ? all : G.tickets, late);
  }

  function revealBets(list, late) {
    return new Promise(resolve => {
      $('reveal-title').textContent = late ? '一斉の追加ベットと倍率' : 'みんなの賭けと倍率';
      $('btn-reveal-go').textContent = late ? 'レース再開！' : 'レース開始！';
      // 人気（ほかに何人がその動物に賭けているか）も出して、倍率が決まった理由を見せる
      const rows = list.map(t => {
        const pl = G.players[t.player];
        const pop = B.popularity(G.tickets, G.tickets.indexOf(t));
        const popText = t.type === 'quintet' ? `${G.players.length}人で遊ぶとき` : pop ? `ほかに${pop}人` : 'だれもいない';
        return `<tr class="${t.player === G.me ? 'mine' : ''}"><td>${pl.mark}${pl.name}</td><td>${B.TYPES[t.type].name}</td><td>${pickChips(t.type, t.pick)}</td><td class="num">${t.stake}枚</td><td class="num">${popText}</td><td class="num"><b>${t.odds}倍</b></td></tr>`;
      }).join('');
      $('reveal-body').innerHTML = list.length
        ? `<table><tr><th>だれ</th><th>券種</th><th>動物</th><th class="num">枚数</th><th class="num">人気</th><th class="num">倍率</th></tr>${rows}</table>
           <p class="reveal-note">ほかの人も賭けている動物ほど勝ちやすいので、倍率が低くなります。${late ? `追加ベットの倍率は今の順位で変わります（1位を含む券×${lateRateShown(0)}・2位から×${lateRateShown(1)}・3位以下×${lateRateShown(2)}）。` : ''}</p>`
        : '<p>だれも賭けませんでした</p>';
      show('reveal');
      $('btn-reveal-go').onclick = () => resolve();
      // 通信のときは、押さなくても少したつと進む（ほかの人を待たせないため）
      if (G.online) autoAdvance($('btn-reveal-go'), 12, resolve);
    });
  }

  // ボタンに残り秒数を出し、0になったら押したことにする
  function autoAdvance(btn, sec, go) {
    if (G.fast) { go(); return; }
    const label = btn.textContent;
    let left = sec;
    const t = setInterval(() => {
      left--;
      btn.textContent = `${label}（${left}）`;
      if (left <= 0) { clearInterval(t); go(); }
    }, 1000);
    const prev = btn.onclick;
    btn.onclick = () => { clearInterval(t); btn.textContent = label; if (prev) prev(); };
  }

  // ---------- 通信で遊ぶとき ----------
  // ステップ（ベットの券・出したカード）を読む。まだなければ「今の場面に追いついた」ので早送りをやめる
  async function stepNow(key) {
    const v = await Net.peek(G.online.code, G.online.gid, key);
    if (v == null) G.fast = false;
    return v;
  }
  const stepWait = key => Net.wait(G.online.code, G.online.gid, key);
  const stepClaim = (key, value) => Net.claim(G.online.code, G.online.gid, key, value);
  // 見はり役：通信できている人のうち、いちばん番号の小さい人。
  // 時間をすぎても書かれないステップに「auto（CPU が代わりにやる）」を書く
  const refereeIdx = () => G.players.findIndex(pl => !pl.cpu && G.onlineNow[pl.uid]);
  function watchdog(key, p, sec) {
    let alive = true;
    const t0 = Date.now();
    const t = setInterval(async () => {
      if (!alive) { clearInterval(t); return; }
      if (refereeIdx() !== G.me) return;
      const away = !G.onlineNow[G.players[p].uid];
      if (Date.now() - t0 > (away ? 4 : sec) * 1000) {
        clearInterval(t);
        await stepClaim(key, { auto: true });
      }
    }, 1000);
    return () => { alive = false; clearInterval(t); };
  }

  // 通信のベット：自分の券を書き、全員の分がそろうのを待つ（番号の順に並べる）
  async function onlineBets(late, autoBet) {
    const keyOf = p => `bet-${G.raceNo}-${late ? 1 : 0}-${p}`;
    const me = G.players[G.me];
    if (await stepNow(keyOf(G.me)) == null) {
      const mine = me.chips > 0 || late ? await humanBet(late) : [];
      await stepClaim(keyOf(G.me), { tickets: mine.map(t => ({ type: t.type, pick: t.pick, stake: t.stake, late: t.late, lateBucket: t.lateBucket })) });
    }
    // 待っている人を表示する
    const status = {};
    const renderWait = () => {
      $('bet-body').innerHTML = `<p class="explain">ほかの人が賭け終わるのを待っています</p><div class="wait-list">${G.players.map((pl, p) =>
        `<span class="wait-item${status[p] ? ' done' : ''}">${status[p] ? '✅' : '⏳'}${pl.mark}${pl.name}</span>`).join('')}</div>`;
      $('btn-bet-done').disabled = true;
      $('btn-bet-skip').classList.add('hidden');
    };
    renderWait();
    G.players.forEach((pl, p) => { if (pl.cpu) status[p] = true; else stepWait(keyOf(p)).then(() => { status[p] = true; renderWait(); }); });
    const all = [];
    for (let p = 0; p < G.players.length; p++) {
      if (G.players[p].cpu) { all.push(...autoBet(p)); continue; }
      const stop = p === G.me ? () => {} : watchdog(keyOf(p), p, late ? 90 : 150);
      const v = await stepWait(keyOf(p));
      stop();
      if (v.auto) all.push(...autoBet(p));
      else all.push(...(v.tickets || []).map(t => Object.assign({}, t, { player: p, late: !!t.late })));
    }
    return all;
  }

  // 通信の手番：自分の番ならカードを選んで書く。ほかの人の番は、書かれるのを待つ
  async function onlineTurn(p) {
    const s = G.s;
    const key = `turn-${G.raceNo}-${s.plays}`;
    if (p === G.me) {
      if (await stepNow(key) == null) {
        const act = s.hands[p].length ? await humanTurn(p) : null;
        await stepClaim(key, act ? { act } : { pass: true });
      }
    } else {
      renderHand(G.me, false);
      if (!G.fast) ticker(`${G.players[p].mark}${G.players[p].name}が考えています…`, true);
    }
    const stop = p === G.me ? () => {} : watchdog(key, p, TURN_SEC + 12);
    const v = await stepWait(key);
    stop();
    if (v.auto) return s.hands[p].length ? R.chooseAction(s, p) : null;
    return v.act || null;
  }

  // ---------- 1レースの進行 ----------
  async function playRace() {
    const n = G.players.length;
    const s = R.newGame(n, G.rng, G.players.map(() => [0, 1, 2]), { dealLater: true });
    G.s = s;
    G.tickets = [];
    G.drama = { close: false, spurt: new Set(), lastRev: -9, climax: false, hl: [], lateOrder: null };
    G.lastChance = null;
    G.slowmo = 1;
    G.turn = -1;
    let lateOpened = false;
    setSky('day');
    buildLanes();

    // レーン発表：動物が1匹ずつレーンに入る
    show('race');
    renderTop();
    renderHand(G.me, false);
    $('turn-info').textContent = 'レーン発表！';
    updateLanes();
    laneEls.forEach(el => el.token.classList.add('hidden'));
    // 「スキップ」を押したら、残りの動物をまとめて出す
    let skip = false;
    let onSkip = () => {};
    const skipped = new Promise(res => { onSkip = res; });
    for (let l = 0; l < 5 && !skip; l++) {
      const a = s.laneOf.indexOf(l);
      laneEls[l].token.classList.remove('hidden');
      ticker(`${R.LANES[l].name}（${R.LANES[l].len}マス）：${animalLabel(a)}！`);
      const box = openModal(`${artHTML(a, 'art-big')}<h3>${R.LANES[l].name}（${R.LANES[l].len}マス）は ${R.ANIMALS[a]}！</h3>
        <button class="btn small skip-btn">スキップ ▶</button>`, 'art-modal');
      box.querySelector('.skip-btn').addEventListener('click', () => { skip = true; onSkip(); });
      await Promise.race([wait(1100), skipped]);
      closeModal();
      if (!skip) await wait(150);
    }
    laneEls.forEach(el => el.token.classList.remove('hidden'));
    await wait(400);

    await betPhase(false);

    // 手札はベットが終わってから配る（手札を見て賭けられないように）
    R.dealAll(s);

    // CPU の作戦は自分の賭けに合わせる。人は時間切れのランダム用に入れておくだけ
    s.targets = G.players.map((pl, p) => {
      const t = G.tickets.filter(x => x.player === p).sort((x, y) => y.stake - x.stake)[0];
      const base = t ? t.pick.slice() : (pl.target || []);
      return base.concat(R.shuffle([0, 1, 2, 3, 4].filter(a => !base.includes(a)), G.rng)).slice(0, 3);
    });

    // 最初の手番：賭けた枚数がいちばん少ない人（同じならランダム）
    const staked = G.players.map((_, p) => G.tickets.filter(t => t.player === p).reduce((sum, t) => sum + t.stake, 0));
    const least = Math.min(...staked);
    const cands = staked.map((v, p) => (v === least ? p : -1)).filter(p => p >= 0);
    let p = cands[Math.floor(G.rng() * cands.length)];

    show('race');
    updateLanes();
    renderTop();
    await countdown();
    ticker(`スタート！最初は${G.players[p].mark}${G.players[p].name}から`);
    await processEvents();
    await sleep(800);

    let guard = 0;
    while (s.finished.length < 4 && guard++ < 500) {
      G.turn = p;
      renderTop();
      let act = null;
      if (G.online && !G.players[p].cpu) {
        act = await onlineTurn(p);
      } else if (!G.players[p].cpu) {
        if (s.hands[p].length) act = await humanTurn(p);
      } else {
        renderHand(G.me, false);
        await wait(900);
        act = R.chooseAction(s, p);
      }
      if (act) await performAction(p, act);
      else { R.fillHand(s, p); ticker(`${G.players[p].name}はパス`); }
      s.plays++;
      renderHand(G.me, false);
      await processEvents();

      // 一斉の追加ベット：1位の動物が残り15マスを越えた手番の直後
      if (!lateOpened && s.finished.length < 4 && (s.finished.length > 0 || Math.min(...s.remaining) <= BO.lateAt)) {
        lateOpened = true;
        if (G.sky === 'day') setSky('dusk');
        G.drama.lateOrder = R.unfinished(s).sort((x, y) => s.remaining[x] - s.remaining[y]);
        flash('#ffb37a');
        Sound.sfx('boom');
        bigText('🌇 一斉の追加ベット！');
        await sleep(1500);
        await betPhase(true);
        show('race');
        updateLanes();
      }
      p = (p + 1) % n;
    }
    R.unfinished(s).sort((a, b) => s.remaining[a] - s.remaining[b]).forEach(a => s.finished.push(a));
    G.turn = -1;
    updateLanes();
    await sleep(800);
    await showResult();
  }

  function showResult() {
    return new Promise(resolve => {
      const s = G.s;
      const res = B.settle(G.tickets, s.finished, BO);
      const before = G.players.map(pl => pl.chips);
      res.payouts.forEach((pay, i) => { G.players[G.tickets[i].player].chips += pay; });
      const last = G.raceNo >= G.races;
      $('result-title').textContent = `${G.raceNo}レース目の結果`;
      $('result-order').innerHTML = artHTML(s.finished[0], 'art-win')
        + s.finished.map((a, k) => `<div class="order-row">${k + 1}着 ${faceHTML(a, 'list-face')} ${R.ANIMALS[a]}</div>`).join('');
      const rows = G.tickets.map((t, i) => {
        const pl = G.players[t.player];
        const hit = res.payouts[i] > 0;
        return `<tr class="row-in${t.player === G.me ? ' mine' : ''}${hit ? ' hit-row' : ''}" style="--i:${i + 3}"><td>${pl.mark}${pl.name}</td><td>${t.late ? '追加・' : ''}${B.TYPES[t.type].name}</td><td>${pickChips(t.type, t.pick)}</td><td class="num">${t.stake}枚</td><td class="num">${t.odds}倍</td><td class="num ${hit ? 'hit' : ''}">${hit ? `🎉${res.payouts[i]}枚` : 'はずれ'}</td></tr>`;
      }).join('');
      const ranking = rankPlayers().map(({ pl, rank, p }, k) => {
        const start = before[p] + G.tickets.filter(t => t.player === p).reduce((sum, t) => sum + t.stake, 0);
        return `<tr class="row-in${p === G.me ? ' mine' : ''}" style="--i:${k}"><td>${rank}位</td><td>${pl.mark}${pl.name}</td><td class="num">💰${start} → <span class="cnt" data-from="${start}" data-to="${pl.chips}">${start}</span></td></tr>`;
      }).join('');
      // 今日の名場面：レース中に集めたものに、逆転勝ちと大きな的中を加えて、点の高い順に2つ
      const hl = G.drama.hl.slice();
      const lo = G.drama.lateOrder;
      const winRank = lo ? lo.indexOf(s.finished[0]) : -1;
      if (winRank >= 2) hl.push({ score: 20, text: `夕焼けのとき${winRank + 1}位だった${animalLabel(s.finished[0])}が大逆転で1着` });
      G.tickets.forEach((t, i) => {
        if (res.payouts[i] > 0 && t.odds >= 8) hl.push({ score: 10 + t.odds, text: `${G.players[t.player].mark}${G.players[t.player].name}が${t.odds}倍の「${B.TYPES[t.type].name}」を的中` });
      });
      const best = hl.sort((x, y) => y.score - x.score).filter((h, k, arr) => arr.findIndex(z => z.text === h.text) === k).slice(0, 2);
      const hlHTML = best.length ? `<div class="highlight"><b>🎬 今日の名場面</b>${best.map(h => `<div>・${h.text}</div>`).join('')}</div>` : '';
      // いちばん大事なチップの順位を先に（券が多いと表がスクロールになるため）
      $('result-table').innerHTML = hlHTML + `<h3 class="result-h">${last ? '最終結果' : '今のチップ'}</h3><table>${ranking}</table>
        <h3 class="result-h">払い戻し</h3><table><tr><th>だれ</th><th>券種</th><th>動物</th><th class="num">枚数</th><th class="num">倍率</th><th class="num">払い戻し</th></tr>${rows || '<tr><td colspan="6">券なし</td></tr>'}</table>`;
      $('btn-result-go').textContent = last ? 'タイトルへ戻る' : '次のレースへ';
      show('result');
      // チップの数字がカウントアップする
      $('result-table').querySelectorAll('.cnt').forEach(el => countUp(el, +el.dataset.from, +el.dataset.to, 1400));
      // 自分の当たり：大当たり（倍率5倍以上か100枚以上）ならコインの雨と花火
      const myPay = res.payouts.reduce((sum, pay, i) => sum + (G.tickets[i].player === G.me ? pay : 0), 0);
      const myBest = Math.max(0, ...G.tickets.filter((t, i) => t.player === G.me && res.payouts[i] > 0).map(t => t.odds));
      if (myPay > 0) {
        Sound.sfx('fanfare');
        const big = myBest >= 5 || myPay >= 100;
        setTimeout(() => {
          callout(big ? `💰大当たり！ +${myPay}枚` : `🎉当たり！ +${myPay}枚`, 'gold');
          Sound.sfx('coins');
          if (big) { coinRain(40); fireworks(3); }
        }, 500);
      }
      // 同じ枚数なら同じ順位なので、1位が何人でも全員の名前を出す（当たりの実況と重ならないよう少しあとに）
      if (last) {
        setTimeout(() => {
          confetti();
          fireworks(6);
          bigText(`🏆 ${rankPlayers().filter(x => x.rank === 1).map(x => x.pl.name).join('と')}の勝ち！`);
        }, myPay > 0 ? 2300 : 0);
      }
      $('btn-result-go').onclick = () => resolve();
      // 通信のときは、押さなくても少したつと次のレースへ（最後のレースはボタンを待つ）
      if (G.online && !last) autoAdvance($('btn-result-go'), 25, resolve);
    });
  }

  // チップの多い順。同じ枚数なら同じ順位
  function rankPlayers() {
    const list = G.players.map((pl, p) => ({ pl, p })).sort((x, y) => y.pl.chips - x.pl.chips);
    list.forEach((x, k) => { x.rank = k > 0 && x.pl.chips === list[k - 1].pl.chips ? list[k - 1].rank : k + 1; });
    return list;
  }

  async function playSeries() {
    for (G.raceNo = 1; G.raceNo <= G.races; G.raceNo++) {
      await playRace();
    }
    G.fast = false;
    if (G.online) { leaveRoom(); return; }
    setSky('day');
    show('title');
  }

  // ---------- 部屋（通信で遊ぶ） ----------
  // 部屋の主が「スタート」を押すと、種（seed）と参加者の順番が配られ、全員が同じレースを動かす
  const Net = window.AnimalNet && window.AnimalNet.backend;
  const room = { code: null, isHost: false, unwatch: null, state: null, races: 1, mode: 'create' };
  const NAME_KEY = 'animalrace.name';
  const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  const linkFor = code => `${location.origin}${location.pathname}?room=${code}${Net && window.AnimalNet.mode === 'local' ? '&local=1' : ''}`;

  function openOnline(mode, code) {
    room.mode = mode;
    $('online-title').textContent = mode === 'create' ? '部屋を作る' : code ? `部屋 ${code} に入る` : '部屋に入る';
    $('in-online-name').value = savedName() || '';
    $('in-room-code').value = code || '';
    $('room-code-row').classList.toggle('hidden', mode === 'create' || !!code);
    $('btn-online-go').textContent = mode === 'create' ? '部屋を作る' : '入る';
    $('online-msg').textContent = '';
    renderOnlineMarks();
    show('online');
  }
  let onlineMark = MARKS[0];
  function renderOnlineMarks() {
    chipButtons($('online-mark-pick'), MARKS, onlineMark, v => v, v => { onlineMark = v; renderOnlineMarks(); });
  }
  // 部屋に入る人の名前とマーク（同じマークがすでにあれば、空いているマークにする）
  function myInfo(players) {
    const name = ($('in-online-name').value.trim() || 'ゲスト').slice(0, 8);
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* 保存できなくても遊べる */ }
    const used = Object.keys(players || {}).filter(u => u !== Net.uid && players[u].online).map(u => players[u].mark);
    const mark = used.includes(onlineMark) ? MARKS.find(m => !used.includes(m)) : onlineMark;
    return { name, mark, joinedAt: Date.now() };
  }

  async function goOnline() {
    const msg = $('online-msg');
    msg.textContent = 'つないでいます…';
    $('btn-online-go').disabled = true;
    try {
      await Net.init();
      let code = room.mode === 'create' ? null : $('in-room-code').value.trim();
      if (room.mode === 'create') {
        // 空いている部屋番号を探す
        for (let k = 0; k < 10 && !code; k++) {
          const c = window.AnimalNet.newCode();
          const ok = await Net.createMeta(c, { host: Net.uid, status: 'lobby', races: 1, createdAt: Date.now(), gid: Math.random().toString(36).slice(2, 10) });
          if (ok) code = c;
        }
        if (!code) throw new Error('部屋を作れませんでした。もう一度ためしてください');
      } else {
        if (!/^\d{4}$/.test(code || '')) throw new Error('部屋番号（4けたの数字）を入れてください');
        const meta = await Net.getMeta(code);
        if (!meta || meta.createdAt < Date.now() - 24 * 3600 * 1000) throw new Error(`部屋 ${code} が見つかりません`);
        if (meta.status !== 'lobby' && !(meta.order || []).includes(Net.uid)) throw new Error('この部屋はもう始まっています');
        // 5人まで（自分がもう入っている部屋に戻るときは数えない）
        if (meta.status === 'lobby') {
          const members = roomMembers({ meta, players: await Net.getPlayers(code) });
          if (members.length >= 5 && !members.includes(Net.uid)) throw new Error(`部屋 ${code} は満員です（5人まで）`);
        }
      }
      room.code = code;
      room.isHost = room.mode === 'create';
      enterRoom();
    } catch (e) {
      msg.textContent = e.message || 'つながりませんでした';
    } finally {
      $('btn-online-go').disabled = false;
    }
  }

  let joined = false;
  function enterRoom() {
    joined = false;
    show('room');
    $('room-code').textContent = room.code;
    if (room.unwatch) room.unwatch();
    room.unwatch = Net.watchRoom(room.code, state => {
      room.state = state;
      const meta = state.meta || {};
      // 最初の1回：自分を部屋に入れる（マークの重なりは、ここで直す）
      if (!joined && meta.createdAt) {
        joined = true;
        const mine = state.players[Net.uid];
        Net.setPlayer(room.code, mine && meta.status === 'playing' ? mine : myInfo(state.players));
      }
      G.onlineNow = {};
      Object.keys(state.players || {}).forEach(u => { G.onlineNow[u] = !!state.players[u].online; });
      if (meta.status === 'playing' && !G.online) startOnlineGame(meta, state.players);
      else if (!G.online) renderRoom();
      else if (G.s) renderTop();
    });
  }
  // 部屋に今いる人（入った順）
  const roomMembers = state => Object.keys(state.players || {})
    .filter(u => state.players[u].online && state.players[u].joinedAt >= (state.meta.createdAt || 0) - 60000)
    .sort((a, b) => state.players[a].joinedAt - state.players[b].joinedAt);

  function renderRoom() {
    const state = room.state;
    if (!state || !state.meta) return;
    const meta = state.meta;
    const members = roomMembers(state);
    const isHost = meta.host === Net.uid;
    $('room-players').innerHTML = members.map(u => {
      const pl = state.players[u];
      return `<div class="room-player">${pl.mark} ${pl.name}${u === meta.host ? ' <small>👑部屋の主</small>' : ''}${u === Net.uid ? ' <small>（あなた）</small>' : ''}</div>`;
    }).join('') + (members.length < 5 ? `<div class="room-player empty">あと${5 - members.length}人まで入れます</div>` : '');
    chipButtons($('room-races'), [1, 2, 3], meta.races || 1, v => `${v}レース`, v => { if (isHost) Net.setMeta(room.code, { races: v }); });
    $('room-races').querySelectorAll('button').forEach(b => { b.disabled = !isHost; });
    const startBtn = $('btn-room-start');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = members.length < 2 || members.length > 5;
    $('room-note').textContent = isHost
      ? (members.length < 2 ? 'リンクを送って、友達が入るのを待ちましょう（2〜5人）' : members.length > 5 ? '5人までです' : 'そろったら「スタート」')
      : '部屋の主がスタートするのを待っています';
  }

  async function shareLink() {
    const url = linkFor(room.code);
    const text = `アニマルレースで遊ぼう！部屋 ${room.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'アニマルレース', text, url }); return; }
      await navigator.clipboard.writeText(url);
      $('room-note').textContent = 'リンクをコピーしました。LINE などに貼って送ってください';
    } catch (e) {
      // 共有をやめたときや、コピーできないときは、リンクをそのまま見せる
      $('room-note').textContent = url;
    }
  }

  function startRoomGame() {
    const state = room.state;
    const members = roomMembers(state);
    if (members.length < 2) return;
    Net.setMeta(room.code, { status: 'playing', order: members, seed: Math.floor(Math.random() * 2 ** 31), startedAt: Date.now() });
  }

  function startOnlineGame(meta, players) {
    const order = meta.order || [];
    const me = order.indexOf(Net.uid);
    if (me < 0) { $('room-note').textContent = 'この部屋はもう始まっています'; return; }
    // マークが重なっていたら、入った順に空いているマークへ（全員の画面で同じ結果になる）
    const used = [];
    G.players = order.map(u => {
      const info = players[u] || { name: '？', mark: '⭐' };
      const mark = used.includes(info.mark) ? MARKS.find(m => !used.includes(m)) : info.mark;
      used.push(mark);
      return { name: info.name, mark, cpu: false, uid: u, style: STYLES[1], chips: BO.start };
    });
    G.me = me;
    G.online = { code: room.code, gid: meta.gid };
    G.rng = R.makeRng(meta.seed >>> 0);
    G.races = meta.races || 1;
    G.speed = 1;
    G.log = [];
    // 読みこみ直したとき：ステップが書かれているところまで、演出なしで早送り
    G.fast = Date.now() - (meta.startedAt || 0) > 5000;
    playSeries();
  }

  function leaveRoom() {
    if (room.unwatch) room.unwatch();
    if (Net && room.code) Net.leave(room.code);
    // 部屋の番号のないページに戻る（もう一度リンクで入れる）
    location.href = location.pathname + (window.AnimalNet.mode === 'local' ? '?local=1' : '');
  }

  // つながりが切れたら上に知らせる
  if (Net) Net.onConnected(on => { $('net-status').classList.toggle('hidden', on); });

  // タイトルの「部屋を作る」「部屋に入る」
  const btnCreate = $('btn-create');
  const btnJoin = $('btn-join');
  if (Net) {
    btnCreate.disabled = false;
    btnJoin.disabled = false;
    btnCreate.title = '';
    btnJoin.title = '';
    btnCreate.addEventListener('click', () => openOnline('create'));
    btnJoin.addEventListener('click', () => openOnline('join'));
    $('btn-online-go').addEventListener('click', goOnline);
    $('btn-share').addEventListener('click', shareLink);
    $('btn-room-start').addEventListener('click', startRoomGame);
    $('btn-room-leave').addEventListener('click', leaveRoom);
    // リンク（?room=1234）から来たら、すぐ「部屋に入る」
    const linkCode = new URLSearchParams(location.search).get('room');
    if (/^\d{4}$/.test(linkCode || '')) openOnline('join', linkCode);
  }

  renderSetup();
  Sound.render();
  window.AnimalRaceGame = G; // 確認用
})();

// アニマルレース：通信で遊ぶための部品
//
// しくみ（全員の画面で同じレースを動かす）
//   - 部屋の主が「種（seed）」と参加者の順番を決めて配る。全員がその種で同じレースを計算する
//   - 人が決めること（ベットの券・出したカード）だけを「ステップ」として部屋に書きこむ
//     ステップは名前（例：turn-1-12）ごとに最初の1回だけ書ける。あとから書こうとしても無視される
//     → 「本人の操作」と「時間切れの代わり（auto）」が同時に来ても、全員が同じ方を使う
//   - 途中で読みこみ直しても、最初からステップをたどれば同じところまで戻れる
//
// 通信のしかたは2つ
//   firebase：Firebase Realtime Database（本番。firebase-config.js に設定がいる）
//   local   ：同じパソコンのブラウザのタブどうし（確認用。URL に ?local=1）
(function (global) {
  'use strict';

  const params = new URLSearchParams(location.search);
  const config = global.ANIMAL_RACE_FIREBASE;
  const mode = params.get('local') === '1' ? 'local'
    : (config && global.firebase ? 'firebase' : null);

  // 部屋番号：4けたの数字
  const newCode = () => String(1000 + Math.floor(Math.random() * 9000));
  // Firebase は undefined を保存できないので、JSON を通して消しておく
  const clean = v => JSON.parse(JSON.stringify(v));
  const DAY = 24 * 60 * 60 * 1000;

  // ---------- Firebase ----------
  function firebaseBackend() {
    const app = global.firebase.initializeApp(config);
    const auth = app.auth();
    const db = app.database();
    let uid = null;
    const roomRef = code => db.ref(`rooms/${code}`);

    async function init() {
      // ?test=1 のときはタブごとに別の人になる（同じパソコンで何人分も試すため）
      if (params.get('test') === '1') await auth.setPersistence(global.firebase.auth.Auth.Persistence.SESSION);
      const cred = auth.currentUser ? { user: auth.currentUser } : await auth.signInAnonymously();
      uid = cred.user.uid;
      return uid;
    }
    async function getMeta(code) { return (await roomRef(code).child('meta').once('value')).val(); }
    async function getPlayers(code) { return (await roomRef(code).child('players').once('value')).val() || {}; }
    async function createMeta(code, meta) {
      // まだない部屋か、1日より古い部屋だけ使える（ルールでも同じことを確かめる）
      const res = await roomRef(code).child('meta').transaction(cur => {
        if (cur && cur.createdAt > Date.now() - DAY) return undefined;
        return meta;
      });
      return res.committed;
    }
    function setMeta(code, patch) { return roomRef(code).child('meta').update(clean(patch)); }
    function setPlayer(code, info) {
      const ref = roomRef(code).child(`players/${uid}`);
      ref.child('online').onDisconnect().set(false);
      return ref.set(clean(Object.assign({}, info, { online: true })));
    }
    // つながり直したら、もう一度「いる」にする
    let presenceCode = null;
    db.ref('.info/connected').on('value', snap => {
      const on = !!snap.val();
      connListeners.forEach(f => f(on));
      if (on && presenceCode && uid) {
        const ref = roomRef(presenceCode).child(`players/${uid}/online`);
        ref.onDisconnect().set(false);
        ref.set(true);
      }
    });
    const connListeners = [];
    function watchRoom(code, cb) {
      presenceCode = code;
      const ref = roomRef(code);
      const meta = ref.child('meta');
      const players = ref.child('players');
      const state = { meta: null, players: {} };
      // 部屋の設定と参加者の両方が届いてから知らせる（先に入った人のマークと重ならないように）
      const loaded = { meta: false, players: false };
      const tell = () => { if (loaded.meta && loaded.players) cb(state); };
      const onMeta = snap => { state.meta = snap.val(); loaded.meta = true; tell(); };
      const onPlayers = snap => { state.players = snap.val() || {}; loaded.players = true; tell(); };
      meta.on('value', onMeta);
      players.on('value', onPlayers);
      return () => { meta.off('value', onMeta); players.off('value', onPlayers); };
    }
    function leave(code) {
      presenceCode = null;
      if (code && uid) return roomRef(code).child(`players/${uid}/online`).set(false);
    }
    const stepRef = (code, gid, key) => roomRef(code).child(`steps/${gid}/${key}`);
    async function claim(code, gid, key, value) {
      // ルールで「まだないときだけ書ける」。先にだれかが書いていたら失敗するが、それでよい
      try { await stepRef(code, gid, key).set(clean(Object.assign({ by: uid }, value))); } catch (e) { /* 先に書かれていた */ }
    }
    async function peek(code, gid, key) { return (await stepRef(code, gid, key).once('value')).val(); }
    function wait(code, gid, key) {
      return new Promise(resolve => {
        const ref = stepRef(code, gid, key);
        const on = snap => { if (snap.exists()) { ref.off('value', on); resolve(snap.val()); } };
        ref.on('value', on);
      });
    }
    return {
      init, getMeta, getPlayers, createMeta, setMeta, setPlayer, watchRoom, leave, claim, peek, wait,
      onConnected: f => connListeners.push(f),
      get uid() { return uid; },
    };
  }

  // ---------- 同じパソコンのタブどうし（確認用） ----------
  // localStorage に書き、BroadcastChannel でほかのタブに知らせる
  function localBackend() {
    const PRE = 'ar-local:';
    let uid = sessionStorage.getItem(PRE + 'uid');
    if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(PRE + 'uid', uid); }
    const ch = new BroadcastChannel('ar-local');
    const listeners = new Set();
    const notify = () => { ch.postMessage('changed'); listeners.forEach(f => f()); };
    ch.onmessage = () => listeners.forEach(f => f());
    const get = k => { const v = localStorage.getItem(PRE + k); return v == null ? null : JSON.parse(v); };
    const put = (k, v) => { localStorage.setItem(PRE + k, JSON.stringify(v)); notify(); };
    let beat = null;

    async function init() { return uid; }
    async function getMeta(code) { return get(`room:${code}:meta`); }
    async function getPlayers(code) { return readPlayers(code); }
    async function createMeta(code, meta) {
      const cur = get(`room:${code}:meta`);
      if (cur && cur.createdAt > Date.now() - DAY) return false;
      put(`room:${code}:meta`, meta);
      return true;
    }
    async function setMeta(code, patch) { put(`room:${code}:meta`, Object.assign(get(`room:${code}:meta`) || {}, clean(patch))); }
    async function setPlayer(code, info) {
      const write = () => put(`room:${code}:player:${uid}`, Object.assign({}, clean(info), { seen: Date.now() }));
      write();
      clearInterval(beat);
      // 2秒ごとに「いる」を書く。7秒書かれなければ、いなくなったとみなす
      beat = setInterval(() => {
        const p = get(`room:${code}:player:${uid}`);
        if (p) { p.seen = Date.now(); localStorage.setItem(PRE + `room:${code}:player:${uid}`, JSON.stringify(p)); }
      }, 2000);
    }
    function readPlayers(code) {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k.match(new RegExp(`^${PRE}room:${code}:player:(.+)$`));
        if (m) { const p = JSON.parse(localStorage.getItem(k)); p.online = Date.now() - p.seen < 7000; out[m[1]] = p; }
      }
      return out;
    }
    function watchRoom(code, cb) {
      const f = () => cb({ meta: get(`room:${code}:meta`), players: readPlayers(code) });
      listeners.add(f);
      const t = setInterval(f, 2000); // いなくなった人に気づくため
      f();
      return () => { listeners.delete(f); clearInterval(t); };
    }
    function leave(code) {
      clearInterval(beat);
      const p = get(`room:${code}:player:${uid}`);
      if (p) { p.seen = 0; put(`room:${code}:player:${uid}`, p); }
    }
    async function claim(code, gid, key, value) {
      const k = `room:${code}:step:${gid}:${key}`;
      if (get(k) == null) put(k, Object.assign({ by: uid }, clean(value)));
    }
    async function peek(code, gid, key) { return get(`room:${code}:step:${gid}:${key}`); }
    function wait(code, gid, key) {
      return new Promise(resolve => {
        const f = () => {
          const v = get(`room:${code}:step:${gid}:${key}`);
          if (v != null) { listeners.delete(f); resolve(v); }
        };
        listeners.add(f);
        f();
      });
    }
    return { init, getMeta, getPlayers, createMeta, setMeta, setPlayer, watchRoom, leave, claim, peek, wait, onConnected: () => {}, get uid() { return uid; } };
  }

  const backend = mode === 'firebase' ? firebaseBackend() : mode === 'local' ? localBackend() : null;

  global.AnimalNet = {
    available: !!backend,
    mode,
    newCode,
    backend,
  };
})(window);

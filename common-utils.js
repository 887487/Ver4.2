// =============================================================================
// common-utils.js
// sidemenu.js + hearing.js + keyboard-nav.js の統合ファイル
// index.html / mail.html / screen.html / admin.html 共通で読み込む
//
// 変更点：
//   ・ダークモードのデフォルトを「オフ（ライトモード）」に変更。
//     OS設定（prefers-color-scheme: dark）には追従しない。
//     ユーザーが手動でトグルを切り替えた場合のみダークモードになる。
//   ・triggerImport / importJSON：File System Access API（Chrome/Edge）を使って
//     開いているファイルと同じフォルダのJSONを選択できるよう変更。
//     データ反映後はページリロードなしで即時更新する。
// =============================================================================

// =============================================================================
// ⓪-P プロファイル（データファイルの切り替え）— 読み込みの最初に実行する
//
//   ・HTML / style.css / common-utils.js は全プロファイル共通。
//     プロファイルごとに異なるのはデータファイル（◯◯data.js）だけ。
//   ・ファイル名の「data.js」より前の部分をプロファイル名として扱う。
//       【NGH】data.js → NGH　／　data.js → 標準
//   ・どのデータファイルを読むかは、このファイルの先頭で決めて document.write で
//     同期読み込みする（各ページのインラインスクリプトより先にデータがそろう）。
//     そのため各 HTML には data.js の <script> を書かない。
//   ・選んだプロファイルは sessionStorage に保存する（ウィンドウを閉じるまで保持）。
//     file:// では新しいタブに sessionStorage が引き継がれないため、
//     openNamedTab で開くタブには URL の ?pg=（ウィンドウID）&pf=（ファイル名）で渡す。
//   ・IndexedDB・ヒアリング入力・他タブへの更新通知はプロファイルごとに分ける。
//     （混ざると、別プロファイルのスクリプトや画面遷移が表示されてしまうため）
// =============================================================================
(function () {
  var SEL_KEY      = 'appProfileSel';     // sessionStorage: { file, how }
  var GROUP_KEY    = 'appProfileGroup';   // sessionStorage: このウィンドウ（タブ群）のID
  // いま開いているツールのフォルダ（例：/C:/tools/）。一覧はフォルダごとに保存する
  // （localStorage は file:// 全体で共有されるため、別の場所にあるツールと混ざらないように）
  var FOLDER = '', PAGE = '';
  try {
    FOLDER = decodeURIComponent(location.pathname.replace(/[^\/]*$/, ''));
    PAGE   = decodeURIComponent(location.pathname.split('/').pop() || '');
  } catch (e) {}
  var LIST_KEY     = 'appProfileFiles:' + FOLDER;   // localStorage : 開いているフォルダで確かめたデータファイルの一覧
  var DEFAULT_FILE = 'data.js';
  var EXCLUDE      = { 'screen-data.js': 1 };   // 廃止済みのファイル。残っていても対象外

  function ssGet(k)    { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k)    { try { sessionStorage.removeItem(k); } catch (e) {} }

  /** プロファイルのデータファイルか（末尾が data.js のファイル） */
  function isDataFile(name) {
    name = String(name == null ? '' : name);
    if (!/data\.js$/i.test(name)) return false;
    if (/[\\\/]/.test(name)) return false;
    if (EXCLUDE[name.toLowerCase()]) return false;
    return true;
  }
  function isDefaultFile(file) { return String(file || '').toLowerCase() === DEFAULT_FILE; }
  /** 「data.js」より前の部分（例：【NGH】） */
  function prefixOf(file) { return String(file || '').slice(0, -7); }
  /** 表示用のプロファイル名（前後のカッコ・区切り記号を外す。空なら「標準」） */
  function nameOf(file) {
    var SEP = /^[\s_\-・.]+|[\s_\-・.]+$/g;
    var p = prefixOf(file).replace(SEP, '');
    var m = /^[【\[［「『(（〔<＜](.*)[】\]］」』)）〕>＞]$/.exec(p);
    if (m) p = m[1];
    p = p.replace(SEP, '');
    return p || '標準';
  }
  function uniqSort(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (f) {
      if (!isDataFile(f) || seen[f]) return;
      seen[f] = 1; out.push(f);
    });
    return out.sort(function (a, b) {
      if (isDefaultFile(a) !== isDefaultFile(b)) return isDefaultFile(a) ? -1 : 1;
      return nameOf(a).localeCompare(nameOf(b), 'ja');
    });
  }
  function readList() {
    try {
      var v = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return uniqSort(Array.isArray(v) ? v : []);
    } catch (e) { return []; }
  }
  function writeList(list) {
    list = uniqSort(list);
    try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch (e) {}
    return list;
  }
  function readSel() {
    try {
      var v = JSON.parse(ssGet(SEL_KEY) || 'null');
      return (v && isDataFile(v.file)) ? v : null;
    } catch (e) { return null; }
  }
  function writeSel(file, how) { ssSet(SEL_KEY, JSON.stringify({ file: file, how: how || 'user' })); }

  // ── 読み込めなかったファイル（このタブの間だけ覚える）──
  //   接続中のフォルダ（AppFS）と、いま開いているツールのフォルダが違うと、
  //   「検出では見つかるのに読み込めない」ファイルが出る。これを覚えておかないと
  //   検出 → 自動で開き直す → 失敗 → 検出 … と再読み込みを繰り返し、画面がちらつく。
  var BAD_KEY = 'appProfileBad';
  function readBad() {
    try { var v = JSON.parse(ssGet(BAD_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function addBad(file) {
    var b = readBad(); if (b.indexOf(file) < 0) { b.push(file); ssSet(BAD_KEY, JSON.stringify(b)); }
  }
  function removeBad(file) {
    var b = readBad().filter(function (f) { return f !== file; }); ssSet(BAD_KEY, JSON.stringify(b));
  }

  // ── 自動の再読み込み（利用者の操作によらないもの）の歯止め ──
  //   万一の繰り返しで画面がちらつき続けないよう、短時間に続いたら止めて選択モーダルに任せる。
  var RELOAD_KEY = 'appProfileAutoReload';
  function autoReload() {
    var now = Date.now(), r = null;
    try { r = JSON.parse(ssGet(RELOAD_KEY) || 'null'); } catch (e) {}
    if (!r || now - r.t > 15000) r = { n: 0, t: now };
    if (r.n >= 2) { P.reloadBlocked = true; return false; }
    r.n++; ssSet(RELOAD_KEY, JSON.stringify(r));
    P.reloading = true;
    try { location.reload(); } catch (e) {}
    return true;
  }

  // ── URL の ?pg= / ?pf=（openNamedTab で開いた新しいタブへの引き継ぎ）──
  var q = {};
  try {
    var sp = new URLSearchParams(location.search || '');
    q.pg = sp.get('pg'); q.pf = sp.get('pf');
    if (q.pg !== null || q.pf !== null) {
      sp.delete('pg'); sp.delete('pf');
      var rest = sp.toString();
      // 再読み込みで古い指定に戻らないよう、URL からは消しておく
      history.replaceState(history.state, '',
        (location.pathname.split('/').pop() || '') + (rest ? '?' + rest : '') + location.hash);
    }
  } catch (e) {}

  var group = ssGet(GROUP_KEY);
  if (!group) {
    // このタブで初めての読み込み。開いた側のタブと同じウィンドウとして扱う
    group = q.pg || ('w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    ssSet(GROUP_KEY, group);
    if (q.pf && isDataFile(q.pf) && !readSel()) writeSel(q.pf, 'inherit');
  }

  var sel  = readSel();
  var list = readList();
  var file = null, how = null;
  if (sel)                    { file = sel.file; how = sel.how; }
  else if (list.length === 1) { file = list[0];  how = 'auto'; }
  else if (list.length === 0) { file = DEFAULT_FILE; how = 'auto'; }   // 従来どおり data.js
  // 2件以上あって未選択 → 読み込まずに選択モーダルを出す

  var P = window.APP_PROFILE = {
    file:      file,              // 読み込むデータファイル名（未選択なら null）
    how:       how,               // 'user' 選択 / 'inherit' 開いたタブから / 'auto' 自動
    group:     group,             // ウィンドウ（タブ群）ID
    name:      file ? nameOf(file) : '',
    prefix:    file ? prefixOf(file) : '',
    isDefault: !!file && isDefaultFile(file),
    loaded:    false,             // データファイルを読み込めたか
    failed:    false,             // 読み込みに失敗したか
    failedFile: null
  };
  // IndexedDB は data.js（標準）なら従来の screenFlowDB をそのまま使う（既存データを引き継ぐ）
  P.idbName = !file ? 'screenFlowDB::(未選択)'
            : (P.isDefault ? 'screenFlowDB' : 'screenFlowDB::' + file);
  P.storageSuffix = !file ? '::(未選択)' : (P.isDefault ? '' : '::' + file);
  window.APP_IDB_NAME = P.idbName;

  var readyQueue = [], ready = false;

  window.AppProfile = {
    DEFAULT_FILE: DEFAULT_FILE,
    LIST_KEY: LIST_KEY,
    FOLDER: FOLDER,
    PAGE: PAGE,
    isDataFile: isDataFile, nameOf: nameOf, prefixOf: prefixOf, isDefaultFile: isDefaultFile,
    readList: readList, writeList: writeList, readSel: readSel, writeSel: writeSel,
    readBad: readBad, removeBad: removeBad, autoReload: autoReload,
    clearSel: function () { ssDel(SEL_KEY); },

    /** データファイル読み込み後に実行する処理を登録する（読み込み済みならすぐ実行） */
    onDataReady: function (fn) {
      if (ready) { try { fn(); } catch (e) { console.error(e); } }
      else readyQueue.push(fn);
    },

    _loadFailed: function () {
      P.failed = true;
      P.failedFile = P.file;
      addBad(P.file);
      // 読み込めなかったプロファイルの保存領域には触らない（未選択用に切り替える）
      P.idbName = 'screenFlowDB::(未選択)';
      P.storageSuffix = '::(未選択)';
      window.APP_IDB_NAME = P.idbName;
      if (typeof window.HEARING_KEY === 'string')     window.HEARING_KEY     = 'hearingState_v7' + P.storageSuffix;
      if (typeof window.HEARING_TPL_KEY === 'string') window.HEARING_TPL_KEY = 'hearingTemplate' + P.storageSuffix;
      if (window._APP_IDB_INST) { try { window._APP_IDB_INST.close(); } catch (e) {} window._APP_IDB_INST = null; }
      console.error('[profile] データファイル「' + P.file + '」を読み込めませんでした。');
    },

    _afterLoad: function () {
      if (P.file && !P.failed) {
        P.loaded = true;
        removeBad(P.file);
        ssDel(RELOAD_KEY);        // 読み込めたので、自動の再読み込みの回数を数え直す
        if (!readSel()) writeSel(P.file, P.how || 'auto');
        var l = readList();
        if (l.indexOf(P.file) < 0) { l.push(P.file); writeList(l); }
      } else if (P.failed) {
        // 見つからなかったファイルは一覧・選択から外す
        writeList(readList().filter(function (f) { return f !== P.failedFile; }));
        var s = readSel();
        if (s && s.file === P.failedFile) ssDel(SEL_KEY);
        // 残りが1件だけならそれを自動で開き直す（読み込めなかったファイルは除く）
        var bad = readBad();
        var rest = readList().filter(function (f) { return bad.indexOf(f) < 0; });
        if (rest.length === 1) {
          writeSel(rest[0], 'auto');
          autoReload();
        }
      }
      ready = true;
      var qd = readyQueue; readyQueue = [];
      qd.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    }
  };

  // ── 他タブへの更新通知（BroadcastChannel 'tool_data_update'）をプロファイルで分ける ──
  //   送信時に __profile を付け、受信時に自分と違うプロファイルの通知は捨てる。
  //   各ページの送受信コードはそのままで済むよう、ここで BroadcastChannel を包む。
  var NativeBC = window.BroadcastChannel;
  if (typeof NativeBC === 'function') {
    var onMsgDesc = Object.getOwnPropertyDescriptor(NativeBC.prototype, 'onmessage');
    var mine = function () { return P.file || null; };
    var accept = function (ev) {
      var d = ev && ev.data;
      if (!d || typeof d !== 'object' || !('__profile' in d)) return true;
      return d.__profile === mine();
    };
    var ProfileBC = function BroadcastChannel(name) {
      var ch = new NativeBC(name);
      if (name !== 'tool_data_update') return ch;
      var nativePost = ch.postMessage;
      ch.postMessage = function (msg) {
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
          msg = Object.assign({}, msg);
          msg.__profile = mine();
        }
        return nativePost.call(ch, msg);
      };
      if (onMsgDesc && onMsgDesc.set) {
        var userFn = null;
        Object.defineProperty(ch, 'onmessage', {
          configurable: true, enumerable: true,
          get: function () { return userFn; },
          set: function (fn) {
            userFn = (typeof fn === 'function') ? fn : null;
            onMsgDesc.set.call(ch, userFn ? function (ev) { if (accept(ev)) return userFn.call(ch, ev); } : null);
          }
        });
      }
      var nativeAdd = ch.addEventListener, nativeRemove = ch.removeEventListener, wraps = [];
      ch.addEventListener = function (type, fn, opt) {
        if (type !== 'message' || typeof fn !== 'function') return nativeAdd.call(ch, type, fn, opt);
        var w = function (ev) { if (accept(ev)) return fn.call(ch, ev); };
        wraps.push([fn, w]);
        return nativeAdd.call(ch, type, w, opt);
      };
      ch.removeEventListener = function (type, fn, opt) {
        if (type === 'message') {
          for (var i = 0; i < wraps.length; i++) {
            if (wraps[i][0] === fn) { var w = wraps[i][1]; wraps.splice(i, 1); return nativeRemove.call(ch, type, w, opt); }
          }
        }
        return nativeRemove.call(ch, type, fn, opt);
      };
      return ch;
    };
    ProfileBC.prototype = NativeBC.prototype;
    window.BroadcastChannel = ProfileBC;
  }

  // ── データファイルを同期で読み込む ──
  var html = '';
  if (file) {
    html += '<script src="' + encodeURIComponent(file).replace(/"/g, '%22') + '"'
          + ' onerror="window.AppProfile&&AppProfile._loadFailed()"><\/script>';
  }
  html += '<script>window.AppProfile&&AppProfile._afterLoad()<\/script>';
  document.write(html);
})();

// =============================================================================
// ⓪ 統合 IndexedDB レイヤー
//    全データを screenFlowDB（v5）の appData ストアで管理する。
//    DB 名はプロファイルごとに分かれる（window.APP_IDB_NAME。data.js＝標準は screenFlowDB のまま）。
//    フォルダ接続（fsDirHandle）だけは全プロファイル共通なので、共通 DB（screenFlowDB）に置く。
//    localStorage は darkMode と hearingState のみ継続使用。
// =============================================================================
var _APP_IDB_INST = null;
var _APP_IDB_SHARED = 'screenFlowDB';   // 全プロファイル共通の DB（フォルダ接続の保存先）
var _APP_IDB_INSTS  = {};                // 共通 DB など、プロファイル以外の DB 接続
// ヒアリング項目／対応方針／パターンのデフォルト内容を大幅に作り直した際にインクリメントする。
// IndexedDB 上の保存値とこの値が異なる場合、保存データを破棄して新しいデフォルトで上書きする。
var HEARING_DATA_VERSION = 2;

// ── 固定文言（オープニング／クロージング）──
// admin.html で編集し data.js に保存される。
// script.html でも同じ値を使うため、既定値と取得口を共通側に置く。
window.FIXED_TEXT_DEFAULTS = {
  opening:'お電話 ありがとうございます。＿＿＿窓口 担当●●でございます。',
  closingDefault: 'ご案内は以上となりますが、そのほか確認されたいことなどはございませんでしょうか？',
  closingNone:    'ありがとうございます。 それでは本日●●がご案内いたしました。それでは失礼いたします。',
  closingAsk:     '○○○についてでございますね。（お問い合わせ内容に回答）',
  // クロージングの切り替えボタンの表示名。管理画面から変えられる
  closingNoneLabel: '不明点なし',
  closingAskLabel:  '不明点あり'
};

/** 固定文言を1つ取り出す（未設定なら既定値） */
window.getFixedText = function(key) {
  var ft = (window._appCache && window._appCache.fixedTexts) || {};
  var v  = ft[key];
  if (v === undefined || v === null || v === '') v = window.FIXED_TEXT_DEFAULTS[key];
  return v || '';
};

/** 改行を <br> にして表示用の HTML にする */
window.fixedTextHtml = function(key) {
  return String(window.getFixedText(key))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
};
function _appIdbUpgrade(e) {
  var db = e.target.result;
  if (!db.objectStoreNames.contains('patterns'))      db.createObjectStore('patterns');
  if (!db.objectStoreNames.contains('imageLib'))       db.createObjectStore('imageLib');
  if (!db.objectStoreNames.contains('appData'))        db.createObjectStore('appData');
  if (!db.objectStoreNames.contains('sideMenuFiles')) db.createObjectStore('sideMenuFiles');
}
/** 名前を指定して DB を開く（プロファイルの DB 以外。接続は名前ごとに使い回す） */
function _appIdbOpenNamed(name) {
  if (name === (window.APP_IDB_NAME || 'screenFlowDB')) return _appIdbOpen();
  if (_APP_IDB_INSTS[name]) return Promise.resolve(_APP_IDB_INSTS[name]);
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(name, 5);
    req.onupgradeneeded = _appIdbUpgrade;
    req.onsuccess = function(e) {
      var db = e.target.result;
      _APP_IDB_INSTS[name] = db;
      db.onclose = function() { delete _APP_IDB_INSTS[name]; };
      db.onversionchange = function() { db.close(); delete _APP_IDB_INSTS[name]; };
      resolve(db);
    };
    req.onerror = function(e) { reject(e.target.error); };
  });
}
function _appIdbOpen() {
  if (_APP_IDB_INST) return Promise.resolve(_APP_IDB_INST);
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(window.APP_IDB_NAME || 'screenFlowDB', 5);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('patterns'))      db.createObjectStore('patterns');
      if (!db.objectStoreNames.contains('imageLib'))       db.createObjectStore('imageLib');
      if (!db.objectStoreNames.contains('appData'))        db.createObjectStore('appData');
      if (!db.objectStoreNames.contains('sideMenuFiles')) db.createObjectStore('sideMenuFiles');
    };
    req.onsuccess = function(e) {
      _APP_IDB_INST = e.target.result;
      _APP_IDB_INST.onclose = function() { _APP_IDB_INST = null; };
      _APP_IDB_INST.onversionchange = function() { _APP_IDB_INST.close(); _APP_IDB_INST = null; };
      resolve(_APP_IDB_INST);
    };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

window.idbGetAppData = function(key) {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('appData', 'readonly');
      var req = tx.objectStore('appData').get(key);
      req.onsuccess = function(e) { resolve(e.target.result !== undefined ? e.target.result : null); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
};

window.idbSetAppData = function(key, value) {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('appData', 'readwrite');
      var req = tx.objectStore('appData').put(value, key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function(e) { reject(e.target.error); };
    });
  });
};

/** 全プロファイル共通の値（フォルダ接続など）を読む */
window.idbGetSharedData = function(key) {
  return _appIdbOpenNamed(_APP_IDB_SHARED).then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('appData', 'readonly');
      var req = tx.objectStore('appData').get(key);
      req.onsuccess = function(e) { resolve(e.target.result !== undefined ? e.target.result : null); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
};

/** 全プロファイル共通の値（フォルダ接続など）を書く */
window.idbSetSharedData = function(key, value) {
  return _appIdbOpenNamed(_APP_IDB_SHARED).then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('appData', 'readwrite');
      tx.objectStore('appData').put(value, key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function(e) { reject(e.target.error); };
    });
  });
};

// =============================================================================
// ⓪-2 File System Access レイヤー（AppFS）
//   admin.html の「💾 保存して反映」から構成ファイル（data.js / common-utils.js）へ
//   サーバーなしで直接書き戻すための共通モジュール。
//
//   ・ディレクトリハンドルは IndexedDB（appData / 'fsDirHandle'）に永続化するため
//     フォルダ選択は初回の1回のみ。2回目以降は権限の再許可（1クリック）で済む。
//   ・非対応ブラウザ（Firefox / Safari）では isSupported() が false を返すので、
//     呼び出し側は従来どおりダウンロード方式にフォールバックする。
//   ・読み込みも必ずハンドル経由（getFile().text()）で行う。
//     fetch() は file:// で CORS により失敗するため使わない。
//
//   ※ pick() / ensure(true) はユーザー操作（クリック）起点で呼ぶこと。
// =============================================================================
window.AppFS = (function() {
  var HANDLE_KEY = 'fsDirHandle';
  var _dir    = null;   // メモリ上のディレクトリハンドル
  var _loaded = false;  // IDB からの読み出し済みフラグ

  /**
   * ネットワークパス（file://host/...）で開かれた場合、ブラウザは
   * 安全なコンテキストとみなさず showDirectoryPicker を提供しない。
   * 非対応として扱い、ダウンロードへフォールバックさせる。
   */
  function _isUnc() {
    try { return location.protocol === 'file:' && !!location.host; } catch (e) { return false; }
  }

  function isSupported() {
    if (_isUnc()) return false;
    return typeof window.showDirectoryPicker === 'function';
  }

  // IDB に永続化されたハンドルを復元する
  function _loadFromIdb() {
    if (_loaded) return Promise.resolve(_dir);
    return window.idbGetSharedData(HANDLE_KEY).then(function(h) {
      _loaded = true;
      if (h && typeof h.getFileHandle === 'function') _dir = h;
      return _dir;
    }).catch(function() { _loaded = true; return null; });
  }

  /**
   * 接続状態を返す。
   * 'unsupported' … API 非対応ブラウザ
   * null          … ハンドル未登録（フォルダ未接続）
   * 'granted'     … 書き込み可能
   * 'prompt'      … 再許可が必要
   * 'denied'      … 拒否済み
   */
  function status() {
    if (!isSupported()) return Promise.resolve('unsupported');
    return _loadFromIdb().then(function(dir) {
      if (!dir) return null;
      if (!dir.queryPermission) return 'granted';
      return dir.queryPermission({ mode: 'readwrite' });
    }).catch(function() { return null; });
  }

  /** フォルダ選択ダイアログを開いてハンドルを保存する */
  function pick() {
    if (!isSupported()) return Promise.reject(new Error('このブラウザは File System Access API に対応していません'));
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'toolRootDir' }).then(function(dir) {
      _dir = dir; _loaded = true;
      return window.idbSetSharedData(HANDLE_KEY, dir).then(function() { return dir; });
    });
  }

  /**
   * 書き込み可能なディレクトリハンドルを返す。取得できない場合は null。
   * @param {boolean} allowPrompt true ならフォルダ選択／権限要求ダイアログを出してよい
   */
  function ensure(allowPrompt) {
    if (!isSupported()) return Promise.resolve(null);
    return _loadFromIdb().then(function(dir) {
      if (!dir) return allowPrompt ? pick() : null;
      if (!dir.queryPermission) return dir;
      return dir.queryPermission({ mode: 'readwrite' }).then(function(p) {
        if (p === 'granted') return dir;
        if (!allowPrompt) return null;
        return dir.requestPermission({ mode: 'readwrite' }).then(function(p2) {
          if (p2 === 'granted') return dir;
          return pick();   // 拒否された場合はフォルダを選び直してもらう
        });
      });
    }).catch(function() {
      return allowPrompt ? pick() : null;
    });
  }

  /** 接続フォルダ内のファイルをテキストで読む。存在しなければ null */
  function readText(name, allowPrompt) {
    return ensure(allowPrompt === true).then(function(dir) {
      if (!dir) return null;
      return dir.getFileHandle(name, { create: false })
        .then(function(fh) { return fh.getFile(); })
        .then(function(f)  { return f.text(); })
        .catch(function()  { return null; });
    });
  }

  /** 接続フォルダ内のファイルへ書き込む。成功で true、フォルダ未接続で false */
  function writeText(name, text, allowPrompt) {
    return ensure(allowPrompt !== false).then(function(dir) {
      if (!dir) return false;
      return dir.getFileHandle(name, { create: true }).then(function(fh) {
        return fh.createWritable().then(function(w) {
          return Promise.resolve(w.write(text)).then(function() { return w.close(); });
        });
      }).then(function() { return true; });
    });
  }

  /** 'sub/file.png' 形式のパスを { dir, name } に解決する */
  function _resolvePath(dir, path, create) {
    var parts = String(path).split('/').filter(Boolean);
    var name  = parts.pop();
    var p = Promise.resolve(dir);
    parts.forEach(function(seg) {
      p = p.then(function(d) { return d.getDirectoryHandle(seg, { create: !!create }); });
    });
    return p.then(function(d) { return { dir: d, name: name }; });
  }

  /** バイナリ（Blob）を書き込む。サブフォルダは自動作成する */
  function writeBinary(path, blob, allowPrompt) {
    return ensure(allowPrompt !== false).then(function(dir) {
      if (!dir) return false;
      return _resolvePath(dir, path, true).then(function(loc) {
        return loc.dir.getFileHandle(loc.name, { create: true }).then(function(fh) {
          return fh.createWritable().then(function(w) {
            return Promise.resolve(w.write(blob)).then(function() { return w.close(); });
          });
        });
      }).then(function() { return true; });
    });
  }

  /**
   * 'a/b/c' 形式のパスからディレクトリハンドルを取得する。
   * getDirectoryHandle は「名前」しか受け取らないため、1階層ずつ辿る必要がある。
   * （スラッシュ入りの文字列をそのまま渡すと必ず失敗する）
   */
  function _resolveDir(root, path) {
    var parts = String(path == null ? '' : path).split('/').filter(Boolean);
    var p = Promise.resolve(root);
    parts.forEach(function(seg) {
      p = p.then(function(d) { return d.getDirectoryHandle(seg, { create: false }); });
    });
    return p;
  }

  /** サブフォルダ内のファイル名一覧を返す（存在しなければ空配列） */
  function listFiles(subdir) {
    return ensure(false).then(function(dir) {
      if (!dir) return [];
      return _resolveDir(dir, subdir).then(function(d) {
        return (async function() {
          var names = [];
          for await (var entry of d.values()) {
            if (entry.kind === 'file') names.push(entry.name);
          }
          return names;
        })();
      }).catch(function() { return []; });
    });
  }

  /** ファイルを Blob として読む（存在しなければ null） */
  function readBinary(path) {
    return ensure(false).then(function(dir) {
      if (!dir) return null;
      var parts = String(path || '').split('/').filter(Boolean);
      var name  = parts.pop();
      var cur   = Promise.resolve(dir);
      parts.forEach(function(seg) {
        cur = cur.then(function(d){ return d.getDirectoryHandle(seg, { create: false }); });
      });
      return cur.then(function(d){ return d.getFileHandle(name, { create: false }); })
                .then(function(fh){ return fh.getFile(); })
                .catch(function(){ return null; });
    }).catch(function(){ return null; });
  }

  /** サブフォルダ名の一覧を返す */
  function listDirs(subdir) {
    return ensure(false).then(function(dir) {
      if (!dir) return [];
      return _resolveDir(dir, subdir).then(function(d) {
        return (async function() {
          var names = [];
          for await (var entry of d.values()) {
            if (entry.kind === 'directory') names.push(entry.name);
          }
          return names;
        })();
      }).catch(function() { return []; });
    });
  }

  /** 空のフォルダを削除する */
  function removeDir(path) {
    return ensure(false).then(function(dir) {
      if (!dir) return false;
      return _resolvePath(dir, path, false)
        .then(function(loc) { return loc.dir.removeEntry(loc.name, { recursive: false }); })
        .then(function() { return true; })
        .catch(function() { return false; });   // 空でなければ失敗するのでそのまま無視
    });
  }

  /** ファイルを削除する */
  function removeFile(path) {
    return ensure(false).then(function(dir) {
      if (!dir) return false;
      return _resolvePath(dir, path, false)
        .then(function(loc) { return loc.dir.removeEntry(loc.name); })
        .then(function() { return true; })
        .catch(function() { return false; });
    });
  }

  /** 接続を解除する */
  function forget() {
    _dir = null; _loaded = true;
    return window.idbSetSharedData(HANDLE_KEY, null);
  }

  /** 接続中フォルダ名（未接続なら null） */
  function dirName() { return _dir ? _dir.name : null; }

  return {
    isSupported: isSupported, status: status, pick: pick, ensure: ensure,
    readText: readText, writeText: writeText, writeBinary: writeBinary, readBinary: readBinary,
    listFiles: listFiles, listDirs: listDirs, removeFile: removeFile, removeDir: removeDir,
    forget: forget, dirName: dirName
  };
})();

// dataURL(base64) → Blob。画像を実ファイルとして書き出すために使う。
window.dataUrlToBlob = function(dataUrl) {
  var m = /^data:([^;,]+)?(;base64)?,/.exec(dataUrl || '');
  if (!m) return null;
  var mime   = m[1] || 'application/octet-stream';
  var body   = dataUrl.slice(m[0].length);
  if (!m[2]) return new Blob([decodeURIComponent(body)], { type: mime });
  var bin = atob(body);
  var buf = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
};

// MIME タイプから拡張子を決める
window.mimeToExt = function(mime) {
  var map = { 'image/png':'png', 'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/gif':'gif',
              'image/webp':'webp', 'image/svg+xml':'svg', 'image/bmp':'bmp' };
  return map[(mime || '').toLowerCase()] || 'png';
};

// =============================================================================
// ⓪-3 画面遷移データの構成ファイル読み込み（data.js 内の window.APP_SCREEN_DATA）
//   画面遷移データは、
//   ・data.js              … パターン構造のみ（画像は "lib:xxx" 参照のまま）
//   ・screen-images/*.png  … 画像を実ファイルとして保存
//   の2か所に分けている。base64 を JS に埋め込まないため、
//   ファイルサイズが小さく、画像はブラウザキャッシュも効く。
//   （以前は別ファイルの screen-data.js だったが、data.js に統合した）
// =============================================================================
window._SCREEN_IMG_MAP = window._SCREEN_IMG_MAP || {};

window.initScreenStaticData = function() {
  if (window._screenStaticPromise) return window._screenStaticPromise;

  var sd = window.APP_SCREEN_DATA;
  if (!sd || !Array.isArray(sd.patterns)) {
    window._screenStaticPromise = Promise.resolve(null);
    return window._screenStaticPromise;
  }

  // 画像マップは同期的に登録する（描画側の解決フォールバックで即使えるように）
  window._SCREEN_IMG_MAP = sd.images || {};

  window._screenStaticPromise = window.idbGetAppData('screenSavedAt').then(function(idbRaw) {
    var idbTs  = idbRaw ? (Date.parse(idbRaw) || 0) : 0;
    var fileTs = Date.parse(sd.savedAt) || 0;
    // IDB の方が新しい（＝このPCで編集済み）場合はファイルを適用しない
    if (fileTs <= idbTs) return null;
    return _appIdbOpen().then(function(db) {
      return new Promise(function(resolve) {
        var tx = db.transaction('patterns', 'readwrite');
        try { tx.objectStore('patterns').put(sd.patterns, 'data'); } catch(e) {}
        tx.oncomplete = function() { resolve(); };
        tx.onerror    = function() { resolve(); };
        tx.onabort    = function() { resolve(); };
      });
    }).then(function() {
      return window.idbSetAppData('screenSavedAt', sd.savedAt);
    }).then(function() {
      return sd.patterns;
    });
  }).catch(function() { return null; });

  return window._screenStaticPromise;
};

/**
 * data.js の library を IndexedDB の imageLib へ復元する。
 *
 * 以前は画面遷移データにパターンと画像ファイルしか含めていなかったため、
 * 別PCでフォルダを受け取ると「画面遷移は見えるのに画像ライブラリは空」に
 * なっていた。ここで一覧を作り直す。
 * dataUrl には base64 ではなくファイルの相対パスを入れる（<img src> で表示できる）。
 */
window.hydrateImageLibrary = function() {
  var sd = window.APP_SCREEN_DATA;
  if (!sd || !Array.isArray(sd.library) || !sd.library.length) return Promise.resolve(0);

  return new Promise(function(resolve) {
    var req = indexedDB.open(window.APP_IDB_NAME || 'screenFlowDB');
    req.onerror = function() { resolve(0); };
    req.onsuccess = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('imageLib')) { db.close(); resolve(0); return; }

      // まずキーだけを取得して差分を求める。
      // レコード本体には base64 画像が入っているため、1件ずつ get すると
      // 数十MBを読み込むことになり、起動が目に見えて遅くなる。
      var ktx = db.transaction('imageLib', 'readonly');
      var kq  = ktx.objectStore('imageLib').getAllKeys();

      kq.onerror = function() { db.close(); resolve(0); };
      kq.onsuccess = function(ev) {
        var have = {};
        (ev.target.result || []).forEach(function(k) { have[k] = 1; });

        var missing = sd.library.filter(function(m) { return !have[m.id]; });
        if (!missing.length) { db.close(); resolve(0); return; }

        var wtx   = db.transaction('imageLib', 'readwrite');
        var store = wtx.objectStore('imageLib');
        missing.forEach(function(meta) {
          // imageLib は out-of-line key（keyPath なし・自動採番なし）のため、
          // put の第2引数でキーを明示しないと DataError になる
          store.put({
            id:         meta.id,
            name:       meta.name || meta.id,
            folder:     meta.folder || '',
            note:       meta.note || '',
            dataUrl:    meta.file,          // 相対パス。<img src> で解決される
            hotspots:   meta.hotspots || [],
            hsLinkFrom: meta.hsLinkFrom || null,
            createdAt:  Date.now()
          }, meta.id);
        });
        wtx.oncomplete = function() { db.close(); resolve(missing.length); };
        wtx.onerror    = function() { db.close(); resolve(0); };
        wtx.onabort    = function() { db.close(); resolve(0); };
      };
    };
  }).catch(function() { return 0; });
};

/** "lib:xxx" の xxx から画像ファイルの相対パスを返す。無ければ null */
window.screenImgFileSrc = function(libId) {
  var m = window._SCREEN_IMG_MAP;
  return (m && m[libId]) ? m[libId] : null;
};

// =============================================================================
// ⓪-4 XLSX リーダー（外部ライブラリ不要）
//   .xlsx は「ZIP に XML を詰めたもの」なので、
//   ・ZIP の解凍 … ブラウザ標準の DecompressionStream('deflate-raw')
//   ・XML の解析 … ブラウザ標準の DOMParser
//   だけで読める。CDN も同梱ライブラリも不要なため file:// のまま動作する。
//   ※ Chrome / Edge 前提（AppFS と同じ条件）
// =============================================================================
(function() {

  function _u16(dv, p) { return dv.getUint16(p, true); }
  function _u32(dv, p) { return dv.getUint32(p, true); }

  /** ZIP の中央ディレクトリを解析して { path: {offset, method, compSize} } を返す */
  function _zipIndex(buf) {
    var dv = new DataView(buf), len = buf.byteLength;
    // EOCD（End Of Central Directory）を末尾から探す
    var eocd = -1, min = Math.max(0, len - 65557);
    for (var i = len - 22; i >= min; i--) {
      if (_u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 構造を読み取れません（.xlsx ファイルではない可能性があります）');

    var count  = _u16(dv, eocd + 10);
    var cdOff  = _u32(dv, eocd + 16);
    if (cdOff === 0xffffffff) throw new Error('ZIP64 形式には対応していません');

    var entries = {}, p = cdOff, dec = new TextDecoder('utf-8');
    for (var n = 0; n < count; n++) {
      if (_u32(dv, p) !== 0x02014b50) break;
      var method   = _u16(dv, p + 10);
      var compSize = _u32(dv, p + 20);
      var nameLen  = _u16(dv, p + 28);
      var extraLen = _u16(dv, p + 30);
      var cmtLen   = _u16(dv, p + 32);
      var loOff    = _u32(dv, p + 42);
      var name     = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      entries[name] = { method: method, compSize: compSize, localOffset: loOff };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  /** ZIP エントリを取り出して文字列で返す */
  function _zipRead(buf, entries, path) {
    var e = entries[path];
    if (!e) return Promise.resolve(null);
    var dv = new DataView(buf);
    var lo = e.localOffset;
    if (_u32(dv, lo) !== 0x04034b50) return Promise.resolve(null);
    var dataStart = lo + 30 + _u16(dv, lo + 26) + _u16(dv, lo + 28);
    var raw = new Uint8Array(buf, dataStart, e.compSize);

    // 無圧縮（method 0）はそのまま
    if (e.method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(raw));
    if (e.method !== 8) return Promise.reject(new Error('未対応の圧縮方式です (method=' + e.method + ')'));
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('このブラウザは解凍に対応していません（Chrome / Edge をご利用ください）'));
    }
    var ds = new DecompressionStream('deflate-raw');
    // Uint8Array のビューをそのまま渡すと元バッファ全体が流れるのでコピーする
    var blob = new Blob([raw.slice(0)]);
    return new Response(blob.stream().pipeThrough(ds)).text();
  }

  /** _zipRead のバイナリ版（画像を取り出すのに使う） */
  function _zipReadBinary(buf, entries, path) {
    var e = entries[path];
    if (!e) return Promise.resolve(null);
    var dv = new DataView(buf);
    var lo = e.localOffset;
    if (_u32(dv, lo) !== 0x04034b50) return Promise.resolve(null);
    var dataStart = lo + 30 + _u16(dv, lo + 26) + _u16(dv, lo + 28);
    var raw = new Uint8Array(buf, dataStart, e.compSize);

    if (e.method === 0) return Promise.resolve(raw.slice(0));
    if (e.method !== 8) return Promise.resolve(null);
    if (typeof DecompressionStream !== 'function') return Promise.resolve(null);

    var ds = new DecompressionStream('deflate-raw');
    var blob = new Blob([raw.slice(0)]);
    return new Response(blob.stream().pipeThrough(ds)).arrayBuffer()
      .then(function(ab) { return new Uint8Array(ab); })
      .catch(function() { return null; });
  }

  function _parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML の解析に失敗しました');
    return doc;
  }

  /** "BC12" → 列インデックス(0始まり) */
  function _colIndex(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  /** sharedStrings.xml → 文字列配列（ふりがな rPh は除外する） */
  /**
   * 共有文字列を読む。
   * セル内の書式（太字・斜体・下線・取り消し線・文字色）は <r><rPr> に入っているので、
   * プレーンテキストと合わせて HTML も組み立てて返す。
   *   out[i]      … プレーンテキスト（従来どおり）
   *   out[i].html … 書式を反映した HTML
   */
  function _parseSharedStrings(doc) {
    if (!doc) return [];
    var sis = doc.getElementsByTagName('si'), out = [];
    out.html = [];   // 添字ごとの書式付き HTML
    for (var i = 0; i < sis.length; i++) {
      var si = sis[i];
      // 本文の <t> だけを拾う（<rPh> はふりがななので除外）
      var ts = si.getElementsByTagName('t'), plain = '';
      for (var j = 0; j < ts.length; j++) {
        var skip = false, p = ts[j].parentNode;
        while (p && p !== si) {
          if ((p.localName || p.nodeName) === 'rPh') { skip = true; break; }
          p = p.parentNode;
        }
        if (!skip) plain += ts[j].textContent;
      }
      out.push(plain);
      out.html[i] = _richToHtml(si);
    }
    return out;
  }


  /**
   * <si> や <is> の中身から、書式を反映した HTML を組み立てる。
   * 太字・斜体・下線・取り消し線・文字色に対応する。
   */
  function _richToHtml(node) {
    if (!node) return '';
    var esc = function(t) {
      return String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    var childByName = function(el, name) {
      if (!el) return null;
      for (var k = 0; k < el.childNodes.length; k++) {
        var c = el.childNodes[k];
        if ((c.localName || c.nodeName) === name) return c;
      }
      return null;
    };

    var html = '';
    for (var n = 0; n < node.childNodes.length; n++) {
      var run = node.childNodes[n];
      var nm  = run.localName || run.nodeName;
      if (nm !== 'r' && nm !== 't') continue;

      var tEl = (nm === 't') ? run : childByName(run, 't');
      if (!tEl) continue;

      var open = '', close = '';
      var pr = (nm === 'r') ? childByName(run, 'rPr') : null;
      if (pr) {
        var has = function(tag) {
          var e = childByName(pr, tag);
          if (!e) return false;
          var v = e.getAttribute('val');
          return v === null || v === '' || v === '1' || v === 'true';
        };
        if (has('b'))      { open += '<strong>'; close = '</strong>' + close; }
        if (has('i'))      { open += '<em>';     close = '</em>' + close; }
        if (has('strike')) { open += '<s>';      close = '</s>' + close; }
        var u = childByName(pr, 'u');
        if (u && (u.getAttribute('val') || 'single') !== 'none') {
          open += '<u>'; close = '</u>' + close;
        }
        var col = childByName(pr, 'color');
        var rgb = col && col.getAttribute('rgb');
        if (rgb && /^[0-9A-Fa-f]{6,8}$/.test(rgb)) {
          var hex = rgb.length === 8 ? rgb.slice(2) : rgb;   // ARGB → RGB
          if (hex.toUpperCase() !== '000000') {
            open += '<span style="color:#' + hex + '">'; close = '</span>' + close;
          }
        }
      }
      html += open + esc(tEl.textContent).replace(/\n/g, '<br>') + close;
    }
    return html;
  }

  /**
   * 文字列に HTML を添えて返す。
   * String オブジェクトを使うと JSON 化や比較で扱いを誤りやすいため、
   * プレーン文字列を返し、書式は別のマップ（rows.html）で持つ。
   */
  function _richValue(text, html, store, r, c) {
    var t = (text == null ? '' : String(text));
    if (store && html) store[r + ',' + c] = html;
    return t;
  }

  /**
   * シートに貼られた画像を取り出す。
   *
   * xlsx では画像はセルの中ではなく drawing として「この行・この列の位置」に
   * 浮かんでいる。アンカーの行列を見て、対応するセルの画像として拾う。
   *   sheet.xml.rels → drawingN.xml → drawingN.xml.rels → xl/media/*
   * @returns Promise<{ 'r,c': [dataURL, ...] }>
   */
  function _readSheetImages(buf, entries, sheetPath) {
    var relPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
    return _zipRead(buf, entries, relPath).then(function(relXml) {
      if (!relXml) return {};
      var rels = _parseXml(relXml).getElementsByTagName('Relationship');
      var drawPath = null;
      for (var i = 0; i < rels.length; i++) {
        if (/drawing/i.test(rels[i].getAttribute('Type') || '')) {
          var t = (rels[i].getAttribute('Target') || '').replace(/^\.\.\//, '').replace(/^\/?xl\//, '');
          drawPath = 'xl/' + t;
          break;
        }
      }
      if (!drawPath) return {};

      var dRelPath = drawPath.replace(/([^/]+)$/, '_rels/$1.rels');
      return Promise.all([
        _zipRead(buf, entries, drawPath),
        _zipRead(buf, entries, dRelPath)
      ]).then(function(r) {
        if (!r[0]) return {};
        var doc = _parseXml(r[0]);
        // rId → メディアのパス
        var media = {};
        if (r[1]) {
          var drs = _parseXml(r[1]).getElementsByTagName('Relationship');
          for (var k = 0; k < drs.length; k++) {
            var tt = (drs[k].getAttribute('Target') || '').replace(/^\.\.\//, '').replace(/^\/?xl\//, '');
            media[drs[k].getAttribute('Id')] = 'xl/' + tt;
          }
        }

        // アンカーごとに「行・列」と画像を対応づける
        var jobs = [], map = {};
        var anchors = [];
        ['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor'].forEach(function(tag) {
          var els = doc.getElementsByTagName(tag);
          for (var a = 0; a < els.length; a++) anchors.push(els[a]);
        });

        anchors.forEach(function(an) {
          var from = an.getElementsByTagName('from')[0];
          var col = 0, row = 0;
          if (from) {
            var cEl = from.getElementsByTagName('col')[0];
            var rEl = from.getElementsByTagName('row')[0];
            col = cEl ? parseInt(cEl.textContent, 10) : 0;
            row = rEl ? parseInt(rEl.textContent, 10) : 0;
          }
          var blips = an.getElementsByTagName('blip');
          if (!blips.length) blips = an.getElementsByTagName('a:blip');
          for (var b = 0; b < blips.length; b++) {
            var rid = blips[b].getAttribute('r:embed') || blips[b].getAttribute('embed');
            var mp  = rid && media[rid];
            if (!mp) continue;
            (function(mPath, key) {
              jobs.push(
                _zipReadBinary(buf, entries, mPath).then(function(bytes) {
                  if (!bytes) return;
                  var ext  = (mPath.split('.').pop() || 'png').toLowerCase();
                  var mime = ext === 'jpg' ? 'image/jpeg'
                           : ext === 'svg' ? 'image/svg+xml' : 'image/' + ext;
                  var url  = 'data:' + mime + ';base64,' + _bytesToBase64(bytes);
                  (map[key] = map[key] || []).push(url);
                }).catch(function(){})
              );
            })(mp, row + ',' + col);
          }
        });
        return Promise.all(jobs).then(function() { return map; });
      }).catch(function() { return {}; });
    }).catch(function() { return {}; });
  }

  /** Uint8Array → base64（大きい画像でも落ちないよう分割して変換する） */
  function _bytesToBase64(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /** worksheet XML → 2次元配列 */
  function _parseSheet(doc, shared) {
    var rowsEl = doc.getElementsByTagName('row'), rows = [];
    rows.html = {};   // 'row,col' → 書式付き HTML
    for (var i = 0; i < rowsEl.length; i++) {
      var rEl  = rowsEl[i];
      var rNum = parseInt(rEl.getAttribute('r') || (i + 1), 10) - 1;
      var cs   = rEl.getElementsByTagName('c');
      var row  = rows[rNum] || (rows[rNum] = []);
      for (var j = 0; j < cs.length; j++) {
        var c   = cs[j];
        var ref = c.getAttribute('r') || '';
        var ci  = ref ? _colIndex(ref) : j;
        var t   = c.getAttribute('t');
        var val = '';
        if (t === 'inlineStr') {
          var isNode = c.getElementsByTagName('is')[0];
          var isEl = c.getElementsByTagName('t');
          for (var k = 0; k < isEl.length; k++) val += isEl[k].textContent;
          val = _richValue(val, _richToHtml(isNode), rows.html, rNum, ci);
        } else {
          var vEl = c.getElementsByTagName('v')[0];
          var raw = vEl ? vEl.textContent : '';
          if (t === 's') {
            var si2 = parseInt(raw, 10);
            val = shared[si2] || '';
            var sh = shared.html && shared.html[si2];
            if (sh) rows.html[rNum + ',' + ci] = sh;
          }
          else if (t === 'b') val = (raw === '1') ? 'TRUE' : 'FALSE';
          else if (t === 'e') val = '';
          else                val = raw;
        }
        if (ci >= 0) row[ci] = val;
      }
    }
    // 未定義の穴を空文字で埋める
    for (var r = 0; r < rows.length; r++) {
      if (!rows[r]) { rows[r] = []; continue; }
      for (var q = 0; q < rows[r].length; q++) if (rows[r][q] == null) rows[r][q] = '';
    }
    return rows;
  }

  /**
   * File / Blob / ArrayBuffer を読み、シートごとの2次元配列を返す。
   * @returns Promise<{ sheets: [{ name, rows }] }>
   */
  window.readXlsx = function(input) {
    var bufP = (input instanceof ArrayBuffer) ? Promise.resolve(input) : input.arrayBuffer();

    return bufP.then(function(buf) {
      var entries = _zipIndex(buf);
      if (!entries['xl/workbook.xml']) {
        throw new Error('ワークブックが見つかりません。.xlsx 形式で保存されているか確認してください（.xls / .csv は非対応）');
      }
      return Promise.all([
        _zipRead(buf, entries, 'xl/workbook.xml'),
        _zipRead(buf, entries, 'xl/_rels/workbook.xml.rels'),
        _zipRead(buf, entries, 'xl/sharedStrings.xml')
      ]).then(function(res) {
        var wb     = _parseXml(res[0]);
        var rels   = res[1] ? _parseXml(res[1]) : null;
        var shared = res[2] ? _parseSharedStrings(_parseXml(res[2])) : [];

        // rId → ファイルパス
        var relMap = {};
        if (rels) {
          var rs = rels.getElementsByTagName('Relationship');
          for (var i = 0; i < rs.length; i++) {
            var tgt = rs[i].getAttribute('Target') || '';
            tgt = tgt.replace(/^\/?xl\//, '').replace(/^\.\//, '');
            relMap[rs[i].getAttribute('Id')] = 'xl/' + tgt;
          }
        }

        var sheetEls = wb.getElementsByTagName('sheet'), jobs = [];
        for (var s = 0; s < sheetEls.length; s++) {
          (function(el, idx) {
            var name = el.getAttribute('name') || ('Sheet' + (idx + 1));
            var rid  = el.getAttribute('r:id') || el.getAttribute('id') ||
                       (el.attributes.getNamedItem('r:id') ? el.attributes.getNamedItem('r:id').value : null);
            var path = (rid && relMap[rid]) || ('xl/worksheets/sheet' + (idx + 1) + '.xml');
            jobs.push(
              _zipRead(buf, entries, path).then(function(xml) {
                var rows = xml ? _parseSheet(_parseXml(xml), shared) : [];
                // 書式はセル位置（'行,列'）をキーにして添える
                return { name: name, rows: rows, html: rows.html || {} };
              }).catch(function() { return { name: name, rows: [], html: {} }; })
            );
          })(sheetEls[s], s);
        }
        return Promise.all(jobs).then(function(sheets) { return { sheets: sheets }; });
      });
    });
  };
})();

// =============================================================================
// サイドメニューの固定セクション（ショートカットキー／フォネティックコード／メールドメイン）
//
// この3つの「内容」（名称・説明・行）は、このファイルで管理する。
//   ・内容を変えたいとき … 下の SHORTCUTS / SIDEMENU_DEFAULT_TABLES を書き換える
//   ・data.js の sideMenuData には、表示順（並び）だけを持たせる（{ id, type } のみ）
// data.js に内容が残っていても、読み込み時にここの定義で置き換える。
// =============================================================================

/** 内容をこのファイルで管理するセクションの ID */
window.SIDEMENU_FIXED_IDS = ['sm_shortcut', 'sm_phonetic', 'sm_domain'];

// ── ショートカットキー一覧 ──
// 一般的な PC 操作のキー。このツール固有の操作は使い方マニュアルに載せる。
var SHORTCUTS = [
  ['編集', [
    ['Ctrl + C',        'コピー'],
    ['Ctrl + X',        '切り取り'],
    ['Ctrl + V',        '貼り付け'],
    ['Ctrl + Shift + V','書式なしで貼り付け'],
    ['Ctrl + Z',        '元に戻す'],
    ['Ctrl + Y',        'やり直し'],
    ['Ctrl + A',        'すべて選択'],
    ['Ctrl + S',        '保存（管理画面では「保存して反映」）']
  ]],
  ['文字の書式', [
    ['Ctrl + B',        '太字'],
    ['Ctrl + I',        '斜体'],
    ['Ctrl + U',        '下線']
  ]],
  ['ページ操作', [
    ['Ctrl + F',        'ページ内を検索'],
    ['F5',              '再読み込み'],
    ['Ctrl + Shift + R','キャッシュを無視して再読み込み'],
    ['Ctrl + P',        '印刷'],
    ['Ctrl + マウスホイール', '拡大 / 縮小'],
    ['Ctrl + 0',        '表示倍率を100%に戻す']
  ]],
  ['タブ・ウィンドウ', [
    ['Ctrl + T',        '新しいタブ'],
    ['Ctrl + W',        'タブを閉じる'],
    ['Ctrl + Shift + T','閉じたタブを開き直す'],
    ['Ctrl + Tab',      '次のタブへ'],
    ['Alt + Tab',       'ウィンドウを切り替え'],
    ['Win + ← / →',     'ウィンドウを左右に寄せる']
  ]],
  ['文字入力', [
    ['半角/全角',        '日本語入力の切り替え'],
    ['F7',              'カタカナに変換'],
    ['F8',              '半角カタカナに変換'],
    ['F9',              '全角英数に変換'],
    ['F10',             '半角英数に変換']
  ]]
];


// ── 表のセクション（フォネティックコード／メールドメイン一覧）と、ショートカットの見出し ──
window.SIDEMENU_DEFAULT_TABLES = [
  {
    id: 'sm_shortcut', type: 'shortcut', label: '⌨️ ショートカットキー一覧',
    note: 'このツール固有の操作は、各ページの「?」から見られる使い方マニュアルをご覧ください。',
    groups: null   // 実際の内容は _defaultShortcutGroups()（SHORTCUTS）から入れる
  },
  {
    id: 'sm_phonetic', type: 'table', label: '📖 フォネティックコード',
    headers: ['アルファベット', '読み方'],
    rows: [
      ['A','アメリカ'],['B','ブラジル'],['C','チャイナ'],['D','デンマーク'],
      ['E','エジプト'],['F','フランス'],['G','ゴルフ'],['H','ホテル'],
      ['I','イタリア'],['J','ジャパン'],['K','キログラム'],['L','ロンドン'],
      ['M','メキシコ'],['N','ノルウェー'],['O','オーサカ'],['P','パリ'],
      ['Q','クイーン'],['R','ローマ'],['S','スペイン'],['T','トウキョウ'],
      ['U','ユニオン'],['V','ビクトリー'],['W','ワシントン'],['X','エックスレイ'],
      ['Y','ヨコハマ'],['Z','ゼブラ'],
      ['-','ハイフン'],['_','アンダーバー']
    ]
  },
{
    id: 'sm_domain', type: 'table', label: '📧 メールドメイン一覧',
    note: 'サイドメニューに表示する参照用の一覧です。ヒアリングシートのメールドメイン候補とは別管理です。',
    headers: ['ドメイン'],
    rows: [
      ['aol.com'],
      ['asahinet.jp'],
      ['au.com'],
      ['auone-net.jp'],
      ['bbiq.jp'],
      ['biglobe.ne.jp'],
      ['biz.ezweb.ne.jp'],
      ['canet.ne.jp'],
      ['commufa.jp'],
      ['dion.ne.jp'],
      ['docomo.ne.jp'],
      ['dream.com'],
      ['dti.ne.jp'],
      ['eonet.ne.jp'],
      ['excite.co.jp'],
      ['ezweb.ne.jp'],
      ['gmail.com'],
      ['gmobb.jp'],
      ['gol.com'],
      ['goo.jp'],
      ['googlemail.com'],
      ['goomail.com'],
      ['hotmail.co.jp'],
      ['hotmail.com'],
      ['i.softbank.jp'],
      ['icloud.com'],
      ['infoseek.co.jp'],
      ['infoseek.jp'],
      ['itscom.net'],
      ['jcom.home.ne.jp'],
      ['jcom.zaq.ne.jp'],
      ['ktv.ne.jp'],
      ['live.jp'],
      ['mac.com'],
      ['mail.bbexcite.jp'],
      ['mail.goo.ne.jp'],
      ['me.com'],
      ['mineo.com'],
      ['msn.com'],
      ['mvt-net.com'],
      ['nifty.com'],
      ['ocn.ne.jp'],
      ['odn.ne.jp'],
      ['outlook.com'],
      ['plala.or.jp'],
      ['pobox.com'],
      ['rakuten.jp'],
      ['softbank.ne.jp'],
      ['so-net.ne.jp'],
      ['vodafone.ne.jp'],
      ['wakwak.com'],
      ['yahoo.co.jp'],
      ['yahoo.ne.jp'],
      ['ybb.ne.jp'],
      ['ymobile.ne.jp'],
      ['ztv.ne.jp']
    ]
  }
];


/** 既定のショートカット一覧（見出し＋行）を組み立てる */
function _defaultShortcutGroups() {
  return SHORTCUTS.map(function(sec) {
    return { label: sec[0], rows: sec[1].map(function(r) { return [r[0], r[1]]; }) };
  });
}
window._defaultShortcutGroups = _defaultShortcutGroups;

/** 固定セクションの定義（内容つき）を新しく作って返す */
function _fixedSideMenuDef(id) {
  var t = window.SIDEMENU_DEFAULT_TABLES.find(function(x) { return x.id === id; });
  if (!t) return null;
  var copy = JSON.parse(JSON.stringify(t));
  if (copy.type === 'shortcut') copy.groups = _defaultShortcutGroups();
  return copy;
}

/**
 * サイドメニューの一覧のうち固定セクションの中身を、このファイルの定義に置き換える（並びは変えない）。
 * 旧データの phonetic 型も、フォネティックコードとして扱う。
 */
window.applyFixedSideMenuSections = function (list) {
  if (!Array.isArray(list)) return list;
  list.forEach(function (sec, i) {
    if (!sec) return;
    var id = sec.id;
    if (sec.type === 'phonetic') id = 'sm_phonetic';
    if (window.SIDEMENU_FIXED_IDS.indexOf(id) < 0) return;
    var def = _fixedSideMenuDef(id);
    if (def) list[i] = def;
  });
  return list;
};

/** data.js へ書き出す形にする（固定セクションは内容を持たせず、id と type だけ＝並び順のみ） */
window.stripFixedSideMenuSections = function (list) {
  return (list || []).map(function (sec) {
    if (sec && window.SIDEMENU_FIXED_IDS.indexOf(sec.id) >= 0) return { id: sec.id, type: sec.type };
    return sec;
  });
};

// ── ヒアリングシートの固定項目「■メモ」──
// メモは常に最下段に固定する項目で、消す・並べ替える・編集する対象ではない。
// そのため data.js（hearingQuestions）には持たせず、ここで定義して必ず補う。
// data.js や IndexedDB に古い q_memo が残っていても、読み込み時に取り除いてここの定義を使う。
window.HEARING_MEMO_ITEM = {
  id: 'q_memo', field: 'memo', label: 'メモ', type: 'text', multiline: true,
  placeholder: '自由記入欄…', common: true, enabled: true, builtin: true, showIf: []
};
function _hrIsMemoQ(q) { return !!q && (q.id === 'q_memo' || q.field === 'memo'); }

/** 保存用：メモ（固定項目）を取り除いた質問一覧を返す */
window.stripHearingMemo = function (list) {
  return (Array.isArray(list) ? list : []).filter(function (q) { return !_hrIsMemoQ(q); });
};

// 全ページ共通の in-memory キャッシュ
window._appCache = {
  scripts:          {},
  mailTemplates:    [],
  mailCatMeta:      { cats: [], subs: {} },
  updateHistory:    [],
  hearingQuestions: [],
  hearingPolicies:  [],
  hearingPatterns:  [],
  sideMenuData:     null,
  faqData:          [],
  linkify:          {},
  hearingTemplates: [],
  hearingLabelPrefix: '■',  // 項目名の先頭に付ける記号（'' なら付けない）
  hearingFixedReady: false, // 組み込み項目を取り込み済みか（true なら足し直さない）
  maintenance: {},          // メンテナンス中のページ（{'script.html': true} の形）
  notice: '',               // お知らせ本文（管理画面で編集し data.js に載せる）
  noticeDate: '',           // 更新日の手動指定（空なら本文中の日付から拾う）
  hearingDevices:   [],     // デバイス候補（[{name, details:[]}]）
  hearingCarriers:  []      // キャリア候補（文字列の配列）
};

// sideMenuData は、どこから読み込んでも（data.js・IndexedDB・他タブからの通知・JSON 取り込み）
// 固定セクションの内容がこのファイルの定義にそろうよう、代入のたびに置き換える。
(function () {
  var _sm = window._appCache.sideMenuData;
  Object.defineProperty(window._appCache, 'sideMenuData', {
    enumerable: true, configurable: true,
    get: function () { return _sm; },
    set: function (v) { _sm = Array.isArray(v) ? window.applyFixedSideMenuSections(v) : v; }
  });
})();

// ── data.js の内容を「読み込み直後に同期で」キャッシュへ流し込む ──
// initAppData() は IndexedDB を読むため非同期で、しかも呼ぶかどうかは各ページ任せ。
// index.html のように initAppData() を呼ばないページでは、
// サイドメニュー・更新履歴・定型文が空のまま描画されてしまう。
// data.js は同期読み込みなので、ここで先に反映しておけばどのページでも欠けない。
// ※ データファイルはこのファイルの後に読み込まれる（⓪-P 参照）ため、読み込み完了時に実行する。
window.AppProfile.onDataReady(function _seedFromStaticData() {
  var sd = window.APP_STATIC_DATA;
  if (!sd) return;
  if (sd.sideMenuData     != null) window._appCache.sideMenuData     = sd.sideMenuData;
  if (sd.updateHistory    != null) window._appCache.updateHistory    = sd.updateHistory;
  if (sd.fixedTexts       != null) window._appCache.fixedTexts       = sd.fixedTexts;
  if (sd.hearingQuestions != null) window._appCache.hearingQuestions = sd.hearingQuestions;
  if (sd.hearingPolicies  != null) window._appCache.hearingPolicies  = sd.hearingPolicies;
  if (sd.hearingPatterns  != null) window._appCache.hearingPatterns  = sd.hearingPatterns;
  if (sd.talkScripts      != null) window._appCache.scripts          = sd.talkScripts;
  if (sd.mailTemplates    != null) window._appCache.mailTemplates    = sd.mailTemplates;
  if (sd.mailCatMeta      != null) window._appCache.mailCatMeta      = sd.mailCatMeta;
  if (sd.faqData          != null) window._appCache.faqData          = sd.faqData;
  if (sd.linkify          != null) window._appCache.linkify          = sd.linkify;
  if (sd.hearingTemplates != null) window._appCache.hearingTemplates = sd.hearingTemplates;
  if (sd.hearingLabelPrefix != null) window._appCache.hearingLabelPrefix = sd.hearingLabelPrefix;
  if (sd.hearingFixedReady != null) window._appCache.hearingFixedReady = sd.hearingFixedReady;
  if (sd.notice      != null) window._appCache.notice      = sd.notice;
  if (sd.noticeDate  != null) window._appCache.noticeDate  = sd.noticeDate;
  if (sd.maintenance != null) window._appCache.maintenance = sd.maintenance;
  if (sd.hearingDevices   != null) window._appCache.hearingDevices  = sd.hearingDevices;
  if (sd.hearingCarriers  != null) window._appCache.hearingCarriers = sd.hearingCarriers;
});

// localStorage からの一回限りのマイグレーション
function _migrateFromLocalStorage() {
  var map = {
    scripts:          'talkScripts',
    mailTemplates:    'mailTemplates',
    mailCatMeta:      'mailCatMeta',
    updateHistory:    'updateHistory',
    hearingQuestions: 'hearingQuestionsDef_v1',
    hearingPolicies:  'hearingPolicies_v1',
    sideMenuData:     'sideMenuData'
  };
  var writes = [];
  Object.keys(map).forEach(function(idbKey) {
    try {
      var raw = localStorage.getItem(map[idbKey]);
      if (raw) {
        var val = JSON.parse(raw);
        window._appCache[idbKey] = val;
        writes.push(window.idbSetAppData(idbKey, val));
        localStorage.removeItem(map[idbKey]);
      }
    } catch(e) {}
  });
  return Promise.all(writes);
}

/**
 * 全データを IDB から _appCache に読み込む。
 * 各ページの DOMContentLoaded で await / .then() して使う。
 */
window.initAppData = function() {
  // ── data.js の APP_STATIC_DATA を優先適用（sideMenu・hearing・履歴・固定テキスト）──
  // ★ スクリプト／メール／ヒアリング／サイドメニュー／更新履歴の実データは
  //   data.js が唯一の管理元。common-utils.js には一切持たせない。
  var sd = window.APP_STATIC_DATA;
  if (!sd) {
    var _pf = window.APP_PROFILE || {};
    if (_pf.file || _pf.failed) {   // 未選択（選択モーダル表示中）のときは出さない
      console.error('[data] データファイル（' + (_pf.failedFile || _pf.file || 'data.js') + '）が読み込まれていません。' +
        'HTML と同じフォルダに配置してください（サイドメニュー・ヒアリング・更新履歴が空になります）。');
    }
  }
  if (sd) {
    if (sd.sideMenuData     != null) window._appCache.sideMenuData     = sd.sideMenuData;
    if (sd.hearingQuestions != null) window._appCache.hearingQuestions = sd.hearingQuestions;
    if (sd.hearingPolicies  != null) window._appCache.hearingPolicies  = sd.hearingPolicies;
    if (sd.hearingPatterns  != null) window._appCache.hearingPatterns  = sd.hearingPatterns;
    if (sd.updateHistory    != null) window._appCache.updateHistory    = sd.updateHistory;
    if (sd.fixedTexts       != null) window._appCache.fixedTexts       = sd.fixedTexts;
    if (sd.faqData          != null) window._appCache.faqData          = sd.faqData;
    if (sd.linkify          != null) window._appCache.linkify          = sd.linkify;
    if (sd.hearingTemplates != null) window._appCache.hearingTemplates = sd.hearingTemplates;
    if (sd.hearingLabelPrefix != null) window._appCache.hearingLabelPrefix = sd.hearingLabelPrefix;
    if (sd.hearingFixedReady != null) window._appCache.hearingFixedReady = sd.hearingFixedReady;
    if (sd.notice      != null) window._appCache.notice      = sd.notice;
    if (sd.noticeDate  != null) window._appCache.noticeDate  = sd.noticeDate;
    if (sd.maintenance != null) window._appCache.maintenance = sd.maintenance;
    if (sd.hearingDevices   != null) window._appCache.hearingDevices  = sd.hearingDevices;
    if (sd.hearingCarriers  != null) window._appCache.hearingCarriers = sd.hearingCarriers;
  if (sd.hearingTemplates != null) window._appCache.hearingTemplates = sd.hearingTemplates;
  if (sd.linkify          != null) window._appCache.linkify          = sd.linkify;
  if (sd.hearingTemplates != null) window._appCache.hearingTemplates = sd.hearingTemplates;
    if (sd.sideMenuFiles) {
      Object.keys(sd.sideMenuFiles).forEach(function(id) {
        var f = sd.sideMenuFiles[id];
        window.idbSaveMenuFile(Object.assign({}, f, { id: id }));
      });
    }
  }
  // 更新履歴・ヒアリングの実データは data.js（APP_STATIC_DATA）が唯一の正。
  // common-utils.js には持たないため、ここでのフォールバックは行わない。

  // scripts / mailTemplates / mailCatMeta / hearingPatterns は IDB から読む
  // lastSavedAt は data.js（構成ファイル）との新旧比較に使う
  var keys = ['scripts','mailTemplates','mailCatMeta','hearingPatterns','lastSavedAt'];
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve) {
      var tx    = db.transaction('appData', 'readonly');
      var store = tx.objectStore('appData');
      var result = {};
      var left   = keys.length;
      keys.forEach(function(k) {
        var req = store.get(k);
        req.onsuccess = function(e) { result[k] = e.target.result; if (!--left) resolve(result); };
        req.onerror   = function()  { result[k] = null;            if (!--left) resolve(result); };
      });
    });
  }).then(function(result) {
    // data.js がない場合は IDB からヒアリング・サイドメニュー等も読む（後方互換）
    if (!sd) {
      var legacyKeys = ['updateHistory','hearingQuestions','hearingPolicies','hearingPatterns','sideMenuData','fixedTexts','hearingDataVersion'];
      return _appIdbOpen().then(function(db) {
        return new Promise(function(resolve2) {
          var tx2    = db.transaction('appData', 'readonly');
          var store2 = tx2.objectStore('appData');
          var left2  = legacyKeys.length;
          legacyKeys.forEach(function(k) {
            var r = store2.get(k);
            r.onsuccess = function(e) { result[k] = e.target.result; if (!--left2) resolve2(result); };
            r.onerror   = function()  { result[k] = null;            if (!--left2) resolve2(result); };
          });
        });
      });
    }
    return result;
  }).then(function(result) {
    // lastSavedAt はメタ情報のため、未設定でもマイグレーション判定には使わない
    var needsMigration = keys.some(function(k) { return k !== 'lastSavedAt' && result[k] == null; });
    if (needsMigration) return _migrateFromLocalStorage().then(function() { return result; });
    return result;
  }).then(function(result) {
    keys.forEach(function(k) {
      if (result[k] != null) window._appCache[k] = result[k];
    });
    // data.js なし時の legacy keys も反映
    if (!sd) {
      ['updateHistory','hearingQuestions','hearingPolicies','hearingPatterns','sideMenuData','fixedTexts'].forEach(function(k) {
        if (result[k] != null) window._appCache[k] = result[k];
      });
    }

    // ── data.js に含まれるスクリプト・メールの取り込み ──
    // admin.html の「💾 保存して反映」が data.js を直接書き換えるため、
    // フォルダごと別PCへ配布しても中身が反映されるようにする。
    // IDB の lastSavedAt より data.js の savedAt が新しい場合のみ上書きする
    // （同一PCで編集した最新データを、古い data.js で巻き戻さないため）。
    if (sd && sd.savedAt) {
      var idbTs  = result.lastSavedAt ? (Date.parse(result.lastSavedAt) || 0) : 0;
      var fileTs = Date.parse(sd.savedAt) || 0;
      if (fileTs > idbTs) {
        if (sd.talkScripts   != null) window._appCache.scripts       = sd.talkScripts;
        if (sd.mailTemplates != null) window._appCache.mailTemplates = sd.mailTemplates;
        if (sd.mailCatMeta   != null) window._appCache.mailCatMeta   = sd.mailCatMeta;
        // IDB にも書き戻し、以降は同期済みとして扱う
        if (window.idbSetAppData) {
          if (sd.talkScripts   != null) window.idbSetAppData('scripts',       sd.talkScripts);
          if (sd.mailTemplates != null) window.idbSetAppData('mailTemplates', sd.mailTemplates);
          if (sd.mailCatMeta   != null) window.idbSetAppData('mailCatMeta',   sd.mailCatMeta);
          window.idbSetAppData('lastSavedAt', sd.savedAt);
        }
      }
    }
    // ── ヒアリング項目の大幅リニューアル対応 ──
    // IndexedDB に旧バージョンのヒアリング項目／対応方針／パターンが残っていると、
    // data.js 側で新しく定義した内容が反映されない。
    // バージョン番号が一致しない場合は保存データを破棄し、data.js の内容で上書き・再保存する。
    // バージョン違いは旧形式の保存データなので data.js で作り直す。
    // ただし保存データがある場合は編集結果なので残す。
    // （無条件に上書きしていたため、管理画面で削除した項目が復活していた）
    var storedHearingVer = result ? result.hearingDataVersion : null;
    if (storedHearingVer !== HEARING_DATA_VERSION && sd) {
      [['hearingQuestions', 'hearingQuestions'],
       ['hearingPolicies',  'hearingPolicies'],
       ['hearingPatterns',  'hearingPatterns']].forEach(function (k) {
        var saved = result ? result[k[0]] : null;
        if (Array.isArray(saved)) { window._appCache[k[0]] = saved; return; }
        window._appCache[k[0]] = JSON.parse(JSON.stringify(sd[k[1]] || []));
        if (window.idbSetAppData) window.idbSetAppData(k[0], window._appCache[k[0]]);
      });
      if (window.idbSetAppData) window.idbSetAppData('hearingDataVersion', HEARING_DATA_VERSION);
    }
    return window._appCache;
  });
};

// =============================================================================
// ① ダークモード初期化（DOM構築前に実行してフラッシュ防止）
// 要件：「ダークモード：オフ」をデフォルトにする。
// 変更前：OS設定（prefers-color-scheme）を優先していた。
// 変更後：localStorage に明示的な設定がある場合のみ適用。
//         未設定（初回起動）の場合は必ずライトモード。
// =============================================================================
(function () {
  var s = localStorage.getItem('darkMode');
  if (s === '1') {
    // ユーザーが明示的にダークモードを有効にした場合のみ適用
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    // 未設定・オフ どちらもライトモード（OS設定には追従しない）
    document.documentElement.setAttribute('data-theme', 'light');
    if (!s) localStorage.setItem('darkMode', '0'); // 初回起動時に明示的にオフを保存
  }
})();

window.applyDarkMode = function (d) {
  if (d) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('darkMode', '1');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('darkMode', '0');
  }
  var c = document.getElementById('darkModeToggle');
  if (c) c.checked = d;
};

// =============================================================================
// ② 定型文クイックコピー
// =============================================================================
window.QUICK_ITEMS = [
  { text: '🟥HELP🟥',                          label: '🟥HELP🟥' },
  { text: '🟨保留中🟨',                         label: '🟨保留中🟨' },
  { text: '🟦後処理🟦',                         label: '🟦後処理🟦' },
  { text: '📱【検証機使用希望】📱（iPhone）',     label: 'iPhone' },
  { text: '📱【検証機使用希望】📱（Android）',    label: 'Android' },
  { text: '📱【検証機　返却します】📱',               label: '検証機返却' },
  { text: '☕10分休憩よろしいでしょうか☕',        label: '10分休憩' },
  { text: '🍱お昼休憩よろしいでしょうか🍱',       label: 'お昼休憩' },
  { text: '🐻離席してもよろしいでしょうか🐻',     label: 'お手洗い' },
];

/**
 * 定型文メニューとトーストを、ボタンの真下に置き直す。
 *
 * ヘッダーの各列（.hd-right など）には、幅が足りないときに要素が重ならないよう
 * overflow-x:auto / overflow-y:hidden が指定されている。
 * そのため position:absolute のままだと、ヘッダーの外に出るメニューが
 * まるごと切り取られて画面に出てこない（＝ボタンを押しても何も起きないように見える）。
 * position:fixed に変えて、押すたびにボタンの位置から座標を計算する。
 */
function _positionQuickMenu() {
  var btn  = document.getElementById('quickCopyBtn');
  var menu = document.getElementById('quickMenu');
  if (!btn || !menu) return;
  var r = btn.getBoundingClientRect();
  var right = Math.max(4, window.innerWidth - r.right);
  menu.style.position = 'fixed';
  menu.style.top      = r.bottom + 'px';   // 隙間があるとマウス移動中にホバーが切れる
  menu.style.left     = 'auto';
  menu.style.right    = right + 'px';
  // 画面が低いときにメニューがはみ出さないようにする
  menu.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - 16) + 'px';
  menu.style.overflowY = 'auto';

  var toast = document.getElementById('quickCopyToast');
  if (toast) {
    toast.style.position = 'fixed';
    toast.style.top   = (r.bottom + 8) + 'px';
    toast.style.left  = 'auto';
    toast.style.right = right + 'px';
  }
}
window._positionQuickMenu = _positionQuickMenu;

window.renderQuickMenu = function () {
  var el = document.getElementById('quickMenu');
  if (!el) return;
  el.innerHTML = window.QUICK_ITEMS.map(function (item, i) {
    return '<div class="quick-menu-item" data-qi="' + i + '">' + item.label + '</div>';
  }).join('');
  el.addEventListener('click', function (ev) {
    var d = ev.target.closest('[data-qi]');
    if (!d) return;
    var item = window.QUICK_ITEMS[parseInt(d.dataset.qi)];
    if (item) window.copyText(item.text, item.label);
  });

  // マウスの出入りで開閉する。
  // ボタンからメニューへ動かす途中で一瞬でも外れると閉じてしまい
  // 「選ぶ前に消える」ため、閉じるまでに少し猶予を持たせる。
  var area = el.closest('.quick-copy-area');
  if (area) {
    var closeTimer = null;
    var cancelClose = function () {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    };
    var open = function () {
      cancelClose();
      _positionQuickMenu();
      el.classList.add('open');
    };
    var scheduleClose = function () {
      cancelClose();
      closeTimer = setTimeout(function () { el.classList.remove('open'); }, 320);
    };
    [area, el].forEach(function (n) {
      n.addEventListener('mouseenter', open);
      n.addEventListener('mouseleave', scheduleClose);
    });
    // 押して開いた場合は、うっかり外れても閉じないよう猶予を打ち消す
    area.addEventListener('click', cancelClose);
  }

  // 開いたまま画面が動いてもボタンに追従させる
  var follow = function () { if (el.classList.contains('open')) _positionQuickMenu(); };
  window.addEventListener('resize', follow);
  window.addEventListener('scroll', follow, true);

  _positionQuickMenu();
};

// ヘッダー右側に並べるページ移動ボタン。並び順もここで決める。
window.NAV_PAGES = [
  { file: 'script.html',  tab: 'scriptTab',     label: '📋 スクリプト' },
  { file: 'mail.html',    tab: 'mailTab',       label: '✉️ メール' },
  { file: 'screen.html',  tab: 'screenFlowTab', label: '🖥️ 画面遷移' },
  { file: 'FAQ.html',     tab: 'faqTab',        label: '❓ FAQ' },
  { file: 'hearing.html', tab: 'hearingTab',    label: '🩺 ヒアリング' }
];

/** いま開いているページのファイル名（大文字小文字は無視して比較する） */
function _currentPageFile() {
  var p = (location.pathname || '').split('/').pop() || 'index.html';
  return decodeURIComponent(p).toLowerCase();
}

/**
 * ページ移動ボタンをヘッダーに並べ直す。
 * ページごとに数も並び順も見た目もばらばらだったため共通化し、
 * 自分自身のページのボタンは出さない。
 */
function _injectNavBtns() {
  var right = document.querySelector('header .hd-right');
  if (!right) return;                                   // ホームなど
  var here = _currentPageFile();
  // 管理画面には各ページへのジャンプボタンを置かない。
  // タブにカーソルを合わせたときのメニューから開ける。
  if (document.body.classList.contains('page-admin')) return;

  // 既存の移動ボタン（HTMLに直接書かれているもの）を取り除く
  Array.prototype.slice.call(right.querySelectorAll('button')).forEach(function (b) {
    var oc = b.getAttribute('onclick') || '';
    if (oc.indexOf('openNamedTab(') < 0) return;
    var hit = window.NAV_PAGES.some(function (p) { return oc.indexOf(p.file) >= 0; });
    if (hit) b.parentNode.removeChild(b);
  });

  var frag = document.createDocumentFragment();
  window.NAV_PAGES.forEach(function (p) {
    if (p.file.toLowerCase() === here) return;          // 自ページは出さない
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-btn';
    b.textContent = p.label;
    b.dataset.page = p.file;                            // メンテナンス表示の対象を判定するため
    b.addEventListener('click', function () { openNamedTab(p.file, p.tab); });
    frag.appendChild(b);
  });
  right.insertBefore(frag, right.firstChild);
}

// 各ページと、管理画面で開くタブの対応
window.ADMIN_TAB_FOR_PAGE = {
  'script.html':  'script',
  'mail.html':    'mail',
  'screen.html':  'screen',
  'faq.html':     'faq',
  'hearing.html': 'hearing'
};

/**
 * ヘッダーに［⚙］を差し込む。
 * 押すと管理画面を開き、そのページに対応するタブを選んだ状態にする。
 * 管理画面とホームには出さない。
 */
function _injectAdminBtn() {
  if (document.getElementById('adminJumpBtn')) return;
  if (document.body.classList.contains('page-admin')) return;
  var right = document.querySelector('header .hd-right');
  if (!right) return;                       // ホームはカードから開く

  var here = _currentPageFile();
  var tab  = window.ADMIN_TAB_FOR_PAGE[here];
  if (!tab) return;

  var b = document.createElement('button');
  b.type = 'button';
  b.id = 'adminJumpBtn';
  b.className = 'nav-btn';
  b.textContent = '⚙';
  b.title = 'このページの設定を管理画面で開く';
  b.addEventListener('click', function () {
    window.openNamedTab('admin.html#' + tab, 'adminTab');
  });
  right.appendChild(b);
}

/**
 * ヘッダーに［💬 定型文］を差し込む。
 * FAQ・ヒアリングには置かれていなかったため、全ページで同じ位置に出す。
 * すでにページ内にある場合は二重に作らない。
 */
function _injectQuickCopy() {
  if (document.getElementById('quickCopyBtn')) return;      // 既にある
  // 管理画面は編集作業の場なので置かない
  if (document.body.classList.contains('page-admin')) return;

  // ホームはヘッダーの作りが違うので、ヘッダー内の末尾に置く
  var right = document.querySelector('header .hd-right')
           || document.querySelector('header.home-header');
  if (!right) return;

  var area = document.createElement('div');
  area.className = 'quick-copy-area';
  area.innerHTML =
    '<button class="quick-copy-btn nav-btn-green" id="quickCopyBtn" type="button">💬 定型文</button>' +
    '<div class="quick-menu" id="quickMenu"></div>' +
    '<div class="quick-copy-toast" id="quickCopyToast"></div>';
  area.querySelector('#quickCopyBtn').addEventListener('click', function () {
    window.toggleQuickMenu();
  });

  if (right.classList.contains('home-header')) {
    area.style.marginLeft = '12px';                        // 時計の右に置く
    right.appendChild(area);
    return;
  }
  // 定型文は「検索欄（または同じ幅の空き）」と ⚙ の手前に置く。
  // 差し込む時点で既にそれらが並んでいることがあるため、末尾に足すと順序が崩れる。
  var before = right.querySelector('.search-wrap')
            || document.getElementById('headerSearchSpacer')
            || document.getElementById('adminJumpBtn');
  if (before && before.parentNode === right) right.insertBefore(area, before);
  else right.appendChild(area);
}

/**
 * 検索サジェストの位置合わせ。
 * 定型文メニューと同じくヘッダーに切り取られるため position:fixed にしてある。
 * 表示のON/OFFは各ページのコードが style.display で行うので、
 * その変化を見て入力欄の真下に置き直す。
 */
document.addEventListener('DOMContentLoaded', function () {
  var box   = document.getElementById('suggestBox');
  var input = document.getElementById('searchBox');
  if (!box || !input) return;
  var last = '';
  var place = function () {
    if (!box.style.display || box.style.display === 'none') return;
    var r = input.getBoundingClientRect();
    var sig = [r.bottom, r.left, r.width, window.innerHeight].join(',');
    if (sig === last) return;   // 自分の書き込みで無限に呼ばれないようにする
    last = sig;
    box.style.top   = (r.bottom + 4) + 'px';
    box.style.left  = r.left + 'px';
    box.style.width = Math.max(220, r.width) + 'px';
    box.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - 16) + 'px';
  };
  if (window.MutationObserver) {
    new MutationObserver(place).observe(box, { attributes: true, attributeFilter: ['style'] });
  }
  input.addEventListener('focus', place);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
});

window.toggleQuickMenu = function () {
  var menu = document.getElementById('quickMenu');
  if (!menu) return;
  _positionQuickMenu();          // 開く前に位置を合わせる
  menu.classList.toggle('open');
};

window.copyText = function (text, label) {
  function doToast() {
    var menu = document.getElementById('quickMenu');
    if (menu) menu.classList.remove('open');
    var toast = document.getElementById('quickCopyToast');
    if (!toast) return;
    toast.textContent = '「' + label + '」をコピーしました';
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(doToast).catch(function () { _fallbackCopy(text); doToast(); });
  } else {
    _fallbackCopy(text);
    doToast();
  }
};

function _fallbackCopy(text) {
  var el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

// =============================================================================
// 複数のページで共通に使う小さな部品
//
// 以前は script.html・mail.html・FAQ.html・admin.html・screen.html がそれぞれ同じ処理を持っていた。
// 複数ページに関わる処理はここに置き、1ページだけで使う処理はそのページの
// HTML にインラインで書く（別ファイルには分けない）。
// =============================================================================

/** HTML に埋め込む文字のエスケープ（null / undefined は空文字） */
window.escHtml = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

/** 検索語に一致した部分を <mark> で囲む（str は呼び出し側でエスケープ済みのもの） */
window.highlightText = function (str, keyword) {
  if (!keyword || !str) return str || '';
  var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(new RegExp(escaped, 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
};

/** 検索語の前後 30 文字を切り出して、検索結果の抜粋にする */
window.excerptText = function (text, keyword) {
  var lower = text.toLowerCase(), kl = keyword.toLowerCase();
  var idx = lower.indexOf(kl);
  if (idx === -1) return '';
  var start = Math.max(0, idx - 30), end = Math.min(text.length, idx + keyword.length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
};

/**
 * 画面遷移データを読む（admin.html / screen.html 共通）。
 * data.js 内の画面遷移データ（構成ファイル）が IDB より新しければそちらを優先する。
 * IDB からの生の読み取り _idbGetScreenDataRaw は、DB の開き方が違うため各ページが持つ。
 */
window.idbGetScreenData = function () {
  return (window.initScreenStaticData ? window.initScreenStaticData() : Promise.resolve(null))
    .then(function (staticPats) {
      if (Array.isArray(staticPats) && staticPats.length) return staticPats;
      return (typeof _idbGetScreenDataRaw === 'function') ? _idbGetScreenDataRaw() : null;
    });
};

/** サイドバーのアコーディオン（カテゴリ）を開閉する */
window.toggleSbAcc = function (id) {
  var block = document.getElementById(id);
  if (!block) return;
  var body  = block.querySelector(':scope > .sb-acc-body');
  var arrow = block.querySelector(':scope > .sb-acc-header .sb-acc-arrow');
  if (!body) return;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
};

/**
 * サイドバーの項目にカーソルを乗せたときのプレビュー（カーソルに追従する吹き出し）。
 *   tooltipId … 吹き出しの要素の id
 *   textAttr  … 吹き出しに出す文字を持つ属性名（data-preview / data-note など）
 * 対象は .sb-item[data-preview]。
 */
window.initSidebarPreview = function (tooltipId, textAttr) {
  var tooltip = document.getElementById(tooltipId);
  var timer = null;

  document.addEventListener('mousemove', function (e) {
    if (!tooltip || tooltip.style.display !== 'block') return;
    var offset = 16;
    var tipW = tooltip.offsetWidth || 280;
    var tipH = tooltip.offsetHeight || 60;
    // 右や下にはみ出すときは反対側に出す
    var left = (e.clientX + offset + tipW > window.innerWidth)
                ? e.clientX - tipW - offset : e.clientX + offset;
    var top  = (e.clientY + offset + tipH > window.innerHeight)
                ? e.clientY - tipH - offset : e.clientY + offset;
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  });

  document.addEventListener('mouseover', function (e) {
    var item = e.target.closest('.sb-item[data-preview]');
    if (!item || !tooltip) return;
    var text = item.getAttribute(textAttr);
    if (!text) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      tooltip.textContent = text;
      tooltip.style.display = 'block';
    }, 260);
  });

  document.addEventListener('mouseout', function (e) {
    var item = e.target.closest('.sb-item[data-preview]');
    if (!item) return;
    clearTimeout(timer);
    if (tooltip) tooltip.style.display = 'none';
  });
};

/**
 * 使い方マニュアルのモーダル。
 * ページに #helpModal があればそれを開き、無いページでは「準備中」の案内を出す。
 */
window.openHelpModal = function () {
  var m = document.getElementById('helpModal');
  if (m) { m.style.display = 'flex'; return; }
  _openPlaceholderHelp();
};
window.closeHelpModal = function () {
  var m = document.getElementById('helpModal');
  if (m) m.style.display = 'none';
};
/** モーダルの外側をクリックしたら閉じる */
window.closeHelpModalOutside = function (e) {
  if (e.target === document.getElementById('helpModal')) window.closeHelpModal();
};

// =============================================================================
// ③ データ更新（JSON インポート）
//
// 要件：
//   ・「データ更新」ボタンで、開いているHTMLファイルと同じフォルダのJSONを選択できる。
//   ・File System Access API（Chrome/Edge）を使用。
//   ・データ反映後はページリロードなしで即時更新する。
//
// 処理フロー：
//   1. window.showOpenFilePicker が使える場合（Chrome/Edge）→ API で選択
//   2. それ以外（Safari 等）→ 従来の <input type="file"> でフォールバック
//   3. JSON を解析して localStorage に保存し、ページ内のデータを即時更新
// =============================================================================

/**
 * 「データ更新」ボタンのクリックハンドラ。
 * File System Access API が使える場合はそちらで、なければ <input> にフォールバック。
 */
window.triggerImport = async function () {
  // showDirectoryPicker（Chrome/Edge）でフォルダを選択しその中のJSONを読み込む
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const jsonFiles = [];
      for await (const [name, handle] of dirHandle) {
        if (handle.kind === 'file' && name.endsWith('.json')) {
          jsonFiles.push({ name, handle });
        }
      }
      if (jsonFiles.length === 0) {
        alert('フォルダ内にJSONファイルが見つかりません。');
        return;
      }
      let targetFile;
      if (jsonFiles.length === 1) {
        targetFile = jsonFiles[0];
      } else {
        const names = jsonFiles.map((f, i) => (i + 1) + ': ' + f.name).join('\n');
        const idx = parseInt(prompt('読み込むJSONファイルを番号で選んでください:\n\n' + names)) - 1;
        if (isNaN(idx) || idx < 0 || idx >= jsonFiles.length) return;
        targetFile = jsonFiles[idx];
      }
      const file = await targetFile.handle.getFile();
      const text = await file.text();
      _processImportText(text, true);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // showOpenFilePicker フォールバック
  if (window.showOpenFilePicker) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON ファイル', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      _processImportText(text, true);
    } catch (e) {
      if (e.name !== 'AbortError') {
        var el = document.getElementById('importFile');
        if (el) el.click();
      }
    }
  } else {
    var el = document.getElementById('importFile');
    if (el) el.click();
  }
};

/**
 * <input type="file"> 経由でファイルが選択された場合のハンドラ。
 * admin.html は独自のインポート処理を持つため、ここは index.html / mail.html / screen.html 向け。
 */
window.importJSON = function (input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    _processImportText(e.target.result, true); // ページリロードなし
    input.value = '';
  };
  reader.readAsText(file);
};

/**
 * JSON テキストを解析して localStorage に保存し、ページを即時更新する。
 * @param {string}  text       - JSON 文字列
 * @param {boolean} noReload   - true: ページリロードなし、false: リロードあり（旧挙動）
 */
// =============================================================================
// 差分結合ヘルパー（インポート時：上書きではなく ID ベースでマージ）
// =============================================================================

// スクリプトを結合する（カテゴリ key が同じなら上書き、なければ追加）
function _mergeScripts(current, incoming) {
  if (!incoming) return current;
  var merged = JSON.parse(JSON.stringify(current || {}));
  Object.keys(incoming).forEach(function(key) {
    merged[key] = incoming[key]; // カテゴリごと上書き（スクリプトは key 単位）
  });
  return merged;
}

// メールテンプレートを結合する（id が同じなら上書き、なければ追加）
function _mergeMail(current, incoming) {
  if (!Array.isArray(incoming)) return current;
  var merged = JSON.parse(JSON.stringify(Array.isArray(current) ? current : []));
  incoming.forEach(function(t) {
    var idx = merged.findIndex(function(x){ return x.id === t.id; });
    if (idx >= 0) merged[idx] = t; // 既存を上書き
    else merged.push(t);           // 差分を追加
  });
  return merged;
}

// 画面遷移データを結合する（パターン id が同じなら画面レベルでマージ）
function _mergeScreenData(current, incoming) {
  if (!Array.isArray(incoming)) return current;
  var merged = JSON.parse(JSON.stringify(Array.isArray(current) ? current : []));
  incoming.forEach(function(inPat) {
    var exPat = merged.find(function(p){ return p.id === inPat.id; });
    if (!exPat) {
      merged.push(inPat); // 新パターンを追加
    } else {
      // 既存パターン内で画面を結合
      exPat.name = inPat.name; // パターン名は最新を使用
      (inPat.screens || []).forEach(function(inScr) {
        var exScr = exPat.screens.find(function(s){ return s.id === inScr.id; });
        if (exScr) Object.assign(exScr, inScr); // 既存画面を上書き
        else exPat.screens.push(inScr);          // 差分画面を追加
      });
    }
  });
  return merged;
}

/**
 * imageLib 配列を IDB の imageLib ストアに直接保存する。
 * idbSetScreenData に依存しないため、どのページからでも呼び出せる。
 */
function _saveImageLibToIdb(libItems) {
  if (!Array.isArray(libItems) || !libItems.length) return;
  _appIdbOpen().then(function(db) {
    var tx = db.transaction('imageLib', 'readwrite');
    var store = tx.objectStore('imageLib');
    libItems.forEach(function(item) {
      if (item && item.id) {
        store.put(item, item.id);
      }
    });
    tx.oncomplete = function() {
      try { var bc = new BroadcastChannel('tool_data_update'); bc.postMessage({type:'imageLibUpdated',ts:Date.now()}); bc.close(); } catch(e) {}
    };
  }).catch(function(e){ console.warn('_saveImageLibToIdb failed:', e); });
}

/**
 * 全タブに全データ更新を通知する。
 */
function _broadcastAllDataUpdated() {
  try {
    var bc = new BroadcastChannel('tool_data_update');
    bc.postMessage({ type: 'allDataUpdated', ts: Date.now() });
    bc.close();
  } catch(e) {}
}

function _processImportText(text, noReload) {
  try {
    _importProgressShow('JSONを解析中…', 'ファイルを確認しています', 20);
    setTimeout(function () {
      try {
        var raw = JSON.parse(text);
        var imported = { scripts: false, mail: false, screen: false, history: false };

        // ===== version:3/2/1（統合JSON：スクリプト＋メール＋画面遷移＋更新履歴）=====
        // 注：talkScripts / mailTemplates は片方だけでも対象とする（admin.html の
        // 「個別エクスポート」「保存して反映」で一部のみ選択した場合に両方揃わないため）。
        if (raw && (raw.version === 3 || raw.version === 2 || raw.version === 1) &&
            ('talkScripts' in raw || 'mailTemplates' in raw)) {
          _importProgressHide();
          if (!confirm('現在のデータをインポートしたデータで上書きします。よろしいですか？')) return;
          _importProgressShow('データを保存中…', 'スクリプト・メール', 50);
          setTimeout(function () {
            try {
              // スクリプト：含まれている場合のみ上書き
              if ('talkScripts' in raw) {
                var mergedScripts = raw.talkScripts;
                window._appCache.scripts = mergedScripts;
                window.idbSetAppData('scripts', mergedScripts);
                try { var _bcs2=new BroadcastChannel('tool_data_update'); _bcs2.postMessage({type:'scriptsUpdated',ts:Date.now()}); _bcs2.close(); } catch(e) {}
                imported.scripts = true;
              }
              // メール：含まれている場合のみ上書き
              if ('mailTemplates' in raw) {
                var mergedMail = raw.mailTemplates;
                window._appCache.mailTemplates = mergedMail;
                window.idbSetAppData('mailTemplates', mergedMail);
                imported.mail = true;
              }

              // 画面遷移
              if ((raw.version === 2 || raw.version === 3) && Array.isArray(raw.screenData)) {
                imported.screen = true;
                imported.screenData = raw.screenData;
              }

              // v3: imageLib を IDB に直接保存（idbSetScreenData 非依存）
              if (raw.version === 3 && Array.isArray(raw.imageLib) && raw.imageLib.length) {
                _saveImageLibToIdb(raw.imageLib);
              }
              window._pendingImgLib = null;

              // 添付ファイル
              if (Array.isArray(raw.sideMenuFiles) && raw.sideMenuFiles.length && window.idbSaveMenuFile) {
                Promise.all(raw.sideMenuFiles.map(function(f){ return window.idbSaveMenuFile(f); })).catch(function(){});
              }

              // 更新履歴
              if (Array.isArray(raw.updateHistory) && raw.updateHistory.length > 0) {
                _mergeHistory(raw.updateHistory);
                imported.history = true;
              }

              // ヒアリング
              if (Array.isArray(raw.hearingQuestions)) { window._appCache.hearingQuestions = raw.hearingQuestions; window.idbSetAppData('hearingQuestions', raw.hearingQuestions); }
              if (Array.isArray(raw.hearingPolicies))  { window._appCache.hearingPolicies  = raw.hearingPolicies;  window.idbSetAppData('hearingPolicies',  raw.hearingPolicies); }
              if (Array.isArray(raw.hearingPatterns))  { window._appCache.hearingPatterns  = raw.hearingPatterns;  window.idbSetAppData('hearingPatterns',  raw.hearingPatterns); }

              // 画面遷移データを IDB に書き込んでから broadcast・applyImport を実行する。
              // idbSetScreenData の完了前に allDataUpdated を送ると、
              // screen.html が idbGetScreenData を読みに行った時点でまだ旧データしか
              // 存在せず反映されない競合が起きるため、Promise チェーンで順序を保証する。
              var _screenWriteP = (imported.screen && typeof idbSetScreenData === 'function')
                ? idbSetScreenData(imported.screenData)
                : Promise.resolve();

              _screenWriteP.catch(function(){}).then(function() {
                // 全タブに一括通知（画面遷移書き込み完了後）
                _broadcastAllDataUpdated();

                _importProgressUpdate('データを反映中…', '', 80);
                setTimeout(function () {
                  try {
                    if (noReload) { _applyImportedDataToPage(imported, raw); } else { location.reload(); }
                  } catch(e) { console.error('applyImport error:', e); }
                  _importProgressHide();
                }, 0);
              });
            } catch(err2) { _importProgressHide(); alert('結合処理に失敗しました: ' + err2.message); }
          }, 0);
        }
        // ===== メールテンプレート単体配列 =====
        else if (Array.isArray(raw)) {
          _importProgressHide();
          if (!confirm('現在のデータをインポートしたデータで上書きします。よろしいですか？')) return;
          _importProgressShow('データを保存中…', 'メールテンプレート', 60);
          setTimeout(function () {
            try {
              window._appCache.mailTemplates = raw;
              window.idbSetAppData('mailTemplates', raw);
              imported.mail = true;
              _broadcastAllDataUpdated();
              _importProgressUpdate('データを反映中…', '', 85);
              setTimeout(function () {
                try {
                  if (noReload) { _applyImportedDataToPage(imported, raw); } else { location.reload(); }
                } catch(e) {}
                _importProgressHide();
              }, 0);
            } catch(err2) { _importProgressHide(); alert('保存に失敗しました: ' + err2.message); }
          }, 0);
        }
        // ===== トークスクリプト単体オブジェクト =====
        else {
          var keys = Object.keys(raw);
          var valid = keys.length > 0 && keys.every(function (k) {
            return raw[k] && raw[k].name && (Array.isArray(raw[k].list) || raw[k].sub);
          });
          if (valid) {
            _importProgressHide();
            if (!confirm('現在のデータをインポートしたデータで上書きします。よろしいですか？')) return;
            _importProgressShow('データを保存中…', 'スクリプト', 60);
            setTimeout(function () {
              try {
                window._appCache.scripts = raw;
                window.idbSetAppData('scripts', raw).then(function() {
                  imported.scripts = true;
                  _broadcastAllDataUpdated();
                  _importProgressUpdate('データを反映中…', '', 85);
                  setTimeout(function () {
                    try {
                      if (noReload) { _applyImportedDataToPage(imported, raw); } else { location.reload(); }
                    } catch(e) { console.error('applyImport error:', e); }
                    _importProgressHide();
                  }, 0);
                }).catch(function(e) { _importProgressHide(); alert('IDB保存に失敗しました: ' + e.message); });
              } catch(err2) { _importProgressHide(); alert('保存に失敗しました: ' + err2.message); }
            }, 0);
          } else {
            _importProgressHide();
            alert('ファイルの形式が正しくありません。');
            return;
          }
        }
      } catch (err) {
        _importProgressHide();
        alert('読み込みに失敗しました: ' + err.message);
      }
    }, 0);
  } catch (err) {
    _importProgressHide();
    alert('読み込みに失敗しました: ' + err.message);
  }
}

/**
 * インポートしたデータをページ内変数に即時反映する（リロードなし）。
 * 各ページの描画関数（renderScriptSidebar, init 等）を呼び出す。
 */
function _applyImportedDataToPage(imported, raw) {
  var msgs = [];
  // deepcopy: structuredClone（Chrome 98+）が使えれば高速、なければ JSON roundtrip
  var _clone = typeof structuredClone === 'function'
    ? structuredClone
    : function (v) { return JSON.parse(JSON.stringify(v)); };

  // スクリプトデータの反映（index.html の scripts 変数を再ロード）
  if (imported.scripts && typeof window.reloadScripts === 'function') {
    window.reloadScripts();
    msgs.push('スクリプト');
  } else if (imported.scripts) {
    try {
      var saved = JSON.stringify(window._appCache.scripts || null);
      if (saved && typeof scripts !== 'undefined') {
        var newData = JSON.parse(saved);
        Object.keys(scripts).forEach(function(k){ delete scripts[k]; });
        Object.assign(scripts, newData);
        if (typeof renderScriptSidebar === 'function') renderScriptSidebar();
        if (typeof renderHome === 'function') renderHome();
        msgs.push('スクリプト');
      }
    } catch(e) {}
  }

  // メールテンプレートの反映（mail.html の templates 変数を再ロード）
  if (imported.mail) {
    try {
      var saved = JSON.stringify(window._appCache.mailTemplates || null);
      if (saved && typeof templates !== 'undefined') {
        templates.length = 0;
        _clone(JSON.parse(saved)).forEach(function(t){ templates.push(t); });
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof showList === 'function') showList('__all__');
        msgs.push('メール');
      }
      // BroadcastChannel でほかのタブにも通知する
      try {
        var bc = new BroadcastChannel('tool_data_update');
        bc.postMessage({ type: 'mailDataUpdated', ts: Date.now() });
        bc.close();
      } catch(e) {}
    } catch(e) {}
  }

  // 画面遷移データの反映
  if (imported.screen && imported.screenData) {
    try {
      // screen.html 用：patterns 変数に直接反映
      if (typeof patterns !== 'undefined') {
        patterns.length = 0;
        imported.screenData.forEach(function(p){ patterns.push(p); });
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof renderFlow === 'function') renderFlow();
        msgs.push('画面遷移');
      }
      // IDB への書き込みは _processImportText 側で完了済み。
      // ここでは他タブ（screen.html）への通知のみ行う。
      try {
        var _bcast = new BroadcastChannel('tool_data_update');
        _bcast.postMessage({ type: 'screenDataUpdated', ts: Date.now() });
        _bcast.close();
      } catch(e) {}
      try { localStorage.setItem(window.profileScopedKey('_screenSaveTs'), Date.now().toString()); } catch(e) {}
    } catch(e) {}
  }

  // 更新履歴の反映
  if (imported.history && typeof window.renderHistory === 'function') {
    window.renderHistory();
  }

  // 反映完了トースト表示
  var msg = msgs.length > 0
    ? '✅ ' + msgs.join('・') + 'データを更新しました'
    : '✅ データを更新しました';

  // 簡易トースト（各ページ固有の toast 関数があればそちらを使う）
  if (typeof toast === 'function') {
    toast(msg);
  } else {
    // 共通のシンプルなトースト
    var el = document.getElementById('_importToast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_importToast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2f3542;color:white;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;pointer-events:none;z-index:9999;opacity:0;transition:opacity .25s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function(){ el.style.opacity = '0'; }, 2800);
  }
}

// 更新履歴をマージ保存（既存にないIDのみ追加し、日付降順ソート）
function _mergeHistory(incoming) {
  try {
    var cur = window._appCache.updateHistory || [];
    var inMap = {};
    incoming.forEach(function (h) { inMap[h.id] = h; });
    var kept   = cur.filter(function (h) { return !inMap[h.id]; });
    var merged = incoming.concat(kept);
    merged.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    window._appCache.updateHistory = merged;
    window.idbSetAppData('updateHistory', merged);
  } catch (e) {}
}

// =============================================================================
// ④ タブ管理・サイドメニュー
// =============================================================================
/**
 * 別のタブを前面に出せなかったとき、自分のタブで開き直すまでの待ち時間（ms）。
 * 前面化に成功していれば、この間にこのタブは blur / 非表示になる。
 */
var _RAISE_WAIT_MS = 500;

/** いま見ているタブで URL を開く（前面化できないときの代替手段） */
function _openHere(url) {
  try { location.href = url; } catch (e) {}
}

/**
 * 既に開いているタブ t を前面に出す。出せなかったら自分のタブで url を開く。
 *
 * 【なぜ必要か】
 * window.open() / focus() は「前面に出してほしい」とブラウザにお願いするだけで、
 * 結果は分からない。別ウィンドウにあるタブや、ブラウザの設定・種類によっては
 * 拒否され、その場合はクリックしても何も起きない（＝ホームに戻れない）ように見えていた。
 * 成功すれば、このタブは blur するか非表示になる。それが起きなければ拒否されたと見なし、
 * このタブ自身を url に切り替える。
 */
function _raiseOrOpenHere(t, url) {
  var left = false;
  var onBlur = function () { left = true; };
  var onVis  = function () { if (document.hidden) left = true; };
  // 先に見張りを付けてから前面化を依頼する（取りこぼし防止）
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  try { t.focus(); } catch (e) {}
  setTimeout(function () {
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
    if (left || document.hidden) return;   // 前面化できた
    _openHere(url);                        // できなかった → 自分のタブで開く
  }, _RAISE_WAIT_MS);
}

/**
 * 名前付きタブで開く。同じ名前のタブが既にあればそこへ移動する。
 *
 * 既存タブは「名前」だけを頼りに探す。window.open の第2引数（タブ名）は
 * ブラウザが共有しているため、ページをまたいでも同じタブが見つかる。
 * 変数に窓の参照を覚えておく方式は、その窓が別のページに切り替わっていても
 * 気付けず、押しても何も起きない原因になるため使わない。
 *
 * 前面に出せないとき（ブラウザが拒否した・ポップアップ禁止など）は、
 * 何も起きないままにせず、いま見ているタブで開く。
 */
window.openNamedTab = function (url, name) {
  // タブ名はウィンドウ（プロファイルの選択単位）ごとに分ける。
  // 別ウィンドウで別プロファイルを開いていても、互いのタブを取り違えない。
  name = window.scopedTabName(name);
  // 新しく開くタブにはプロファイルを URL で渡す（file:// では sessionStorage が引き継がれない）
  var newUrl = window.withProfileParams(url);
  // URL に # が付いていれば、既存タブでもそこへ合わせる（⚙ からタブ指定で開く用）
  var hash = '';
  var hi = String(url).indexOf('#');
  if (hi >= 0) hash = String(url).slice(hi);
  var applyHash = function (t) {
    if (!hash || !t) return;
    try {
      if (t.location.hash === hash) {
        // 同じ値だと hashchange が起きないので、一度空にしてから入れ直す
        t.location.hash = '';
      }
      t.location.hash = hash;
    } catch (e) {
      // file:// では別ページの location を読み書きできず、上の処理が失敗する。
      // location への代入だけは許されていて、ハッシュ違いだけなら再読み込みにならない
      // （admin.html 側の hashchange で該当タブに切り替わる）。
      try { t.location.href = url; } catch (e2) {}
    }
  };

  // まず空 URL で開いて既存タブを取りに行く。
  // いきなり window.open(url, name) にすると、既存タブでも読み込み直しになり
  // 入力中の内容が消えてしまう。
  var t = null;
  try { t = window.open('', name); } catch (e) { t = null; }

  // ポップアップ禁止などで窓が得られない → 自分のタブで開く
  if (!t) { _openHere(url); return null; }

  // 名前が自分自身のタブを指していた（＝別のタブは無い）→ 自分のタブで開く
  if (t === window) { _openHere(url); return null; }

  var isBlank = true;
  try {
    var h = t.location && t.location.href;
    isBlank = !h || h === 'about:blank';
  } catch (e) { isBlank = false; }   // 読めない＝既に何か開いている

  if (isBlank) {
    // 今作ったばかりの空タブ。ここへ読み込む
    try { t.location.href = newUrl; } catch (e) { t = window.open(newUrl, name); }
    if (t && t.focus) { try { t.focus(); } catch (e) {} }
    return t;
  }

  // 既存タブがあった。前面に出す（出せなければ自分のタブで開く）
  applyHash(t);
  _raiseOrOpenHere(t, url);
  return t;
};

/**
 * ヘッダー右端に日時を出す。
 * これまでホームだけだったので、全ページで同じ位置に出す。
 */
function _injectClock() {
  if (document.getElementById('homeClock')) return;      // ホームは元からある
  var right = document.querySelector('header .hd-right');
  if (!right) return;

  var el = document.createElement('span');
  el.id = 'headerClock';
  // 幅を固定しておく。数字が変わるたびに右側がずれるのを防ぐ
  el.style.cssText = 'margin-left:10px;font-size:12px;font-variant-numeric:tabular-nums;'
    + 'color:var(--header-text,#fff);opacity:.85;letter-spacing:.03em;white-space:nowrap;'
    + 'flex:0 0 auto;min-width:11.5em;text-align:left;'
    + 'display:inline-flex;align-items:center;height:32px;';
  right.appendChild(el);

  var DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var p = function (n) { return String(n).padStart(2, '0'); };
  var tick = function () {
    var d = new Date();
    el.textContent = d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate())
      + '(' + DAYS[d.getDay()] + ') ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  tick();
  setInterval(tick, 1000);
}

/**
 * 自分のタブに名前を付ける。
 *
 * window.open(url, name) は「同じ名前のタブ」を探すが、
 * 利用者が直接開いたタブには名前が付いていない。
 * そのため［🏠ホーム］を押すと、既にホームが開いていても
 * 新しいタブが開いてしまっていた。
 * 読み込み時に自分で名乗っておけば、どのページからでも見つけられる。
 */
function _claimTabName() {
  try {
    // 既に名前があっても上書きする。
    // 前面化できず同じタブで別ページへ切り替えた場合、window.name は前のページの
    // 名前のまま残る。そのままだと「スクリプトを開く」が自分自身を指してしまい、
    // 押しても何も起きなくなる。
    var n = window.scopedTabName(window.tabNameForFile(_currentPageFile()));
    if (n && window.name !== n) window.name = n;
  } catch (e) {}
}

/** タブ名にウィンドウID を付ける（同じウィンドウのタブだけを探すため） */
window.scopedTabName = function (name) {
  var g = window.APP_PROFILE && window.APP_PROFILE.group;
  if (!name || !g || name.charAt(0) === '_') return name;
  var suffix = '@' + g;
  return (name.slice(-suffix.length) === suffix) ? name : name + suffix;
};

/** 新しいタブへ、このウィンドウのプロファイルを渡すための URL を作る */
window.withProfileParams = function (url) {
  var P = window.APP_PROFILE;
  if (!P || !P.group) return url;
  url = String(url);
  var hi = url.indexOf('#');
  var base = hi >= 0 ? url.slice(0, hi) : url;
  var hash = hi >= 0 ? url.slice(hi) : '';
  if (/[?&]pg=/.test(base)) return url;
  var add = 'pg=' + encodeURIComponent(P.group)
          + (P.loaded && P.file ? '&pf=' + encodeURIComponent(P.file) : '');
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + add + hash;
};

/** ページ名（file）から、そのページのタブ名を決める */
window.tabNameForFile = function (file) {
  var f = String(file || '').toLowerCase();
  var hit = (window.NAV_PAGES || []).find(function (p) { return p.file.toLowerCase() === f; });
  if (hit) return hit.tab;
  if (f.indexOf('admin') >= 0) return 'adminTab';
  if (f.indexOf('index') >= 0 || f === '') return 'homeTab';
  return f.replace(/[^a-z0-9]/g, '') + 'Tab';
};

window.toggleSideMenu = function () {
  var m = document.getElementById('sideMenu');
  if (!m) return;
  m.classList.toggle('open');
};

window.toggleAccordion = function (id) {
  var body = document.getElementById(id);
  if (!body) return;
  var header = body.previousElementSibling;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (header) {
    header.classList.toggle('open', !isOpen);
    var arrow = header.querySelector('.arrow');
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
  }
};

window.toggleSubAccordion = function (id) {
  var body = document.getElementById(id);
  if (!body) return;
  var header = body.previousElementSibling;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (header) {
    header.classList.toggle('open', !isOpen);
    var sarrow = header.querySelector('.sub-arrow');
    if (sarrow) sarrow.style.transform = isOpen ? '' : 'rotate(90deg)';
  }
};

// 管理画面：パスワード認証付きオープン
var ADMIN_PW = 'admin1234';
var _adminUnlocked = false;
window.openAdminWithAuth = function () {
  if (_adminUnlocked) {
    sessionStorage.setItem('adminAuth', '1');
    window.openNamedTab('admin.html', 'adminTab');
    return;
  }
  var pw = prompt('管理画面のパスワードを入力してください');
  if (pw === null) return;
  if (pw === ADMIN_PW) {
    _adminUnlocked = true;
    sessionStorage.setItem('adminAuth', '1');
    window.openNamedTab('admin.html', 'adminTab');
  } else {
    alert('パスワードが違います');
  }
};

// =============================================================================
// 添付ファイル機能 — sideMenuFiles IDB 操作
// =============================================================================

/** ファイルを IDB sideMenuFiles に保存 */
window.idbSaveMenuFile = function(fileObj) {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('sideMenuFiles', 'readwrite');
      tx.objectStore('sideMenuFiles').put(fileObj, fileObj.id);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function(e) { reject(e.target.error); };
    });
  });
};

/** IDB から全ファイルを取得 */
window.idbGetAllMenuFiles = function() {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('sideMenuFiles', 'readonly');
      var req = tx.objectStore('sideMenuFiles').getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
};

/** IDB から特定ファイルを取得 */
window.idbGetMenuFile = function(id) {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('sideMenuFiles', 'readonly');
      var req = tx.objectStore('sideMenuFiles').get(id);
      req.onsuccess = function(e) { resolve(e.target.result || null); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
};

/** IDB から特定ファイルを削除 */
window.idbDeleteMenuFile = function(id) {
  return _appIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction('sideMenuFiles', 'readwrite');
      tx.objectStore('sideMenuFiles').delete(id);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function(e) { reject(e.target.error); };
    });
  });
};

// =============================================================================
// 添付ファイル機能 — CSS インジェクション
// =============================================================================
(function() {
  var css =
    /* ドロップゾーン */
    '.sm-files-dz{border:2px dashed var(--border,#dfe4ea);border-radius:8px;padding:12px;margin:8px 10px 4px;text-align:center;font-size:11px;color:var(--text3,#999);cursor:pointer;transition:border-color .15s,background .15s;}' +
    '.sm-files-dz:hover,.sm-files-dz.drag-over{border-color:var(--accent,#3742fa);background:var(--accent-lt,#eef0ff);color:var(--accent-text,#3742fa);}' +
    '.sm-files-dz-icon{font-size:20px;display:block;margin-bottom:3px;}' +
    /* ファイルリスト */
    '.sm-files-list{list-style:none;margin:0;padding:0 0 6px;}' +
    '.sm-file-item{display:flex;align-items:center;gap:5px;padding:5px 10px 5px 12px;border-bottom:1px solid var(--border2,#f0f0f0);font-size:12px;}' +
    '.sm-file-item:last-child{border-bottom:none;}' +
    '.sm-file-icon{font-size:15px;flex-shrink:0;}' +
    '.sm-file-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--accent-text,#3742fa);cursor:pointer;font-weight:600;}' +
    '.sm-file-name:hover{text-decoration:underline;}' +
    '.sm-file-size{font-size:10px;color:var(--text3,#999);flex-shrink:0;}' +
    '.sm-file-del{flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text3,#999);font-size:13px;padding:2px 4px;border-radius:4px;}' +
    '.sm-file-del:hover{color:#e74c3c;}' +
    /* ファイルアクションモーダル */
    '#smFileModal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9900;align-items:center;justify-content:center;}' +
    '#smFileModal.open{display:flex;}' +
    '.sm-file-modal-box{background:var(--surface,#fff);border-radius:14px;padding:26px 26px 20px;min-width:260px;max-width:320px;width:88%;box-shadow:0 12px 40px rgba(0,0,0,.25);}' +
    '.sm-file-modal-title{font-size:13px;font-weight:700;color:var(--text,#2f3542);margin:0 0 5px;word-break:break-all;line-height:1.5;}' +
    '.sm-file-modal-sub{font-size:11px;color:var(--text3,#999);margin:0 0 16px;}' +
    '.sm-file-modal-btns{display:flex;flex-direction:column;gap:7px;}' +
    '.sm-file-modal-btn{padding:9px 0;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;font-family:inherit;}' +
    '.sm-file-modal-btn:hover{opacity:.85;}' +
    '.sm-file-modal-btn.view{background:var(--accent,#3742fa);color:#fff;}' +
    '.sm-file-modal-btn.dl{background:var(--surface2,#f1f2f6);color:var(--text,#2f3542);border:1px solid var(--border,#dfe4ea);}' +
    '.sm-file-modal-btn.cancel{background:none;color:var(--text3,#999);font-weight:400;font-size:12px;padding:5px 0;}' +
    /* PDF ビューアモーダル */
    '#smPdfViewer{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9910;flex-direction:column;}' +
    '#smPdfViewer.open{display:flex;}' +
    '.sm-pdf-toolbar{height:46px;background:var(--header-bg,#2f3542);color:#fff;display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;}' +
    '.sm-pdf-toolbar-title{flex:1;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.sm-pdf-toolbar-btn{background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer;font-weight:600;font-family:inherit;}' +
    '.sm-pdf-toolbar-btn:hover{background:rgba(255,255,255,.28);}' +
    '#smPdfFrame{flex:1;width:100%;border:none;background:#fff;}';
  var el = document.createElement('style');
  el.id = 'smFilesStyle';
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
})();

// =============================================================================
// 添付ファイル機能 — モーダル DOM 注入
// =============================================================================
(function() {
  function _inject() {
    if (!document.getElementById('smFileModal')) {
      var m = document.createElement('div');
      m.id = 'smFileModal';
      m.innerHTML =
        '<div class="sm-file-modal-box">' +
          '<p class="sm-file-modal-title" id="smFileModalTitle"></p>' +
          '<p class="sm-file-modal-sub"  id="smFileModalSub"></p>' +
          '<div class="sm-file-modal-btns">' +
            '<button class="sm-file-modal-btn view"   id="smFileModalViewBtn" onclick="window._smViewPdf()" style="display:none">🌐 ブラウザで閲覧</button>' +
            '<button class="sm-file-modal-btn dl"     id="smFileModalDlBtn"   onclick="window._smDownloadFile()">⬇ ダウンロード</button>' +
            '<button class="sm-file-modal-btn cancel"                         onclick="window._smCloseFileModal()">キャンセル</button>' +
          '</div>' +
        '</div>';
      m.addEventListener('click', function(e){ if(e.target===m) window._smCloseFileModal(); });
      document.body.appendChild(m);
    }
    if (!document.getElementById('smPdfViewer')) {
      var v = document.createElement('div');
      v.id = 'smPdfViewer';
      v.innerHTML =
        '<div class="sm-pdf-toolbar">' +
          '<span class="sm-pdf-toolbar-title" id="smPdfViewerTitle"></span>' +
          '<button class="sm-pdf-toolbar-btn" onclick="window._smDownloadFile()">⬇ DL</button>' +
          '<button class="sm-pdf-toolbar-btn" onclick="window._smClosePdfViewer()">✕ 閉じる</button>' +
        '</div>' +
        '<iframe id="smPdfFrame" src="about:blank"></iframe>';
      document.body.appendChild(v);
    }
  }
  if (document.body) { _inject(); }
  else { document.addEventListener('DOMContentLoaded', _inject); }
})();

// =============================================================================
// 添付ファイル機能 — ファイルアクション
// =============================================================================

/** MIMEタイプ → アイコン */
window._smMimeIcon = function(mime) {
  if (!mime) return '📄';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('zip') || mime.includes('compressed')) return '📦';
  return '📄';
};

/** ファイルサイズ表示 */
window._smFormatSize = function(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
};

/** 現在操作中のファイル */
window._smCurrentFile = null;

/** ファイル名クリック → アクション選択モーダル */
window._smFileAction = function(id) {
  if (!window.idbGetMenuFile) { alert('ファイル機能が初期化されていません'); return; }
  window.idbGetMenuFile(id).then(function(f) {
    if (!f) { alert('ファイルが見つかりません（ID: ' + id + '）'); return; }
    window._smCurrentFile = f;
    var isPdf = f.mimeType === 'application/pdf';
    var isImg = (f.mimeType || '').startsWith('image/');

    // PDF → 別タブで開く
    if (isPdf) {
      var tab = window.open('', '_blank');
      if (tab) {
        tab.document.write(
          '<html><head><title>' + f.name.replace(/</g,'&lt;') + '</title></head>' +
          '<body style="margin:0;padding:0;">' +
          '<embed src="' + f.dataUrl + '" type="application/pdf" width="100%" height="100%" style="position:fixed;inset:0;width:100%;height:100%;">' +
          '</body></html>'
        );
        tab.document.close();
      }
      return;
    }

    // 画像 → 別タブで開く
    if (isImg) {
      var imgTab = window.open('', '_blank');
      if (imgTab) {
        imgTab.document.write(
          '<html><head><title>' + f.name.replace(/</g,'&lt;') + '</title></head>' +
          '<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;">' +
          '<img src="' + f.dataUrl + '" style="max-width:100%;max-height:100vh;object-fit:contain;">' +
          '</body></html>'
        );
        imgTab.document.close();
      }
      return;
    }

    // その他 → 即ダウンロード
    window._smDownloadFile();
  }).catch(function(e) {
    alert('ファイルの読み込みに失敗しました: ' + (e && e.message || e));
  });
};

window._smCloseFileModal = function() {
  var m = document.getElementById('smFileModal');
  if (m) m.classList.remove('open');
};

window._smViewPdf = function() {
  window._smCloseFileModal();
  var f = window._smCurrentFile; if (!f) return;
  var viewer = document.getElementById('smPdfViewer');
  var frame  = document.getElementById('smPdfFrame');
  var title  = document.getElementById('smPdfViewerTitle');
  if (!viewer || !frame) return;
  if (title) title.textContent = f.name;
  frame.src = f.dataUrl;
  viewer.classList.add('open');
};

window._smClosePdfViewer = function() {
  var v = document.getElementById('smPdfViewer');
  var f = document.getElementById('smPdfFrame');
  if (v) v.classList.remove('open');
  if (f) f.src = 'about:blank';
};

window._smDownloadFile = function() {
  window._smCloseFileModal();
  var f = window._smCurrentFile; if (!f) return;
  var a = document.createElement('a');
  a.href     = f.dataUrl;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ document.body.removeChild(a); }, 100);
};

/** マニュアルPDFをブラウザで閲覧（別タブで開く） */
window._smOpenManualPdf = function(event, url) {
  event.preventDefault();
  event.stopPropagation();
  if (!url) return;
  // file:// URL はブラウザのセキュリティ制限により window.open で開く
  var tab = window.open(url, '_blank');
  if (!tab) {
    // ポップアップブロック時はアンカーリンクで代替
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); }, 100);
  }
};

/** onclick 属性内の JS 文字列リテラル用エスケープ
 *  Windows の共有パス（\\server\share\...）を安全に埋め込むため、
 *  バックスラッシュ → シングルクォート → HTML 特殊文字の順に処理する */
function _smAttrJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  "\\'")
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}

/**
 * 動画パスを、確実に解決できる絶対URLへ正規化する。
 *
 *  ・相対パス（./videos/… ）
 *      プレイヤーは window.open('','_blank') + document.write で作るため、
 *      about:blank の基準URLがブラウザ依存になり相対パスが外れることがある。
 *      呼び出し元ページ（location.href）を基準に絶対URL化して回避する。
 *  ・日本語やスペースを含むパス
 *      new URL() が自動でパーセントエンコードするため、そのまま扱える。
 *  ・"#" や "?" を含むフォルダ名
 *      URLの断片/クエリ記号と解釈されてしまうため、先にエスケープする。
 *  ・Windows のUNC/ドライブレターパス
 *      file:// 形式へ変換する。
 */
function _smResolveMediaUrl(u) {
  var s = String(u == null ? '' : u).trim();
  if (!s) return '';

  // \\server\share\... → file://server/share/...
  if (/^\\\\/.test(s)) return 'file://' + s.replace(/\\/g, '/').replace(/^\/\//, '');
  // C:\path\... → file:///C:/path/...
  if (/^[a-zA-Z]:[\\/]/.test(s)) return 'file:///' + s.replace(/\\/g, '/');
  // 既にスキーム付き（http: / https: / file: など）はそのまま
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return s;

  // 相対パス：# と ? だけ先に逃がしてから絶対URL化する
  var safe = s.replace(/#/g, '%23').replace(/\?/g, '%3F');
  try { return new URL(safe, location.href).href; } catch (e) { return s; }
}

/** HTML 埋め込み用エスケープ */
function _smHtmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 動画を別タブで再生する。
 * マニュアルPDF（_smFileAction）と同じ方式で、about:blank のタブに
 * プレイヤーページを書き込む。opener と同一スキームになるため、
 * ツールを file:// で開いている場合は共有フォルダの動画もそのまま再生できる。
 */
window._smOpenVideo = function(event, url, name) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!url) return;

  var title = name || String(url).split(/[\\/]/).pop();
  url = _smResolveMediaUrl(url);          // 相対パス・日本語・UNC を絶対URLへ
  var tab   = window.open('', '_blank');

  // ポップアップブロック時は動画URLへ直接遷移させる
  if (!tab) {
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); }, 100);
    return;
  }

  var u = _smHtmlEsc(url), t = _smHtmlEsc(title);
  tab.document.write(
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<title>' + t + '</title>' +
    '<style>' +
      'html,body{margin:0;height:100%;background:#0d0d0d;color:#eee;' +
        'font-family:"Noto Sans JP",sans-serif;display:flex;flex-direction:column;}' +
      'header{height:44px;display:flex;align-items:center;padding:0 16px;gap:12px;' +
        'background:#2f3542;font-size:13px;font-weight:700;flex-shrink:0;}' +
      'header span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      'header a{color:#cfd6e4;font-size:11px;font-weight:600;text-decoration:none;' +
        'border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:4px 10px;}' +
      'header a:hover{background:rgba(255,255,255,.12);}' +
      'main{flex:1;display:flex;align-items:center;justify-content:center;padding:12px;min-height:0;}' +
      'video{max-width:100%;max-height:100%;background:#000;outline:none;}' +
      '#err{display:none;max-width:620px;font-size:13px;line-height:2;color:#ffd9d9;' +
        'background:#2a1a1a;border-radius:10px;padding:22px 24px;}' +
      '#err a{color:#ffb3b3;}' +
    '</style></head><body>' +
    '<header><span>🎬 ' + t + '</span>' +
      '<a href="' + u + '" download>⬇ ダウンロード</a></header>' +
    '<main>' +
      '<video id="v" controls autoplay playsinline preload="metadata" src="' + u + '"></video>' +
      '<div id="err">⚠️ この動画を再生できませんでした。<br>' +
        'ブラウザのセキュリティ制限（http(s) ページから file:// を読み込めない）か、' +
        '対応していない形式の可能性があります。<br>' +
        '再生可能な形式：MP4(H.264) / WebM / Ogg<br><br>' +
        '<a href="' + u + '">元のファイルを直接開く</a></div>' +
    '</main>' +
    '<script>' +
      'var v=document.getElementById("v");' +
      'v.onerror=function(){v.style.display="none";document.getElementById("err").style.display="block";};' +
    '<\/script>' +
    '</body></html>'
  );
  tab.document.close();
};

window._smDeleteFile = function(id) {
  if (!confirm('このファイルを削除しますか？')) return;
  window.idbDeleteMenuFile(id).then(function() {
    window._renderSideMenuFileList();
  });
};

// =============================================================================
// 添付ファイル機能 — サイドメニューファイルリスト描画
// =============================================================================
window._renderSideMenuFileList = function() {
  var listEl = document.getElementById('smFilesList'); if (!listEl) return;
  window.idbGetAllMenuFiles().then(function(files) {
    if (!files || !files.length) {
      listEl.innerHTML = '<li style="padding:7px 14px;font-size:11px;color:var(--text3,#999)">ファイルがありません</li>';
      return;
    }
    files.sort(function(a,b){ return (b.addedAt||'').localeCompare(a.addedAt||''); });
    var _e = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    listEl.innerHTML = files.map(function(f) {
      return '<li class="sm-file-item">' +
        '<span class="sm-file-icon">' + window._smMimeIcon(f.mimeType) + '</span>' +
        '<span class="sm-file-name" onclick="window._smFileAction(\'' + _e(f.id) + '\')" title="' + _e(f.name) + '">' + _e(f.name) + '</span>' +
        '<span class="sm-file-size">' + window._smFormatSize(f.size) + '</span>' +
        '<button class="sm-file-del" onclick="window._smDeleteFile(\'' + _e(f.id) + '\')" title="削除">🗑</button>' +
      '</li>';
    }).join('');
  }).catch(function() {
    listEl.innerHTML = '<li style="padding:7px 14px;font-size:11px;color:var(--text3,#999)">読み込みエラー</li>';
  });
};

// =============================================================================
// 添付ファイル機能 — D&D ハンドラ
// =============================================================================
window._smHandleDrop = function(event) {
  event.preventDefault();
  event.stopPropagation();
  var files = event.dataTransfer && event.dataTransfer.files;
  if (!files || !files.length) return;
  Array.prototype.forEach.call(files, _smSaveFile);
};

window._smHandleFileInput = function(input) {
  var files = input.files; if (!files || !files.length) return;
  Array.prototype.forEach.call(files, _smSaveFile);
  input.value = '';
};

function _smSaveFile(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var fileObj = {
      id:       'smf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
      name:     file.name,
      mimeType: file.type || _smGuessMime(file.name),
      size:     file.size,
      dataUrl:  e.target.result,
      addedAt:  new Date().toISOString()
    };
    window.idbSaveMenuFile(fileObj);
  };
  reader.readAsDataURL(file);
}

function _smGuessMime(name) {
  var ext = (name||'').split('.').pop().toLowerCase();
  return {pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',zip:'application/zip',txt:'text/plain'}[ext] || 'application/octet-stream';
}

// =============================================================================
// ⑤ サイドメニュー HTML 構築・更新履歴描画
// =============================================================================
window.renderHistory = function () {
  var panel = document.getElementById('historyPanel');
  if (!panel) return;
  var arr = window._appCache.updateHistory || [];
  if (!arr || arr.length === 0) {
    arr = [{ id: 'h_default_1', content: '初版作成', author: '-', approver: '-', date: '2026/03/08' }];
  }
  var td = function (v) {
    return '<td style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;color:var(--text,#2f3542);word-break:break-all;">' + (v || '-') + '</td>';
  };
  var rows = arr.map(function (e) { return '<tr>' + td(e.content) + td(e.author) + td(e.approver) + td(e.date) + '</tr>'; }).join('');
  panel.innerHTML =
    '<div style="padding:10px 12px 14px;"><div style="overflow-x:auto;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:280px;">' +
    '<colgroup><col><col style="width:52px"><col style="width:52px"><col style="width:82px"></colgroup>' +
    '<thead><tr style="background:var(--surface2,#f8f9fa)">' +
    '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">更新内容</th>' +
    '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">更新者</th>' +
    '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">承認者</th>' +
    '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">更新日</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div></div>';
};

// =============================================================================
// サイドメニュー JSON キー
// =============================================================================
var SIDE_MENU_DATA_KEY = 'sideMenuData';

// 更新履歴は data.js（APP_STATIC_DATA.updateHistory）で管理します。

// サイドメニューは data.js（APP_STATIC_DATA.sideMenuData）で管理します。

window.loadSideMenuData = function() {
  return window._appCache.sideMenuData || null;
};

window.saveSideMenuData = function(data) {
  window._appCache.sideMenuData = data;
  window.idbSetAppData('sideMenuData', data);
};

// 初回起動時の localStorage 書き込みは廃止。
// サイドメニューデータの正は data.js（APP_STATIC_DATA.sideMenuData）。
// admin.html の「💾 保存して反映」で更新する。

function _buildSideMenuHTML(isDark, sectionsOverride) {
  // localStorage は使用しない。data.js の内容（_appCache.sideMenuData）を正として参照する。
  // キャッシュ未設定のタイミングで呼ばれても欠けないよう data.js を直接見る保険を入れる。
  // sectionsOverride：管理画面が、保存前の編集中の内容をこの画面のメニューに出すときに渡す。
  var sections = (Array.isArray(sectionsOverride) ? sectionsOverride : null)
              || (window._appCache && window._appCache.sideMenuData)
              || (window.APP_STATIC_DATA && window.APP_STATIC_DATA.sideMenuData)
              || [];
  var html = '';

  // ダークモードトグル（固定）
  html += '<div class="side-section"><div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;">' +
    '<span style="font-size:13px;font-weight:600;">🌙 ダークモード</span>' +
    '<label class="dark-toggle-sw"><input type="checkbox" id="darkModeToggle"' + (isDark ? ' checked' : '') + ' onchange="window.applyDarkMode(this.checked)"><span class="dark-toggle-sl"></span></label>' +
    '</div></div>';



  // JSON 定義セクション
  sections.forEach(function(sec, si) {
    var secId = sec.id || ('smSec_' + si);

    if (sec.type === 'links_with_sub') {
      // サブアコーディオン付きセクション
      html += '<div class="side-section"><div class="side-section-header" onclick="toggleAccordion(\'' + secId + '\')">' +
        sec.label + ' <span class="arrow" style="display:inline-block;transition:transform .2s">▶</span></div>' +
        '<ul class="accordion-body" id="' + secId + '">';
      (sec.subSections || []).forEach(function(sub, sj) {
        var subId = sub.id || (secId + '_sub' + sj);
        var lis = (sub.items || []).map(function(it) {
          if (it.disabled) {
            return '<li><span class="sm-link-disabled">' + (it.name || '') + '<em class="sm-disabled-badge">無効</em></span></li>';
          }
          if (it.fileId) {
            return '<li><a href="javascript:void(0)" onclick="window._smFileAction(\'' + it.fileId.replace(/'/g,"\\'") + '\')" style="display:flex;align-items:center;gap:4px;">📎 ' + it.name + '</a></li>';
          }
          if (it.file) {
            return '<li><a href="' + it.file + '" download style="display:flex;align-items:center;gap:4px;">⬇️ ' + it.name + '</a></li>';
          }
          // マニュアル／動画ボタン（通常セクションと同じ見た目）
          var subManualBtn = (it.manualUrl) ?
            '<a href="' + _smHtmlEsc(_smResolveMediaUrl(it.manualUrl)) + '" target="_blank" title="マニュアルをブラウザで閲覧" style="border:1px solid var(--accent,#4361ee);border-radius:4px;color:var(--accent-text,#4361ee);font-size:10px;padding:1px 6px;line-height:1.5;flex-shrink:0;white-space:nowrap;text-decoration:none;background:none;">📕 マニュアル</a>　' : '';
          var subVideoBtn = (it.videoUrl) ?
            '<a href="javascript:void(0)" onclick="window._smOpenVideo(event,\'' + _smAttrJs(it.videoUrl) + '\',\'' + _smAttrJs(it.name || '') + '\')" title="動画をブラウザで再生" style="border:1px solid #e8590c;border-radius:4px;color:#e8590c;font-size:10px;padding:1px 6px;line-height:1.5;flex-shrink:0;white-space:nowrap;text-decoration:none;background:none;">🎬 動画</a>　' : '';
          if (subManualBtn || subVideoBtn) {
            return '<li style="display:flex;align-items:center;gap:4px;">' +
              '<a href="' + (it.url || '#') + '" target="_blank" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.name + '</a>' +
              subManualBtn + subVideoBtn + '</li>';
          }
          return '<li><a href="' + (it.url || '#') + '" target="_blank">' + it.name + '</a></li>';
        }).join('');
        html += '<li class="sub-acc-item">' +
          '<div class="sub-acc-header" onclick="toggleSubAccordion(\'' + subId + '\')">' +
          '<span class="sub-arrow" style="display:inline-block;transition:transform .2s">▶</span>' + sub.label +
          '</div><ul class="sub-acc-body" id="' + subId + '">' + lis + '</ul></li>';
      });
      html += '</ul></div>';

    } else if (sec.type === 'shortcut') {
      // ショートカットキー一覧。見出し（group）ごとに キー / 説明 を並べる。
      // data.js に見出しだけ入っている（groups が無い）場合は既定の内容を出す。
      var scGroups = (Array.isArray(sec.groups) && sec.groups.length)
        ? sec.groups : _defaultShortcutGroups();
      var scBody = scGroups.map(function(g) {
        return '<div class="sc-sec">' + _smHtmlEsc(g.label || '') + '</div>'
          + '<table class="sc-table">' + (g.rows || []).map(function(r) {
              var keys = String(r[0] || '').split(' ').map(function(k) {
                return (k === '/' || k === '+') ? k : '<kbd>' + _smHtmlEsc(k) + '</kbd>';
              }).join(' ');
              return '<tr><th>' + keys + '</th><td>' + _smHtmlEsc(r[1] || '') + '</td></tr>';
            }).join('') + '</table>';
      }).join('');
      html += '<div class="side-section">'
        + '<div class="side-section-header" onclick="toggleAccordion(\'' + secId + '\')">'
        +   (sec.label || '⌨️ ショートカットキー一覧') + ' '
        +   '<span class="arrow" style="display:inline-block;transition:transform .2s">▶</span>'
        + '</div>'
        + '<div class="accordion-body" id="' + secId + '" style="padding:10px 12px 14px;">'
        +   scBody
        +   (sec.note ? '<div class="sc-note">' + _smHtmlEsc(sec.note) + '</div>' : '')
        + '</div></div>';

    } else if (sec.type === 'table') {
      // 表セクション（フォネティックコード、ドメイン一覧などに使う）。
      // 見出し行 sec.headers と、明細 sec.rows を管理画面で編集できる。
      var hd = (sec.headers || []).map(function(t) {
        return '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;'
             + 'font-weight:700;color:var(--text2,#555)">' + _smHtmlEsc(t) + '</th>';
      }).join('');
      var bd = (sec.rows || []).map(function(r) {
        return '<tr>' + (r || []).map(function(c) {
          return '<td style="padding:5px 8px;border:1px solid var(--border,#e8eaed);">'
               + _smHtmlEsc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      html += '<div class="side-section"><div class="side-section-header" onclick="toggleAccordion(\'' + secId + '\')">' +
        sec.label + ' <span class="arrow" style="display:inline-block;transition:transform .2s">▶</span></div>' +
        '<div class="accordion-body" id="' + secId + '" style="padding:10px 12px 14px;"><div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:220px;">' +
        (hd ? '<thead><tr style="background:var(--surface2,#f8f9fa)">' + hd + '</tr></thead>' : '') +
        '<tbody>' + bd + '</tbody></table></div></div></div>';

    } else if (sec.type === 'phonetic') {
      // フォネティックコード（固定テーブル）
      html += '<div class="side-section"><div class="side-section-header" onclick="toggleAccordion(\'' + secId + '\')">' +
        sec.label + ' <span class="arrow" style="display:inline-block;transition:transform .2s">▶</span></div>' +
        '<div class="accordion-body" id="' + secId + '" style="padding:10px 12px 14px;"><div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:220px;">' +
        '<colgroup><col><col style="width:160px"></colgroup>' +
        '<thead><tr style="background:var(--surface2,#f8f9fa)">' +
        '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">アルファベット</th>' +
        '<th style="padding:6px 8px;border:1px solid var(--border,#e8eaed);text-align:center;font-weight:700;color:var(--text2,#555)">読み方</th>' +
        '</tr></thead><tbody>' +
        '</tbody></table></div></div></div>';

    } else {
      // 通常リンクセクション
      var lis = (sec.items || []).map(function(it) {
        if (it.disabled) {
          return '<li><span class="sm-link-disabled">' + (it.name || '') + '<em class="sm-disabled-badge">無効</em></span></li>';
        }
        if (it.fileId) {
          return '<li><a href="javascript:void(0)" onclick="window._smFileAction(\'' + it.fileId.replace(/'/g,"\\'") + '\')" style="display:flex;align-items:center;gap:4px;">📎 ' + it.name + '</a></li>';
        }
        if (it.file) {
          return '<li><a href="' + it.file + '" download style="display:flex;align-items:center;gap:4px;">⬇️ ' + it.name + '</a></li>';
        }
        var manualBtn = (it.manualUrl) ?
          '<a href="' + _smHtmlEsc(_smResolveMediaUrl(it.manualUrl)) + '" target="_blank" title="マニュアルをブラウザで閲覧" style="border:1px solid var(--accent,#4361ee);border-radius:4px;color:var(--accent-text,#4361ee);font-size:10px;padding:1px 6px;line-height:1.5;flex-shrink:0;white-space:nowrap;text-decoration:none;background:none;">📕 マニュアル</a>　' : '';
        var videoBtn = (it.videoUrl) ?
          '<a href="javascript:void(0)" onclick="window._smOpenVideo(event,\'' + _smAttrJs(it.videoUrl) + '\',\'' + _smAttrJs(it.name || '') + '\')" title="動画をブラウザで再生" style="border:1px solid #e8590c;border-radius:4px;color:#e8590c;font-size:10px;padding:1px 6px;line-height:1.5;flex-shrink:0;white-space:nowrap;text-decoration:none;background:none;">🎬 動画</a>　' : '';
        return '<li style="display:flex;align-items:center;gap:4px;">' + '<a href="' + (it.url || '#') + '" target="_blank" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.name + '</a>' + manualBtn + videoBtn + '</li>';
      }).join('');
      html += '<div class="side-section"><div class="side-section-header" onclick="toggleAccordion(\'' + secId + '\')">' +
        sec.label + ' <span class="arrow" style="display:inline-block;transition:transform .2s">▶</span></div>' +
        '<ul class="accordion-body" id="' + secId + '">' + lis + '</ul></div>';
    }
  });
  // フォネティックコード・ドメインリストなどの表は
  // 管理画面（サイドメニュー編集）で作れる「表セクション」に移行した。
  // ここでのハードコードは廃止し、sideMenuData から描画する。


  // 更新履歴（固定）
  html += '<div class="side-section" id="historySideSection">' +
    '<div class="side-section-header" onclick="toggleAccordion(\'historyPanel\')">📝 更新履歴 <span class="arrow" style="display:inline-block;transition:transform .2s">▶</span></div>' +
    '<div class="accordion-body" id="historyPanel" style="padding:0;"></div></div>';

  return html;
}

// =============================================================================
// ⑥ ヒアリングチェックシート（hearing.js 全機能）
// ※ 変更なし（省略せず全文維持）
// =============================================================================

// 入力中のヒアリング内容はプロファイルごとに分ける（標準＝data.js は従来のキーのまま）
/**
 * localStorage のキーに、いまのプロファイルぶんの印を付ける。
 * 画面遷移・サイドメニューの開閉・メールの旧データなど、data.js / IndexedDB を経由しない
 * localStorage 直書きの保存先は、これを通さないとプロファイルをまたいで混ざってしまう
 * （IndexedDB は window.APP_IDB_NAME で分かれているが、localStorage は素のままだと file:// 全体で共有される）。
 */
window.profileScopedKey = function (base) {
  return base + ((window.APP_PROFILE && window.APP_PROFILE.storageSuffix) || '');
};

var HEARING_KEY = 'hearingState_v7' + ((window.APP_PROFILE && window.APP_PROFILE.storageSuffix) || '');
var HEARING_TPL_KEY = 'hearingTemplate' + ((window.APP_PROFILE && window.APP_PROFILE.storageSuffix) || '');

/** 登録されているテンプレート一覧 */
window.getHearingTemplates = function() {
  var t = (window._appCache && window._appCache.hearingTemplates) ||
          (window.APP_STATIC_DATA && window.APP_STATIC_DATA.hearingTemplates) || [];
  return t.slice().sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
};

/**
 * ヒアリング関連のデータを IndexedDB から読み込む。
 * これまで admin.html でしか読んでおらず、hearing.html や script.html では
 * 管理画面で作ったテンプレートや質問が反映されなかった。
 */
window.loadHearingData = function() {
  if (!window.idbGetAppData) return Promise.resolve();
  return Promise.all([
    window.idbGetAppData('hearingTemplates'),
    window.idbGetAppData('hearingQuestions'),
    window.idbGetAppData('hearingPolicies'),
    window.idbGetAppData('hearingDataVersion'),
    window.idbGetAppData('hearingFixedReady')
  ]).then(function(r) {
    if (r[4] != null) window._appCache.hearingFixedReady = !!r[4];
    // バージョンが合うときだけ保存データを使う（合わなければ data.js の内容）
    // 「.length があるときだけ採用」にしていると、全件削除して保存した空配列が
    // 無視され、data.js の内容が復活してしまう。配列であればそのまま使う。
    if (r[3] === window.HEARING_DATA_VERSION) {
      if (Array.isArray(r[1])) window._appCache.hearingQuestions = r[1];
      if (Array.isArray(r[2])) window._appCache.hearingPolicies  = r[2];
    }
    // テンプレートはバージョン管理の対象外（後から追加した機能のため）
    if (Array.isArray(r[0])) window._appCache.hearingTemplates = r[0];
    if (typeof renderHearing === 'function') renderHearing();
  }).catch(function() {});
};

// ヒアリングを表示するページでは、読み込み後に反映する
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { window.loadHearingData(); });
} else {
  window.loadHearingData();
}

/** いま選ばれているテンプレートID（未選択なら空） */
window.getCurrentTemplate = function() {
  try { return localStorage.getItem(HEARING_TPL_KEY) || ''; } catch (e) { return ''; }
};

/**
 * テンプレートを切り替える。
 * 別の聞き取りを始める操作なので、入力済みの回答は消す。
 */
window.setCurrentTemplate = function(id) {
  var next = id || '';
  try {
    // 空文字だと「未設定」と区別が付かない環境があるため、解除時はキーごと消す
    if (next) localStorage.setItem(HEARING_TPL_KEY, next);
    else      localStorage.removeItem(HEARING_TPL_KEY);
  } catch (e) {}

  // 別の聞き取りを始める操作なので入力済みの回答は消す。
  //
  // 【不具合対応】以前はキーを1つ残らず delete していたため、
  // devices（デバイス欄の入れ物）まで消えてしまい、直後の renderHearing() が
  // s.devices[device] で例外を出して止まっていた。
  // その結果「解除ボタンが効かない」「結果文が出ない」「リセットの効き方が不安定」
  // といった症状がまとめて発生していたので、既定値で作り直す形に改める。
  hearingState = _hrNewState();
  if (typeof saveHearingState === 'function') saveHearingState();
  if (typeof renderHearing === 'function') renderHearing();
};

/** テンプレートの選択を解除する */
window.clearHearingTemplate = function() {
  window.setCurrentTemplate('');
};

/**
 * テンプレートのトグル。選んでいないものを押すと切り替え、選択中のものをもう一度押すと解除する。
 * （以前は解除専用の「✕ 解除」ボタンがあった）
 */
window.toggleHearingTemplate = function(id) {
  if (id && window.getCurrentTemplate() === id) window.clearHearingTemplate();
  else window.setCurrentTemplate(id);
};

/**
 * いまのテンプレートで表示する質問だけを返す。
 *   common: true … どのテンプレートでも表示
 *   tplIds に含む … そのテンプレートのときだけ表示（複数指定できる。旧データは tplId）
 * テンプレート未選択のときは共通項目だけを出す。
 */
window.filterQuestionsByTemplate = function(list) {
  var cur = window.getCurrentTemplate();
  var lst = list || [];
  var byId = {};
  lst.forEach(function(q) { if (q) byId[q.id] = q; });
  var ok = function(q) {
    var ids = window.getQuestionTplIds(q);
    if (!ids.length) return true;       // 共通・未設定は常に表示
    return ids.indexOf(cur) >= 0;
  };
  // 入れ子（親→子→孫…）は、自分の条件に加えて、親もすべて表示されるときだけ表示する。
  // 何段ネストしても対応できるよう、親をたどって再帰的に判定する。
  var memo = {};
  var visible = function(q) {
    if (!q) return false;
    if (Object.prototype.hasOwnProperty.call(memo, q.id)) return memo[q.id];
    memo[q.id] = false;   // 循環参照が万一あっても無限ループにしない
    var v = ok(q) && (q.parentId ? visible(byId[q.parentId]) : true);
    memo[q.id] = v;
    return v;
  };
  return lst.filter(visible);
};

/**
 * ログ作成補助の中に置かれた項目（記述・選択など）のうち、いま表示するもの。
 * 有効で、表示条件・パターンを満たすものだけ。
 */
/**
 * ログ作成補助の、特定のボタン（サブテンプレート）に属する中の項目を取り出す。
 * ボタンごとに完全に別の項目セットを持つ（他のボタンとは共用しない）。
 */
window.hearingChildItemsForOpt = function(q, optV, s) {
  if (!q || typeof _hrGetQuestions !== 'function') return [];
  var over = (typeof _hrPatternOverrides === 'function') ? _hrPatternOverrides(s || hearingState) : {};
  return window.filterQuestionsByTemplate(_hrGetQuestions()).filter(function(k) {
    if (k.parentId !== q.id || k.parentOpt !== optV || !k.enabled) return false;
    if (k.type === 'spacer') return false;   // 空白行は中を持てない（見出し・ログ作成補助は中に置ける）
    if (k.id in over) return !!over[k.id];
    return _hrEvalShowIf(k.showIf, s || hearingState);
  });
};

window.hearingChildItems = function(q, s) {
  if (!q || typeof _hrGetQuestions !== 'function') return [];
  var over = (typeof _hrPatternOverrides === 'function') ? _hrPatternOverrides(s || hearingState) : {};
  return window.filterQuestionsByTemplate(_hrGetQuestions()).filter(function(k) {
    if (k.parentId !== q.id || !k.enabled) return false;
    if (k.type === 'spacer') return false;   // 空白行は中を持てない（見出し・ログ作成補助は中に置ける）
    if (k.id in over) return !!over[k.id];
    return _hrEvalShowIf(k.showIf, s || hearingState);
  });
};

/**
 * 質問を表示するテンプレートID の一覧。空なら共通（すべてのテンプレートで表示）。
 * 1つの質問を複数のテンプレートで使えるよう tplIds（配列）で持つ。
 * 以前のデータは tplId（1つだけ）なので、それも読めるようにしている。
 */
window.getQuestionTplIds = function(q) {
  if (!q || q.common) return [];
  if (Array.isArray(q.tplIds)) return q.tplIds.filter(function(x) { return !!x; });
  return q.tplId ? [q.tplId] : [];
};

// 入力状態の初期値。
// 以前は「用途」「【移行Sアカ】…」など業務固有の項目をここに並べていたが、
// 質問は data.js で管理する運用になったため、汎用の入れ物だけにする。
// 各項目の値は、回答が入った時点で追加される。
var DEFAULT_STATE = {
  devices: {},   // 詳細つきトグルの入れ物（質問ごとに作り直される）
  memo: ''
};

// デバイス・キャリア・メールドメインの候補は data.js（質問の options）で持つ。
// 以前はここに既定値を並べていたが、事業所ごとに違うものを
// 共通スクリプトに書いておく意味がないため廃止した。

/**
 * 質問の選択肢。候補は質問そのものが持つ。
 * 読み込み順に左右されないよう関数宣言にしている
 * （初期状態の組み立てが、この下の定義より先に走るため）。
 */
/**
 * チェック＋数量：チェックした項目の行を作る（plain と、書式があるときの html）。
 * 各項目の文字にある「●」は、共有のテキストエリアの値に置き換える。
 */
function _hrQtyCheckParts(q, s) {
  var fld = q.field || q.id;
  var st = s[fld] || {};
  var picked = Array.isArray(st.picked) ? st.picked : [];
  var qty = (st.text != null) ? String(st.text) : '';
  var opts = window.getHearingOptions(q) || [];
  var order = opts.map(function (o) { return o.v || o.l; });
  var texts = [], htmls = [], hasRich = false;
  picked.slice().sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }).forEach(function (v) {
    var o = opts.find(function (x) { return (x.v || x.l) === v; }) || { l: v };
    texts.push(String(o.l || v).split('\u25cf').join(qty));
    if (o.lHtml) {
      hasRich = true;
      htmls.push(window.hearingSanitizeHtml(o.lHtml).split('\u25cf').join(escHtml(qty)));
    } else {
      htmls.push(escHtml(o.l || v).split('\u25cf').join(escHtml(qty)));
    }
  });
  return { texts: texts, htmls: htmls, hasRich: hasRich };
}


/**
 * 項目1つぶんの「いまの回答」を、1行の文字列にする（種類を問わず使える）。
 * ログ作成補助の出力する文章の中で、他の項目の回答を差し込むために使う
 * （buildHearingLines の中の同種の処理とは別に、単体でも呼べるように用意している）。
 * 未回答なら空文字を返す。
 */
window.hearingAnswerText = function (q, s) {
  if (!q) return '';
  s = s || (typeof hearingState !== 'undefined' ? hearingState : {});
  var fld = q.field || q.id;

  if (q.type === 'qtycheck') return _hrQtyCheckParts(q, s).texts.join('\u3001');
  if (q.type === 'bool') {
    var bv = s[fld];
    if (bv === true)  return q.trueResult  || q.trueLabel  || 'はい';
    if (bv === false) return q.falseResult || q.falseLabel || 'いいえ';
    return '';
  }
  if (q.type === 'text') return (s[fld] == null) ? '' : String(s[fld]);
  if (window.isDetailToggle(q)) {
    var dst = s[fld] || {}, parts = [];
    _hrOptsOf(q).forEach(function (o) {
      var val = o.v || o.l, d = dst[val];
      if (!d || !d.selected) return;
      var dd = Array.isArray(d.detail) ? d.detail : (d.detail ? [d.detail] : []);
      parts.push(dd.length ? (o.l || val) + '(' + dd.join('/') + ')' : (o.l || val));
    });
    return parts.join('\u3001');
  }
  var val = s[fld];
  if (val === null || val === undefined || val === '') return '';
  if (Array.isArray(val) && !val.length) return '';
  if (_hrIsManualValue(q, val)) {
    var mv = s[q.manualField || (fld + 'Manual')];
    return mv ? String(mv) : '';
  }
  if (Array.isArray(val)) {
    var order = window.getHearingOptions(q).map(function (o) { return o.v; });
    val = val.slice().sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
    });
    return val.map(function (v) { return _hrOptText(q, v); }).join('\u3001');
  }
  return _hrOptText(q, val);
};

/**
 * ログ作成補助の出力する文章の中の「{{項目名}}」を、その項目のいまの回答に置き換える。
 * 一致する項目が見つからないときは、書いたとおりの文字を残す（気付けるように消さない）。
 */
window.hearingResolveRefs = function (text, s) {
  if (!text || text.indexOf('{{') < 0) return text;
  var qs = _hrGetQuestions();
  return String(text).replace(/\{\{([^{}]+)\}\}/g, function (m, label) {
    label = label.trim();
    var q = qs.find(function (x) { return x && x.label === label; });
    if (!q) return m;
    return window.hearingAnswerText(q, s);
  });
};

/** HTML の中の「{{項目名}}」を置き換える（差し込む値は HTML エスケープする） */
window.hearingResolveRefsHtml = function (html, s) {
  if (!html || html.indexOf('{{') < 0) return html;
  var qs = _hrGetQuestions();
  return String(html).replace(/\{\{([^{}]+)\}\}/g, function (m, label) {
    label = label.trim();
    var q = qs.find(function (x) { return x && x.label === label; });
    if (!q) return m;
    return escHtml(window.hearingAnswerText(q, s));
  });
};

function _hrOptsOf(q) {
  var list = (q && q.options) || [];
  // 名前が空の選択肢は選べないので出さない。
  // 同じ値が重複していると入力状態が共有されて紛らわしいので、先勝ちで1つにする。
  var seen = {};
  return list.filter(function (o) {
    if (!o) return false;
    var v = String(o.v !== undefined && o.v !== null && o.v !== '' ? o.v : (o.l || '')).trim();
    if (!v || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

/**
 * 「詳細つきトグル」かどうか。
 * 選択肢のどれかが details を持っていれば、2段構え（選択肢＋詳細）で表示する。
 * デバイス（iPhone→Web/アプリ）のような項目がこれにあたる。
 */
window.isDetailToggle = function (q) {
  if (!q || (q.type !== 'toggle' && q.type !== 'device')) return false;
  return (q.options || []).some(function (o) {
    return o && Array.isArray(o.details) && o.details.length;
  });
};

/** 詳細つきトグルの項目を探す（入力状態の初期化に使う） */
window.getDetailToggleQuestions = function () {
  var qs = (typeof _hrGetQuestions === 'function') ? _hrGetQuestions() : [];
  return qs.filter(function (q) { return window.isDetailToggle(q); });
};

/** いま使われているデバイス項目（後方互換用） */
window.getHearingDeviceQuestion = function () {
  var qs = (typeof _hrGetQuestions === 'function') ? _hrGetQuestions() : [];
  return qs.find(function (q) { return q && (q.type === 'device' || q.id === 'q_devices'); }) || null;
};

/**
 * デバイス候補（[{name, details:[]}, ...]）。名前が空の行は無視する。
 * 選択肢は質問そのもの（q.devices）が持つ。
 * 引数を省いた場合はデバイス項目を自動で探す。
 */
window.getHearingDevices = function (q) {
  if (q === undefined) q = window.getHearingDeviceQuestion();
  // いまは options（{l,v,details}）が正。古い形（devices / 全体設定）も読める
  var list = q && Array.isArray(q.options) && q.options.length
    ? q.options.map(function (o) { return { name: o.v || o.l, details: o.details || [] }; })
    : (q && q.devices);
  if (!Array.isArray(list) || !list.length) list = window._appCache && window._appCache.hearingDevices;
  if (!Array.isArray(list)) list = [];
  var out = [];
  list.forEach(function (d) {
    if (!d) return;
    var name = String(d.name || '').trim();
    if (!name || out.some(function (x) { return x.name === name; })) return;
    var det = Array.isArray(d.details) ? d.details : [];
    out.push({
      name: name,
      details: det.map(function (v) { return String(v || '').trim(); })
                  .filter(function (v, i, a) { return v && a.indexOf(v) === i; })
    });
  });
  return out;
};

/** デバイス名だけの配列 */
window.getHearingDeviceNames = function (q) {
  return window.getHearingDevices(q).map(function (d) { return d.name; });
};

/** そのデバイスの詳細候補 */
window.getHearingDeviceDetails = function (q, name) {
  // 旧シグネチャ getHearingDeviceDetails(name) にも対応する
  if (typeof q === 'string') { name = q; q = undefined; }
  var d = window.getHearingDevices(q).find(function (x) { return x.name === name; });
  return d ? d.details : [];
};

/**
 * 既定値の入力状態を新しく作る。
 * devices（デバイス欄の入れ物）を必ず用意するのがポイント。
 * ここが欠けると描画時に例外が出て、画面全体が固まってしまう。
 */
function _hrNewState() {
  var st = JSON.parse(JSON.stringify(DEFAULT_STATE));
  if (!st.devices) st.devices = {};
  // 詳細つきトグル（デバイスなど）は「選択肢ごとに {selected, detail}」を持つ
  (window.getDetailToggleQuestions ? window.getDetailToggleQuestions() : []).forEach(function (q) {
    var fld = q.field || q.id;
    st[fld] = {};
    _hrOptsOf(q).forEach(function (o) {
      st[fld][o.v || o.l] = { selected: false, detail: [] };
    });
  });
  if (!st.devices) st.devices = {};
  return st;
}
window._hrNewState = _hrNewState;

function loadHearingState() {
  try {
    var saved = localStorage.getItem(HEARING_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      // 詳細つきトグル（デバイスなど）の保存値を、いまの選択肢に合わせて整える
      (window.getDetailToggleQuestions ? window.getDetailToggleQuestions() : []).forEach(function (q) {
        var fld  = q.field || q.id;
        var cur  = parsed[fld];
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
        var next = {};
        _hrOptsOf(q).forEach(function (o) {
          var val = o.v || o.l;
          var d = next[val] = cur[val] || { selected: false, detail: [] };
          if (!Array.isArray(d.detail)) d.detail = d.detail ? [d.detail] : [];
          // 旧データの「両方」は Web＋アプリ に変換する。
          // 選択肢から外したため、そのままだと画面に出ない選択が残ってしまう。
          if (d.detail.indexOf('両方') >= 0) {
            d.detail = d.detail.filter(function (v) { return v !== '両方'; });
            ['Web', 'アプリ'].forEach(function (v) {
              if (d.detail.indexOf(v) < 0) d.detail.push(v);
            });
          }
          // 選択肢に無い値が残っていたら取り除く
          var allowed = Array.isArray(o.details) ? o.details : [];
          if (allowed.length) {
            d.detail = d.detail.filter(function (v) { return allowed.indexOf(v) >= 0; });
            d.selected = d.detail.length > 0;
          } else {
            d.detail = [];
            d.selected = !!d.selected;
          }
        });
        parsed[fld] = next;
      });
      return Object.assign({}, DEFAULT_STATE, parsed);
    }
  } catch (e) {}
  return _hrNewState();
}

function saveHearingState() {
  try { localStorage.setItem(HEARING_KEY, JSON.stringify(hearingState)); } catch (e) {}
}

var hearingState = loadHearingState();
/**
 * ホーム（index.html）を開く。
 * script.html の goHome() は「スクリプトの先頭に戻る」別機能なので名前を分ける。
 * 既にホームのタブが開いていればそれを再利用する。
 */
window.goHomePage = function() {
  if (typeof openNamedTab === 'function') openNamedTab('index.html', 'homeTab');
  else location.href = 'index.html';
};

// ── URL のハイパーリンク化 ──
// コンテンツ（スクリプト / メール / 画面遷移 / FAQ）の本文に書かれた
// http(s):// を、クリックできるリンクとして扱うかどうか。
// 利用者ごとの好みではなく運用上の判断なので、admin.html で
// コンテンツ種別ごとに設定し、data.js に保存して全員に配る。
// 対象の要素に data-linkify="0" が付いていればリンク化しない。
// 設定はコンテンツ1件ごとに持ち、admin.html の書式バーで切り替える。

/**
 * 表示済みの本文に対してリンク化を適用/解除する。
 * 対象は data-linkify 属性を持つ要素の中だけに限る。
 */
/**
 * 本文が描き替わったら自動でリンク化する。
 *
 * 自分が挿入した <a> も監視対象になってしまうため、適用中は監視を止める。
 * これをしないと「書き換え → 検知 → また書き換え」で回り続け、
 * 途中で止まったときに未適用のまま残ってしまう。
 */
var _lkBusy = false;

(function _watchLinkify() {
  var timer = null;
  var obs = null;

  var run = function() {
    if (!window.applyLinkify) return;
    _lkBusy = true;
    if (obs) obs.disconnect();
    try { window.applyLinkify(); } catch (e) {}
    _lkBusy = false;
    if (obs) _observe();
  };

  var kick = function() {
    if (_lkBusy) return;
    clearTimeout(timer);
    timer = setTimeout(run, 60);
  };

  var _observe = function() {
    document.querySelectorAll('[data-linkify]').forEach(function(el) {
      // data-linkify（設定の切り替え）の変化も拾う。
      // これが無いと ON→OFF にしてもリンクのまま残る。
      obs.observe(el, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-linkify']
      });
    });
  };

  var start = function() {
    obs = new MutationObserver(function(muts) {
      if (_lkBusy) return;
      // 状態（リンクの有無）で判断する方式にしたのでフラグ操作は不要
      kick();
    });
    _observe();
    run();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

/**
 * 表示中の本文にリンク化を適用/解除する。
 * data-linkify="0" の要素は対象外。編集中の欄も触らない。
 */
window.applyLinkify = function(root) {
  var scope = root || document;
  var targets = scope.querySelectorAll('[data-linkify]');
  Array.prototype.forEach.call(targets, function(el) {
    // 編集中の欄はリンクにしない（クリックすると編集の妨げになる）
    if (el.isContentEditable) return;
    if (el.closest && el.closest('[contenteditable="true"]')) return;

    var want = (el.getAttribute('data-linkify') !== '0');   // "0" のときだけ無効
    var has  = !!el.querySelector('a.auto-link');
    if (want === has) return;      // すでに望む状態
    if (want) _linkifyEl(el); else _unlinkifyEl(el);
  });
};

var URL_RE = /(https?:\/\/[^\s<>"'）】」』]+)/g;

/** テキスト中の URL を <a> に置き換える */
function _linkifyEl(el) {
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function(c) {
      if (c.nodeType === 3) {
        var t = c.nodeValue;
        URL_RE.lastIndex = 0;
        if (!URL_RE.test(t)) return;
        URL_RE.lastIndex = 0;
        var span = document.createElement('span');
        span.innerHTML = t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(URL_RE, '<a href="$1" target="_blank" rel="noopener noreferrer" class="auto-link">$1</a>');
        c.parentNode.replaceChild(span, c);
      } else if (c.nodeType === 1 && c.tagName !== 'A' && c.tagName !== 'IMG') {
        walk(c);
      }
    });
  })(el);
}

/** リンクを外して元のテキストに戻す */
function _unlinkifyEl(el) {
  Array.prototype.slice.call(el.querySelectorAll('a.auto-link')).forEach(function(a) {
    a.parentNode.replaceChild(document.createTextNode(a.textContent), a);
  });
  el.normalize();
}

/**
 * ヘッダーのページ名ボタンの動作。
 * これまで index.html へ移動していたが、求められているのは
 * 「そのページの初期表示に戻す」なので、ページ内でリセットする。
 * ページ独自の戻し方（goHome）があればそれを使い、無ければ読み込み直す。
 */
window.resetPageView = function () {
  // ページによって挙動が違うと分かりにくいので、どのページでも読み込み直す。
  // goHome() があるページ（スクリプト・メール）も同じ扱いにそろえる。
  location.reload();
};

/** ページ名ボタンを「ページ内リセット」に付け替える */
function _bindTitleBtn() {
  document.querySelectorAll('header .hd-title-btn').forEach(function (b) {
    if (b.tagName !== 'BUTTON') return;          // 管理画面は span（押せない）
    b.removeAttribute('onclick');
    b.onclick = function () { window.resetPageView(); };
    b.title = 'このページを初期表示に戻す';
  });
}

/**
 * ヘッダーに［🏠 ホーム］ボタンを差し込む。
 *
 * これまでページ名（📋 トークスクリプト など）自体がホームへのリンクだったが、
 * 見た目がボタンに見えず気づきにくかった。また画面遷移・管理画面には
 * 導線そのものが無かったため、全ページで同じ位置に置く。
 * ホーム自身には不要なので付けない。
 */
function _injectHomeBtn() {
  if (document.getElementById('homeBtn')) return;                       // 既にある
  if (document.querySelector('.home-header')) return;                   // ホーム自身
  var left = document.querySelector('header .hd-left');
  if (!left) return;

  var b = document.createElement('button');
  b.id = 'homeBtn';
  b.className = 'home-nav-btn';
  b.type = 'button';
  b.title = 'ホームへ戻る';
  b.textContent = '🏠 ホーム';
  b.onclick = function() { goHomePage(); };

  // ☰ の直後（ページ名の前）に置く
  var menu = left.querySelector('#menuBtn');
  if (menu && menu.nextSibling) left.insertBefore(b, menu.nextSibling);
  else if (menu) left.appendChild(b);
  else left.insertBefore(b, left.firstChild);
}

/**
 * ［?］使い方マニュアルのボタンを、無いページに差し込む。
 *
 * script / mail / screen / admin には最初から置かれているが、
 * FAQ とヒアリングには無く、ヘッダーの並びがそろわなかった。
 * 中身はこれから用意するので、いまは「準備中」と伝えるだけにする。
 */
function _injectHelpBtn() {
  if (document.querySelector('header .help-circle-btn')) return;   // 既にある
  if (document.querySelector('.home-header')) return;              // ホーム
  var left = document.querySelector('header .hd-left');
  if (!left) return;

  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'help-circle-btn';
  b.title = '使い方マニュアル';
  b.textContent = '?';
  b.addEventListener('click', function () { window.openHelpModal(); });
  left.appendChild(b);
}

/** マニュアルがまだ無いページ用の、簡単な案内 */
function _openPlaceholderHelp() {
  var id = 'helpModalPlaceholder';
  var el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; return; }

  var titleEl = document.querySelector('header .hd-title-btn');
  var pageName = titleEl ? titleEl.textContent.trim() : 'このページ';

  el = document.createElement('div');
  el.id = id;
  el.className = 'help-modal-overlay';
  el.style.display = 'flex';
  el.innerHTML =
    '<div class="help-modal-box">' +
      '<div class="help-modal-header">' +
        '<span class="help-modal-title">📖 使い方マニュアル｜' + escHtml(pageName) + '</span>' +
        '<button class="help-modal-close" type="button">✕</button>' +
      '</div>' +
      '<div class="help-modal-body">' +
        '<div style="padding:28px 4px;text-align:center;color:var(--text3);line-height:2;">' +
          '<div style="font-size:32px;margin-bottom:10px;">📝</div>' +
          'このページのマニュアルは準備中です。' +
        '</div>' +
      '</div>' +
    '</div>';

  var close = function () { el.style.display = 'none'; };
  el.querySelector('.help-modal-close').addEventListener('click', close);
  el.addEventListener('click', function (e) { if (e.target === el) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });
  document.body.appendChild(el);
}

/**
 * ヘッダーの並びをページ間でそろえる。
 *
 *   ≡ / 🏠ホーム / 日時 / ページ名 / ? / 各ページ / 定型文 / 検索 / ⚙
 *
 * ページごとに HTML の書き方が違い、順番も入り交じっていたため、
 * 差し込みが終わったあとにここで並べ替える。
 * 検索欄が無いページ（ヒアリングなど）は、同じ幅の空きを置いて
 * 他のページと見た目がずれないようにする。
 */
function _orderHeader() {
  var head = document.querySelector('header');
  if (!head) return;
  var left  = head.querySelector('.hd-left');
  var right = head.querySelector('.hd-right');
  if (!left || !right) return;

  // ページ名と ? は左側へ（日時のあと）
  var title = head.querySelector('.hd-title-btn');
  var help  = head.querySelector('.help-circle-btn');
  var home  = head.querySelector('.home-nav-btn');
  var clock = document.getElementById('headerClock');

  if (home)  left.appendChild(home);
  if (clock) left.appendChild(clock);
  if (title) left.appendChild(title);

  // ? は全ページに置く（無いページには _injectHelpBtn が差し込む）。
  // 万一置けなかった場合に備えて、同じ大きさの空きで幅だけそろえる。
  if (help) {
    left.appendChild(help);
    var oldSp = document.getElementById('headerHelpSpacer');
    if (oldSp) oldSp.parentNode.removeChild(oldSp);
  } else if (!document.body.classList.contains('page-home')) {
    var hsp = document.getElementById('headerHelpSpacer');
    if (!hsp) {
      hsp = document.createElement('span');
      hsp.id = 'headerHelpSpacer';
      hsp.setAttribute('aria-hidden', 'true');
      hsp.style.cssText = 'flex:0 0 auto;width:32px;height:32px;';
    }
    left.appendChild(hsp);
  }

  // 右側は 各ページ → 定型文 → 検索 → ⚙ の順。
  // 定型文ボタンも .nav-btn を持つページがあるので、ページ移動ボタンとは別に扱う。
  var quick  = right.querySelector('.quick-copy-area');
  var navs   = Array.prototype.slice.call(right.querySelectorAll('.nav-btn'))
                 .filter(function (b) {
                   if (b.id === 'adminJumpBtn' || b.id === 'quickCopyBtn') return false;
                   return !(quick && quick.contains(b));
                 });
  var search = right.querySelector('.search-wrap');
  var gear   = document.getElementById('adminJumpBtn');

  navs.forEach(function (b) { right.appendChild(b); });
  if (quick) right.appendChild(quick);

  if (search) {
    right.appendChild(search);
  } else if (!document.body.classList.contains('page-home')) {
    // 検索欄が無いページでも、同じ幅を空けて並びをそろえる。
    // すでに作ってある場合は位置だけ直す（先に作られていると先頭に残るため）。
    var sp = document.getElementById('headerSearchSpacer');
    if (!sp) {
      sp = document.createElement('span');
      sp.id = 'headerSearchSpacer';
      sp.setAttribute('aria-hidden', 'true');
      // 検索欄（#searchBox）と同じ幅。狭い画面では 200px になるのも合わせる
      sp.style.cssText = 'flex:0 0 auto;width:300px;';
      sp.className = 'header-search-spacer';
    }
    right.appendChild(sp);
  }
  if (gear) right.appendChild(gear);

  // 管理画面の「保存して反映」は右端に置く（いちばん使うため）
  var save = right.querySelector('.btn-primary');
  if (save) {
    var dirty = document.getElementById('dirtyIndicator');
    if (dirty) right.appendChild(dirty);
    right.appendChild(save);
  }
  _placeProfileBadge();
}

/**
 * プロファイルの切り替えボタン（⑫）をヘッダーに置く。
 * ・通常のページ：左側（ページ名・? のあと）。右側はボタンが多く、幅が足りないと
 *   先頭が見えなくなるため。
 * ・管理画面：右側の空き（検索欄の代わりの余白）の中。ボタンを増やしても
 *   中央のタブの幅が狭くならないようにする。
 */
function _placeProfileBadge() {
  var b = document.getElementById('profileBadge');
  if (!b) return;
  var head = document.querySelector('header');
  var left = head && head.querySelector('.hd-left');
  if (!left) return;                                   // ホームは ⑫ 側で配置
  var sp = document.getElementById('headerSearchSpacer');
  if (document.body.classList.contains('page-admin') && sp) {
    sp.style.display = 'flex';
    sp.style.alignItems = 'center';
    sp.style.justifyContent = 'flex-end';
    sp.removeAttribute('aria-hidden');
    if (b.parentNode !== sp) sp.appendChild(b);
  } else if (b.parentNode !== left || left.lastElementChild !== b) {
    left.appendChild(b);
  }
}

function _initHeaderBtns() {
  _claimTabName();
  _injectHomeBtn(); _bindTitleBtn(); _injectNavBtns(); _injectAdminBtn(); _injectClock();
  _injectHelpBtn();
  if (!document.body.classList.contains('page-admin')) {
    _applyMaintenance();
    window.paintMaintenanceButtons();   // 移動ボタンに「メンテナンス中」を反映
  }
  _orderHeader();     // 差し込みが済んでから並べ替える
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initHeaderBtns);
} else {
  _initHeaderBtns();
}

/**
 * ヒアリングパネルを各ページに差し込む。
 *
 * これまで script.html にだけ直接書かれていたが、
 * メール・画面遷移を見ながら聞き取りたい場面があるため共通化した。
 * 管理画面（.page-admin）は編集用のプレビューを持つので対象外。
 * すでにページ内にパネルがある場合は二重に作らない。
 */
function _hrInjectPanel() {
  if (document.body.classList.contains('page-admin')) return;   // 管理画面は除外
  if (document.body.classList.contains('page-hearing')) return; // 専用ページは1枚表示
  if (document.body.classList.contains('page-home')) return;    // ホームは一覧のみ（カードから開く）
  if (document.getElementById('hearingPanel')) return;          // 既にある

  var el = document.createElement('div');
  el.id = 'hearingPanel';
  el.className = 'hearing-panel';
  el.innerHTML =
    '<button id="hearingToggleBtn" class="hearing-toggle-btn" onclick="toggleHearingPanel()"' +
    ' title="ヒアリングチェックシート">＜</button>' +
    '<div class="hearing-panel-body">' +
      '<div class="hearing-header">' +
        '<span class="hearing-title">ヒアリングチェックシート</span>' +
        '<div class="hearing-header-btns">' +
          '<button class="hearing-copy-btn" onclick="copyHearingText()" title="ヒアリング内容をコピー">📋 コピー</button>' +
          '<button class="hearing-open-btn" onclick="openNamedTab(\'hearing.html\',\'hearingTab\')" title="別タブで大きく開く">↗ 別タブ</button>' +
          '<button class="hearing-reset-btn" onclick="resetHearing()">リセット</button>' +
        '</div>' +
      '</div>' +
      '<div id="hearingCopyToast" class="hearing-copy-toast"></div>' +
      '<div class="hearing-content" id="hearingContent"></div>' +
    '</div>';
  document.body.appendChild(el);
  if (typeof renderHearing === 'function') renderHearing();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _hrInjectPanel);
} else {
  _hrInjectPanel();
}

// 他のタブでヒアリング内容が変わったら追従する（同じ内容を見せるため）
window.addEventListener('storage', function(e) {
  if (e.key !== HEARING_KEY) return;
  if (typeof loadHearingState === 'function') hearingState = loadHearingState();
  if (typeof renderHearing === 'function') renderHearing();
});

var hearingPanelOpen = false;

window.toggleHearingPanel = function () {
  hearingPanelOpen = !hearingPanelOpen;
  var panel = document.getElementById('hearingPanel');
  var btn   = document.getElementById('hearingToggleBtn');
  if (panel) panel.classList.toggle('open', hearingPanelOpen);
  if (btn)   btn.textContent = hearingPanelOpen ? '＞' : '＜';
};

window.resetHearing = function () {
  hearingState = _hrNewState();
  saveHearingState();
  // 「入力内容をすべて消去」なので、テンプレートの選択も一緒に外す。
  // ここで外さないと、リセットの度に選択が残ったり消えたりして見える。
  try { localStorage.removeItem(HEARING_TPL_KEY); } catch (e) {}
  renderHearing();   // テンプレートバーも含めて描き直す
};

/** 他の項目の表示条件が、この欄の値を見ているか */
function _hrShowIfDepends(field) {
  var qs = _hrGetQuestions();
  // showIf は [[{field,op,value}, ...], ...] の入れ子（OR の中に AND）
  var hit = qs.some(function (q) {
    var inShowIf = (q.showIf || []).some(function (group) {
      return (Array.isArray(group) ? group : [group]).some(function (c) {
        return c && c.field === field;
      });
    });
    return inShowIf || (q.resets || []).indexOf(field) >= 0;
  });
  if (hit) return true;
  return ((window._appCache && window._appCache.hearingPatterns) || []).some(function (p) {
    return (p.conditions || []).some(function (c) { return c && c.field === field; });
  });
}

/**
 * 記述欄など「打ちながら」更新する項目の保存。
 * setHearing() は毎回 renderHearing() するため、1文字ごとに入力欄が
 * 作り直されてフォーカスが外れてしまう。ここでは結果文だけ更新する。
 * ただし他の項目の表示条件がこの欄を見ている場合は全体を描き直す。
 */
window.setHearingInput = function (field, value) {
  hearingState[field] = value;
  saveHearingState();
  if (_hrShowIfDepends(field)) { renderHearing(); return; }
  if (typeof renderHearingSummary === 'function') renderHearingSummary();
};

window.setHearing = function (field, value) {
  // リセット定義をデータ駆動定義から取得（カスタム質問対応）
  var qs = _hrGetQuestions();
  var resets = {};
  qs.forEach(function(q) { if (q.resets && q.resets.length) resets[q.field] = q.resets; });
  if (resets[field]) resets[field].forEach(function (f) { hearingState[f] = null; });
  hearingState[field] = value;
  saveHearingState();
  renderHearing();
};

window.toggleHearingOpt = function (field, value, multi) {
  if (!hearingState[field] || typeof hearingState[field] !== 'object' || Array.isArray(hearingState[field])) {
    hearingState[field] = {};
  }
  var st = hearingState[field];
  var d = st[value] || (st[value] = { selected: false, detail: [] });
  var next = !d.selected;
  // 項目（行）どうしは独立していて、いくつでも同時に選べる。
  // 「複数選択」の設定は各項目の詳細ボタンだけに効く（setHearingOptDetail）。
  d.selected = next;
  if (!d.selected) d.detail = [];
  saveHearingState();
  renderHearing();
};
/** 旧名（デバイス専用だった頃の呼び出し互換） */
window.toggleHearingDevice = function (device) { window.toggleHearingOpt('devices', device); };

window.setHearingOptDetail = function (field, value, detail, multi) {
  if (!hearingState[field] || typeof hearingState[field] !== 'object' || Array.isArray(hearingState[field])) {
    hearingState[field] = {};
  }
  var st = hearingState[field];
  var d = st[value] || (st[value] = { selected: false, detail: [] });
  if (!Array.isArray(d.detail)) d.detail = [];
  var idx = d.detail.indexOf(detail);
  // 複数選択を許可していないときは、その項目の詳細を選び直しとして扱う
  // （同じ項目の他の詳細だけ外す。他の項目には触れない）
  if (idx < 0 && multi === false) {
    d.detail = [];
  }
  if (idx >= 0) {
    // すでに選択中のボタンをもう一度押すと、その項目だけOFF（複数選択可）
    d.detail.splice(idx, 1);
  } else {
    d.detail.push(detail);
  }
  d.selected = d.detail.length > 0;
  saveHearingState();
  renderHearing();
};
/** 旧名（デバイス専用だった頃の呼び出し互換） */
window.setHearingDeviceDetail = function (device, value) {
  window.setHearingOptDetail('devices', device, value);
};

window.onHearingCarrierChange = function () {
  var sel = document.getElementById('hearingCarrierSel');
  if (!sel) return;
  hearingState.carrier = sel.value;
  var mw = document.getElementById('hearingCarrierManualWrap');
  if (mw) mw.style.display = sel.value === '__manual__' ? 'block' : 'none';
  saveHearingState();
  renderHearingSummary();
};

window.onHearingCarrierManualInput = function () {
  var inp = document.getElementById('hearingCarrierManual');
  if (!inp) return;
  hearingState.carrierManual = inp.value;
  saveHearingState();
  renderHearingSummary();
};

window.onHearingDomainChange = function () {
  var sel = document.getElementById('hearingDomainSel');
  if (!sel) return;
  hearingState.mailDomain = sel.value;
  var mw = document.getElementById('hearingDomainManualWrap');
  if (mw) mw.style.display = sel.value === '__manual__' ? 'block' : 'none';
  saveHearingState();
  renderHearingSummary();
};

window.onHearingDomainManualInput = function () {
  var inp = document.getElementById('hearingDomainManual');
  if (!inp) return;
  hearingState.mailDomainManual = inp.value;
  saveHearingState();
  renderHearingSummary();
};

window.onHearingCheckChange = function (field) {
  var el = document.getElementById('hearingCb_' + field);
  if (!el) return;
  hearingState[field] = el.checked;
  saveHearingState();
  renderHearingSummary();
};

function _boolBtns(field, value, labelTrue, labelFalse) {
  var t = '<button class="hr-btn' + (value === true  ? ' active' : '') + '" onclick="setHearing(\'' + field + '\',true)">'  + labelTrue  + '</button>';
  var f = '<button class="hr-btn' + (value === false ? ' active' : '') + '" onclick="setHearing(\'' + field + '\',false)">' + labelFalse + '</button>';
  return t + f;
}

function _strBtns(field, value, items) {
  // 選択中のボタンをもう一度押したら解除できるようにする。
  // 以前は選び直しはできても「何も選んでいない」に戻せなかった。
  return items.map(function (item) {
    var active = value === item.v ? ' active' : '';
    return '<button class="hr-btn' + active + '" onclick="window.toggleHearingSingle(\'' + field + '\',\'' + item.v + '\')">' + window.hrOptHtml(item) + '</button>';
  }).join('');
}

/** 単一選択のトグル。同じ値をもう一度選んだら解除する */
window.toggleHearingSingle = function (field, value) {
  window.setHearing(field, hearingState[field] === value ? '' : value);
};

// ── 項目名の先頭に付ける記号 ────────────────────────────
// 以前は「■」を決め打ちで付けていたが、付けるかどうか・どの記号にするかを
// 選べるようにした。全体の既定（hearingLabelPrefix）を質問ごとに上書きできる。
window.HEARING_PREFIX_OPTIONS = [
  { v: '',  l: 'なし（記号を付けない）' },
  { v: '　', l: '空白（全角スペース）' },   // 記号は付けず、項目名を1文字ぶん字下げする
  { v: '■', l: '■' },
  { v: '●', l: '●' },
  { v: '◆', l: '◆' },
  { v: '▶', l: '▶' },
  { v: '〇', l: '〇' },
  { v: '・', l: '・' },
  { v: '※', l: '※' },
  { v: '＞', l: '＞' }
];

/** 記号のプルダウンに出す短い名前（空文字は「なし」、全角スペースは「空白」） */
window.hearingPrefixLabel = function (v) {
  return v === '' ? 'なし' : (v === '　' ? '空白' : v);
};

/**
 * 全体の既定記号。
 * 以前は項目ごとの記号選択に「既定に従う」という選択肢があり、その既定値は ■ だった。
 * 「既定」と「■」が実質同じ選択肢として並んでいて紛らわしいため、「既定に従う」は廃止し、
 * 項目は常に自分の記号を持つようにした（新規項目は「なし」から始まる）。
 * この関数は、記号を持たない古いデータ（以前の「既定に従う」のまま保存されたもの）のための
 * 後方互換の受け皿として残してあり、常に「なし」を返す。
 */
window.getHearingDefaultPrefix = function () {
  return '';
};

/** 後方互換のために残してあるだけで、現在は呼び出し元が無い（記号は項目ごとに直接持つ） */
window.setHearingDefaultPrefix = function () {};

/**
 * その項目に付ける記号を返す。
 * 質問に prefix が設定されていればそれを、無ければ全体の既定を使う。
 */
window.getHearingPrefix = function (q) {
  if (q && typeof q.prefix === 'string') return q.prefix;
  return window.getHearingDefaultPrefix();
};


// ── ログ作成補助の本文の書式 ─────────────────────────────
// 本文は plain な text（従来どおり。出力・コピーの基本）に加えて、
// 書式を付けたときだけ textHtml（許可したタグだけに絞った HTML）を持つ。

var _HR_OK_TAGS  = { B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, DEL:1, BR:1, DIV:1, P:1, SPAN:1, FONT:1, IMG:1,
  TABLE:1, TBODY:1, THEAD:1, TR:1, TD:1, TH:1 };
// 表のセルだけに許可する属性（結合セルの行列数。数字だけを許可する）
var _HR_TABLE_CELL_ATTR = { colspan:1, rowspan:1 };
var _HR_OK_STYLE = { 'color':1, 'font-weight':1, 'font-style':1, 'text-decoration':1, 'text-decoration-line':1, 'text-align':1 };
// 画像は data: URL（base64）だけを許可する（外部 URL は読み込ませない）。サイズにも上限を設ける。
var _HR_IMG_SRC_RE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
var _HR_IMG_MAX_LEN = 3000000;   // だいたい 2MB 程度の画像まで（base64 化で文字数は約 4/3 倍になる）

/** 貼り付けなどで紛れ込んだ不要なタグ・属性を取り除く（許可するのは文字の装飾と、data: 画像だけ） */
window.hearingSanitizeHtml = function (html) {
  var doc = new DOMParser().parseFromString('<body>' + String(html == null ? '' : html) + '</body>', 'text/html');
  var walk = function (node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { node.removeChild(ch); return; }
      var tag = ch.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') { node.removeChild(ch); return; }
      if (tag === 'IMG') {
        var src = ch.getAttribute('src') || '';
        if (!_HR_IMG_SRC_RE.test(src) || src.length > _HR_IMG_MAX_LEN) { node.removeChild(ch); return; }
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        ch.setAttribute('src', src);
        ch.setAttribute('alt', '');
        ch.setAttribute('style', 'max-width:100%;height:auto;');
        return;
      }
      walk(ch);
      if (!_HR_OK_TAGS[tag]) {                       // 許可外のタグは中身だけ残す
        while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
        node.removeChild(ch);
        return;
      }
      if (tag === 'TABLE') {                          // 表本体には class="rt-table" だけ許可する
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        ch.setAttribute('class', 'rt-table');
        return;
      }
      if (tag === 'TD' || tag === 'TH') {              // セルの結合（colspan/rowspan、数字のみ）だけ許可する
        var keepAttr = {};
        Array.prototype.slice.call(ch.attributes).forEach(function (a) {
          if (_HR_TABLE_CELL_ATTR[a.name] && /^[0-9]+$/.test(a.value)) keepAttr[a.name] = a.value;
        });
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        Object.keys(keepAttr).forEach(function (k) { ch.setAttribute(k, keepAttr[k]); });
        return;
      }
      if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TR') {   // それ以外の表タグは属性を持たない
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        return;
      }
      var keep = {};
      if (tag === 'FONT') {
        var col = ch.getAttribute('color') || '';
        if (/^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgb\([\d\s,.%]+\))$/i.test(col)) keep.color = col;
      }
      var st = ch.getAttribute('style') || '';
      var okSt = st.split(';').map(function (d) {
        var i = d.indexOf(':'); if (i < 0) return '';
        var k = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim();
        return (_HR_OK_STYLE[k] && /^[#\w\s(),.%-]+$/.test(v)) ? k + ':' + v : '';
      }).filter(function (x) { return x; }).join(';');
      Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
      if (keep.color) ch.setAttribute('color', keep.color);
      if (okSt) ch.setAttribute('style', okSt);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
};

/**
 * HTML を、改行つきの plain text にする。
 * 編集欄で Enter を押すと入る <div> も、Shift+Enter の <br> も改行として扱う。
 * ブロックの末尾に置かれた <br>（空の行を作るためだけのもの）は数えない。
 */
window.hearingHtmlToText = function (html) {
  var doc = new DOMParser().parseFromString('<body>' + String(html == null ? '' : html) + '</body>', 'text/html');
  var lines = [], cur = null;
  var flush = function () { if (cur !== null) { lines.push(cur.replace(/\t$/, '')); cur = null; } };  // 行末の余分なタブは削る
  // br の後ろ（同じブロックの中）に、まだ内容が続くか
  var hasContentAfter = function (br, root) {
    for (var n = br; n && n !== root; n = n.parentNode) {
      for (var s = n.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType === 1 || (s.nodeType === 3 && s.nodeValue !== '')) return true;
      }
    }
    return false;
  };
  var proc = function (node, root) {
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) { cur = (cur === null ? '' : cur) + ch.nodeValue; return; }
      if (ch.nodeType !== 1) return;
      if (ch.tagName === 'BR') {
        if (cur === null) cur = '';
        if (hasContentAfter(ch, root)) flush();
        return;
      }
      if (ch.tagName === 'DIV' || ch.tagName === 'P' || ch.tagName === 'TR') {
        flush(); proc(ch, ch); flush(); return;      // 表の行も、改行区切りの1行として扱う
      }
      if (ch.tagName === 'TD' || ch.tagName === 'TH') {
        proc(ch, ch);
        if (cur === null) cur = '';
        cur += '\t';              // セルの区切り（表計算に貼り付けたときタブ区切りになる）
        return;
      }
      proc(ch, root);            // B / I / SPAN など：改行には影響しない
    });
  };
  proc(doc.body, doc.body);
  flush();
  return lines.join('\n').replace(/\u00a0/g, ' ');
};

/** plain text を、編集欄に入れる HTML にする（1行を1つの <div> にして、空行も保つ） */
window.hearingTextToHtml = function (text) {
  var s = String(text == null ? '' : text);
  if (s === '') return '';
  return s.split('\n').map(function (l) {
    return '<div>' + (l === '' ? '<br>' : escHtml(l)) + '</div>';
  }).join('');
};

// ── 書式つきの名前（項目名・選択肢名・詳細）─────────────────
// 名前は plain な文字列（label / l / details。入力状態のキーや出力の基本）を今までどおり持ち、
// 書式（太字・色など）を付けたときだけ、別に labelHtml / lHtml / detailsHtml を持つ。
// 書式が無いものは、これまでと同じ表示になる。

/** 項目名の表示用 HTML */
/**
 * 見出しの文字の中にある「[表示名](URL)」を、クリックできるリンクに変える。
 * http:// と https:// の URL だけを許可する（他は書いたとおりの文字のまま残す）。
 * 渡す文字列は、あらかじめ escHtml 済みであること（そのままでは [ ] ( ) は変換されない文字なので安全に扱える）。
 */
window.hearingParseHeadingLinks = function (escapedHtml) {
  if (!escapedHtml) return escapedHtml;
  var s = String(escapedHtml);
  if (s.indexOf('](') < 0 && s.indexOf('］（') < 0 && s.indexOf('](') < 0) {
    // よくある組み合わせ（半角のみ／全角のみ）に無ければ、他の混在も含めて対象外
    if (!/[\[［][^\[\]［］]+[\]］]\s*[\(（]/.test(s)) return s;
  }
  // 表示名は [ ] か ［ ］、URL は ( ) か （ ） のどちらでも、混ぜて書いても認識する
  return s.replace(/[\[［]([^\[\]［］]+)[\]］]\s*[\(（](https?:\/\/[^\s()（）]+)[\)）]/g, function (m, disp, url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + disp + '</a>';
  });
};

window.hrLabelHtml = function (q) {
  if (!q) return '';
  // 書式が無いときも、項目名の中の改行はそのまま見えるようにする（<br> にする。文字は escHtml で安全に）
  var html = q.labelHtml ? window.hearingSanitizeHtml(q.labelHtml) : escHtml(q.label || '').replace(/\n/g, '<br>');
  // 見出しでは、[表示名](URL) の書き方をリンクにする
  if (q.type === 'heading') html = window.hearingParseHeadingLinks(html);
  return html;
};
/** 選択肢名の表示用 HTML（書式が無ければ従来どおり名前そのまま） */
window.hrOptHtml = function (o) {
  return o.lHtml ? window.hearingSanitizeHtml(o.lHtml) : o.l;
};
/** 選択肢名の表示用 HTML（エスケープして出す箇所用） */
window.hrOptHtmlEsc = function (o, fallback) {
  return o.lHtml ? window.hearingSanitizeHtml(o.lHtml) : escHtml(o.l || fallback || '');
};
/** 詳細ボタンの表示用 HTML */
window.hrDetailHtml = function (o, i, opt) {
  var h = Array.isArray(o.detailsHtml) ? o.detailsHtml[i] : '';
  return h ? window.hearingSanitizeHtml(h) : escHtml(opt);
};
/** 出力文（HTML）の「入力箇所」を、入力値（HTML）に差し替える */
window.hearingFillSlotHtml = function (tplHtml, valHtml) {
  return String(tplHtml || '').replace(new RegExp(HEARING_SLOT_RE.source, 'g'), function () { return valHtml; });
};

function _hrRow(label, content, extraClass, prefix) {
  var pf = (typeof prefix === 'string') ? prefix : window.getHearingDefaultPrefix();
  return '<div class="hr-row' + (extraClass ? ' ' + extraClass : '') + '">' +
         '<div class="hr-label">' + escHtml(pf) + label + '</div>' +
         '<div class="hr-btns">' + content + '</div>' +
         '</div>';
}

/**
 * 対応方針の条件を1つ評価する。
 *
 * 保存形式が2通りある：
 *   {field, op:'eq', value:'学校'} … 演算子つき（エディタが作る新しい形）
 *   {field, value:'学校'}          … 演算子なし（等しいものとして扱う）
 * 真偽値は {field, op:'true'} のように value を持たないため、
 * value だけを見ていると「条件なし」と誤解して常に成立してしまう。
 */
function _hrCondMatches(cond, s) {
  if (!cond || !cond.field) return true;
  var val = s[cond.field];
  var op  = cond.op;
  var cv  = cond.value;
  // 演算子が無い古い形は、値の比較として扱う（'true'/'false' は真偽値とみなす）
  if (!op) {
    if (cv === 'true')  return val === true;
    if (cv === 'false') return val === false;
    return val === cv;
  }
  switch (op) {
    case 'true':    return val === true;
    case 'false':   return val === false;
    case 'eq':      return val === cv;
    case 'neq':     return val !== cv;
    case 'notnull': return val !== null && val !== undefined && val !== '';
    case 'in':      return String(cv || '').split(',').indexOf(String(val)) >= 0;
    default:        return val === cv;
  }
}
window._hrCondMatches = _hrCondMatches;

/** 対応方針の一覧を取り出す（data.js / _appCache が唯一の管理元） */
window.getHearingPolicies = function () {
  // 空配列＝「全部消した」。未設定（配列ですらない）ときだけ data.js を見る。
  // ここを長さで判定していたため、最後の1件を消すと全件復活していた。
  var cached = window._appCache && window._appCache.hearingPolicies;
  if (!Array.isArray(cached)) {
    var sd = window.APP_STATIC_DATA;
    cached = (sd && Array.isArray(sd.hearingPolicies)) ? sd.hearingPolicies : [];
  }
  return JSON.parse(JSON.stringify(cached));
};

/**
 * 対応方針を判定する。
 *
 * 以前は組み込みぶんを calcPolicies() に直接書いていたため、
 * 管理画面の対応方針エディタから編集も削除もできなかった。
 * いまは組み込みぶんも data.js（hearingPolicies）に入っているので、
 * ここでは条件を評価するだけにする。
 *
 * また、判定関数は admin.html にしか無く、ヒアリング画面では
 * 登録した方針が反映されないままだったので共通側へ移した。
 */
window.evalHearingPolicies = function (s) {
  return window.evalHearingPolicyItems(s).map(function (x) { return x.policy; });
};

/** 対応方針を { policy（plain）, html（書式つきのときだけ）} の形で返す */
window.evalHearingPolicyItems = function (s) {
  var cur = window.getCurrentTemplate ? window.getCurrentTemplate() : '';
  var out = [];
  window.getHearingPolicies().forEach(function (item) {
    if (!item || item.enabled === false || !item.policy) return;
    // テンプレート指定なし（共通）と、いま選んでいるテンプレートのものだけ
    if (item.tplId && item.tplId !== cur) return;
    var match = (item.conditions || []).every(function (cond) {
      return _hrCondMatches(cond, s);
    });
    if (match) out.push({ policy: item.policy, html: item.policyHtml || '' });
  });
  return out;
};

function calcPolicies(s) {
  return calcPolicyItems(s).map(function (x) { return x.text; });
}

function calcPolicyItems(s) {
  // 同じ文言が複数の条件から出ることがあるため、重複は1つにまとめる
  var seen = {}, uniq = [];
  window.evalHearingPolicyItems(s).forEach(function (p) {
    var k = String(p.policy == null ? '' : p.policy).trim();
    if (!k || seen[k]) return;
    seen[k] = 1; uniq.push({ text: k, html: p.html });
  });
  return uniq;
}

// ===================================================================
// ヒアリング質問定義（データ駆動式）
// localStorage に 'hearingQuestionsDef_v1' があればそちらを使用する。
// デフォルト項目数 = 0（admin.htmlで追加管理）
// ===================================================================
// ヒアリング質問は data.js（APP_STATIC_DATA.hearingQuestions）で管理します。

// ヒアリング（質問・対応方針・パターン）は data.js で管理します。

var HEARING_POLICIES_DEFAULT  = [];
// localStorage キーは後方互換のため定義のみ残す（読み書きには使用しない）
var HEARING_QUESTIONS_KEY = 'hearingQuestionsDef_v1';

function _hrQuestionsLoad() {
  return JSON.parse(JSON.stringify(window._appCache.hearingQuestions || []));
}
function _hrQuestionsSave(list) {
  // メモは common-utils.js の固定項目なので、保存データには含めない
  window._appCache.hearingQuestions = JSON.parse(JSON.stringify(window.stripHearingMemo(list)));
  // 一度でも保存したら、組み込み項目を自動で足し直さない
  // （消した項目が次の描画で戻ってきてしまうため）
  window._appCache.hearingFixedReady = true;
  if (window.idbSetAppData) window.idbSetAppData('hearingFixedReady', true);
  var p = window.idbSetAppData('hearingQuestions', window._appCache.hearingQuestions);
  // バージョンも保存しないと、次の読み込みで data.js の内容に戻され追加が消える
  if (typeof window.HEARING_DATA_VERSION !== 'undefined') {
    window.idbSetAppData('hearingDataVersion', window.HEARING_DATA_VERSION);
  }
  if (typeof markDirty === 'function') markDirty();
  return p || Promise.resolve();
}
/**
 * 組み込み項目（デバイス／キャリア／メールドメイン／メモ）を補って返す。
 * まだ保存データに入っていない環境でも、必ず画面に出るようにするため。
 * すでに同じ id があれば触らないので、並べ替えや非表示の設定は保たれる。
 */
function _hrWithFixedItems(list) {
  var arr = Array.isArray(list) ? list.slice() : [];

  // 組み込み項目（デバイス／キャリア／メールドメイン／メモ）の取り込みは
  // 一度だけ。毎回補っていると、管理画面で削除しても次の描画で復活してしまう。
  if (!(window._appCache && window._appCache.hearingFixedReady)) {
    var head = [];
    (window.HEARING_FIXED_ITEMS || []).forEach(function (t) {
      if (arr.some(function (q) { return q && q.id === t.id; })) return;
      var copy = JSON.parse(JSON.stringify(t));
      var atEnd = copy.atEnd; delete copy.atEnd;
      if (atEnd) arr.push(copy); else head.push(copy);
    });
    if (head.length) arr = head.concat(arr);
  }

  // 選択肢は「質問そのもの」が持つ形に揃える。
  // 以前は全体設定（hearingDevices / hearingCarriers）に置いていたため、
  // 古いデータを読んだときはここで質問側へ移し替える。
  arr = arr.map(function (q) {
    if (!q) return q;
    // デバイス専用だった型を「詳細つきトグル」に読み替える
    if (q.type === 'device' || (q.id === 'q_devices' && !Array.isArray(q.options))) {
      var dv = (Array.isArray(q.devices) && q.devices.length) ? q.devices
             : (window._appCache && window._appCache.hearingDevices);
      if (!Array.isArray(dv)) dv = [];
      q = Object.assign({}, q, {
        type: 'toggle', multi: true,
        options: dv.map(function (d) {
          return { l: d.name, v: d.name, details: (d.details || []).slice() };
        })
      });
      delete q.devices;
    }
    // 旧形式（全体設定を参照していた頃）の読み替え
    if (q.optionsFrom === 'carriers') {
      var cv = (window._appCache && window._appCache.hearingCarriers);
      var src = Array.isArray(cv) ? cv : [];
      q = Object.assign({}, q, { options: src.map(function (v) { return { l: v, v: v }; }) });
      delete q.optionsFrom;
    }
    if (q.optionsFrom === 'domains') {
      q = Object.assign({}, q, { options: q.options || [] });
      delete q.optionsFrom;
    }
    return q;
  });

  // メモ（固定項目）は常に最下段。保存データに残っていた古い定義は捨て、common-utils.js の定義を使う。
  arr = window.stripHearingMemo(arr);
  arr.push(JSON.parse(JSON.stringify(window.HEARING_MEMO_ITEM)));
  return arr;
}
window._hrWithFixedItems = _hrWithFixedItems;

function _hrGetQuestions() {
  var cached = window._appCache && window._appCache.hearingQuestions;
  if (!Array.isArray(cached)) {
    var sd = window.APP_STATIC_DATA;
    cached = (sd && Array.isArray(sd.hearingQuestions)) ? sd.hearingQuestions : [];
  }
  return _hrWithFixedItems(JSON.parse(JSON.stringify(cached)));
}

function _hrEvalShowIf(showIf, s) {
  if (!showIf || !showIf.length) return true;
  return showIf.some(function(group) {
    return group.every(function(cond) {
      var val = (cond.field in s) ? s[cond.field] : undefined;
      switch(cond.op) {
        case 'eq':      return val === cond.value;
        case 'neq':     return val !== cond.value;
        case 'true':    return val === true;
        case 'false':   return val === false;
        case 'notnull': return val !== null && val !== undefined;
        case 'in':      return (cond.value||'').split(',').indexOf(String(val)) >= 0;
        default:        return true;
      }
    });
  });
}

// ===================================================================
// ヒアリング状態のタブ間リアルタイム同期（localStorage storage イベント）
// ===================================================================
window.addEventListener('storage', function(e) {
  if (e.key !== HEARING_KEY) return;
  try {
    var updated = e.newValue ? JSON.parse(e.newValue) : null;
    if (!updated) return;
    // 詳細つきトグル（デバイスなど）は選択肢ぶんの入れ物を補完しておく
    (window.getDetailToggleQuestions ? window.getDetailToggleQuestions() : []).forEach(function(q) {
      var fld = q.field || q.id;
      var cur = updated[fld];
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
      var next = {};
      _hrOptsOf(q).forEach(function(o) {
        var v = o.v || o.l;
        next[v] = cur[v] || { selected: false, detail: [] };
      });
      updated[fld] = next;
    });
    hearingState = Object.assign({}, DEFAULT_STATE, updated);
    if (typeof renderHearing === 'function') renderHearing();
  } catch(ex) {}
});

// ── ヒアリングの「組み込み項目」──────────────────────────
// デバイス／キャリア／メールドメイン／メモは、以前はコードに直接
// 書き込まれていて並べ替えも非表示もできなかった。
// これらを他と同じ「カスタム項目」として hearingQuestions に持たせ、
// 並べ替え・非表示・記号・出力名などを同じ仕組みで扱えるようにする。
// 質問は data.js（hearingQuestions）で管理する。
// 以前はデバイス／キャリア／メールドメイン／メモをここから補っていたが、
// 削除しても復活してしまうため廃止した。必要なら管理画面から追加する。
window.HEARING_FIXED_ITEMS = [];


/**
 * 組み込み項目を hearingQuestions に取り込む（1回だけ）。
 * デバイス～ドメインは先頭、メモは末尾に入れる。
 * すでに同じ id があれば何もしないので、並べ替えた結果は保たれる。
 */
window.ensureHearingFixedItems = function () {
  // メモは _hrGetQuestions() が常に補うため、保存データへ取り込む必要はない
  return false;
};

/** 質問の選択肢。候補は質問そのものが持つ */
window.getHearingOptions = _hrOptsOf;

/** デバイス項目（複数デバイス＋詳細）の中身 */
/**
 * 詳細つきトグルの中身。
 * 選択肢を1行ずつ並べ、詳細があればその行に詳細ボタンを並べる。
 * 詳細が無い選択肢は ON / OFF の単純なトグルになる。
 */
function _hrDetailToggleHTML(s, q) {
  var fld = q.field || q.id;
  var st  = s[fld] || {};
  var h = '<div class="hr-device-group">';
  _hrOptsOf(q).forEach(function (o) {
    var val = o.v || o.l;
    var d = st[val] || { selected: false, detail: [] };
    var dDetail = Array.isArray(d.detail) ? d.detail : (d.detail ? [d.detail] : []);
    var details = Array.isArray(o.details) ? o.details : [];
    var content = '';
    if (details.length) {
      // 複数選択を許可していないときは、項目ごとに詳細を1つだけ選べる。
      // どちらの場合も、選択中をもう一度押せば解除できる。
      details.forEach(function (opt, di) {
        var active = (dDetail.indexOf(opt) >= 0) ? ' active' : '';
        content += '<button class="hr-device-btn' + active + '" onclick="setHearingOptDetail(\'' + fld + '\',\'' + val + '\',\'' + opt + '\',' + (q.multi ? 'true' : 'false') + ')">' + window.hrDetailHtml(o, di, opt) + '</button>';
      });
    } else {
      content = '<button class="hr-device-btn' + (d.selected ? ' active' : '') + '" onclick="toggleHearingOpt(\'' + fld + '\',\'' + val + '\',' + (q.multi ? 'true' : 'false') + ')">' + (d.selected ? 'ON' : 'OFF') + '</button>';
    }
    // 中項目（選択肢の行）には先頭記号を付けない。付くのは項目名だけ
    h += _hrRow(o.lHtml ? window.hearingSanitizeHtml(o.lHtml) : (o.l || val), content, 'hr-device-row', '');
  });
  return h + '</div>';
}
window._hrDetailToggleHTML = _hrDetailToggleHTML;

/** 「その他（手入力）」付きのプルダウン */
/**
 * 手入力欄を出す選択肢かどうか。
 * 既定は「その他（手入力）」だが、質問の選択肢に manual:true を付ければ
 * 任意の選択肢（例：その他）を手入力のきっかけにできる。
 */
/** この項目が手入力欄を持つか（その他を出す／手入力にした選択肢がある） */
window.hearingNeedsManual = function (q) {
  if (!q) return false;
  if (q.allowManual) return true;
  return window.getHearingOptions(q).some(function (o) { return !!o.manual; });
};

function _hrIsManualValue(q, v) {
  if (v === '__manual__') return true;
  return window.getHearingOptions(q).some(function (o) { return o.manual && o.v === v; });
}
window._hrIsManualValue = _hrIsManualValue;

function _hrSelectManualHTML(q, s) {
  var fld  = q.field || q.id;
  var mfld = q.manualField || (fld + 'Manual');
  var v    = s[fld];
  // 手入力の選択肢は常に一番下に置く。
  // あとから項目を足すと「1, 2, その他, 3」の並びになってしまうため。
  var opts = window.getHearingOptions(q).slice().sort(function (a, b) {
    return (a.manual ? 1 : 0) - (b.manual ? 1 : 0);
  });
  var showManual = _hrIsManualValue(q, v);
  var h = '<select class="hr-select" onchange="window.setHearingSelect(\'' + fld + '\',this.value)">' +
    '<option value="">選択してください</option>' +
    opts.map(function (o) { return _mkOpt(o.v, v, o.l); }).join('') +
    // 選択肢に手入力のものがあれば、自動の「その他（手入力）」は足さない
    // （両方出ると「その他」が2つ並んでしまう）
    // 「その他（手入力）」は、既に手入力の選択肢が無いときだけ自動で足す
    // （ある選択肢に既に手入力の印が付いていれば、それが「その他（手入力）」そのものなので、二重には出さない）
    ((window.hearingNeedsManual(q) && !opts.some(function (o) { return o.manual; }))
      ? '<option value="__manual__"' + (v === '__manual__' ? ' selected' : '') + '>その他（手入力）</option>' : '') +
    '</select>';
  h += '<div style="display:' + (showManual ? 'block' : 'none') + ';margin-top:6px;">' +
    '<input type="text" class="hr-text-input" placeholder="' + escHtml(q.manualPlaceholder || '') + '"' +
    ' data-hr-field="' + escHtml(mfld) + '" value="' + escHtml(s[mfld] || '') + '" oninput="setHearingInput(\'' + mfld + '\',this.value)"></div>';
  return h;
}
window._hrSelectManualHTML = _hrSelectManualHTML;

/** プルダウンの選択。手入力に切り替わったとき欄を出すため描き直す */
window.setHearingSelect = function (field, value) {
  hearingState[field] = value;
  saveHearingState();
  renderHearing();
};

/** 1つのヒアリング項目の HTML（画面用）。組み込み項目もここを通る */
/**
 * 項目1つぶんの HTML（種類ごとの内容は _hearingItemHTMLRaw が作る）。
 * ここでは、その項目の中に置かれた項目（子）があれば、続けて描き足す。
 * ログ作成補助に限らず、記述・選択などどの種類の項目も子を持てる
 * （子がさらに子を持つ「入れ子の入れ子」にも、再帰なので何段でも対応する）。
 * 管理画面のプレビューは、行ごとに別々に描くため、ここでは何もしない。
 */
window.hearingItemHTML = function (q, s) {
  var raw = _hearingItemHTMLRaw(q, s);
  if (!raw || q.type === 'spacer' || q.type === 'heading' || q.type === 'log') return raw;
  if (document.body && document.body.classList.contains('page-admin')) return raw;
  var kids = window.hearingChildItems(q, s);
  if (!kids.length) return raw;
  var kidsHtml = kids.map(function (k) { return window.hearingItemHTML(k, s); }).join('');
  var wrapClass = (q.type === 'log') ? 'hr-log-children' : 'hr-nested-children';
  var injected = '<div class="' + wrapClass + '">' + kidsHtml + '</div>';
  // .hr-btns の閉じタグの直前に差し込む（末尾は必ず </div></div> = hr-btns → hr-row の順で閉じる）
  var idx = raw.lastIndexOf('</div></div>');
  return (idx < 0) ? (raw + injected) : (raw.slice(0, idx) + injected + raw.slice(idx));
};

function _hearingItemHTMLRaw(q, s) {
  var fld = q.field || q.id;
  var pf  = window.getHearingPrefix(q);

  // 見出しは、中の項目（ログ作成補助の中に置かれたとき）としても使える。
  // トップレベルの見出し（グループの開閉）とは別の、シンプルな区切り表示にする。
  if (q.type === 'heading' && q.parentId) {
    return '<div class=\"hr-heading\">' + escHtml(pf ? pf + ' ' : '') + window.hrLabelHtml(q) + '</div>';
  }
  // 画像：入力欄を持たない。管理側で挿入した画像をそのまま表示するだけ
  if (q.type === 'image') {
    if (!q.imageHtml) return '';
    var imgLabel = q.label ? '<div class=\"hr-label\">' + escHtml(pf ? pf + ' ' : '') + window.hrLabelHtml(q) + '</div>' : '';
    return '<div class=\"hr-row hr-image-row\">' + imgLabel + '<div class=\"hr-btns\">' + q.imageHtml + '</div></div>';
  }
  if (q.type === 'bool') {
    return _hrRow(window.hrLabelHtml(q), _boolBtns(fld, s[fld], q.trueLabel || 'はい', q.falseLabel || 'いいえ'), '', pf);
  }
  if (q.type === 'str' || q.type === 'toggle' || q.type === 'device') {
    // 選択肢に詳細があるものは2段構え（例：iPhone → Web / アプリ）
    if (window.isDetailToggle(q)) {
      return _hrRow(window.hrLabelHtml(q), _hrDetailToggleHTML(s, q), 'hr-device-wrap', pf);
    }
    return _hrRow(window.hrLabelHtml(q), q.multi
      ? _multiBtns(fld, s[fld], window.getHearingOptions(q))
      : _strBtns(fld, s[fld], window.getHearingOptions(q)), '', pf);
  }
  if (q.type === 'radio') {
    // ラジオも、チェックボックスと同じく縦一列に並べる
    return _hrRow(window.hrLabelHtml(q),
      '<div class="hr-choice-vertical">' + _radioBtns(fld, s[fld], window.getHearingOptions(q), false, true) + '</div>',
      '', pf);
  }
  if (q.type === 'spacer') {
    // 空白行：入力欄を持たない、ただの空き（結果文・コピーにも空行として出る）
    return '<div class="hr-row hr-spacer-row"><div class="hr-btns"><div class="hr-spacer"></div></div></div>';
  }
  if (q.type === 'qtycheck') {
    // チェック＋数量：チェックした項目名（「●」を含められる）に、共有のテキストエリアの値を差し込んで出す。
    // 例：「テスト、●本」を選び、テキストエリアに「3」→「テスト、3本」。
    var qtySt = s[fld] || {};
    var qtyPicked = Array.isArray(qtySt.picked) ? qtySt.picked : [];
    var qtyRows = (window.getHearingOptions(q) || []).map(function (o) {
      var v = o.v || o.l;
      var on = qtyPicked.indexOf(v) >= 0;
      return '<label class="hr-qtycheck-row"><input type="checkbox"' + (on ? ' checked' : '') +
        ' onchange="toggleHearingQtyCheck(\'' + fld + '\',\'' + escHtml(v).replace(/'/g, "\\'") + '\')">' +
        '<span>' + window.hrOptHtmlEsc(o, v) + '</span></label>';
    }).join('');
    var qtyPh = escHtml(q.placeholder || '');
    var qtyTa = '<textarea class="hr-text-input hr-autogrow hr-qtycheck-input" data-hr-field="' + escHtml(fld) + '__qty" rows="1"' +
      ' placeholder="' + qtyPh + '" style="font-family:inherit;"' +
      ' oninput="setHearingQtyText(\'' + fld + '\',this.value);window.hrAutoGrow(this)">' + escHtml(qtySt.text || '') + '</textarea>';
    return _hrRow(window.hrLabelHtml(q), '<div class="hr-qtycheck-group">' + qtyRows + qtyTa + '</div>', '', pf);
  }
  if (q.type === 'log') {
    // ログ作成補助。選んだボタンの内容が、この項目の出力になる（もう一度押すと外れる）。
    // 中に置いた項目は、ボタンごとの専用のセット（サブテンプレート）で、
    // そのボタンを選んでいるときだけ、続けて表示する（他のボタンとは共用しない）。
    var picked = Array.isArray(s[fld]) ? s[fld] : (s[fld] ? [s[fld]] : []);
    var opts = window.getHearingOptions(q) || [];
    var btns = opts.map(function (o) {
      var v = o.v || o.l;
      var on = picked.indexOf(v) >= 0 ? ' active' : '';
      return '<button class="hr-log-btn' + on + '" title="押すと出力に加えます（もう一度押すと外れます）"'
        + ' onclick="toggleHearingMulti(\'' + fld + '\',\'' + escHtml(v).replace(/'/g, "\\'") + '\')">'
        + window.hrOptHtmlEsc(o, v) + '</button>';
    }).join('');
    var kidsHtml = '';
    if (!(document.body && document.body.classList.contains('page-admin'))) {
      kidsHtml = picked.map(function (v) {
        var kids = window.hearingChildItemsForOpt(q, v, s);
        if (!kids.length) return '';
        return '<div class="hr-log-children">' + kids.map(function (k) { return window.hearingItemHTML(k, s); }).join('') + '</div>';
      }).join('');
    }
    return '<div class="hr-row hr-log-row"><div class="hr-btns">'
      + '<div class="hr-log-group">' + btns + '</div>' + kidsHtml
      + '</div></div>';
  }
  if (q.type === 'checkbox') {
    // チェックボックスは常に複数選択。選んだものが「、」でつながって出力される。
    // 複数を見比べながら選ぶため縦に並べる。
    return _hrRow(window.hrLabelHtml(q),
      '<div class="hr-choice-vertical">' +
        _radioBtns(fld, s[fld], window.getHearingOptions(q), true) +
      '</div>', '', pf);
  }
  if (q.type === 'select') {
    // プルダウンは常に同じ描画（手入力が要らないときは、その分の選択肢が付かないだけ）。
    // 以前は「手入力が要らない」ときだけ別の描画関数（_selectBox）を使っていて、
    // プレースホルダーの文言（「選択してください」／「（未選択）」）や見た目が食い違っていた。
    return _hrRow(window.hrLabelHtml(q), _hrSelectManualHTML(q, s), '', pf);
  }
  if (q.type === 'text') {
    var ph = escHtml(q.placeholder || '');
    // メモは「■メモ　消去」のように、見出しの横に消去ボタンを置く
    var isMemo = (fld === 'memo' || q.id === 'q_memo');
    var labelHtml = escHtml(pf) + window.hrLabelHtml(q) + (isMemo
      ? '<button type="button" class="hr-memo-clear" onclick="window.clearHearingMemo(\'' + fld + '\')" title="メモの内容だけを消します">消去</button>'
      : '');
    if (isMemo) {
      return '<div class="hr-row hr-memo-row">'
        + '<div class="hr-label">' + labelHtml + '</div>'
        + '<div class="hr-btns">'
        + '<textarea class="hr-text-input hr-autogrow" data-hr-field="' + escHtml(fld) + '" rows="1" placeholder="' + ph + '" style="font-family:inherit;" oninput="setHearingInput(\'' + fld + '\',this.value);window.hrAutoGrow(this)">' + escHtml(s[fld] || '') + '</textarea>'
        + '</div></div>';
    }
    var clearBtn = '';
    return _hrRow(window.hrLabelHtml(q), (q.multiline
      ? '<textarea class="hr-text-input hr-autogrow" data-hr-field="' + escHtml(fld) + '" rows="1" placeholder="' + ph + '" style="font-family:inherit;" oninput="setHearingInput(\'' + fld + '\',this.value);window.hrAutoGrow(this)">' + escHtml(s[fld] || '') + '</textarea>'
      : '<input type="text" class="hr-text-input" data-hr-field="' + escHtml(fld) + '" placeholder="' + ph + '" value="' + escHtml(s[fld] || '') + '" oninput="setHearingInput(\'' + fld + '\',this.value)">') + clearBtn, '', pf);
  }
  return '';
}

// opts: {title, mistakeField, spamField, permField, permLabel}
// メール受信なしの確認項目は管理画面の質問で作れるため、専用の描画は廃止した。


// ── ヒアリング項目のグループ ──
// 見出しから次の見出しまでを1グループとして扱い、まとめて開閉できるようにする。
// 項目数が多いとき、いま使う範囲だけを開いておける。
var _hrGroupOpen  = false;   // 描画中にグループを開いているか
var _hrGroupState = {};      // グループごとの開閉状態

try {
  var _gs = localStorage.getItem(window.profileScopedKey('hearingGroups'));
  if (_gs) _hrGroupState = JSON.parse(_gs);
} catch (e) { _hrGroupState = {}; }

window.toggleHearingGroup = function(gid) {
  _hrGroupState[gid] = (_hrGroupState[gid] === false);
  try { localStorage.setItem(window.profileScopedKey('hearingGroups'), JSON.stringify(_hrGroupState)); } catch (e) {}
  renderHearing();
};

/** ドメイン一覧の既定値（サイドメニューに無いときのフォールバック） */
function _defaultMailDomains() {
  var t = window.SIDEMENU_DEFAULT_TABLES.find(function(x) { return x.id === 'sm_domain'; });
  return (t ? t.rows : []).map(function(r) { return r[0]; });
}

// ── メンテナンス中 ───────────────────────────────────
// 管理画面のスイッチで、ページごとに「メンテナンス中」にできる。
// ページは開けるが、操作できないよう覆いをかぶせる。

/** そのページがメンテナンス中か */
window.isMaintenance = function (file) {
  var f = String(file || _currentPageFile()).toLowerCase();
  var m = (window._appCache && window._appCache.maintenance) || {};
  return !!m[f];
};

/** メンテナンス状態を設定する（管理画面から呼ぶ） */
window.setMaintenance = function (file, on) {
  var m = Object.assign({}, (window._appCache && window._appCache.maintenance) || {});
  var f = String(file || '').toLowerCase();
  if (on) m[f] = true; else delete m[f];
  window._appCache.maintenance = m;
  if (window.idbSetAppData) window.idbSetAppData('maintenance', m);
  try {
    var bc = new BroadcastChannel('tool_data_update');
    bc.postMessage({ type: 'maintenanceUpdated', data: m });
    bc.close();
  } catch (e) {}
};

/** メンテナンス中なら画面全体に覆いを出す */
function _applyMaintenance() {
  var on = window.isMaintenance();
  var el = document.getElementById('maintenanceOverlay');
  if (!on) { if (el) el.parentNode.removeChild(el); return; }
  if (el) return;

  el = document.createElement('div');
  el.id = 'maintenanceOverlay';
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(20,22,28,.78);backdrop-filter:blur(2px);cursor:not-allowed;';
  el.innerHTML =
    '<div style="text-align:center;color:#fff;padding:28px 36px;border-radius:14px;' +
      'background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);max-width:80vw;">' +
      '<div style="font-size:44px;margin-bottom:12px;">🚧</div>' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:8px;">メンテナンス中です</div>' +
      '<div style="font-size:12px;line-height:1.8;opacity:.85;">' +
        'このページは現在編集中のため、一時的にご利用いただけません。<br>' +
        'しばらく経ってから開き直してください。</div>' +
    '</div>';
  // 覆いの上での操作をすべて止める
  ['click', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    el.addEventListener(ev, function (e) { e.stopPropagation(); e.preventDefault(); }, true);
  });
  document.body.appendChild(el);
}
window._applyMaintenance = _applyMaintenance;

// ── メンテナンス中のページへ移動するボタン ─────────────
// ヘッダーの各ページへのボタンと、ホームのカードに「🚧 メンテナンス中」を出し、押せなくする。
// 状態は管理画面のスイッチと連動する（他のタブで切り替えても即座に反映）。
// 管理画面のタブのメニュー（↗ 開く）は、管理する人が確認できるよう対象外。

/** メンテナンス表示の対象（ヘッダーの移動ボタン・ホームのカード） */
function _maintTargets() {
  var list = [];
  Array.prototype.forEach.call(document.querySelectorAll('header .nav-btn[data-page]'), function (el) {
    list.push({ el: el, file: el.getAttribute('data-page'), card: false });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.home-card[data-file]'), function (el) {
    list.push({ el: el, file: el.getAttribute('data-file'), card: true });
  });
  return list;
}

function _ensureMaintStyle() {
  if (document.getElementById('maintBtnStyle')) return;
  var st = document.createElement('style');
  st.id = 'maintBtnStyle';
  st.textContent =
    '.is-maint{opacity:.55 !important;cursor:not-allowed !important;filter:grayscale(.5);}' +
    '.home-card.is-maint{position:relative;transform:none !important;box-shadow:none !important;border-color:var(--border) !important;}' +
    '.home-card.is-maint .home-card-arrow{color:var(--text3) !important;}' +
    '.maint-badge{display:inline-block;margin-left:5px;padding:1px 6px;border-radius:9px;font-size:10px;' +
      'font-weight:700;line-height:1.5;background:#ffb800;color:#3a2a00;white-space:nowrap;vertical-align:middle;}' +
    '.home-card .maint-badge{position:absolute;top:10px;right:10px;margin:0;font-size:11px;padding:2px 8px;}';
  document.head.appendChild(st);
}

/** メンテナンス中のページへのボタンに印を付け、押せなくする（解除されたら元に戻す） */
window.paintMaintenanceButtons = function () {
  _ensureMaintStyle();
  _maintTargets().forEach(function (t) {
    var on = !!(t.file && window.isMaintenance(t.file));
    var el = t.el;
    var badge = el.querySelector(':scope > .maint-badge');
    el.classList.toggle('is-maint', on);
    if (on) {
      el.setAttribute('aria-disabled', 'true');
      if (el.getAttribute('data-title0') === null) el.setAttribute('data-title0', el.getAttribute('title') || '');
      el.setAttribute('title', 'メンテナンス中のため開けません');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'maint-badge';
        badge.textContent = t.card ? '🚧 メンテナンス中' : '🚧';
        el.appendChild(badge);
      }
      var arrow = t.card ? el.querySelector('.home-card-arrow') : null;
      if (arrow) {
        if (arrow.getAttribute('data-text0') === null) arrow.setAttribute('data-text0', arrow.textContent);
        arrow.textContent = '現在ご利用いただけません';
      }
    } else {
      el.removeAttribute('aria-disabled');
      var t0 = el.getAttribute('data-title0');
      if (t0 !== null) { if (t0) el.setAttribute('title', t0); else el.removeAttribute('title'); el.removeAttribute('data-title0'); }
      if (badge) badge.parentNode.removeChild(badge);
      var ar = t.card ? el.querySelector('.home-card-arrow') : null;
      if (ar && ar.getAttribute('data-text0') !== null) { ar.textContent = ar.getAttribute('data-text0'); ar.removeAttribute('data-text0'); }
    }
  });
};

// メンテナンス中のボタンは、クリックもキー操作（Enter）も無効にする。
// ボタン自身の処理より先に止めるため、キャプチャ段階で受ける。
document.addEventListener('click', function (e) {
  var t = e.target && e.target.closest ? e.target.closest('.is-maint') : null;
  if (!t) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// 他のタブで切り替えられたら即座に反映する
try {
  var _mbc = new BroadcastChannel('tool_data_update');
  _mbc.addEventListener('message', function (ev) {
    if (!ev || !ev.data || ev.data.type !== 'maintenanceUpdated') return;
    window._appCache.maintenance = ev.data.data || {};
    _applyMaintenance();
    window.paintMaintenanceButtons();
  });
} catch (e) {}

/** 固定テキストの値を取り出す（未設定なら既定値） */
window.getFixedText = function (key) {
  var ft = (window._appCache && window._appCache.fixedTexts) || {};
  var v = ft[key];
  if (v !== undefined && v !== null && String(v) !== '') return String(v);
  var d = window.FIXED_TEXT_DEFAULTS || {};
  return d[key] !== undefined ? String(d[key]) : '';
};

// ログ作成補助で、複数のボタンを選んだときの区切り線
var LOG_SEPARATOR = '--------------------------------------------------';
window.LOG_SEPARATOR = LOG_SEPARATOR;

// ── お知らせ ────────────────────────────────────────
// 以前は ★お知らせ★.js / .txt を別ファイルで置いていたが、
// ファイル名に記号が入るため環境によって読めないことがあり、
// 管理画面からも編集できなかった。いまは data.js に載せる。
// 旧ファイルが残っていればそちらを優先して読む（移行のため）。

/** お知らせ本文。無ければ空文字 */
window.getNotice = function () {
  // 空文字は「消した」という意思表示。
  // 中身の有無で判定すると、空にしても data.js の内容が復活してしまう。
  var v = window._appCache && window._appCache.notice;
  if (typeof v === 'string') return v;
  if (typeof window.APP_NOTICE === 'string') return window.APP_NOTICE;  // 旧ファイル
  var sd = window.APP_STATIC_DATA;
  return (sd && typeof sd.notice === 'string') ? sd.notice : '';
};

// 旧 ★お知らせ★.js が置かれている場合は、そちらを最初に採り込む。
// （管理画面に移行するまでの橋渡し。移行後は旧ファイルを削除してください）
// データファイルの読み込み後に判定する（⓪-P 参照）。
window.AppProfile.onDataReady(function () {
  if (!window._appCache) return;
  if (typeof window.APP_NOTICE !== 'string' || !window.APP_NOTICE.trim()) return;
  // 管理画面で一度でも設定していれば（空にした場合も含めて）そちらを尊重する。
  // 中身の有無で判定すると、空にしたときに旧ファイルが復活してしまう。
  var sd = window.APP_STATIC_DATA;
  var configured = (typeof window._appCache.notice === 'string' && window._appCache.notice !== '')
             || (sd && typeof sd.notice === 'string');
  if (configured) return;
  window._appCache.notice = window.APP_NOTICE;
});

/** お知らせの更新日（手動指定）。無ければ空文字 */
window.getNoticeDate = function () {
  if (window.APP_NOTICE_DATE) return String(window.APP_NOTICE_DATE);
  var v = window._appCache && window._appCache.noticeDate;
  return v ? String(v) : '';
};

/** お知らせを保存する（管理画面から呼ぶ） */
window.setNotice = function (text, dateStr) {
  window._appCache.notice = String(text == null ? '' : text);
  window._appCache.noticeDate = String(dateStr == null ? '' : dateStr);
  if (window.idbSetAppData) {
    window.idbSetAppData('notice', window._appCache.notice);
    window.idbSetAppData('noticeDate', window._appCache.noticeDate);
  }
  try {
    var bc = new BroadcastChannel('tool_data_update');
    bc.postMessage({ type: 'noticeUpdated', data: window._appCache.notice, date: window._appCache.noticeDate });
    bc.close();
  } catch (e) {}
};

/**
 * サイドメニューの「メールドメイン一覧」の中身を返す（参照用）。
 * ヒアリングシートの候補は別管理なので、こちらとは連動しない。
 */
window.getMailDomainList = function () {
  var list = (window._appCache && window._appCache.sideMenuData) || [];
  var sec = list.find(function(x) { return x && x.id === 'sm_domain'; });
  var rows = (sec && Array.isArray(sec.rows)) ? sec.rows : null;
  if (!rows || !rows.length) return _defaultMailDomains();
  var out = [];
  rows.forEach(function(r) {
    var v = String((r && r[0]) || '').trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  return out.length ? out : _defaultMailDomains();
};

/**
 * 固定セクションの内容をそろえ、一覧に無いものは末尾に足す（管理画面が使う）。
 * 足したときだけ true。
 */
window.ensureDefaultSideMenuTables = function() {
  var list = window._appCache.sideMenuData;
  if (!Array.isArray(list)) return false;
  window.applyFixedSideMenuSections(list);
  var added = false;
  window.SIDEMENU_FIXED_IDS.forEach(function(id) {
    if (list.some(function(sec) { return sec && sec.id === id; })) return;
    var def = _fixedSideMenuDef(id);
    if (def) { list.push(def); added = true; }
  });
  return added;
};

/** ショートカット一覧の中身（表の部分だけ） */
function _shortcutBody() {
  var keys = function(str) {
    return str.split(' ').map(function(k) {
      return (k === '/' || k === '+') ? k : '<kbd>' + escHtml(k) + '</kbd>';
    }).join(' ');
  };
  var body = SHORTCUTS.map(function(sec) {
    return '<div class="sc-sec">' + escHtml(sec[0]) + '</div>'
      + '<table class="sc-table">' + sec[1].map(function(r) {
          return '<tr><th>' + keys(r[0]) + '</th><td>' + escHtml(r[1]) + '</td></tr>';
        }).join('') + '</table>';
  }).join('');

  return body
    + '<div class="sc-note">このツール固有の操作は、各ページの「?」から見られる使い方マニュアルをご覧ください。</div>';
}

/** ショートカット一覧を開く（外部から呼ばれた場合はサイドメニューを開く） */
window.openShortcutHelp = function() {
  if (typeof toggleSideMenu === 'function') {
    var m = document.getElementById('sideMenu');
    if (m && !m.classList.contains('open')) toggleSideMenu();
  }
  // セクション化したのでIDは sideMenuData 側で決まる
  var sec = (window._appCache.sideMenuData || []).find(function(x) { return x.type === 'shortcut'; });
  var id  = sec ? (sec.id || 'sm_shortcut') : 'sm_shortcut';
  var p = document.getElementById(id);
  if (p && !p.classList.contains('open')) toggleAccordion(id);
  if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
};



/** テンプレート選択のボタン列。登録が無ければ何も出さない */
/** プルダウン */
function _selectBox(field, val, options) {
  return '<select class="hr-text-input" onchange="setHearing(\'' + field + '\',this.value)">'
    + '<option value="">（未選択）</option>'
    + options.map(function(o) {
        return '<option value="' + escHtml(o.v) + '"' + (val === o.v ? ' selected' : '') + '>'
          + escHtml(o.l) + '</option>';
      }).join('')
    + '</select>';
}

/** ラジオボタン（複数選択を許可した場合はチェックボックスにする） */
function _radioBtns(field, val, options, multi, canClear) {
  var arr = Array.isArray(val) ? val : (val ? [val] : []);
  return '<div class="hr-radio-group">' + options.map(function(o) {
    var on = multi ? (arr.indexOf(o.v) >= 0) : (val === o.v);
    var v  = escHtml(o.v).replace(/'/g, "\\'");
    // ラジオは onchange だと、選択中のものを押しても何も起きず解除できない。
    // onclick にして「同じものを押したら解除」を扱えるようにする。
    var handler = multi
      ? ' onchange="toggleHearingMulti(\'' + field + '\',\'' + v + '\')"'
      : (canClear
          ? ' onclick="window.toggleHearingSingle(\'' + field + '\',\'' + v + '\')"'
          : ' onchange="setHearing(\'' + field + '\',\'' + v + '\')"');
    return '<label class="hr-radio">'
      + '<input type="' + (multi ? 'checkbox' : 'radio') + '"'
      + ' name="hr_' + field + '"' + (on ? ' checked' : '')
      + handler + '>'
      + '<span>' + window.hrOptHtmlEsc(o) + '</span></label>';
  }).join('') + '</div>';
}

/** 複数選択のボタン群（トグル） */
function _multiBtns(field, val, options) {
  var arr = Array.isArray(val) ? val : (val ? [val] : []);
  return '<div class="hr-btns">' + options.map(function(o) {
    var on = arr.indexOf(o.v) >= 0;
    return '<button type="button" class="hr-btn' + (on ? ' active' : '') + '"'
      + ' onclick="toggleHearingMulti(\'' + field + '\',\'' + escHtml(o.v).replace(/'/g, "\\'") + '\')">'
      + window.hrOptHtmlEsc(o) + '</button>';
  }).join('') + '</div>';
}

/** 複数選択の値を出し入れする */
/** チェック＋数量：チェックの ON/OFF を切り替える */
window.toggleHearingQtyCheck = function (field, value) {
  var st = hearingState[field];
  if (!st || typeof st !== 'object' || Array.isArray(st)) st = hearingState[field] = { picked: [], text: '' };
  if (!Array.isArray(st.picked)) st.picked = [];
  var i = st.picked.indexOf(value);
  if (i >= 0) st.picked.splice(i, 1); else st.picked.push(value);
  saveHearingState();
  renderHearing();
};

/** チェック＋数量：共有のテキストエリアの値を設定する（入力中は描き直さない） */
window.setHearingQtyText = function (field, text) {
  var st = hearingState[field];
  if (!st || typeof st !== 'object' || Array.isArray(st)) st = hearingState[field] = { picked: [], text: '' };
  st.text = text;
  saveHearingState();
  if (_hrShowIfDepends(field)) { renderHearing(); return; }
  if (typeof renderHearingSummary === 'function') renderHearingSummary();
};

window.toggleHearingMulti = function(field, value) {
  var cur = hearingState[field];
  var arr = Array.isArray(cur) ? cur.slice() : (cur ? [cur] : []);
  var i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1); else arr.push(value);
  hearingState[field] = arr.length ? arr : null;
  saveHearingState();
  renderHearing();
};

/** テンプレートバーの HTML（管理画面の描画からも使う） */
window._hrTemplateBarHTML = function () { return _hrTemplateBar(); };

function _hrTemplateBar() {
  var tpls = window.getHearingTemplates();
  if (!tpls.length) return '';
  var cur = window.getCurrentTemplate();
  // 管理画面では、テンプレートごとに名前変更・削除ボタンを出す
  var admin = document.body.classList.contains('page-admin');
  return '<div class="hr-tpl-bar">'
    + tpls.map(function(t) {
        return '<span class="hr-tpl-wrap">'
          + '<button type="button" class="hr-tpl-btn' + (t.id === cur ? ' active' : '') + '"'
          + ' aria-pressed="' + (t.id === cur ? 'true' : 'false') + '"'
          // 名前が長いとボタンの中で省略されるため、ツールチップに全文＋案内を出す
          + ' title="' + escHtml(t.name) + '　' + (t.id === cur ? '（選択中。もう一度押すと解除）' : '（押すとこのテンプレートに切り替え）') + '"'
          // クリックでボタン自身にフォーカスが移ると、ブラウザが自動でそこまでスクロールし、
          // 結果として画面が先頭（テンプレート欄）まで戻ってしまうため、フォーカスさせない
          + ' onmousedown="event.preventDefault()"'
          + ' onclick="window.toggleHearingTemplate(\'' + t.id + '\')">' + escHtml(t.name) + '</button>'
          + (admin ? '<button type="button" class="hr-tpl-edit"'
              + ' onclick="window.renameHearingTemplate(\'' + t.id + '\')"'
              + ' title="テンプレート名を変更">✎</button>'
              + '<button type="button" class="hr-tpl-del"'
              + ' onclick="window.deleteHearingTemplate(\'' + t.id + '\')"'
              + ' title="このテンプレートを削除">×</button>' : '')
          + '</span>';
      }).join('')
    + '</div>';
}

// テンプレートの名前変更・削除は管理画面だけの操作なので admin.html にある

var _hrMemoHTML = '';   // メモは結果文の直前に固定するため一時的に保持する

function renderHearing() {
  var el = document.getElementById('hearingContent');
  _hrMemoHTML = '';
  if (!el) return;
  var s = hearingState;
  // テンプレートで表示する項目を絞る（共通項目は常に表示）
  var qs = window.filterQuestionsByTemplate(_hrGetQuestions());

  // ── パターンによる表示/非表示オーバーライドを評価 ──
  var patterns = window._appCache.hearingPatterns || [];
  var patternOverrides = {}; // questionId -> true(show)/false(hide)
  patterns.forEach(function(pat) {
    if (!pat.conditions || !pat.conditions.length) return;
    var allMet = pat.conditions.every(function(cond) {
      var sv = s[cond.field];
      if (typeof sv === 'boolean') return (cond.value === 'true') === sv;
      return String(sv === null || sv === undefined ? '' : sv) === String(cond.value || '');
    });
    if (allMet) {
      (pat.targets || []).forEach(function(t) { patternOverrides[t.id] = t.show; });
    }
  });

  // デバイス・キャリア・メールドメイン・メモも通常の項目として並ぶ
  var h = '';

  qs.forEach(function(q) {
    if (q.parentId) return;    // ログ作成補助の中の項目は、親の行の中に出す
    if (!q.enabled) return;
    // パターンが優先、なければ showIf を評価
    if (q.id in patternOverrides) {
      if (!patternOverrides[q.id]) return;
    } else if (!_hrEvalShowIf(q.showIf, s)) {
      return;
    }
    var fld = q.field || q.id;
    // 見出し：入力欄を持たず、区切りとして表示する（コピー時も出力する）
    // ここから次の見出しまでが1グループ。まとめて開閉できるようにする。
    if (q.type === 'heading') {
      if (_hrGroupOpen) h += '</div>';          // 前のグループを閉じる
      var gid = 'hrg_' + (q.id || fld);
      var opened = (_hrGroupState[gid] !== false);
      h += '<div class="hr-group' + (opened ? ' open' : '') + '">'
        // 見出しは折りたたまず、区切りとして出すだけにする
        +   '<div class="hr-heading">'
        +     escHtml(window.getHearingPrefix(q)) + window.hrLabelHtml(q)
        +   '</div>'
        +   '<div class="hr-group-body">';
      _hrGroupOpen = true;
      return;
    }
    // メモだけは結果文の直前に固定するため、いったん取り置く
    if (q.field === 'memo' || q.id === 'q_memo') {
      _hrMemoHTML = window.hearingItemHTML(q, s);
      return;
    }
    h += window.hearingItemHTML(q, s);
  });

  // メール受信なしの確認項目はコードに直接書いていたが、
  // 同じことは管理画面の質問（チェックボックス＋表示条件）で作れるため廃止した。
  if (_hrGroupOpen) { h += '</div></div>'; _hrGroupOpen = false; }
  // メモは結果文のすぐ上に固定する（並び順に関係なくここへ出す）
  if (_hrMemoHTML) { h += _hrMemoHTML; _hrMemoHTML = ''; }
  h += '<div id="hearingSummaryArea"></div>';
  h = _hrTemplateBar() + h;
  // 描き直しで入力欄が作り直されるため、打っていた場所を覚えて戻す
  var focused = _hrCaptureFocus();
  // テンプレートの切り替えなどで描き直すと、スクロール位置が先頭に戻ってしまうため覚えて戻す
  var scroller = _hrFindScroller(el);
  var scrollTop = scroller ? scroller.scrollTop : 0;
  el.innerHTML = h;
  _hrAutoGrowAll();
  _hrRestoreFocus(focused);
  if (scroller) scroller.scrollTop = scrollTop;
  renderHearingSummary();
  // 管理画面では「＋ 対応方針を追加」に、いま条件になる件数を出す
  if (typeof _hrUpdateAddPolicyBtn === 'function') _hrUpdateAddPolicyBtn();
}

/**
 * 複数行入力の高さを内容に合わせる。
 * 既定は1行分で、改行が増えたぶんだけ伸ばす（縮むときも追従させる）。
 */
/** メモの内容だけを消す（他の入力はそのまま） */
window.clearHearingMemo = function (field) {
  var f = field || 'memo';
  if (!hearingState[f]) return;
  hearingState[f] = '';
  saveHearingState();
  renderHearing();
};

window.hrAutoGrow = function (el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight || 0) + 'px';
};

/** 画面内の自動調節つき入力欄をまとめて整える */
function _hrAutoGrowAll() {
  document.querySelectorAll('.hr-autogrow').forEach(function (el) { window.hrAutoGrow(el); });
}

/** いま入力中の欄と、カーソルの位置を覚えておく */
/** el を含む、実際にスクロールしている祖先要素を探す（無ければ null） */
function _hrFindScroller(el) {
  var n = el ? el.parentElement : null;
  while (n && n !== document.body) {
    var cs = window.getComputedStyle(n);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return null;
}

function _hrCaptureFocus() {
  var el = document.activeElement;
  if (!el || !el.getAttribute || !el.getAttribute('data-hr-field')) return null;
  var r = { field: el.getAttribute('data-hr-field') };
  try { r.start = el.selectionStart; r.end = el.selectionEnd; } catch (e) {}
  return r;
}

/** 描き直したあと、同じ欄の同じ位置にカーソルを戻す */
function _hrRestoreFocus(info) {
  if (!info) return;
  var el = document.querySelector('[data-hr-field="' + info.field + '"]');
  if (!el) return;
  try {
    el.focus();
    if (info.start != null) el.setSelectionRange(info.start, info.end);
  } catch (e) {}
}

function _mkOpt(val, selected, label) {
  return '<option value="' + escHtml(val) + '"' + (selected === val ? ' selected' : '') + '>' +
         escHtml(label === undefined || label === null ? val : label) + '</option>';
}
function _mkChk(id, checked, label) { return '<label class="hr-check-label"><input id="hearingCb_' + id + '" type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="onHearingCheckChange(\'' + id + '\')">' + ' ' + label + '</label>'; }

window._setHearingMemo = function(val) {
  hearingState.memo = val;
  saveHearingState();
  renderHearingSummary();
};

// ── 結果文（ヒアリング内容）の組み立て ──────────────────────────
// 画面の「📋 ヒアリング内容」とコピー結果は必ず同じものにしたいので、
// 一度ここで「行の配列」を作り、表示とコピーの両方がこれを使う。
//   { kind:'heading', text }                  … 見出し
//   { kind:'row', label, outLabel, value, type, outTpl } … 質問と回答
//   { kind:'policy', value }                  … 対応方針

// 出力文に埋め込む「入力箇所」の目印。全角/半角どちらの括弧でも書ける。
var HEARING_SLOT_RE = /\[入力\]|［入力］|\{入力\}|｛入力｝/;
window.HEARING_SLOT_TOKEN = '[入力]';

/** 出力文に「入力箇所」が含まれているか */
window.hearingHasSlot = function (tpl) {
  return HEARING_SLOT_RE.test(String(tpl || ''));
};

/** 出力文の「入力箇所」を実際の入力値に差し替える */
window.hearingFillSlot = function (tpl, val) {
  return String(tpl || '').replace(new RegExp(HEARING_SLOT_RE.source, 'g'), String(val == null ? '' : val));
};

/**
 * 質問の書式つき項目名・出力を、結果の行に持たせる。
 * 出力欄が文章なら outTplHtml、「出力名：回答」なら outLabelHtml（出力が空なら項目名の書式）。
 * 書式が無ければ何も足さない（従来どおりの表示になる）。
 */
function _hrRichParts(q) {
  var r = {};
  var tpl = q.outTpl || '', lab = q.outLabel || '';
  if (tpl && window.hearingHasSlot(tpl)) { if (q.outHtml) r.outTplHtml = window.hearingSanitizeHtml(q.outHtml); }
  else if (lab)                          { if (q.outHtml) r.outLabelHtml = window.hearingSanitizeHtml(q.outHtml); }
  else if (q.labelHtml)                  { r.outLabelHtml = window.hearingSanitizeHtml(q.labelHtml); }
  return r;
}

/** 1行ぶんの HTML（書式つきでコピーするとき・画面に出すとき用） */
function _hrLineHtml(item) {
  if (item.kind === 'blank') return '';
  var esc = function (t) { return escHtml(t).replace(/\n/g, '<br>'); };
  if (item.kind === 'heading') {
    var pf = (typeof item.prefix === 'string') ? item.prefix : window.getHearingDefaultPrefix();
    return escHtml(pf ? pf + ' ' : '') + window.hearingParseHeadingLinks(item.textHtml || escHtml(item.text));
  }
  if (item.kind === 'policy') return '対応方針：' + (item.htmlValue ? window.hearingSanitizeHtml(item.htmlValue) : esc(item.value));
  if (item.logOnly) return item.htmlValue || esc(item.value);
  var valH = esc(item.value);
  if (item.outTpl && window.hearingHasSlot(item.outTpl)) {
    return window.hearingFillSlotHtml(item.outTplHtml || escHtml(item.outTpl), valH);
  }
  // 項目名が空のときは「：」を付けず、値だけにする
  var labH = item.outLabelHtml || escHtml(item.outLabel);
  return labH ? (labH + '：' + valH) : valH;
}
window._hrLineHtml = _hrLineHtml;

/** 書式つきの部分を含む行か */
function _hrLineIsRich(item) {
  return !!(item.htmlValue || item.outTplHtml || item.outLabelHtml || item.textHtml);
}

/** 1行ぶんの出力テキスト（コピー用） */
function _hrLineText(item) {
  if (item.kind === 'blank') return '';    // 空白行
  if (item.kind === 'heading') {
    var pf = (typeof item.prefix === 'string') ? item.prefix : window.getHearingDefaultPrefix();
    return pf ? pf + ' ' + item.text : item.text;
  }
  if (item.kind === 'policy')  return '対応方針：' + item.value;
  // ログ作成補助は項目名を持たない。「ボタン名＋本文」だけを出す
  if (item.logOnly) return item.value;
  // 出力文が設定されていれば「項目名：値」ではなく文章として出す
  if (item.outTpl && window.hearingHasSlot(item.outTpl)) {
    return window.hearingFillSlot(item.outTpl, item.value);
  }
  // 項目名が空のときは「：」を付けず、値だけにする
  return item.outLabel ? (item.outLabel + '：' + item.value) : item.value;
}
window._hrLineText = _hrLineText;

/** いま表示中のパターンによる表示/非表示の上書きを求める */
function _hrPatternOverrides(s) {
  var over = {};
  ((window._appCache && window._appCache.hearingPatterns) || []).forEach(function (pat) {
    if (!pat.conditions || !pat.conditions.length) return;
    var ok = pat.conditions.every(function (c) {
      var sv = s[c.field];
      if (typeof sv === 'boolean') return (c.value === 'true') === sv;
      return String(sv === null || sv === undefined ? '' : sv) === String(c.value || '');
    });
    if (ok) (pat.targets || []).forEach(function (t) { over[t.id] = t.show; });
  });
  return over;
}
window._hrPatternOverrides = _hrPatternOverrides;

/** 選択肢の値を表示用テキストに直す */
function _hrOptText(q, v) {
  var o = window.getHearingOptions(q).find(function (x) { return x.v === v; });
  return o ? (o.r || o.l) : String(v);
}

function buildHearingLines(s) {
  s = s || hearingState;
  var out = [];
  var push = function (label, value) {
    out.push({ kind: 'row', label: label, outLabel: label, value: value, type: '', outTpl: '' });
  };

  // ── 項目（デバイス・キャリア・メールドメイン・メモを含め全て） ──
  // 表示中のテンプレートに合わせて絞る（画面の見た目とコピー結果をそろえる）
  var qs = (typeof _hrGetQuestions === 'function')
    ? window.filterQuestionsByTemplate(_hrGetQuestions()) : [];
  var over = _hrPatternOverrides(s);

  // 1つの項目ぶんの出力を sink に積む（ログ作成補助の中の項目も、同じ処理で出力する）
  var emit = function (q, out) {
    if (!q.enabled) return;
    if (q.id in over) { if (!over[q.id]) return; }
    else if (!_hrEvalShowIf(q.showIf, s)) return;

    // ログ作成補助：選んだボタンを「ボタン名＋改行＋本文」で並べる。
    // 複数選んだときは区切り線ではさむ。
    if (q.type === 'log') {
      var logFld = q.field || q.id;
      var picked = s[logFld];
      picked = Array.isArray(picked) ? picked : (picked ? [picked] : []);
      if (!picked.length) return;

      var opts = window.getHearingOptions(q);
      var order = opts.map(function (o) { return o.v || o.l; });
      var blocks = [], htmlBlocks = [], hasRich = false;
      // ボタンごとに、その文章＋そのボタン専用の中の項目（サブテンプレート）をまとめて1つの区画にする。
      // ボタン名そのものは出力に含めない。中の項目は、そのボタンでだけ使うもの（他のボタンとは共用しない）。
      picked.slice().sort(function (a, b) {
        return order.indexOf(a) - order.indexOf(b);      // 押した順ではなく並び順
      }).forEach(function (v) {
        var o = opts.find(function (x) { return (x.v || x.l) === v; }) || { l: v };
        // 「他の項目の回答を入れる」差し込み（{{項目名}}）を、出力の直前に解決する
        var body = (o.text == null) ? '' : window.hearingResolveRefs(String(o.text), s);
        if (o.textHtml) hasRich = true;
        var bodyHtml = o.textHtml ? window.hearingResolveRefsHtml(window.hearingSanitizeHtml(o.textHtml), s)
                                   : escHtml(body).replace(/\n/g, '<br>');

        // このボタンだけの中の項目（他のボタンの中の項目とは混ざらない）
        var kidItems = [];
        qs.forEach(function (k) {
          if (k.parentId !== q.id || k.parentOpt !== v || k.type === 'spacer') return;   // 空白行は中に置けない（見出し・ログ作成補助は置ける）
          emitWithChildren(k, kidItems);
        });

        // 文字が無くても、画像だけの本文はそれ自体が内容（差し込み・出力から落とさない）
        var bodyHasImg = /<img\b/i.test(o.textHtml || '');
        var segParts = [], segHtmlParts = [];
        if (body) segParts.push(body);
        if (body || o.textHtml) segHtmlParts.push(bodyHtml);
        if (kidItems.length) {
          segParts.push(kidItems.map(_hrLineText).join('\n'));
          segHtmlParts.push(kidItems.map(_hrLineHtml).join('<br>'));
          if (kidItems.some(_hrLineIsRich)) hasRich = true;
        }
        if (!segParts.length && !bodyHasImg) return;   // このボタンは出す内容が無い
        blocks.push(segParts.join('\n'));              // 画像だけのときは空文字（plain には映らない）
        htmlBlocks.push(segHtmlParts.join('<br>'));
      });
      if (!blocks.length) return;

      out.push({
        kind: 'row', label: q.label, outLabel: (q.outLabel || q.label),
        value: blocks.join('\n' + LOG_SEPARATOR + '\n'),
        htmlValue: hasRich ? htmlBlocks.join('<br>' + escHtml(LOG_SEPARATOR) + '<br>') : '',
        type: '', outTpl: '', multiline: true, logOnly: true
      });
      return;
    }

    // 空白行：入力を持たず、結果文・コピーに空行として出す（前後に中身が無いときは _hrTrimBlanks で詰める）
    if (q.type === 'spacer') { out.push({ kind: 'blank' }); return; }

    // 見出しは入力を持たないが、区切りとして出力する（「結果文・コピーにも含める」がオフなら、画面表示だけにする）
    if (q.type === 'heading') {
      if (q.includeInOutput === false) return;
      var hh = { kind: 'heading', text: (q.outLabel || q.label), prefix: window.getHearingPrefix(q) };
      var hrp = _hrRichParts(q);
      if (hrp.outLabelHtml) hh.textHtml = hrp.outLabelHtml;
      out.push(hh);
      return;
    }

    // 画像：入力を持たない。ツール画面には表示するが、結果文・コピーには出さない
    if (q.type === 'image') { return; }

    var fld = q.field || q.id;

    // チェック＋数量：チェックした項目だけ、●を数量に置き換えて、そのまま出力する（項目名は付けない）
    if (q.type === 'qtycheck') {
      var qp = _hrQtyCheckParts(q, s);
      if (!qp.texts.length) return;
      out.push({
        kind: 'row', label: q.label, outLabel: (q.outLabel || q.label),
        value: qp.texts.join('\n'),
        htmlValue: qp.hasRich ? qp.htmls.join('<br>') : '',
        type: '', outTpl: '', multiline: true, logOnly: true
      });
      return;
    }

    // 詳細つきトグルは「iPhone(Web)、PC(Win)」の形にまとめる
    if (window.isDetailToggle(q)) {
      var st = s[fld] || {};
      var parts = [];
      _hrOptsOf(q).forEach(function (o) {
        var val = o.v || o.l;
        var d = st[val];
        if (!d || !d.selected) return;
        var dd = Array.isArray(d.detail) ? d.detail : (d.detail ? [d.detail] : []);
        parts.push(dd.length ? (o.l || val) + '(' + dd.join('/') + ')' : (o.l || val));
      });
      if (!parts.length) return;
      out.push(Object.assign({
        kind: 'row', label: q.label, outLabel: (q.outLabel || q.label),
        value: parts.join('、'), type: '', outTpl: q.outTpl || ''
      }, _hrRichParts(q)));
      return;
    }

    var val = s[fld];
    if (val === null || val === undefined || val === '') return;
    if (Array.isArray(val) && !val.length) return;

    // 「その他（手入力）」が選ばれているときは手入力の値を使う
    if (_hrIsManualValue(q, val)) {
      val = s[q.manualField || (fld + 'Manual')];
      if (!val) return;
      out.push(Object.assign({
        kind: 'row', label: q.label, outLabel: (q.outLabel || q.label),
        value: String(val), type: '', outTpl: q.outTpl || ''
      }, _hrRichParts(q)));
      return;
    }

    var disp = '', type = '';
    if (q.type === 'bool') {
      if (val === true)       { disp = q.trueResult  || q.trueLabel  || 'はい';   type = 'yes'; }
      else if (val === false) { disp = q.falseResult || q.falseLabel || 'いいえ'; type = 'no';  }
    } else if (q.type === 'text') {
      disp = String(val);
    } else {
      // str / select / radio / toggle。複数選択のときは配列で入る。
      // 押した順ではなく、選択肢に並べた順で出力する
      if (Array.isArray(val)) {
        var order = window.getHearingOptions(q).map(function (o) { return o.v; });
        val = val.slice().sort(function (a, b) {
          var ia = order.indexOf(a), ib = order.indexOf(b);
          return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
        });
      }
      disp = Array.isArray(val)
        ? val.map(function (v) { return _hrOptText(q, v); }).join('、')
        : _hrOptText(q, val);
    }
    if (!disp) return;
    out.push(Object.assign({
      kind: 'row', label: q.label, outLabel: (q.outLabel || q.label),
      value: disp, type: type, outTpl: q.outTpl || '',
      isMemo: (fld === 'memo' || q.id === 'q_memo'),
      multiline: !!q.multiline
    }, _hrRichParts(q)));
  };

  /**
   * 項目1つぶんを出力し、続けてその中の項目（子）も出力する。
   * ログ作成補助は、子の出力を自分の1行にまとめる（emit の中で処理済み）。
   * それ以外の種類は、子を「項目名：値」の別の行として、自分の行のすぐあとに続ける。
   * 子がさらに子を持っていても、再帰で続けて出力される（何段の入れ子でも対応）。
   */
  var emitWithChildren = function (q, out) {
    emit(q, out);
    if (q.type === 'log') return;   // ログは自分の emit の中で子をまとめ済み
    qs.forEach(function (k) {
      if (k.parentId !== q.id || k.type === 'spacer') return;   // 空白行は中に置けない（見出し・ログ作成補助は置ける）
      emitWithChildren(k, out);
    });
  };

  qs.forEach(function (q) {
    if (q.parentId) return;    // 中の項目は、親の出力（emitWithChildren の再帰）でまとめて出す
    emitWithChildren(q, out);
  });

  // ── 対応方針 ──
  calcPolicyItems(s).forEach(function (p) { out.push({ kind: 'policy', value: p.text, htmlValue: p.html }); });


  // メモは並び順に関わらず最下段に置く（結果文の締めとして読みやすいため）
  var memoIdx = out.findIndex(function (o) { return o.kind === 'row' && o.isMemo; });
  if (memoIdx >= 0) out.push(out.splice(memoIdx, 1)[0]);

  // 中身が1つも無い見出しは出さない（結果文が見出しだらけになるのを防ぐ）。空白行は中身に数えない。
  var kept = out.filter(function (item, i) {
    if (item.kind !== 'heading') return true;
    for (var j = i + 1; j < out.length; j++) {
      if (out[j].kind === 'blank') continue;
      if (out[j].kind === 'heading') return false;
      return true;
    }
    return false;
  });
  return _hrTrimBlanks(kept);
}

/**
 * 空白行の整理：先頭・末尾の空白行と、連続する空白行は1つにまとめて取り除く。
 * （見出しや項目が表示されないとき、空行だけが残らないようにする）
 */
function _hrTrimBlanks(list) {
  var res = [];
  list.forEach(function (it) {
    if (it.kind === 'blank' && (!res.length || res[res.length - 1].kind === 'blank')) return;
    res.push(it);
  });
  while (res.length && res[res.length - 1].kind === 'blank') res.pop();
  return res;
}
window.buildHearingLines = buildHearingLines;

function renderHearingSummary() {
  var area = document.getElementById('hearingSummaryArea');
  if (!area) return;
  var items = buildHearingLines(hearingState);
  if (!items.length) { area.innerHTML = ''; return; }

  var hasPolicy = items.some(function (it) { return it.kind === 'policy'; });
  var h = '<div class="hr-summary"><div class="hr-summary-title">📋 ヒアリング内容</div><div class="hr-summary-rows">';
  items.forEach(function (it) {
    if (it.kind === 'policy') return;   // 対応方針は下にまとめて出す
    if (it.kind === 'blank') { h += '<div class="hr-summary-blank"></div>'; return; }
    if (it.kind === 'heading') {
      var hpf = (typeof it.prefix === 'string') ? it.prefix : window.getHearingDefaultPrefix();
      h += '<div class="hr-summary-heading">' + escHtml(hpf ? hpf + ' ' : '') + (it.textHtml || escHtml(it.text)) + '</div>';
      return;
    }
    // ログ作成補助は項目名を出さず、ボタン名＋本文だけを見せる
    if (it.logOnly) {
      h += '<div class="hr-summary-row hr-summary-block">' +
           '<span class="hr-sum-val hr-sum-multiline">' +
           (it.htmlValue ? it.htmlValue : escHtml(it.value).replace(/\n/g, '<br>')) + '</span></div>';
      return;
    }
    // 出力文が設定されている項目は、文章そのものを1行で見せる
    if (it.outTpl && window.hearingHasSlot(it.outTpl)) {
      h += '<div class="hr-summary-row hr-summary-sentence">' +
           '<span class="hr-sum-val">' + (it.outTplHtml
             ? window.hearingFillSlotHtml(it.outTplHtml, escHtml(it.value))
             : escHtml(window.hearingFillSlot(it.outTpl, it.value))) + '</span></div>';
      return;
    }
    var valClass = 'hr-sum-val';
    if (it.type === 'yes') valClass += ' hr-sum-yes';
    if (it.type === 'no')  valClass += ' hr-sum-no';
    // メモなど複数行の内容は、改行をそのまま見せる
    var val = escHtml(it.value);
    var block = (it.isMemo || it.multiline);
    if (block) { valClass += ' hr-sum-multiline'; val = val.replace(/\n/g, '<br>'); }
    // 画面の結果文とコピー結果を完全に一致させるため、出力名（未設定なら項目名）で出す
    var sumLabH = it.outLabelHtml || escHtml(it.outLabel);
    h += '<div class="hr-summary-row' + (block ? ' hr-summary-block' : '') + '">' +
         (sumLabH ? '<span class="hr-sum-label">' + sumLabH + '</span>' : '') +
         '<span class="' + valClass + '">' + val + '</span></div>';
  });
  h += '</div>';
  if (hasPolicy) {
    h += '<div id="hearingPolicyArea">';
    items.forEach(function (it) {
      if (it.kind !== 'policy') return;
      h += '<div class="hr-summary-policy"><span class="hr-policy-icon">📌</span>' +
           '<span class="hr-policy-text">対応方針：' + (it.htmlValue ? window.hearingSanitizeHtml(it.htmlValue) : escHtml(it.value).replace(/\n/g, '<br>')) + '</span></div>';
    });
    h += '</div>';
  }
  h += '</div>';
  area.innerHTML = h;
  if (hasPolicy) {
    setTimeout(function () {
      var pEl = document.getElementById('hearingPolicyArea');
      if (pEl && pEl.scrollIntoView) pEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }
}

window.copyHearingText = function () {
  var items = buildHearingLines(hearingState);
  var lines = items.map(_hrLineText);
  if (lines.length === 0) { _showHearingToast('コピーする内容がありません', true); return; }
  var text = lines.join('\n');
  var done = function () { _showHearingToast('ヒアリング内容をコピーしました', false); };

  // 書式（太字・色など）を付けた項目があるときは、HTML も一緒にコピーする。
  // 書式に対応した貼り付け先では書式つきで、対応しない所では今までどおり plain で入る。
  if (items.some(_hrLineIsRich) &&
      window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    var html = items.map(_hrLineHtml).join('<br>');
    var plainOnly = function () {
      try { navigator.clipboard.writeText(text).then(done, function () { _fallbackCopy(text); done(); }); }
      catch (e) { _fallbackCopy(text); done(); }
    };
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html':  new Blob([html],  { type: 'text/html' })
      })]).then(done, plainOnly);
      return;
    } catch (e) { /* 下の plain へ */ }
  }
  // 2回目以降も必ず動くよう、失敗時は毎回 fallback に落とす
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      navigator.clipboard.writeText(text).then(done, function () { _fallbackCopy(text); done(); });
    } catch (e) { _fallbackCopy(text); done(); }
  } else {
    _fallbackCopy(text);
    done();
  }
};

function _showHearingToast(msg, isError) {
  var toast = document.getElementById('hearingCopyToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'hearing-copy-toast show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { toast.className = 'hearing-copy-toast'; }, 2000);
}

window.renderHearing = renderHearing;

// =============================================================================
// ⑦ キーボードナビゲーション（変更なし）
// =============================================================================
document.addEventListener('keydown', function (e) {
  var key = e.key;
  var focused = document.activeElement;
  if (key === 'Enter') {
    if (focused && focused !== document.body) {
      if (focused.tagName === 'BUTTON' || focused.getAttribute('role') === 'button' ||
          focused.classList.contains('sb-item') || focused.classList.contains('script-list-item') ||
          focused.classList.contains('step-choice-btn') || focused.classList.contains('suggest-item')) {
        focused.click(); e.preventDefault(); return;
      }
    }
  }
  var searchBox  = document.getElementById('searchBox');
  var suggestBox = document.getElementById('suggestBox');
  if (focused === searchBox && suggestBox && suggestBox.style.display !== 'none') {
    var items   = suggestBox.querySelectorAll('.suggest-item');
    var current = suggestBox.querySelector('.suggest-item.kb-focus');
    var idx = -1;
    items.forEach(function (el, i) { if (el === current) idx = i; });
    if (key === 'ArrowDown') { e.preventDefault(); if (current) current.classList.remove('kb-focus'); var next = items[Math.min(idx + 1, items.length - 1)]; next.classList.add('kb-focus'); next.scrollIntoView({ block: 'nearest' }); return; }
    if (key === 'ArrowUp') { e.preventDefault(); if (current) current.classList.remove('kb-focus'); if (idx > 0) { var prev = items[idx - 1]; prev.classList.add('kb-focus'); prev.scrollIntoView({ block: 'nearest' }); } return; }
    if (key === 'Enter') { e.preventDefault(); if (current) { current.click(); return; } if (items.length > 0) { items[0].click(); return; } }
  }
  if (key === 'ArrowLeft') {
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) return;
    var backBtn = document.querySelector('.step-back-btn');
    if (backBtn) { e.preventDefault(); backBtn.click(); return; }
    if (typeof goBack === 'function') { e.preventDefault(); goBack(); }
    return;
  }
  if (key === 'ArrowRight') {
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) return;
    if (typeof goForward === 'function') { e.preventDefault(); goForward(); }
    return;
  }
});

(function () {
  if (document.getElementById('_cuKbCSS')) return;
  var style = document.createElement('style');
  style.id = '_cuKbCSS';
  style.textContent =
    '.suggest-item.kb-focus { background: var(--accent-lt) !important; }' +
    '.script-list-item:focus { outline: 2px solid #3742fa; outline-offset: -2px; }' +
    '.step-choice-btn:focus { outline: 2px solid #3742fa; border-color: var(--accent); background: #f0f4ff; }' +
    '.sb-acc-header:focus { outline: 2px solid #3742fa; outline-offset: -2px; }' +
    '.sb-item:focus { outline: 2px solid #3742fa; outline-offset: -2px; }' +
    '.hr-btn:focus, .hr-device-btn:focus { outline: 2px solid #3742fa; }' +
    // ── ■デバイス（1グループのトグルボタン） ──
    '.hr-device-btn { display:inline-block; height:26px; padding:0 12px; margin-right:6px; border:1px solid var(--border,#dfe4ea); border-radius:14px; background:var(--surface2,#f1f2f6); color:var(--text2,#57606f); font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; transition:background .12s,border-color .12s,color .12s; }' +
    '.hr-device-btn.active { background:var(--accent,#3742fa); border-color:var(--accent,#3742fa); color:#fff; }' +
    '.hr-device-row { flex-direction:row !important; align-items:center; gap:6px; padding:1px 0; }' +
    '.hr-device-row .hr-label { flex:0 0 74px; min-width:74px; font-size:10px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
    '.hr-device-row .hr-btns { display:flex; flex:1; min-width:0; align-items:center; flex-wrap:wrap; gap:3px; }' +
    '.hr-device-row .hr-device-btn { height:22px; padding:0 8px; margin-right:0; font-size:10px; border-radius:4px; }' +
    '.hr-device-group { display:flex; flex-direction:column; gap:2px; padding:5px 7px; background:var(--surface2,#f1f2f6); border:1px solid var(--border,#dfe4ea); border-radius:6px; }' +
    // ── メモ欄 ──
    // 縦並びの行で flex-start にすると、中身の幅が内容に縮んでしまう（記述の入力欄より細くなる）。
    // 記述と同じく行いっぱいに広げる。
    '.hr-memo-row { align-items: stretch !important; }' +
    // 1行から始めて内容に合わせて伸ばす。プレースホルダは行の中央に見せる
    '.hr-autogrow { min-height:32px; height:32px; overflow-y:hidden; resize:none; line-height:1.6; padding:6px 9px; }' +
    // メモは他の入力欄と同じ幅にそろえる（1行始まりだと細く見えるため）
    '.hr-memo-row .hr-btns { flex:1; min-width:0; width:100%; }' +
    // メモ・記述・プルダウン・手入力欄の幅をそろえる
    '.hr-row .hr-btns { flex:1; min-width:0; }' +
    '.hr-row .hr-text-input, .hr-row .hr-select { width:100%; box-sizing:border-box; }' +
    // メモ・記述・プルダウン・手入力欄をすべて同じ幅にそろえる
    '.hr-row .hr-btns > div { width:100%; }' +
    '.hr-row .hr-btns > div > .hr-text-input { width:100%; box-sizing:border-box; }' +
    '.hr-log-group { display:flex; flex-direction:column; align-items:flex-start; gap:6px; }' +
    // ログ作成補助の中の項目：ボタンの下に、左に線を引いて続ける
    '.hr-log-children, .hr-nested-children { display:flex; flex-direction:column; gap:4px; margin-top:6px; padding:4px 0 2px 10px; border-left:3px solid var(--accent-lt,#dfe3ff); }' +
    '.hr-log-children > .hr-row, .hr-nested-children > .hr-row { padding:4px 0 !important; border:none !important; background:none !important; }' +
    // 空白行：枠も余白も持たない、ただの空き
    '.hr-spacer-row { padding:0 !important; border:none !important; background:none !important; min-height:0 !important; box-shadow:none !important; }' +
    '.hr-spacer { height:14px; }' +
    // チェック＋数量
    '.hr-qtycheck-group { display:flex; flex-direction:column; gap:6px; align-items:stretch; }' +
    '.hr-qtycheck-row { display:flex; align-items:flex-start; gap:6px; font-size:13px; cursor:pointer; }' +
    '.hr-qtycheck-row input { margin-top:3px; width:15px; height:15px; flex:0 0 auto; cursor:pointer; }' +
    '.hr-summary-blank { height:8px; }' +
    '.hr-log-row .hr-btns { flex:1; min-width:0; }' +
    '.hr-log-btn { height:28px; padding:0 12px; border:1px solid var(--accent,#3742fa);' +
      'border-radius:6px; background:var(--accent-lt,#eef0ff); color:var(--accent-text,#3742fa);' +
      'font-size:12px; font-family:inherit; cursor:pointer; white-space:nowrap; }' +
    '.hr-log-btn:hover { background:var(--accent,#3742fa); color:#fff; }' +
    '.hr-log-btn.active { background:var(--accent,#3742fa); color:#fff; font-weight:700; }' +
    '.hr-memo-clear { margin-left:10px; height:20px; padding:0 10px; vertical-align:middle;' +
      'border:1px solid var(--border); border-radius:4px; background:var(--surface);' +
      'color:var(--text3); font-size:10px; font-family:inherit; cursor:pointer; }' +
    '.hr-memo-clear:hover { border-color:var(--red,#e63946); color:var(--red,#e63946); }' +
    // 見出しでまとめた項目の縦間隔を少し広げる
    '.hr-group .hr-row { padding-top:7px; padding-bottom:7px; }' +
    // トグルの中項目：名前は折り返さず、なるべく1行で表示する。
    //   名前の列は、いちばん長い名前に合わせた幅にする（全行でボタンの位置がそろう）。
    //   ただし列が広がりすぎてボタンが窮屈にならないよう、グループの幅の 55% までとし、
    //   それを超える長さのときだけ折り返す。
    '.hr-device-row .hr-label { flex:0 0 auto; min-width:0; max-width:55%; overflow:visible; text-overflow:clip; white-space:normal; word-break:break-word; }' +
    '@supports (grid-template-columns: subgrid) {' +
      '.hr-device-group { display:grid; grid-template-columns:fit-content(55%) minmax(0,1fr); column-gap:8px; row-gap:2px; }' +
      '.hr-device-group > .hr-device-row { grid-column:1 / -1; display:grid !important; grid-template-columns:subgrid; align-items:center; }' +
      '.hr-device-row .hr-label { max-width:none; }' +
    '}' +
    '.hr-memo-row .hr-autogrow, .hr-row .hr-btns > .hr-autogrow { width:100%; box-sizing:border-box; }' +
    '.hr-sum-multiline { white-space:pre-wrap; word-break:break-word; }' +
    // 複数選択は縦並び（横に並ぶと選択済みが分かりにくいため）
    '.hr-choice-vertical .hr-radio-group,.hr-choice-vertical { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }' +
    '.hr-summary-block { align-items:flex-start; }' +
    '.hr-memo-textarea { width:100%; min-height:60px; resize:vertical; padding:7px 9px; border:1px solid var(--border,#dfe4ea); border-radius:6px; font-family:inherit; font-size:12px; background:var(--bg,#f1f2f6); color:var(--text,#2f3542); line-height:1.6; transition:border-color .15s; }' +
    '.hr-memo-textarea:focus { outline:none; border-color:var(--accent,#3742fa); }';
  document.head.appendChild(style);
})();

// =============================================================================
// ⑧ DOMContentLoaded：サイドメニュー描画 & 各種初期化
// =============================================================================
document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('_smDarkCSS')) {
    var st = document.createElement('style');
    st.id = '_smDarkCSS';
    st.textContent =
      '.dark-toggle-sw{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}' +
      '.dark-toggle-sw input{opacity:0;width:0;height:0}' +
      '.dark-toggle-sl{position:absolute;cursor:pointer;inset:0;background:#ccc;border-radius:24px;transition:.3s}' +
      '.dark-toggle-sl:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}' +
      'input:checked+.dark-toggle-sl{background:#5c6afc}' +
      'input:checked+.dark-toggle-sl:before{transform:translateX(20px)}';
    document.head.appendChild(st);
  }

  var m = document.getElementById('sideMenu');
  if (m) {
    var saved  = localStorage.getItem('darkMode');
    var isDark = saved === '1';
    m.innerHTML = _buildSideMenuHTML(isDark);
    window.renderHistory();
    window.addEventListener('storage', function (e) {
      if (e.key === 'updateHistory') window.renderHistory();
      if (e.key === 'sideMenuData') {
        var isDarkNow = localStorage.getItem('darkMode') === '1';
        m.innerHTML = _buildSideMenuHTML(isDarkNow);
        window.renderHistory();
      }
    });
  }

  _injectQuickCopy();
  window.renderQuickMenu();   // 差し込みが無ければ何もしない
  // 定型文はここで差し込まれるページがあるので、並べ直す
  if (typeof _orderHeader === 'function') _orderHeader();

  if (document.getElementById('hearingContent')) renderHearing();

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.quick-copy-area')) {
      var qm = document.getElementById('quickMenu');
      if (qm) qm.classList.remove('open');
    }
    var btn = document.getElementById('menuBtn');
    if (m && !m.contains(e.target) && btn && e.target !== btn && !btn.contains(e.target)) {
      m.classList.remove('open');
    }
  });
});

// JSON の D&D インポートは廃止した。
// 管理画面が data.js を直接書き出すようになり、受け渡しが不要になったため。

// =============================================================================
// ⑧ サイドバー JS制御フォーカスマネージャー
//    ブラウザネイティブ focus に依存しない永続的なフォーカス表示。
//    どこをクリックしても最後に触ったサイドバー要素の青枠を保持し、
//    Esc キーのみで解除する。
//    使用方法:
//      sbFocusSet(id)     … 指定IDの要素にフォーカスを移す
//      sbFocusRestore()   … DOM再構築後に前回フォーカスを復元する
// =============================================================================
(function () {
  var _focusId = null;

  window.sbFocusSet = function (id) {
    // 旧フォーカスを解除
    if (_focusId) {
      var old = document.getElementById(_focusId);
      if (old) old.classList.remove('sb-js-focus');
    }
    _focusId = id || null;
    // 新しい要素に付与
    if (_focusId) {
      var el = document.getElementById(_focusId);
      if (el) el.classList.add('sb-js-focus');
    }
  };

  // DOM再構築後に前回フォーカスを復元する（renderSidebar の末尾で呼ぶ）
  window.sbFocusRestore = function () {
    if (!_focusId) return;
    var el = document.getElementById(_focusId);
    if (el) el.classList.add('sb-js-focus');
  };

  // Esc キーでフォーカスを解除
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.sbFocusSet(null);
  });
})();

// =============================================================================
// ⑨ 共通インポートプログレスオーバーレイ
//    admin.html の _importProgressShow/Update/Hide と同一 API。
//    index.html / mail.html / screen.html で D&D JSON インポート時に表示する。
// =============================================================================
(function () {
  var _el = null;

  function _ensure() {
    if (_el) return _el;
    // CSS
    var style = document.createElement('style');
    style.textContent = [
      '#_impProg{display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);align-items:center;justify-content:center}',
      '#_impProg.show{display:flex}',
      '#_impProgBox{background:var(--surface,#fff);border-radius:12px;padding:24px 28px;min-width:300px;max-width:440px;width:88vw;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}',
      '#_impProgLbl{font-size:13px;font-weight:700;color:var(--text,#222)}',
      '#_impProgSub{font-size:11px;color:var(--text3,#888);margin-top:-6px;min-height:15px}',
      '#_impProgTrack{width:100%;height:6px;background:var(--surface2,#eee);border-radius:3px;overflow:hidden}',
      '#_impProgBar{height:100%;width:0%;background:var(--accent,#3742fa);border-radius:3px;transition:width .15s ease}'
    ].join('');
    document.head.appendChild(style);
    // HTML
    _el = document.createElement('div');
    _el.id = '_impProg';
    _el.innerHTML = '<div id="_impProgBox">'
      + '<div id="_impProgLbl">読み込み中…</div>'
      + '<div id="_impProgSub"></div>'
      + '<div id="_impProgTrack"><div id="_impProgBar"></div></div>'
      + '</div>';
    document.body.appendChild(_el);
    return _el;
  }

  window._importProgressShow = function (label, sub, pct) {
    _ensure().classList.add('show');
    window._importProgressUpdate(label, sub, pct);
  };
  window._importProgressUpdate = function (label, sub, pct) {
    _ensure();
    var l = document.getElementById('_impProgLbl');
    var s = document.getElementById('_impProgSub');
    var b = document.getElementById('_impProgBar');
    if (l) l.textContent = label || '';
    if (s) s.textContent = sub   || '';
    if (b) b.style.width = Math.min(100, Math.max(0, pct || 0)) + '%';
  };
  window._importProgressHide = function () {
    var el = document.getElementById('_impProg');
    if (el) el.classList.remove('show');
  };
})();

// =============================================================================
// ⑩ 画面遷移データの IDB 書き込み（index.html / mail.html 用）
//    screen.html / admin.html では各ページで定義された関数が優先される。
//    共通の _appIdbOpen を使い、独立した DB 接続を作らない。
// =============================================================================
(function () {
  if (typeof idbSetScreenData === 'function') return; // 既に定義済みならスキップ

  var IDB_STORE = 'patterns';
  var IDB_KEY   = 'data';

  window.idbSetScreenData = function (data) {
    if (!data) return Promise.resolve();
    // imageLib の先行保存（v3: _pendingImgLib が設定されている場合）
    var pendingLib = window._pendingImgLib;
    window._pendingImgLib = null;

    var libP = Promise.resolve();
    if (pendingLib && pendingLib.length) {
      libP = _appIdbOpen().then(function(db) {
        return new Promise(function(resolve) {
          var tx  = db.transaction('imageLib', 'readonly');
          var req = tx.objectStore('imageLib').getAllKeys();
          req.onsuccess = function(e) {
            var existing = new Set(e.target.result || []);
            var toInsert = pendingLib.filter(function(x){ return !existing.has(x.id); });
            if (!toInsert.length) { resolve(); return; }
            var tx2 = db.transaction('imageLib', 'readwrite');
            toInsert.forEach(function(item){ tx2.objectStore('imageLib').put(item, item.id); });
            tx2.oncomplete = resolve;
            tx2.onerror    = resolve;
          };
          req.onerror = function(){ resolve(); };
        });
      });
    }

    return libP.then(function() {
      return _appIdbOpen().then(function(db) {
        return new Promise(function(resolve, reject) {
          var tx  = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(data, IDB_KEY);
          tx.oncomplete = resolve;
          tx.onerror    = function(e){ reject(e.target.error); };
        });
      });
    });
  };
})();

// =============================================================================
// ⑪ BroadcastChannel 受信リスナー（admin.html / 他ページからのリアルタイム反映）
// =============================================================================

/**
 * IndexedDB の内容を _appCache へ読み直す（値が無いキーは触らない）。
 * 管理画面が保存した最新の内容を、開いているページに取り込むために使う。
 */
window.refreshAppCacheFromIDB = function (keys) {
  if (!window.idbGetAppData) return Promise.resolve();
  return Promise.all((keys || []).map(function (k) {
    return window.idbGetAppData(k).catch(function () { return null; });
  })).then(function (vals) {
    (keys || []).forEach(function (k, i) { if (vals[i] != null) window._appCache[k] = vals[i]; });
  });
};
(function() {
  var _rxBc;
  try { _rxBc = new BroadcastChannel('tool_data_update'); } catch(e) { return; }

  // 管理画面が保存した内容は IndexedDB に入っている。このページのキャッシュ（_appCache）は
  // 読み込み時のままで古いので、通知を受けたら IndexedDB から読み直してから描き直す。
  // （以前はキャッシュをそのまま使っていて、保存しても開いているページの表示が変わらなかった）
  var HEARING_KEYS = ['hearingQuestions', 'hearingPolicies', 'hearingPatterns', 'hearingTemplates', 'hearingLabelPrefix'];
  var call = function (name) { if (typeof window[name] === 'function') { try { window[name](); } catch (e) {} } };

  /** 通知の種類ごとの「読み直し＋描き直し」 */
  var reloaders = {
    mail: function () {
      // mail.html が reloadMail（IndexedDB を読み直して描き直す）を持つ
      return window.refreshAppCacheFromIDB(['mailTemplates', 'mailCatMeta']).then(function () { call('reloadMail'); });
    },
    faq: function () {
      return window.refreshAppCacheFromIDB(['faqData']).then(function () { call('reloadFaq'); });
    },
    hearing: function () {
      return window.refreshAppCacheFromIDB(HEARING_KEYS).then(function () { call('renderHearing'); });
    },
    history: function () {
      return window.refreshAppCacheFromIDB(['updateHistory']).then(function () { call('renderHistory'); });
    },
    screen: function () {
      // screen.html: IndexedDB の最新のパターンを読み直す。
      // idbGetScreenData() は読み込み時の data.js の内容を先に返すので使わず、生の読み取りを使う。
      // （また、返ってきた配列が patterns そのものだと、空にしたとき中身まで消えるので、複製してから入れ替える）
      var rawReader = (typeof _idbGetScreenDataRaw === 'function') ? _idbGetScreenDataRaw
                    : (typeof idbGetScreenData === 'function' ? idbGetScreenData : null);
      if (!rawReader) return Promise.resolve();
      return rawReader().then(function (data) {
        if (!Array.isArray(data) || !data.length) return;
        if (typeof patterns !== 'undefined') {
          var fresh = data.slice();
          patterns.length = 0;
          fresh.forEach(function (p) { patterns.push(p); });
          // 表示キャッシュをクリア
          if (typeof _pvImgCache !== 'undefined') { Object.keys(_pvImgCache).forEach(function (k) { delete _pvImgCache[k]; }); }
          if (typeof renderSidebar === 'function') renderSidebar();
          if (typeof renderFlow    === 'function') renderFlow();
        }
      }).catch(function () {});
    },
    sideMenu: function () {
      return window.refreshAppCacheFromIDB(['sideMenuData']).then(function () {
        var el = document.getElementById('sideMenu');
        if (el) {
          el.innerHTML = _buildSideMenuHTML(localStorage.getItem('darkMode') === '1');
          window.renderHistory();
        }
      });
    }
  };

  // 管理画面は、自分が保存した通知を自分でも受け取る（同じページ内の別の BroadcastChannel から届く）。
  // 管理画面は編集中の内容を自分で持っているので、IndexedDB から読み直して差し替えたり、
  // 入力中のフォームを描き直したりしない。
  var ADMIN_SKIP = { scriptsUpdated: 1, mailDataUpdated: 1, faqUpdated: 1, screenDataUpdated: 1,
                     historyUpdated: 1, noticeUpdated: 1, hearingUpdated: 1 };

  _rxBc.onmessage = function(ev) {
    var type = ev.data && ev.data.type;
    var isAdminPage = !!(document.body && document.body.classList.contains('page-admin'));
    if (isAdminPage && ADMIN_SKIP[type]) return;
    if (isAdminPage && type === 'allDataUpdated') {
      // 従来どおり（管理画面ではヒアリングの描き直しと、スクリプト・メールのキャッシュ更新だけ）
      call('renderHearing');
      window.refreshAppCacheFromIDB(['scripts', 'mailTemplates']);
      return;
    }

    // ── スクリプトデータ更新 ──
    if (type === 'scriptsUpdated') {
      // script.html の reloadScripts 関数があれば呼ぶ
      call('reloadScripts');
    }

    // ── メールデータ更新 ──
    if (type === 'mailDataUpdated') reloaders.mail();

    // ── FAQ 更新 ──
    if (type === 'faqUpdated') {
      if (ev.data.data) { window._appCache.faqData = ev.data.data; call('reloadFaq'); }
      else reloaders.faq();
    }

    // ── 画面遷移データ更新 ──
    if (type === 'screenDataUpdated') reloaders.screen();

    // ── サイドメニュー更新 ──
    if (type === 'sideMenuUpdated') {
      if (ev.data && ev.data.data) {
        window._appCache.sideMenuData = ev.data.data;
        window.idbSetAppData('sideMenuData', ev.data.data);
      }
      var sideMenuEl = document.getElementById('sideMenu');
      if (sideMenuEl) {
        var isDarkNow = localStorage.getItem('darkMode') === '1';
        sideMenuEl.innerHTML = _buildSideMenuHTML(isDarkNow);
        window.renderHistory();
      }
    }

    // ── 更新履歴 ──
    if (type === 'historyUpdated') {
      if (Array.isArray(ev.data.data)) { window._appCache.updateHistory = ev.data.data; call('renderHistory'); }
      else reloaders.history();
    }

    // ── お知らせ（ホーム） ──
    if (type === 'noticeUpdated') {
      if (ev.data.data != null) window._appCache.notice = String(ev.data.data);
      if (ev.data.date != null) {
        window._appCache.noticeDate = String(ev.data.date);
        // getNoticeDate() は読み込み時に設定した APP_NOTICE_DATE を先に見るので、こちらも更新する
        window.APP_NOTICE_DATE = window._appCache.noticeDate;
      }
      call('renderNotice');
    }

    // ── 全データ更新（どのページからのインポートでも全タブに反映） ──
    if (type === 'allDataUpdated') {
      call('reloadScripts');
      window.refreshAppCacheFromIDB(['fixedTexts', 'notice', 'noticeDate']).then(function () { call('renderNotice'); });
      reloaders.mail();
      reloaders.faq();
      reloaders.hearing();
      reloaders.history();
      reloaders.sideMenu();
      reloaders.screen();
    }

    // ── 画像ライブラリ更新 ──
    if (type === 'imageLibUpdated') {
      // screen.html / admin.html の画像キャッシュをクリア
      try { if (typeof _pvImgCache !== 'undefined') { Object.keys(_pvImgCache).forEach(function(k){ delete _pvImgCache[k]; }); } } catch(e) {}
      try { if (typeof _imgLibAllItems !== 'undefined') { _imgLibAllItems = []; if (typeof _imgLibRender === 'function') _imgLibRender(); } } catch(e) {}
    }

    // ── ヒアリング更新 ──
    if (type === 'hearingUpdated') reloaders.hearing();
  };
})();
// =============================================================================
// ⑫ プロファイルの選択モーダル／ヘッダーの切り替えボタン（⓪-P の画面部分）
//   ・データファイルが複数あり、このウィンドウで未選択のときだけ選択モーダルを出す。
//   ・ヘッダーの［🗂 プロファイル名］からいつでも手動で切り替えられる。
//   ・切り替えると、同じウィンドウ（このタブから開いたタブ群）もそろって切り替わる。
//
//   【検出は「いま開いているツールのフォルダ」を基準にする】
//   file:// ではフォルダの中身をページから直接読むことができない（fetch・XHR・iframe
//   いずれもブラウザが拒否する）。そこで、候補のファイル名を集めたうえで、
//   1件ずつ「開いているフォルダから実際に読み込めるか」を確かめ（probe）、
//   読み込めたものだけを一覧にする。別のフォルダにあるファイルが混ざることはない。
//   候補のファイル名の集め方：
//     ① 前回確かめた一覧（フォルダごとに保存）
//     ② ［📁 ツールのフォルダを選択］で選んだフォルダの中身（選んだフォルダは覚えておき、
//        権限が有効な間は開くたびに自動で調べる）
//     ③ 管理画面で接続したフォルダの中身（名前の手がかりとしてだけ使う。①②と同じく必ず確かめる）
//     ④ ［📄 ファイルを指定］で選んだファイル名
// =============================================================================
(function () {
  var AP = window.AppProfile, P = window.APP_PROFILE;
  if (!AP || !P) return;

  var modal = null;          // 表示中のモーダル要素
  var required = false;      // 選ぶまで閉じられないモード
  var message = '';          // モーダル内のお知らせ
  var busy = false;          // 検出・確認の処理中

  var TOOL_DIR_KEY = 'profileToolDir:' + (AP.FOLDER || '');   // 選んだツールのフォルダ（共通 DB）
  var PROBE_KEY    = 'appProfileProbe';                       // 確認結果（このタブの間だけ）

  var chan = null;           // ウィンドウ内のタブへ切り替えを伝える（'tool_data_update' とは別）
  try { chan = new BroadcastChannel('tool_profile'); } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uniq(a) {
    var seen = {}, out = [];
    (a || []).forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function fsSupported() {
    if (window.AppFS && typeof window.AppFS.isSupported === 'function') return window.AppFS.isSupported();
    return typeof window.showDirectoryPicker === 'function';
  }

  /** 画面ごとの「いま再読み込みしてよいか」（管理画面は未保存があれば false を返す） */
  function canAutoReload() {
    try {
      if (typeof window.appProfileCanAutoReload === 'function') return window.appProfileCanAutoReload() !== false;
    } catch (e) {}
    return true;
  }

  // ── 開いているフォルダにあるかの確認（probe）──
  function probeCache() {
    try { var v = JSON.parse(sessionStorage.getItem(PROBE_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function probeCacheSet(file, ok) {
    var c = probeCache(); c[file] = ok;
    try { sessionStorage.setItem(PROBE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  /**
   * file が「いま開いているツールのフォルダ」にありそうかを確かめる。
   * @param force 使わない（過去の確認結果に関わらず isDataFile だけで判断するため）
   * @return Promise<boolean>
   *
   * 以前は、見えない iframe の中で実際に読み込めるかまで確かめていた。
   * ただし、この確認自体が file:// のセキュリティ制限（'file:' URLs are treated as
   * unique security origins）に阻まれて失敗する環境があり、実際には正しく読み込める
   * ファイルまで「読み込めない」と誤判定し、既に表示できていたデータまで巻き込んで
   * 無効化してしまう不具合があった。
   * 実際に読み込めるかどうかは、選ばれたときに <script src="..."> で本読み込みするときの
   * onerror（_loadFailed）で確実に分かるため、ここでの事前確認はやめ、
   * ファイル名の形（isDataFile）だけで候補として扱うようにした。
   */
  function probe(file, force) {
    return Promise.resolve(AP.isDataFile(file));
  }
  /** 複数を確かめて、読み込めたものだけ返す */
  function probeAll(files, force) {
    files = uniq((files || []).filter(AP.isDataFile));
    return Promise.all(files.map(function (f) { return probe(f, force); })).then(function (oks) {
      return {
        found:   files.filter(function (f, i) { return oks[i]; }),
        missing: files.filter(function (f, i) { return !oks[i]; })
      };
    });
  }

  // ── 候補のファイル名を集める ──
  function listDir(dir) {
    return (async function () {
      var names = [];
      for await (var entry of dir.values()) { if (entry.kind === 'file') names.push(entry.name); }
      return names;
    })();
  }
  /** ② 以前に選んだツールのフォルダ（読み取り権限があるときだけ） */
  function namesFromToolDir() {
    if (!fsSupported() || !window.idbGetSharedData) return Promise.resolve([]);
    return window.idbGetSharedData(TOOL_DIR_KEY).then(function (dir) {
      if (!dir || typeof dir.values !== 'function') return [];
      var q = dir.queryPermission ? dir.queryPermission({ mode: 'read' }) : Promise.resolve('granted');
      return Promise.resolve(q).then(function (p) { return p === 'granted' ? listDir(dir) : []; });
    }).catch(function () { return []; });
  }
  /** ③ 管理画面で接続したフォルダ（手がかりとしてだけ使う） */
  function namesFromConnected() {
    var FS = window.AppFS;
    if (!FS || !FS.isSupported()) return Promise.resolve([]);
    return FS.status().then(function (s) {
      return s === 'granted' ? FS.listFiles('') : [];
    }).catch(function () { return []; });
  }

  /**
   * 自動の検出（ページを開いたとき）。操作なしでできる範囲で候補を集め、
   * 開いているフォルダにあるものだけを一覧にする。
   */
  function detectAuto() {
    return Promise.all([namesFromToolDir(), namesFromConnected()]).then(function (r) {
      var hints = (r[0] || []).concat(r[1] || []).filter(AP.isDataFile);
      // 標準の data.js は名前が決まっているので、手がかりが無くても必ず確かめる
      var cands = uniq(hints.concat(AP.readList(), [AP.DEFAULT_FILE], P.loaded ? [P.file] : []));
      return probeAll(cands, false).then(function (res) {
        AP.writeList(res.found);        // 開いているフォルダで確かめたものだけを保存する
        return res.found;
      });
    }).catch(function () { return null; });
  }

  /** ［📁 ツールのフォルダを選択］：選んだフォルダの中身を、開いているフォルダと照合する */
  function pickToolDir() {
    if (typeof window.showDirectoryPicker !== 'function') return Promise.resolve(null);
    return window.showDirectoryPicker({ id: 'profileToolDir', mode: 'read' }).then(function (dir) {
      return listDir(dir).then(function (names) {
        var cands = names.filter(AP.isDataFile);
        return probeAll(cands, true).then(function (res) {
          var hasTool = names.some(function (n) { return String(n).toLowerCase() === 'common-utils.js'; });
          if (!hasTool || (cands.length && !res.found.length)) {
            message = '選んだフォルダ（' + dir.name + '）は、いま開いているツールのフォルダではないようです。'
              + 'このページ（' + (AP.PAGE || 'HTML') + '）があるフォルダを選んでください。';
            return null;
          }
          // 開いているツールのフォルダと確認できたので覚えておく（次からは自動で調べる）
          if (window.idbSetSharedData) window.idbSetSharedData(TOOL_DIR_KEY, dir).catch(function () {});
          if (!cands.length) {
            message = 'このフォルダにプロファイル（data.js で終わるファイル）が見つかりません。';
          } else if (res.missing.length) {
            message = '「' + res.missing.join('」「') + '」は読み込めなかったため、候補から外しました。';
          } else {
            message = res.found.length + ' 件のプロファイルが見つかりました。';
          }
          // 選んだフォルダ＝開いているフォルダの中身なので、一覧をそのまま置き換える
          return AP.writeList(res.found);
        });
      });
    }).catch(function (e) {
      if (!(e && e.name === 'AbortError')) message = 'フォルダを読み取れませんでした。';
      return null;
    });
  }

  /** 表示用の候補一覧 */
  function candidates() {
    if (P.loaded && P.file && AP.readList().indexOf(P.file) < 0) AP.writeList(AP.readList().concat([P.file]));
    var bad = AP.readBad();
    return AP.readList().filter(function (f) { return bad.indexOf(f) < 0 || (P.loaded && f === P.file); });
  }

  // ── 切り替え ──
  function switchTo(file) {
    if (!AP.isDataFile(file)) return;
    AP.removeBad(file);                          // 利用者が選んだものは、もう一度試す
    AP.writeSel(file, 'user');
    if (P.loaded && file === P.file) { P.how = 'user'; closeModal(); return; }
    try { if (chan) chan.postMessage({ type: 'switch', group: P.group, file: file }); } catch (e) {}
    P.reloading = true;
    location.reload();
  }

  if (chan) chan.onmessage = function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== 'switch' || d.group !== P.group || !AP.isDataFile(d.file)) return;
    AP.writeSel(d.file, 'user');                 // このタブの選択も合わせる（sessionStorage はタブごと）
    if (P.loaded && d.file === P.file) return;
    if (canAutoReload()) { P.reloading = true; location.reload(); }
    else showPendingBanner(d.file);
  };

  /** 未保存の変更があって自動で読み直せないときの案内 */
  function showPendingBanner(file) {
    var el = document.getElementById('profilePending');
    if (!el) {
      el = document.createElement('div');
      el.id = 'profilePending';
      el.className = 'profile-pending';
      document.body.appendChild(el);
    }
    el.innerHTML = '🗂 このウィンドウのプロファイルが「' + esc(AP.nameOf(file)) + '」に切り替えられました。'
      + '未保存の変更を保存してから再読み込みしてください。'
      + '<button type="button" class="profile-pending-btn">再読み込み</button>';
    el.querySelector('button').onclick = function () { location.reload(); };
  }

  /** 検出結果を受けて、必要ならモーダルを出す／自動で開き直す */
  function afterDetect(list, manual) {
    if (P.reloading) return;
    if (list) {
      updateBadge();                             // 件数でボタンの表示（アイコンのみ／名前）が変わる
      var bad = AP.readBad();
      var usable = list.filter(function (f) { return bad.indexOf(f) < 0; });
      if (!P.loaded) {
        if (usable.length === 1) {
          AP.writeSel(usable[0], 'auto');
          if (AP.autoReload()) return;
        }
        if (!usable.length && !message) message = 'このフォルダにプロファイル（data.js で終わるファイル）が見つかりません。';
        openModal(true);
        return;
      }
      // このウィンドウでまだ選んでいない（自動で開いた）のに複数見つかった → 選んでもらう
      if (usable.length >= 2 && P.how === 'auto' && !modal) { openModal(true); return; }
    }
    updateBadge();
    if (modal) render();
  }

  // ── モーダル ──
  function openModal(req) {
    required = !!req || !P.loaded;
    if (!document.body) return;
    var isNew = !modal;
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'profileModal';
      modal.className = 'profile-modal-backdrop';
      modal.addEventListener('click', onModalClick);
      document.body.appendChild(modal);
    }
    render();
    var cur = modal.querySelector('.profile-item.is-current') || modal.querySelector('.profile-item');
    if (cur) { try { cur.focus(); } catch (e) {} }
    // 開いたときに、一覧のファイルが今もフォルダにあるか確かめ直す（消えたものは外す）
    if (isNew && !busy) {
      var list = AP.readList();
      if (list.length) {
        probeAll(list, true).then(function (res) {
          if (res.missing.length) {
            AP.writeList(res.found);
            message = '「' + res.missing.join('」「') + '」は開いているフォルダに見つからないため、一覧から外しました。';
          }
          updateBadge();
          if (modal) render();
        });
      }
    }
  }

  function closeModal() {
    if (required && !P.loaded) return;
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null; required = false; message = '';
  }

  function render() {
    if (!modal) return;
    var list = candidates();
    var pickOk = typeof window.showDirectoryPicker === 'function' && fsSupported();
    var html = '<div class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">'
      + '<div class="profile-modal-head"><span id="profileModalTitle">🗂 プロファイルの選択</span>'
      + (required ? ''
          : '<button type="button" class="profile-modal-close" data-act="close" title="閉じる">✕</button>')
      + '</div>'
      + '<p class="profile-modal-lead">表示するデータ（プロファイル）を選んでください。<br>'
      + '選んだプロファイルは、このウィンドウを閉じるまで保持されます。</p>';

    // 一覧が無いまま標準（data.js）を試して見つからなかっただけのときは、エラーとしては出さない
    if (P.failed && P.failedFile && !(P.how === 'auto' && AP.isDefaultFile(P.failedFile))) {
      html += '<div class="profile-modal-msg is-error">「' + esc(P.failedFile) + '」を読み込めませんでした。'
        + 'HTML と同じフォルダにあるか確認してください。</div>';
    }
    if (message) html += '<div class="profile-modal-msg">' + esc(message) + '</div>';

    if (list.length) {
      html += '<div class="profile-modal-list">';
      list.forEach(function (f) {
        var isCur = P.loaded && f === P.file;
        html += '<button type="button" class="profile-item' + (isCur ? ' is-current' : '') + '" data-file="' + esc(f) + '">'
          + '<span class="profile-item-name">' + esc(AP.nameOf(f)) + '</span>'
          + '<span class="profile-item-file">' + esc(f) + '</span>'
          + (isCur ? '<span class="profile-item-tag">表示中</span>' : '')
          + '</button>';
      });
      html += '</div>';
    } else {
      html += '<div class="profile-modal-empty">プロファイルの一覧がありません。<br>'
        + 'ツールのフォルダを選ぶか、データファイル（◯◯data.js）を指定してください。</div>';
    }

    html += '<div class="profile-modal-foot">'
      + (pickOk ? '<button type="button" class="profile-foot-btn" data-act="detect"' + (busy ? ' disabled' : '') + '>'
          + (busy ? '⏳ 確認中…' : '📁 ツールのフォルダを選択') + '</button>' : '')
      + '<button type="button" class="profile-foot-btn" data-act="pick"' + (busy ? ' disabled' : '') + '>📄 ファイルを指定</button>'
      + '<input type="file" class="profile-file-input" accept=".js" multiple hidden>'
      + '</div>'
      + '<div class="profile-modal-note">※ いま開いているツールのフォルダ'
      + (AP.FOLDER ? '（' + esc(AP.FOLDER) + '）' : '') + 'にある「◯◯data.js」だけを表示します'
      + '（例：【NGH】data.js → NGH）。新しく追加したときは［'
      + (pickOk ? '📁 ツールのフォルダを選択' : '📄 ファイルを指定') + '］で読み込み直してください。</div>'
      + '</div>';
    modal.innerHTML = html;

    var input = modal.querySelector('.profile-file-input');
    if (input) input.addEventListener('change', function () {
      var names = [].map.call(input.files || [], function (f) { return f.name; }).filter(AP.isDataFile);
      if (!names.length) { message = '「data.js」で終わるファイルを選んでください。'; render(); return; }
      busy = true; message = ''; render();
      // 指定されたファイルも、開いているフォルダにあるかを確かめてから候補にする
      probeAll(names, true).then(function (res) {
        busy = false;
        if (res.found.length) AP.writeList(AP.readList().concat(res.found));
        if (res.missing.length) {
          message = '「' + res.missing.join('」「') + '」は、いま開いているツールのフォルダにありません。'
            + 'このフォルダにあるファイルを指定してください。';
        }
        if (res.found.length === 1 && !res.missing.length) { switchTo(res.found[0]); return; }
        updateBadge();
        render();
      });
    });
  }

  function onModalClick(e) {
    var t = e.target;
    if (t === modal) { if (!required) closeModal(); return; }   // 背景クリック
    var item = t.closest ? t.closest('.profile-item') : null;
    if (item) { switchTo(item.getAttribute('data-file')); return; }
    var btn = t.closest ? t.closest('[data-act]') : null;
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    if (act === 'close') { required = false; closeModal(); }
    else if (act === 'pick') { var inp = modal.querySelector('.profile-file-input'); if (inp) inp.click(); }
    else if (act === 'detect' && !busy) {
      busy = true; message = ''; render();
      pickToolDir().then(function (list) {
        busy = false;
        afterDetect(list, true);
        if (modal) render();
      });
    }
  }

  // モーダル表示中は、ページのショートカットキーなどを効かせない
  document.addEventListener('keydown', function (e) {
    if (!modal) return;
    if (e.key === 'Escape') {
      if (!required) closeModal();
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    if (!modal.contains(e.target)) { e.stopPropagation(); e.stopImmediatePropagation(); }
  }, true);

  // ── ヘッダーの切り替えボタン ──
  function updateBadge() {
    var b = document.getElementById('profileBadge');
    if (!b) return;
    var name = P.loaded ? P.name : '未選択';
    // プロファイルが標準の1つだけなら、ヘッダーを狭めないようアイコンだけにする
    var iconOnly = P.loaded && P.isDefault && AP.readList().length < 2;
    b.textContent = iconOnly ? '🗂' : '🗂 ' + name;
    b.classList.toggle('profile-badge-icon', iconOnly);
    b.title = 'プロファイル：' + name + (P.loaded ? '（' + P.file + '）' : '') + '\nクリックで切り替え';
  }

  function injectBadge() {
    if (document.getElementById('profileBadge')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'profileBadge';
    b.className = 'profile-badge';
    b.addEventListener('click', function () { message = ''; openModal(false); });
    var left = document.querySelector('header .hd-left');
    if (left) {
      left.appendChild(b);
      if (typeof _placeProfileBadge === 'function') _placeProfileBadge();   // ページごとの置き場所へ
    } else {
      var head = document.querySelector('header');
      if (!head) return;
      b.classList.add('profile-badge-home');
      head.appendChild(b);                  // ホームは日時の右
    }
    updateBadge();
  }

  function init() {
    injectBadge();
    if (P.reloading) return;
    if (!P.loaded) {
      // 先に検出を試し、結果が出てからモーダルを出す。
      // （検出で1件に決まって自動で開き直す場合に、モーダルが一瞬出て消えるちらつきを防ぐ）
      var fallback = setTimeout(function () { if (!P.reloading && !modal) openModal(true); }, 1500);
      detectAuto().then(function (list) {
        clearTimeout(fallback);
        if (list) afterDetect(list, false);
        else if (!P.reloading && !modal) openModal(true);
      });
      return;
    }
    // 既に「標準（data.js）」を読み込めていて、他のプロファイルの手がかりも無いときは、
    // ここで自動の検出（iframe でファイルを読めるか確かめる処理）を行わない。
    // 環境によっては、この確認が file:// のセキュリティ制限に阻まれて失敗することがあり、
    // 正常に読み込めているデータまで巻き込んで無効化してしまうおそれがあるため。
    // （プロファイルが増えた場合は、［🔍 検出］ボタンから手動で確かめられる）
    if (P.isDefault && !AP.readList().length) { updateBadge(); return; }
    detectAuto().then(function (list) { afterDetect(list, false); });
  }

  window.AppProfile.openModal = function () { message = ''; openModal(false); };
  window.AppProfile.detect = detectAuto;
  window.AppProfile.probe = probe;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

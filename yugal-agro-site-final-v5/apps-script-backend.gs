/* =====================================================================
   Yugal Agro - COMPLETE backend (v8)  |  Google Apps Script + Google Sheet
   Ye file puraane backend ki jagah poori tarah lagti hai.
   Sab data aapki Google Sheet mein save hota hai (aapke control mein, backup ke liye
   File > Download ya Sheet ko copy kar sakte hain):
     Sheet "Customers" : har customer (naam, mobile, email, password-hash, address, last login)
     Sheet "Orders"    : har order (customer ID ke saath, UTR, status, items, payment slip ID)
     Sheet "Config"    : prices / business info / bank / UPI (website live sync)
   Payment slip ki photo Drive folder "YugalAgro Slips" mein jaati hai.
   ===================================================================== */

var CONF = {
  ADMIN_EMAIL: 'care.yugalagro@gmail.com',                 // sirf yahi Google account admin ban sakta hai
  GOOGLE_CLIENT_ID: 'PASTE_CLIENT_ID.apps.googleusercontent.com', // sirf CUSTOMER 'Continue with Google' ke liye (index.html ke CFG.gid wala hi). Khaali chhodne par Google button band rahega.
  NOTIFY_ADMIN: true,       // naye order par aapko email
  NOTIFY_CUSTOMER: true,    // customer ko order / status email
  CUSTOMER_DAYS: 30,        // customer login kitne din yaad rahe
  ADMIN_TOKEN_HOURS: 2      // admin panel session
};

var H_ORD = ['id', 'date', 'cid', 'name', 'phone', 'email', 'addr', 'sub', 'ship', 'tot', 'method', 'utr', 'slipId', 'status', 'note', 'items', 'updated', 'when'];
var H_CUS = ['cid', 'created', 'name', 'phone', 'email', 'pw', 'addr', 'lastLogin'];

/* ---------- run ONCE: sheets banata hai aur permissions maangta hai ---------- */
function setup() {
  sheet_('Orders', H_ORD); sheet_('Customers', H_CUS); sheet_('Config', ['chunk']);
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  secret_();
  Logger.log('Setup OK. Ab Deploy > New deployment karein.');
}

/* ---------- web entry points ---------- */
function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.action === 'config') return json_({ ok: true, pd: getPD_() });
  if (q.action === 'track') {
    var o = findOrder_(String(q.id || '').toUpperCase());
    return json_(o ? { ok: true, status: o.status || 'Placed', note: o.note || '' } : { ok: false });
  }
  return json_({ ok: true, service: 'Yugal Agro' });
}

function doPost(e) {
  var o;
  try { o = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, err: 'Bad request' }); }
  try {
    var act = o.action, r;
    if (act === 'order') r = order_(o);
    else if (act === 'csignup') r = csignup_(o);
    else if (act === 'clogin') r = clogin_(o);
    else if (act === 'cme') r = cme_(o);
    else if (act === 'corders') r = corders_(o);
    else if (act === 'cforgot') r = cforgot_(o);
    else if (act === 'creset') r = creset_(o);
    else if (act === 'cgoogle') r = cgoogle_(o);
    else if (act === 'cphone') r = cphone_(o);
    else if (act === 'cotp') r = cotp_(o);
    else if (act === 'cotpv') r = cotpv_(o);
    else if (['agate', 'gforgot', 'greset', 'alogin', 'setpw', 'forgot', 'reset', 'chpw'].indexOf(act) > -1) r = adminAuth_(o);
    else if (act === 'orders') r = requireLevel_(o, 'op') ? { ok: true, orders: allOrders_() } : { ok: false, err: 'expired' };
    else if (act === 'setStatus') r = requireLevel_(o, 'op') ? setStatus_(o) : { ok: false, err: 'expired' };
    else if (act === 'customers') r = requireLevel_(o, 'op') ? { ok: true, customers: allCustomers_() } : { ok: false, err: 'expired' };
    else if (act === 'saveConfig') r = requireLevel_(o, o.lv) ? saveConfig_(o) : { ok: false, err: 'expired' };
    else r = { ok: false, err: 'Unknown action' };
    return json_(r);
  } catch (err) {
    return json_({ ok: false, err: 'Server error: ' + err.message });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- sheet helpers ---------- */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name, head) {
  var s = ss_().getSheetByName(name);
  if (!s) {
    s = ss_().insertSheet(name);
    s.appendRow(head);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, head.length).setFontWeight('bold');
    s.getRange(2, 1, s.getMaxRows() - 1, head.length).setNumberFormat('@');   // phone numbers text rahein
  }
  return s;
}
function rows_(s) {
  var v = s.getDataRange().getValues();
  if (v.length < 2) return [];
  var h = v[0];
  return v.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = r[j] === undefined ? '' : String(r[j]); });
    return o;
  });
}
function colIndex_(head, key) { return head.indexOf(key) + 1; }
function lock_() { var l = LockService.getScriptLock(); l.waitLock(20000); return l; }

/* ---------- crypto / tokens (HMAC signed, koi session storage nahi) ---------- */
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }
function secret_() {
  var s = props_().getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props_().setProperty('SECRET', s); }
  return s;
}
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function sign_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())); }
function mkTok_(type, sub, ttlSec, pv) {
  var body = [type, sub, Date.now() + ttlSec * 1000, pv || ''].join('|');
  return Utilities.base64EncodeWebSafe(body) + '.' + sign_(body);
}
function vfTok_(tok, type) {
  try {
    if (!tok) return null;
    var p = String(tok).split('.');
    var body = Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString();
    if (sign_(body) !== p[1]) return null;
    var a = body.split('|');
    if (a[0] !== type || Number(a[2]) < Date.now()) return null;
    return { sub: a[1], pv: a[3] };
  } catch (e) { return null; }
}
function pwMake_(pw) { var salt = Utilities.getUuid(); return salt + '$' + sha_(salt + pw); }
function pwOk_(stored, pw) { if (!stored) return false; var p = String(stored).split('$'); return sha_(p[0] + pw) === p[1]; }
function pwVer_(stored) { return String(stored || '').split('$')[1] ? String(stored).split('$')[1].slice(0, 10) : ''; }
function failCount_(k) { return Number(cache_().get('f_' + k) || 0); }
function failAdd_(k) { cache_().put('f_' + k, String(failCount_(k) + 1), 900); }
function failClear_(k) { cache_().remove('f_' + k); }
function code6_() { return ('000000' + Math.floor(Math.random() * 1000000)).slice(-6); }
function mail_(to, subject, body) { try { MailApp.sendEmail(to, subject, body); } catch (e) {} }

/* ---------- config (prices, business info, bank...) ---------- */
function getPD_() {
  var s = sheet_('Config', ['chunk']), n = s.getLastRow();
  if (n < 2) return {};
  var v = s.getRange(2, 1, n - 1, 1).getValues().map(function (r) { return r[0]; }).join('');
  try { return JSON.parse(v) || {}; } catch (e) { return {}; }
}
function putPD_(pd) {
  var s = sheet_('Config', ['chunk']), str = JSON.stringify(pd), ch = [];
  for (var i = 0; i < str.length; i += 40000) ch.push([str.substr(i, 40000)]);
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 1).clearContent();
  s.getRange(2, 1, ch.length, 1).setNumberFormat('@').setValues(ch);
}
/* op -> prices + awards; cf -> sirf cfg (phone, email, bank, UPI, QR...) */
function saveConfig_(o) {
  var l = lock_();
  try {
    var stored = getPD_(), inc = o.pd || {}, lv = o.lv;
    var out = JSON.parse(JSON.stringify(lv === 'cf' ? stored : inc));
    out.cfg = lv === 'cf' ? (inc.cfg || {}) : (stored.cfg || {});
    out.ts = Date.now();
    putPD_(out);
    return { ok: true };
  } finally { l.releaseLock(); }
}

/* ---------- admin auth ----------
   3 alag password (teeno ek doosre se alag hone chahiye):
   gate = admin email + password (andar aane ke liye)
   op   = Operational Admin section
   cf   = Confidential Admin section
   Pehli baar gate password ADMIN_EMAIL par aaye 6-digit code se banta hai
   (isliye koi bahar wala pehle se password nahi bana sakta). */
var KINDS = ['gate', 'op', 'cf'];
function adminPw_(k) { return props_().getProperty('PW_' + k) || ''; }
function emailIsAdmin_(e) { return String(e || '').trim().toLowerCase() === CONF.ADMIN_EMAIL.toLowerCase(); }
function pwReuse_(kind, pw) { return KINDS.some(function (k) { return k !== kind && adminPw_(k) && pwOk_(adminPw_(k), pw); }); }
function cooldown_(k) { if (cache_().get('cd_' + k)) return true; cache_().put('cd_' + k, '1', 30); return false; }
function gsOk_(gs) { var v = vfTok_(gs, 'gs'); return !!v && !!adminPw_('gate') && v.pv === pwVer_(adminPw_('gate')); }
function requireLevel_(o, lv) {
  if (lv !== 'op' && lv !== 'cf') return false;
  if (o.lv !== lv) return false;
  var v = vfTok_(o.tok, 'at');
  return !!v && v.sub === lv && v.pv === pwVer_(adminPw_(lv));
}
function codeCheck_(key, code) {      // '' = sahi, warna error text
  var tries = Number(cache_().get('rcf_' + key) || 0);
  if (tries >= 5) { cache_().remove('rc_' + key); return 'Bahut zyada galat code. Naya code mangwayein.'; }
  if (cache_().get('rc_' + key) !== sha_(String(code || '') + key)) { cache_().put('rcf_' + key, String(tries + 1), 600); return 'Code galat ya expire ho gaya.'; }
  return '';
}
function codeSend_(key, to, subject, intro) {
  var code = code6_();
  cache_().put('rc_' + key, sha_(code + key), 600); cache_().remove('rcf_' + key);
  mail_(to, subject, intro + ' ' + code + '\n\nCode 10 minute tak chalega. Aapne request nahi ki to is email ko ignore karein.');
}
function pwProblem_(kind, pw) {
  if (String(pw || '').length < 8) return 'Password kam se kam 8 characters ka ho.';
  if (pwReuse_(kind, String(pw))) return 'Ye password kisi aur admin password jaisa hai. Teeno password alag rakhein.';
  return '';
}
function adminAuth_(o) {
  var act = o.action, lv = o.lv, p;
  if (act === 'agate') {
    if (failCount_('agate') >= 5) return { ok: false, err: 'Bahut zyada galat koshishein. 15 minute baad try karein.' };
    if (!emailIsAdmin_(o.email) || !pwOk_(adminPw_('gate'), String(o.pw || ''))) { failAdd_('agate'); return { ok: false, err: 'Email ya password galat hai.' }; }
    failClear_('agate');
    return { ok: true, gs: mkTok_('gs', 'admin', 1800, pwVer_(adminPw_('gate'))), email: CONF.ADMIN_EMAIL,
      st: { op: adminPw_('op') ? 1 : 0, cf: adminPw_('cf') ? 1 : 0 } };
  }
  if (act === 'gforgot') {
    if (emailIsAdmin_(o.email) && !cooldown_('gate')) codeSend_('gate', CONF.ADMIN_EMAIL, 'Yugal Agro - admin login password code', 'Admin login password setup/reset code:');
    return { ok: true };
  }
  if (act === 'greset') {
    if (!emailIsAdmin_(o.email)) return { ok: false, err: 'Code galat ya expire ho gaya.' };
    var e1 = codeCheck_('gate', o.code); if (e1) return { ok: false, err: e1 };
    p = pwProblem_('gate', o.pw); if (p) return { ok: false, err: p };
    props_().setProperty('PW_gate', pwMake_(String(o.pw)));
    cache_().remove('rc_gate'); failClear_('agate');
    return { ok: true };
  }
  if (act === 'chpw') {
    if (!requireLevel_(o, lv)) return { ok: false, err: 'expired' };
    var target = o.target === 'gate' ? 'gate' : lv, fk = 'a' + target;
    if (failCount_(fk) >= 5) return { ok: false, err: 'Bahut zyada galat koshishein. 15 minute baad try karein.' };
    if (!pwOk_(adminPw_(target), String(o.old || ''))) { failAdd_(fk); return { ok: false, err: 'Current password galat hai.' }; }
    p = pwProblem_(target, o.pw); if (p) return { ok: false, err: p };
    failClear_(fk); props_().setProperty('PW_' + target, pwMake_(String(o.pw)));
    return { ok: true };
  }
  if (!gsOk_(o.gs)) return { ok: false, err: 'expired' };
  if (lv !== 'op' && lv !== 'cf') return { ok: false, err: 'Invalid admin type.' };
  var key = 'a' + lv, ttl = CONF.ADMIN_TOKEN_HOURS * 3600;
  if (act === 'alogin') {
    if (failCount_(key) >= 5) return { ok: false, err: 'Bahut zyada galat koshishein. 15 minute baad try karein.' };
    if (!pwOk_(adminPw_(lv), String(o.pw || ''))) { failAdd_(key); return { ok: false, err: 'Wrong password' }; }
    failClear_(key);
    return { ok: true, tok: mkTok_('at', lv, ttl, pwVer_(adminPw_(lv))) };
  }
  if (act === 'setpw') {                       // section ka pehli baar password (gate pass hone ke baad)
    if (adminPw_(lv)) return { ok: false, err: 'Password pehle se set hai. Login ya Forgot password use karein.' };
    p = pwProblem_(lv, o.pw); if (p) return { ok: false, err: p };
    var st = pwMake_(String(o.pw)); props_().setProperty('PW_' + lv, st);
    return { ok: true, tok: mkTok_('at', lv, ttl, pwVer_(st)) };
  }
  if (act === 'forgot') {
    if (!cooldown_(key)) codeSend_(key, CONF.ADMIN_EMAIL, 'Yugal Agro - admin password reset code', (lv === 'op' ? 'Operational' : 'Confidential') + ' Admin reset code:');
    return { ok: true };
  }
  if (act === 'reset') {
    var e2 = codeCheck_(key, o.code); if (e2) return { ok: false, err: e2 };
    p = pwProblem_(lv, o.pw); if (p) return { ok: false, err: p };
    props_().setProperty('PW_' + lv, pwMake_(String(o.pw)));
    cache_().remove('rc_' + key); failClear_(key);
    return { ok: true };
  }
  return { ok: false, err: 'Unknown' };
}

/* ---------- customers ---------- */
function normPhone_(p) { return String(p || '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''); }
function userOf_(c) { return { cid: c.cid, name: c.name, phone: c.phone, email: c.email, addr: c.addr }; }
function custTok_(c) { return mkTok_('ct', c.cid, CONF.CUSTOMER_DAYS * 86400, pwVer_(c.pw)); }
function custFromTok_(ctok) {
  var v = vfTok_(ctok, 'ct');
  if (!v) return null;
  var c = rows_(sheet_('Customers', H_CUS)).filter(function (x) { return x.cid === v.sub; })[0];
  return c && pwVer_(c.pw) === v.pv ? c : null;
}
function findCust_(id) {
  id = String(id || '').trim().toLowerCase();
  var byMail = id.indexOf('@') > -1, ph = normPhone_(id);
  return rows_(sheet_('Customers', H_CUS)).filter(function (x) { return byMail ? x.email.toLowerCase() === id : x.phone === ph; })[0] || null;
}
function setCell_(s, head, row, key, val) { s.getRange(row, colIndex_(head, key)).setValue(String(val)); }

function csignup_(o) {
  var name = String(o.name || '').trim().slice(0, 80), phone = normPhone_(o.phone), email = String(o.email || '').trim().toLowerCase(), pw = String(o.pw || '');
  if (!name || !/^\d{10}$/.test(phone)) return { ok: false, err: 'Naam aur 10-digit mobile number sahi daalein.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, err: 'Sahi email daalein.' };
  if (pw.length < 6) return { ok: false, err: 'Password kam se kam 6 characters ka rakhein.' };
  var l = lock_();
  try {
    var s = sheet_('Customers', H_CUS), all = rows_(s);
    if (all.some(function (x) { return x.phone === phone || x.email.toLowerCase() === email; }))
      return { ok: false, err: 'Ye mobile ya email pehle se registered hai. Kripya Login karein.' };
    var c = { cid: 'C' + Utilities.getUuid().slice(0, 8).toUpperCase(), created: String(Date.now()), name: name, phone: phone, email: email, pw: pwMake_(pw), addr: '', lastLogin: String(Date.now()) };
    s.appendRow(H_CUS.map(function (k) { return c[k]; }));
    mail_(email, 'Welcome to Yugal Agro', 'Namaste ' + name + ',\n\nAapka Yugal Agro account ban gaya hai. Mobile ya email se login karke apne saare orders dekh sakte hain.\n\n- Yugal Agro');
    return { ok: true, ctok: custTok_(c), user: userOf_(c) };
  } finally { l.releaseLock(); }
}
function clogin_(o) {
  var key = 'c' + String(o.id || '').toLowerCase().trim();
  if (failCount_(key) >= 8) return { ok: false, err: 'Bahut zyada galat koshishein. 15 minute baad try karein.' };
  var c = findCust_(o.id);
  if (!c || !pwOk_(c.pw, String(o.pw || ''))) { failAdd_(key); return { ok: false, err: 'Mobile/email ya password galat hai.' }; }
  failClear_(key);
  var s = sheet_('Customers', H_CUS); setCell_(s, H_CUS, c._row, 'lastLogin', Date.now());
  return { ok: true, ctok: custTok_(c), user: userOf_(c) };
}
function cme_(o) { var c = custFromTok_(o.ctok); return c ? { ok: true, user: userOf_(c) } : { ok: false, err: 'expired' }; }
function corders_(o) {
  var c = custFromTok_(o.ctok);
  if (!c) return { ok: false, err: 'expired' };
  var list = rows_(sheet_('Orders', H_ORD)).filter(function (x) { return x.cid === c.cid; }).map(function (x) { return pubOrder_(x, false); });
  list.sort(function (a, b) { return b.d - a.d; });
  return { ok: true, orders: list };
}
function cforgot_(o) {
  var c = findCust_(o.id);
  if (c && !cooldown_('c' + c.cid)) codeSend_('c' + c.cid, c.email, 'Yugal Agro - password reset code', 'Aapka password reset code:');
  return { ok: true };       // account hai ya nahi, ek jaisa jawab
}
function creset_(o) {
  var c = findCust_(o.id);
  if (!c) return { ok: false, err: 'Code galat ya expire ho gaya.' };
  var key = 'c' + c.cid, tries = Number(cache_().get('rcf_' + key) || 0);
  if (tries >= 5) { cache_().remove('rc_' + key); return { ok: false, err: 'Bahut zyada galat code. Naya code mangwayein.' }; }
  if (cache_().get('rc_' + key) !== sha_(String(o.code || '') + key)) { cache_().put('rcf_' + key, String(tries + 1), 600); return { ok: false, err: 'Code galat ya expire ho gaya.' }; }
  if (String(o.pw || '').length < 6) return { ok: false, err: 'Password kam se kam 6 characters ka rakhein.' };
  setCell_(sheet_('Customers', H_CUS), H_CUS, c._row, 'pw', pwMake_(String(o.pw)));
  cache_().remove('rc_' + key);
  return { ok: true };
}
/* ---- customer: Google / email code / mobile ---- */
function googleVerify_(cred) {
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    var d = JSON.parse(r.getContentText());
    if (d.aud !== CONF.GOOGLE_CLIENT_ID || String(d.email_verified) !== 'true' || Number(d.exp) * 1000 < Date.now()) return null;
    return d;
  } catch (e) { return null; }
}
function cgoogle_(o) {
  var d = googleVerify_(o.cred);
  if (!d) return { ok: false, err: 'Google sign-in verify nahi hua. Dobara try karein.' };
  var email = String(d.email).toLowerCase(), l = lock_();
  try {
    var s = sheet_('Customers', H_CUS), c = rows_(s).filter(function (x) { return x.email.toLowerCase() === email; })[0];
    if (!c) {
      c = { cid: 'C' + Utilities.getUuid().slice(0, 8).toUpperCase(), created: String(Date.now()), name: String(d.name || email.split('@')[0]).slice(0, 80), phone: '', email: email, pw: '', addr: '', lastLogin: String(Date.now()) };
      s.appendRow(H_CUS.map(function (k) { return c[k]; }));
      mail_(email, 'Welcome to Yugal Agro', 'Namaste ' + c.name + ',\n\nAapka Yugal Agro account ban gaya hai. Aap Google se, ya email par aaye code se login kar sakte hain.\n\n- Yugal Agro');
    } else setCell_(s, H_CUS, c._row, 'lastLogin', Date.now());
    return { ok: true, ctok: custTok_(c), user: userOf_(c), needPhone: !c.phone };
  } finally { l.releaseLock(); }
}
function cphone_(o) {
  var c = custFromTok_(o.ctok);
  if (!c) return { ok: false, err: 'expired' };
  var ph = normPhone_(o.phone);
  if (!/^\d{10}$/.test(ph)) return { ok: false, err: '10-digit mobile number sahi daalein.' };
  var l = lock_();
  try {
    var s = sheet_('Customers', H_CUS);
    if (rows_(s).some(function (x) { return x.phone === ph && x.cid !== c.cid; })) return { ok: false, err: 'Ye mobile number kisi aur account par hai.' };
    setCell_(s, H_CUS, c._row, 'phone', ph); c.phone = ph;
    return { ok: true, user: userOf_(c) };
  } finally { l.releaseLock(); }
}
function cotp_(o) {                 // email par login code
  var c = findCust_(o.id);
  if (c && !cooldown_('lo' + c.cid)) codeSend_('lo' + c.cid, c.email, 'Yugal Agro - login code', 'Aapka login code:');
  return { ok: true };
}
function cotpv_(o) {
  var c = findCust_(o.id);
  if (!c) return { ok: false, err: 'Code galat ya expire ho gaya.' };
  var key = 'lo' + c.cid, e = codeCheck_(key, o.code);
  if (e) return { ok: false, err: e };
  cache_().remove('rc_' + key);
  setCell_(sheet_('Customers', H_CUS), H_CUS, c._row, 'lastLogin', Date.now());
  return { ok: true, ctok: custTok_(c), user: userOf_(c) };
}
function allCustomers_() {
  var orders = rows_(sheet_('Orders', H_ORD)), stat = {};
  orders.forEach(function (x) {
    if (!x.cid) return;
    var s = stat[x.cid] = stat[x.cid] || { n: 0, tot: 0 };
    s.n++; if (x.status !== 'Cancelled') s.tot += Number(x.tot) || 0;
  });
  return rows_(sheet_('Customers', H_CUS)).map(function (c) {
    var s = stat[c.cid] || { n: 0, tot: 0 };
    return { cid: c.cid, name: c.name, phone: c.phone, email: c.email, created: Number(c.created), lastLogin: Number(c.lastLogin), n: s.n, tot: s.tot };
  }).reverse();
}

/* ---------- orders ---------- */
function pubOrder_(x, admin) {
  var it = []; try { it = JSON.parse(x.items || '[]'); } catch (e) {}
  var o = { id: x.id, d: Number(x.date), name: x.name, phone: x.phone, email: x.email, addr: x.addr, sub: Number(x.sub), ship: Number(x.ship), tot: Number(x.tot),
    method: x.method, utr: x.utr, status: x.status || 'Placed', note: x.note, it: it };
  if (admin) { o.slipId = x.slipId; o.cid = x.cid; }
  return o;
}
function allOrders_() {
  var l = rows_(sheet_('Orders', H_ORD)).map(function (x) { return pubOrder_(x, true); });
  l.sort(function (a, b) { return b.d - a.d; });
  return l.slice(0, 500);
}
function findOrder_(id) { return rows_(sheet_('Orders', H_ORD)).filter(function (x) { return x.id === id; })[0] || null; }
function slipFolder_() {
  var it = DriveApp.getFoldersByName('YugalAgro Slips');
  return it.hasNext() ? it.next() : DriveApp.createFolder('YugalAgro Slips');
}
function order_(o) {
  var c = custFromTok_(o.ctok);
  if (!c) return { ok: false, err: 'expired' };
  var od = o.order || {};
  if (!/^YA-\d{5}$/.test(String(od.id || ''))) return { ok: false, err: 'Invalid order ID' };
  if (!od.it || !od.it.length || od.it.length > 50) return { ok: false, err: 'Cart khaali hai' };
  if (['cod', 'online', 'wa'].indexOf(od.method) < 0) return { ok: false, err: 'Invalid payment method' };
  var l = lock_();
  try {
    if (findOrder_(od.id)) return { ok: false, err: 'Order ID repeat ho gayi, dobara try karein.' };
    var slipId = '';
    if (od.method === 'online' && String(od.slip || '').indexOf('data:image') === 0 && od.slip.length < 4000000) {
      try {
        var m = od.slip.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        if (m) slipId = slipFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], od.id + '.jpg')).getId();
      } catch (e) {}
    }
    var items = od.it.map(function (i) { return { i: Number(i.i), n: String(i.n).slice(0, 80), u: String(i.u).slice(0, 30), q: Number(i.q), pr: Number(i.pr) }; });
    var now = Date.now();
    var row = { id: od.id, date: String(now), cid: c.cid, name: String(od.name || c.name).slice(0, 80), phone: normPhone_(od.phone || c.phone), email: c.email,
      addr: String(od.addr || '').slice(0, 400), sub: String(Number(od.sub) || 0), ship: String(Number(od.ship) || 0), tot: String(Number(od.tot) || 0), method: od.method,
      utr: String(od.utr || '').slice(0, 30), slipId: slipId, status: od.method === 'online' ? 'Payment verification pending' : 'Placed', note: '',
      items: JSON.stringify(items), updated: String(now), when: Utilities.formatDate(new Date(now), 'Asia/Kolkata', 'dd MMM yyyy HH:mm') };
    sheet_('Orders', H_ORD).appendRow(H_ORD.map(function (k) { return row[k]; }));
    if (row.addr && row.addr !== c.addr) setCell_(sheet_('Customers', H_CUS), H_CUS, c._row, 'addr', row.addr);
    var txt = items.map(function (i) { return i.q + ' x ' + i.n + ' (' + i.u + ') = Rs ' + (i.q * i.pr); }).join('\n');
    if (CONF.NOTIFY_ADMIN) mail_(CONF.ADMIN_EMAIL, 'New order ' + row.id + ' - Rs ' + row.tot + ' (' + row.method + ')',
      row.name + ' | ' + row.phone + ' | ' + row.email + '\n' + row.addr + '\n\n' + txt + '\n\nTotal Rs ' + row.tot + (row.utr ? '\nUTR: ' + row.utr : ''));
    if (CONF.NOTIFY_CUSTOMER) mail_(c.email, 'Yugal Agro - order ' + row.id + ' mil gaya',
      'Namaste ' + c.name + ',\n\nAapka order ' + row.id + ' mil gaya hai.\n\n' + txt + '\n\nTotal: Rs ' + row.tot + '\n\nStatus aap website par "My Orders" mein dekh sakte hain.\n- Yugal Agro');
    return { ok: true, id: row.id };
  } finally { l.releaseLock(); }
}
function setStatus_(o) {
  var l = lock_();
  try {
    var s = sheet_('Orders', H_ORD), x = findOrder_(String(o.id || ''));
    if (!x) return { ok: false, err: 'Order nahi mila' };
    var status = String(o.status || '').slice(0, 60), note = String(o.note || '').slice(0, 300), changed = status !== x.status;
    setCell_(s, H_ORD, x._row, 'status', status); setCell_(s, H_ORD, x._row, 'note', note); setCell_(s, H_ORD, x._row, 'updated', Date.now());
    if (changed && CONF.NOTIFY_CUSTOMER && x.email) mail_(x.email, 'Yugal Agro - order ' + x.id + ': ' + status,
      'Namaste ' + x.name + ',\n\nAapke order ' + x.id + ' ka status: ' + status + (note ? '\n' + note : '') + '\n\n- Yugal Agro');
    return { ok: true };
  } finally { l.releaseLock(); }
}

/**
 * 로망데스크 서버 (껍데기) — 이 파일은 고치지 마세요.
 *
 * 실제 서버 코드는 로망데스크 공개 저장소(romangdesk-releases의 server 폴더)에서 받아
 * 이 시트의 스크립트 속성에 보관해 두고 씁니다. 새 판이 나오면 저절로 바꿔요(몇 시간에 한 번 확인).
 * 시트 커스텀 메뉴 [로망데스크 → 서버 업데이트]를 누르면 바로 확인해요.
 * 새 판이 오류를 내면 직전 판으로 저절로 돌아가요. 웹앱을 다시 배포할 필요가 없어요.
 *
 * 처음 한 번: 이 파일을 붙여 넣고 저장 → 위쪽 함수 칸에서 rdSetup 고르기 → ▷ 실행(권한 허용)
 *            → 배포 → 배포 관리 → ✏ → 버전 '새 버전' → 배포
 * 만든 사람만: rdUseNext를 실행하면 이 시트가 미리보기 판(server/next)을 먼저 받는다 (되돌리기: rdUseStable)
 *            → 이 시트에 연결된 PC 앱·웹앱도 미리보기 판을 받는다
 */
const RD_SRC = 'https://raw.githubusercontent.com/cmi-0/romangdesk-releases/HEAD/server/';
const RD_SHELL = 2;              // 껍데기 판 (서버 코드가 껍데기를 알아보는 데 씀) · 2: 미리보기 칸
const RD_CHECK_MS = 6 * 3600e3;  // 새 판 확인 간격
const RD_CHUNK = 8000;           // 스크립트 속성 한 칸에 넣는 글자 수 (한 칸 9KB 제한)
var RD_ = { ver: '', slot: '', err: '', files: {} };

function rdNum_(v) { const p = String(v || '0').split('.'); return (Number(p[0]) || 0) * 1e6 + (Number(p[1]) || 0) * 1e3 + (Number(p[2]) || 0); }
function rdPack_(s) { return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(s, 'text/plain', 'rd.txt')).getBytes()); }
function rdUnpack_(b64) { return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip', 'rd.gz')).getDataAsString('UTF-8'); }
// 보관 자리 두 칸(a·b): 지금 쓰는 판과 직전 판
function rdRead_(all, slot, name) {
  const meta = JSON.parse(all['rdsrc.' + slot + '.meta'] || 'null');
  if (!meta || !meta.files || !meta.files[name]) return null;
  let b64 = '';
  for (let i = 0; i < meta.files[name]; i++) b64 += all['rdsrc.' + slot + '.' + name + '.' + i] || '';
  return rdUnpack_(b64);
}
function rdWrite_(P, slot, ver, got) {
  const all = P.getProperties(), out = {}, files = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('rdsrc.' + slot + '.') === 0) P.deleteProperty(k); });
  Object.keys(got).forEach(function (name) {
    const b64 = rdPack_(got[name]); let n = 0;
    for (let i = 0; i < b64.length; i += RD_CHUNK) out['rdsrc.' + slot + '.' + name + '.' + (n++)] = b64.slice(i, i + RD_CHUNK);
    files[name] = n;
  });
  out['rdsrc.' + slot + '.meta'] = JSON.stringify({ ver: ver, files: files, at: Date.now() });
  P.setProperties(out);
}
function rdChannel_() { return PropertiesService.getScriptProperties().getProperty('rdsrc.channel') === 'next' ? 'next' : ''; }
function rdFetch_(name, v, dir) {
  const r = UrlFetchApp.fetch(RD_SRC + (dir || '') + encodeURIComponent(name) + '?v=' + encodeURIComponent(v || Date.now()), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(name + '을(를) 받지 못했어요 (' + r.getResponseCode() + ')');
  return r.getContentText();
}
// 새 판 받기. force: 확인 간격을 따지지 않고 바로. down: 낮은 판으로도 바꿈(미리보기 → 정식으로 되돌릴 때). 돌려줌: { ok, changed, from, to, error }
function rdUpdate_(force, down) {
  const P = PropertiesService.getScriptProperties(), all = P.getProperties();
  if (!force && Date.now() - Number(all['rdsrc.at'] || 0) < RD_CHECK_MS) return { ok: true, changed: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '다른 업데이트가 진행 중이에요' };
  try {
    const cur = all['rdsrc.cur'] || '', curMeta = JSON.parse(all['rdsrc.' + cur + '.meta'] || 'null'), from = curMeta ? curMeta.ver : '';
    // 미리보기 칸(만든 사람 시트)은 server/next, 없으면 정식 칸
    let dir = rdChannel_() === 'next' ? 'next/' : '', meta = null;
    if (dir) { try { meta = JSON.parse(rdFetch_('version.json', '', dir)); } catch (e) { dir = ''; } }
    if (!meta) meta = JSON.parse(rdFetch_('version.json'));
    P.setProperty('rdsrc.at', String(Date.now()));
    if (!meta || !meta.version) throw new Error('최신 판 정보가 이상해요');
    if (from && (down ? meta.version === from : rdNum_(meta.version) <= rdNum_(from))) return { ok: true, changed: false, from: from, to: from };
    if (!force && all['rdsrc.bad'] === meta.version) return { ok: true, changed: false, from: from, to: from }; // 오류를 낸 판은 저절로 다시 받지 않는다
    const names = (meta.files && meta.files.length ? meta.files : ['core.gs', 'Dialog.html']), got = {};
    names.forEach(function (n) { got[n] = rdFetch_(n, meta.version, dir); });
    const core = got['core.gs'] || '';
    if (core.indexOf("const VERSION = '" + meta.version + "'") < 0) throw new Error('받은 서버 코드가 ' + meta.version + ' 판이 아니에요');
    new Function(core); // 문법만 미리 확인 (실행하지 않음)
    const slot = cur === 'a' ? 'b' : 'a';
    rdWrite_(P, slot, meta.version, got);
    P.setProperty('rdsrc.cur', slot); P.deleteProperty('rdsrc.bad');
    return { ok: true, changed: true, from: from, to: meta.version };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { lock.releaseLock(); }
}
// 보관해 둔 파일 (서버 코드가 대화창 Dialog.html을 여기서 꺼내 쓴다)
function rdFile_(name) {
  if (name in RD_.files) return RD_.files[name];
  try { RD_.files[name] = RD_.slot ? rdRead_(PropertiesService.getScriptProperties().getProperties(), RD_.slot, name) : null; } catch (e) { RD_.files[name] = null; }
  return RD_.files[name];
}
function rdInfo_() { return { shell: RD_SHELL, ver: RD_.ver, slot: RD_.slot, err: RD_.err, channel: rdChannel_() }; }

// 만든 사람용 (편집기에서 실행): 이 시트는 미리보기 판을 먼저 받는다 / 정식 판으로 되돌린다
function rdUseNext() {
  PropertiesService.getScriptProperties().setProperty('rdsrc.channel', 'next');
  const r = rdUpdate_(true);
  Logger.log('미리 받기 켬 · ' + (r.ok ? (r.changed ? '미리보기 판 ' + r.to + '을(를) 받았어요' : '지금 판 ' + (r.to || RD_.ver) + ' (미리보기 칸에 더 새 판이 없어요)') : '확인 못 함: ' + r.error) + ' · 연결된 앱도 다음 동기화 때 미리보기 판으로 바뀌어요');
}
function rdUseStable() {
  PropertiesService.getScriptProperties().deleteProperty('rdsrc.channel');
  const r = rdUpdate_(true, true);
  Logger.log('미리 받기 끔 · ' + (r.ok ? '정식 판 ' + (r.to || RD_.ver) : '확인 못 함: ' + r.error));
}

// 처음 한 번 (편집기에서 실행): 서버 코드 받기 + 권한 허용 + 드라이브 폴더 준비
function rdSetup() {
  const r = rdUpdate_(true);
  if (!r.ok && !RD_.ver) throw new Error('서버 코드를 받지 못했어요: ' + r.error);
  rdBoot_();
  if (typeof prepareFiles === 'function') prepareFiles();
  Logger.log('로망데스크 서버 ' + (RD_.ver || '?') + ' 준비 끝. 이제 배포 → 배포 관리 → 새 버전으로 배포하세요.');
}

// 실행될 때마다: 보관해 둔 서버 코드를 불러온다 (지금 판이 오류를 내면 직전 판으로)
function rdBoot_() {
  const P = PropertiesService.getScriptProperties();
  try { rdUpdate_(false); } catch (e) {} // 몇 시간에 한 번만 실제로 확인 (권한 없는 자리 — 시트 열기·고치기 — 에서는 조용히 넘어감)
  let all = P.getProperties();
  if (!all['rdsrc.cur']) { try { rdUpdate_(true); } catch (e) {} all = P.getProperties(); }
  const cur = all['rdsrc.cur'];
  if (!cur) { RD_.err = '서버 코드를 아직 받지 못했어요'; return; }
  const order = [cur, cur === 'a' ? 'b' : 'a'];
  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    try {
      const src = rdRead_(all, slot, 'core.gs');
      if (!src) continue;
      (0, eval)(src); // 서버 코드의 함수들(doPost·onOpen·메뉴…)이 전역 함수가 된다
      RD_.ver = JSON.parse(all['rdsrc.' + slot + '.meta']).ver; RD_.slot = slot; RD_.files = {};
      if (i > 0) { // 지금 판이 오류 → 직전 판으로 되돌리고, 오류 낸 판은 기억
        const bad = JSON.parse(all['rdsrc.' + cur + '.meta'] || '{}').ver || '';
        P.setProperty('rdsrc.cur', slot); if (bad) P.setProperty('rdsrc.bad', bad);
      }
      return;
    } catch (e) { RD_.err = String(e && e.message || e); }
  }
}

// 서버 코드를 못 불러왔을 때만 쓰이는 자리 (불러오면 서버 코드의 같은 이름 함수가 대신한다)
function doGet() { return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '서버 코드를 받지 못했어요. 시트의 커스텀 메뉴 로망데스크 → 서버 다시 받기를 눌러 주세요. ' + RD_.err })).setMimeType(ContentService.MimeType.JSON); }
function doPost() { return doGet(); }
function onOpen() {
  SpreadsheetApp.getUi().createMenu('로망데스크').addItem('서버 다시 받기', 'rdMenuFetch').addToUi();
}
function rdMenuFetch() {
  const r = rdUpdate_(true), ui = SpreadsheetApp.getUi();
  ui.alert('로망데스크', r.ok ? '서버 코드를 받았어요 (' + (r.to || '') + '). 시트를 새로고침하면 메뉴가 모두 보여요.' : '받지 못했어요: ' + r.error + '\n인터넷 연결을 확인하고 다시 눌러 주세요.', ui.ButtonSet.OK);
}

rdBoot_();

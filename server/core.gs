/**
 * 로망데스크 서버 (구글 앱스스크립트)  v1.3.0
 * - 기록은 이 시트에 저장한다 (기록 탭: 할 일·진도·일정·메모·D-Day·바로가기 / 설정 탭)
 * - 보기 탭(진도 기록부·할 일 현황·월간 일정·메모 모아보기)은 기록 탭을 보기 좋게 정리해 보여 준다 (인쇄용)
 * - 나이스·에어코리아·구글 캘린더(iCal)는 이 스크립트가 대신 불러온다 (인증키는 설정 탭에만 있다)
 * - 기기는 '연결 코드'로 인증한다. 인증은 해시로 하고, '기기 추가하기'로 다시 보여 줄 수 있게 원문은 스크립트 속성(선생님 계정만)에 둔다.
 * - 날짜는 시트에 '2026.11.07.' 글자로 적는다 (점으로 입력·표시 통일). 앱과는 2026-11-07로 주고받는다.
 * 붙이는 곳: 구글 시트 → 확장 프로그램 → Apps Script → 이 파일(Code.gs)과 Dialog.html
 */
const VERSION = '1.5.4';
const LAYOUT_VER = 2;            // 시트 모양 버전 (올라가면 동기화·시트 준비하기 때 한 번 정리)
const APP_BG = '#f0f1f4';        // 앱이 쓰는 칸 (연회색) — 고쳐도 되돌아가요
const TS_FMT = 'yyyy.mm.dd. hh:mm';
const APP_ONLY_MSG = '수정은 앱에서만 해 주세요.';
const HEAD_BG = '#d0e0e3';
const KEEP_DEL_DAYS = 30;
const SPARE_ROWS = 5;             // 기록 탭 맨 아래에 남겨 두는 빈 줄 수 (인쇄하면 쓴 줄만 나오게 나머지는 줄인다)
const DEL_TAB = '삭제 기록';       // 숨긴 탭: 줄째 지운 항목(빈 포스트잇)의 번호만 30일 보관 → 다른 기기에도 지웠다고 알려 준다
const MAX_FAILS = 5;
const LOCK_MIN = 10;
const RESERVED = ['neisKey', 'airKey', 'adminPw', '제작자 정보']; // 앱으로 내려보내지 않는 설정 칸
const NEIS_SVC = ['schoolInfo', 'mealServiceDietInfo', 'SchoolSchedule', 'classInfo', 'misTimetable', 'elsTimetable', 'hisTimetable'];

// 열 정의: k=앱에서 쓰는 이름, h=시트 제목, t=text|num|bool|ts(날짜·시각)|formula
// map: 앱 값 ↔ 시트에 보이는 한글 / hidden: 숨긴 칸 / derived: 서버가 채우는 칸(앱으로 안 보냄)
function F_(k, h, t, w, o) { return Object.assign({ k: k, h: h, t: t, w: w }, o || {}); }
const REP_MAP = { daily: '매일', weekday: '평일', weekly: '매주', monthly: '매월' };
const COLOR_MAP = { butter: '노랑', pink: '분홍', sky: '하늘', mint: '민트', lav: '보라', peach: '살구' };
const TAB_COLOR = { view: '#a8c7b5', rec: '#b7c3d6', set: '#c9c3b0' };
const VIEW = { prog: '진도 기록부', todo: '할 일 현황', month: '월간 일정', memo: '메모 모아보기' };
const SPECS = {
  todos: {
    name: '할 일',
    cols: [
      F_('title', '제목', 'text', 340, { note: '할 일 내용' }),
      F_('cat', '분류', 'text', 72, { list: ['수업', '담임', '행정', '행사', '연구', '기안', '품의'] }),
      F_('due', '마감', 'text', 92, { fmt: 'date', note: '마감일 (예: 2026.11.20.)' }),
      F_('rep', '반복', 'text', 64, { map: REP_MAP, note: '비우면 한 번만. 매일 / 평일 / 매주 / 매월' }),
      F_('done', '완료', 'bool', 50),
      F_('doneAt', '완료일', 'ts', 124, { note: '완료하면 앱이 적어요' }),
      F_('created', '만든 날', 'ts', 124, { note: '앱이 적어요' }),
    ],
  },
  progress: {
    name: '진도',
    cols: [
      F_('date', '날짜', 'text', 92, { fmt: 'date', note: '수업한 날 (예: 2026.11.06.)' }),
      F_('cls', '반', 'text', 60, { note: '예: 3-1' }),
      F_('text', '진도 내용', 'text', 360, { note: '어디까지 나갔는지' }),
      F_('created', '만든 날', 'ts', 124, { note: '앱이 적어요' }),
    ],
  },
  events: {
    name: '일정',
    cols: [
      F_('date', '날짜', 'text', 92, { fmt: 'date', note: '예: 2026.11.20.' }),
      F_('time', '시간', 'text', 64, { fmt: 'time', note: '비우면 종일 (예: 15:00)' }),
      F_('title', '제목', 'text', 340),
      F_('end', '끝 날짜', 'text', 92, { fmt: 'date', note: '여러 날 일정의 마지막 날 (예: 2026.11.22.). 하루짜리는 비워 둬요.' }),
      F_('tags', '분류', 'text', 110, { note: '분류 꼬리표. 여러 개는 쉼표로 (예: 중요, ★)' }),
      F_('plain', '노트', 'text', 380, { derived: 1, note: '일정 노트의 글자만 보여요. 여기서 고치면 굵게·목록 같은 서식은 사라지고 글자로 바뀌어요.' }),
      F_('html', '노트 서식(앱용)', 'text', 160, { hidden: 1, note: '앱이 쓰는 칸이에요. 고치지 마세요.' }),
    ],
  },
  memos: {
    name: '메모',
    cols: [
      F_('plain', '내용', 'text', 420, { derived: 1, note: '포스트잇 글자만 보여요. 여기서 고치면 굵게·목록 같은 서식은 사라지고 글자로 바뀌어요.' }),
      F_('color', '색', 'text', 60, { map: COLOR_MAP }),
      F_('trash', '휴지통', 'bool', 56, { note: '체크되면 떼어낸 포스트잇 (앱에서 다시 꺼낼 수 있어요)' }),
      F_('html', '서식(앱용)', 'text', 160, { hidden: 1, note: '앱이 쓰는 칸이에요. 고치지 마세요.' }),
    ],
  },
  ddays: {
    name: 'D-Day',
    cols: [
      F_('title', '이름', 'text', 280),
      F_('date', '날짜', 'text', 92, { fmt: 'date', note: '예: 2026.12.31.' }),
      F_('left', '남은 날', 'formula', 70, { note: '시트가 계산해요. 이 칸 아래에는 적지 마세요.', formula: function (L) {
        const r = L.date + '2:' + L.date;
        return '=ARRAYFORMULA({"남은 날";LET(r,' + r + ',d,IFERROR(' + DVX_('r') + ',""),IF(r="","",IF(d="","",IF(d=TODAY(),"D-Day",IF(d>TODAY(),"D-"&(d-TODAY()),"D+"&(TODAY()-d))))))})';
      } }),
    ],
  },
  links: {
    name: '바로가기',
    cols: [
      F_('icon', '아이콘', 'text', 60, { note: '이모지 한 글자' }),
      F_('name', '이름', 'text', 160),
      F_('url', '주소', 'text', 380, { note: '웹 주소 또는 PC의 파일·폴더 경로' }),
    ],
  },
};
// 보이는 칸 뒤에 붙는 칸 (수정 일시·삭제됨) / 맨 오른쪽 숨긴 칸 (ID·수정·서버)
const SYS_SHOW = [
  F_('when', '수정 일시', 'text', 118, { note: '마지막으로 고친 때 (보기용)', sys: 1 }),
  F_('del', '삭제됨', 'bool', 56, { note: '체크하면 모든 기기에서 삭제돼요 (30일 뒤 줄이 정리돼요)', sys: 1 }),
];
const SYS_HIDE = [
  F_('id', 'ID', 'text', 90, { note: '앱이 정하는 번호예요. 고치지 마세요.', sys: 1, hidden: 1 }),
  F_('_u', '수정(ms)', 'num', 100, { note: '앱이 적는 칸이에요. 고치지 마세요.', sys: 1, hidden: 1 }),
  F_('su', '서버(ms)', 'num', 100, { note: '앱이 적는 칸이에요. 고치지 마세요.', sys: 1, hidden: 1 }),
];
const COL_ORDER = ['todos', 'progress', 'events', 'memos', 'ddays', 'links'];
const RICH_TABS = ['memos', 'events']; // 서식 글(html)과 글자만(plain) 칸이 짝으로 있는 탭
const SETTINGS_TAB = '설정';
const SETTING_NOTES = {
  neisKey: ['나이스 인증키', '붙여 넣으면 급식·학사일정·시간표를 정식으로 불러와요. 이 칸은 앱으로 내려가지 않아요.'],
  airKey: ['에어코리아 인증키', '공공데이터포털 일반 인증키(Decoding). 이 칸은 앱으로 내려가지 않아요.'],
  '제작자 정보': ['제작자 정보', '앱 정보에 버전과 함께 보여요. 이 칸은 앱이 고치지 않아요.'],
  adminPw: ['관리자 비밀번호', '앱 제목 앞 아이콘에서 이 시트를 열 때 쓰는 비밀번호예요. 비워 두면 아이콘이 열리지 않아요.'],
  school: ['급식 학교', ''], location: ['날씨 지역', ''], air: ['미세먼지 측정소', ''], myClasses: ['내 수업 반', ''],
  theme: ['테마', ''], bodyFont: ['본문 글꼴', ''], titleFont: ['제목 글꼴', ''], titles: ['위젯 제목', ''],
  todayCards: ['오늘 화면 카드', ''], icals: ['연결한 캘린더', '구글 캘린더 비공개 주소가 들어 있어요. 시트를 남에게 공유하지 마세요.'],
};

/* ============================ 메뉴 ============================ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('로망데스크')
    .addItem('기기 추가하기 (연결 키·QR 보기)', 'menuAddDevice')
    .addItem('연결 코드 바꾸기 (모든 기기 다시 연결)', 'menuConnect')
    .addItem('모든 기기 연결 끊기', 'menuDisconnect')
    .addSeparator()
    .addItem('시트 준비하기 (탭 만들기·다듬기)', 'menuSetup')
    .addItem('메모 모아보기 새로 고침', 'menuMemoView')
    .addItem('설정 칸 안내', 'menuHelp')
    .addSeparator()
    .addItem('자동 백업 켜기 (매월 1일)', 'menuBackupOn')
    .addItem('지금 백업하기', 'menuBackupNow')
    .addSeparator()
    .addItem('서버 업데이트 (지금 ' + VERSION + ')', 'menuServerUpdate')
    .addToUi();
}
function menuSetup() {
  setupAll_();
  const has = !!PropertiesService.getScriptProperties().getProperty('connCode');
  SpreadsheetApp.getActive().toast(has ? '탭을 정리했어요.' : '탭을 준비했어요. 다음은 [로망데스크 → 연결 코드 바꾸기]', '로망데스크', 6);
}
function menuMemoView() {
  refreshMemoView_();
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(VIEW.memo);
  if (sh) ss.setActiveSheet(sh);
}
function menuHelp() {
  SpreadsheetApp.getUi().alert('설정 탭에서 아래 칸을 직접 채울 수 있어요.\n\n· neisKey: 나이스 인증키\n· airKey: 공공데이터포털 인증키 (에어코리아·기상청·측정소정보)\n· adminPw: 관리자 비밀번호\n· 제작자 정보: 앱 정보에 보이는 글\n\n이 네 칸은 앱이 바꾸지 않고, 인증키·비밀번호는 앱으로 내려가지 않아요. 시트를 남에게 공유할 때는 지우고 주세요.');
}
// 연결 코드 바꾸기: 새 코드를 만들면 지금까지 연결한 기기는 모두 끊긴다
function menuConnect() {
  const ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  if (p.getProperty('codeHash') && ui.alert('연결 코드 바꾸기', '새 코드를 만들면 지금 연결된 PC·폰·태블릿이 모두 끊겨요.\n기기 하나를 더 연결하려는 거라면 [기기 추가하기]를 쓰세요.\n\n코드를 바꿀까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  setupAll_();
  const code = newCode_();
  p.setProperty('codeSalt', Utilities.getUuid());
  p.setProperty('codeHash', hash_(p.getProperty('codeSalt') + code));
  p.setProperty('connCode', code);
  p.deleteProperty('fails'); p.deleteProperty('lockUntil');
  showConnDialog_(code, true);
}
// 기기 추가하기: 지금 코드를 다시 보여 준다 (기존 기기는 그대로)
function menuAddDevice() {
  const p = PropertiesService.getScriptProperties(), code = p.getProperty('connCode');
  if (!code || !p.getProperty('codeHash')) {
    SpreadsheetApp.getUi().alert('기기 추가하기', '다시 보여 줄 연결 코드가 없어요.\n처음 한 번은 [연결 코드 바꾸기]로 코드를 만들어 주세요. (이때 이미 연결된 기기는 다시 연결해야 해요)', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  showConnDialog_(code, false);
}
function showConnDialog_(code, isNew) {
  const p = PropertiesService.getScriptProperties();
  const dh = typeof rdFile_ === 'function' ? rdFile_('Dialog.html') : null; // 껍데기가 보관해 둔 대화창 (없으면 프로젝트의 Dialog 파일)
  const t = dh ? HtmlService.createTemplate(dh) : HtmlService.createTemplateFromFile('Dialog');
  // 웹앱 주소는 짐작해서 채우지 않는다 (틀린 주소가 들어간 적이 있음). 선생님이 한 번 붙여 넣은 주소만 기억해 채운다.
  t.data = JSON.stringify({ code: code, isNew: !!isNew, execUrl: p.getProperty('execUrl') || '', appUrl: p.getProperty('appUrl') || '' });
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(560).setHeight(660), isNew ? '연결 코드 바꾸기' : '기기 추가하기');
}
function saveAppUrl(u) { PropertiesService.getScriptProperties().setProperty('appUrl', String(u || '').slice(0, 300)); return true; }
function saveExecUrl(u) {
  u = String(u || '').trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) return false;
  PropertiesService.getScriptProperties().setProperty('execUrl', u.slice(0, 300)); return true;
}
function menuDisconnect() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('모든 기기 연결 끊기', 'PC·폰·태블릿의 연결이 모두 끊겨요. 기록은 시트에 그대로 남아요.\n계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty('codeHash'); p.deleteProperty('codeSalt'); p.deleteProperty('connCode'); p.deleteProperty('fails'); p.deleteProperty('lockUntil');
  SpreadsheetApp.getActive().toast('모든 기기의 연결을 끊었어요.', '로망데스크', 5);
}

/* ============================ 웹앱 진입 ============================ */
function doGet() {
  return json_({ ok: true, name: '로망데스크 서버', v: VERSION, note: '이 주소는 앱이 사용해요. 브라우저에서 열 필요는 없어요.' });
}
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, code: 'BAD', error: '요청을 읽지 못했어요' }); }
  const a = auth_(String(req.k || ''));
  if (!a.ok) return json_(a);
  try {
    switch (req.a) {
      case 'ping': return json_({ ok: true, v: VERSION, name: SpreadsheetApp.getActive().getName(), flags: flags_(), now: Date.now() });
      case 'sync': return json_(sync_(req));
      case 'neis': return json_(neis_(req));
      case 'air': return json_(air_(req));
      case 'kma': return json_(kma_(req));
      case 'airNear': return json_(airNear_(req));
      case 'ics': return json_(ics_(req));
      case 'checkKey': return json_(checkKey_(req));
      case 'admin': return json_(admin_(req));
      case 'periods': return json_({ ok: true, periods: periods_() });
      case 'imgUp': return json_(imgUp_(req));
      case 'imgGet': return json_(imgGet_(req));
      case 'fileStart': return json_(fileStart_(req));
      case 'fileChunk': return json_(fileChunk_(req));
      case 'fileGc': return json_(fileGc_(req));
      case 'toDoc': return json_(toDoc_(req));
      case 'backup': { const r = backupNow_(); r.flags = flags_(); return json_(r); }
      default: return json_({ ok: false, code: 'BAD', error: '알 수 없는 요청' });
    }
  } catch (err) {
    return json_({ ok: false, code: 'ERR', error: String(err && err.message || err) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ============================ 인증 ============================ */
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function newCode_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function auth_(code) {
  const p = PropertiesService.getScriptProperties();
  const now = Date.now();
  const until = Number(p.getProperty('lockUntil') || 0);
  if (now < until) return { ok: false, code: 'LOCK', error: '연결 시도가 너무 많아 잠시 잠겼어요. ' + Math.ceil((until - now) / 60000) + '분 뒤에 다시 해 주세요.' };
  const h = p.getProperty('codeHash');
  if (!h) return { ok: false, code: 'NOCODE', error: '연결 코드가 없어요. 시트 메뉴 [로망데스크 → 연결 코드 바꾸기]를 먼저 해 주세요.' };
  if (code && hash_(p.getProperty('codeSalt') + code) === h) { if (p.getProperty('fails')) p.deleteProperty('fails'); return { ok: true }; }
  const n = Number(p.getProperty('fails') || 0) + 1;
  if (n >= MAX_FAILS) { p.setProperty('lockUntil', String(now + LOCK_MIN * 60000)); p.deleteProperty('fails'); } else p.setProperty('fails', String(n));
  return { ok: false, code: 'AUTH', error: '연결 코드가 맞지 않아요. 연결 키를 다시 확인해 주세요.' };
}

/* ============================ 시트 모양 버전 올리기 ============================ */
// v2 (1.4.0): 날짜를 '2026.11.07.' 글자로, 시각을 '2026.11.07. 08:10'으로, 앱이 쓰는 칸을 연회색으로, 보기 탭 수식을 점 날짜용으로.
// 이미 쓰던 시트도 동기화(또는 시트 준비하기) 때 한 번만 정리한다. 선생님이 적은 내용은 그대로 두고 모양만 바꾼다.
function upgrade_() {
  const p = PropertiesService.getScriptProperties();
  if (Number(p.getProperty('layoutVer') || 0) >= LAYOUT_VER) return;
  const ss = SpreadsheetApp.getActive();
  COL_ORDER.forEach(function (key) {
    if (!ss.getSheetByName(SPECS[key].name)) return;
    const t = openTab_(key), sh = t.sh, maxR = sh.getMaxRows();
    t.cols.forEach(function (c) {
      const col = t.idx[c.k] + 1; if (!col || maxR < 2) return;
      const body = sh.getRange(2, col, maxR - 1, 1);
      if (c.fmt === 'date') { body.setNumberFormat('@'); if (c.note) sh.getRange(1, col).setNote(c.note); }
      if (c.t === 'ts') body.setNumberFormat(TS_FMT);
      if (isAppCol_(c)) body.setBackground(APP_BG);
    });
    t.rows.forEach(function (o) { if (Number(o._u)) o.when = whenStr_(Number(o._u)); });
    if (t.rows.length) saveTab_(t); // 날짜·수정 일시를 점 모양으로 다시 씀
  });
  const st = ss.getSheetByName(SETTINGS_TAB);
  if (st && st.getMaxRows() > 1) st.getRange(2, 3, st.getMaxRows() - 1, 2).setBackground(APP_BG);
  // 보기 탭: 수식만 새로 (선생님이 고른 반·기간·기간표 날짜는 그대로)
  let v;
  if ((v = ss.getSheetByName(VIEW.prog))) { progFormulas_(v, recRef_('progress')); v.getRange(3, 8, 7, 2).setNumberFormat('yyyy.mm.dd.'); }
  if ((v = ss.getSheetByName(VIEW.todo))) todoFormulas_(v, recRef_('todos'));
  if ((v = ss.getSheetByName(VIEW.month))) monthFormulas_(v, recRef_('events'), recRef_('ddays'));
  const dd = ss.getSheetByName(SPECS.ddays.name);
  if (dd) { const t = openTab_('ddays'), L = {}; t.cols.forEach(function (c) { L[c.k] = colLetter_(t.idx[c.k] + 1); }); const f = SPECS.ddays.cols.filter(function (c) { return c.t === 'formula'; })[0]; dd.getRange(1, t.idx[f.k] + 1).setFormula(f.formula(L)); }
  p.setProperty('layoutVer', String(LAYOUT_VER));
}

/* ============================ 시트 준비 ============================ */
function setupAll_() {
  const ss = SpreadsheetApp.getActive();
  COL_ORDER.forEach(function (k) { openTab_(k); });
  openSettings_().setTabColor(TAB_COLOR.set);
  setupViews_();
  upgrade_();
  // 기본 빈 시트 정리 (다른 탭을 만든 뒤 비어 있을 때만)
  ['시트1', 'Sheet1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() <= 1 && s.getLastColumn() <= 1) { try { ss.deleteSheet(s); } catch (e) {} }
  });
  // 순서: 보기 탭 → 기록 탭 → 설정
  const order = [VIEW.prog, VIEW.todo, VIEW.month, VIEW.memo].concat(COL_ORDER.map(function (k) { return SPECS[k].name; }), [SETTINGS_TAB]);
  order.forEach(function (n, i) { const s = ss.getSheetByName(n); if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); } });
  const first = ss.getSheetByName(VIEW.prog); if (first) ss.setActiveSheet(first);
}
function allCols_(key) {
  const c = SPECS[key].cols;
  return c.filter(function (x) { return !x.hidden; }).concat(SYS_SHOW, SYS_HIDE, c.filter(function (x) { return x.hidden; }));
}
const dataCols_ = function (key) { return SPECS[key].cols.filter(function (c) { return c.t !== 'formula' && !c.derived; }); };
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function styleHeader_(sh, c, forceBg) {
  const r = sh.getRange(1, c);
  if (forceBg || r.getBackground() === '#ffffff') r.setBackground(HEAD_BG).setFontColor('#000000');
  r.setFontWeight('normal').setHorizontalAlignment('center').setVerticalAlignment('middle');
}
function createTab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

// 탭을 열어 (없으면 만들어) 제목줄·서식을 맞추고, 줄을 읽는다
function openTab_(key) {
  const ss = SpreadsheetApp.getActive();
  const spec = SPECS[key], cols = allCols_(key);
  const isNew = !ss.getSheetByName(spec.name);
  const sh = createTab_(ss, spec.name);
  let vals = sh.getDataRange().getValues();
  let head = (vals[0] || []).map(String);
  if (head.length === 1 && head[0] === '') head = [];
  // 계산 칸(남은 날 등)은 오류가 나도 제목으로 알아보게 수식으로 찾는다
  cols.forEach(function (c) {
    if (c.t !== 'formula' || head.indexOf(c.h) >= 0 || !head.length) return;
    const fs = sh.getRange(1, 1, 1, head.length).getFormulas()[0];
    const j = fs.findIndex(function (f) { return String(f).indexOf('"' + c.h + '"') >= 0; });
    if (j >= 0) head[j] = c.h;
  });
  let changed = false;
  const added = [];
  cols.forEach(function (c, ci) {
    if (head.indexOf(c.h) >= 0) return;
    changed = true;
    // 이미 쓰던 탭에 새 칸이 생기면(예: 일정의 끝 날짜·분류·노트) 정해진 자리(뒤에 올 칸 바로 앞)에 열을 끼워 넣는다 → 숨긴 칸 뒤로 밀리지 않게
    let at = -1;
    if (!isNew && head.length) for (let j = ci + 1; j < cols.length && at < 0; j++) at = head.indexOf(cols[j].h);
    if (at >= 0) { sh.insertColumnBefore(at + 1); head.splice(at, 0, c.h); added.push(c); }
    else { head.push(c.h); if (!isNew && head.length > 1) added.push(c); }
  });
  if (changed || isNew) {
    if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    vals = sh.getDataRange().getValues();
    while (vals[0] && vals[0].length < head.length) vals[0].push('');
  }
  const idx = {};
  cols.forEach(function (c) { idx[c.k] = head.indexOf(c.h); });
  // 끼워 넣은 열은 옆 칸의 서식(체크 상자·회색 등)을 물려받지 않게 지우고, 숨길 칸은 숨긴다
  added.forEach(function (c) {
    const col = idx[c.k] + 1, maxR = sh.getMaxRows();
    if (maxR > 1) sh.getRange(2, col, maxR - 1, 1).clearFormat().clearDataValidations();
    sh.getRange(1, col).setBackground(HEAD_BG).setFontColor('#000000');
    if (c.hidden) sh.hideColumns(col);
  });
  // 서식은 새 탭이거나 열이 추가됐을 때만 입힌다 (선생님이 바꾼 서식을 지키려고)
  if (changed || isNew) formatTab_(sh, cols, idx, head.length, isNew, key);
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const raw = vals[i], o = { _raw: raw };
    cols.forEach(function (c) { if (c.t !== 'formula') o[c.k] = fromCell_(c, raw[idx[c.k]]); });
    if (!o.id && !hasContent_(spec, o)) continue;
    rows.push(o);
  }
  return { sh: sh, spec: spec, cols: cols, idx: idx, ncols: head.length, nOld: Math.max(vals.length - 1, 0), rows: rows, key: key };
}
function hasContent_(spec, o) {
  return spec.cols.some(function (c) { return c.t === 'text' && String(o[c.k] || '').trim() !== ''; });
}
function formatTab_(sh, cols, idx, ncols, isNew, key) {
  const maxR = sh.getMaxRows();
  const L = {}; cols.forEach(function (c) { L[c.k] = colLetter_(idx[c.k] + 1); });
  cols.forEach(function (c) {
    const col = idx[c.k] + 1;
    styleHeader_(sh, col, !!isNew);
    sh.setColumnWidth(col, c.w || 100);
    if (c.note) sh.getRange(1, col).setNote(c.note);
    if (c.t === 'formula') { sh.getRange(1, col).setFormula(c.formula(L)); if (maxR > 1) sh.getRange(2, col, maxR - 1, 1).setFontColor('#6b6980').setHorizontalAlignment('center').setBackground(APP_BG); return; }
    if (maxR > 1) fmtBody_(c, sh.getRange(2, col, maxR - 1, 1));
  });
  sh.getRange(1, 1, 1, ncols).setVerticalAlignment('middle');
  sh.setRowHeight(1, 28);
  sh.setFrozenRows(1);
  if (!isNew) return;
  // 새 탭만: 숨긴 칸, 회색·취소선 규칙, 필터, 탭 색
  const shown = cols.filter(function (c) { return !c.hidden; }).length;
  const hid = cols.filter(function (c) { return c.hidden; });
  if (hid.length) sh.hideColumns(idx[hid[0].k] + 1, hid.length);
  if (maxR > 1) {
    const rng = sh.getRange(2, 1, maxR - 1, shown);
    const rules = [SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L.del + '2=TRUE').setFontColor('#a3a1b0').setStrikethrough(true).setRanges([rng]).build()];
    const grey = key === 'todos' ? 'done' : key === 'memos' ? 'trash' : '';
    if (grey) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L[grey] + '2=TRUE').setFontColor('#a3a1b0').setRanges([rng]).build());
    sh.setConditionalFormatRules(rules);
  }
  try { if (!sh.getFilter()) sh.getRange(1, 1, maxR, shown).createFilter(); } catch (e) {}
  sh.setTabColor(TAB_COLOR.rec);
}

// 칸 모양 (체크 상자는 내용 있는 줄에만 따로 넣는다 → tidyRows_)
function fmtBody_(c, body) {
  if (c.t === 'text') body.setNumberFormat('@');
  else if (c.t === 'num') body.setNumberFormat('0');
  else if (c.t === 'ts') body.setNumberFormat(TS_FMT).setFontColor('#6b6980');
  if (isAppCol_(c)) body.setBackground(APP_BG);
  if (c.t === 'bool') body.setHorizontalAlignment('center');
  const list = c.map ? Object.keys(c.map).map(function (k) { return c.map[k]; }) : c.list;
  if (list) body.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build());
  if (c.sys && c.t !== 'bool') body.setFontColor('#8a8a8a');
  if (c.k === 'title' || c.k === 'text' || c.k === 'plain' || c.k === 'url') body.setWrap(true);
  if (c.fmt === 'date' || c.fmt === 'time' || c.map || c.k === 'cls') body.setHorizontalAlignment('center');
  body.setVerticalAlignment('top');
}
// 줄 수 맞추기: 쓴 줄 + 빈 줄 SPARE_ROWS 개만 남기고, 체크 상자는 쓴 줄에만 → 인쇄하면 쓴 줄만 나온다
function tidyRows_(t, n) {
  const sh = t.sh, need = n + 1 + SPARE_ROWS;
  let maxR = sh.getMaxRows();
  if (maxR < need) {
    const add = need - maxR, at = Math.max(maxR - 1, 1); // 마지막 줄 앞에 끼워 넣어야 필터·회색 규칙 범위가 같이 늘어난다
    sh.insertRowsAfter(at, add);
    t.cols.forEach(function (c) { const col = t.idx[c.k] + 1; if (col > 0 && c.t !== 'formula') fmtBody_(c, sh.getRange(at + 1, col, add, 1)); });
    maxR = need;
  } else if (maxR > need) { sh.deleteRows(need + 1, maxR - need); maxR = need; }
  t.cols.forEach(function (c) {
    if (c.t !== 'bool') return;
    const col = t.idx[c.k] + 1; if (col < 1) return;
    if (n) sh.getRange(2, col, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    sh.getRange(n + 2, col, maxR - n - 1, 1).clearDataValidations().clearContent();
  });
}

// 앱이 쓰는 칸 (연회색, 시트에서 고치면 되돌림): 완료일·만든 날·수정 일시·계산 칸·숨긴 칸
function isAppCol_(c) { return c.t === 'ts' || c.k === 'when' || c.t === 'formula' || !!c.hidden; }
function toCell_(c, v) {
  if (c.t === 'bool') return v === true || v === 'TRUE' || v === 'true';
  if (c.t === 'num') { const n = Number(v); return (v === null || v === undefined || v === '' || isNaN(n)) ? '' : n; }
  if (c.t === 'ts') { const n = Number(v); return (!v || isNaN(n) || n <= 0) ? '' : new Date(n); }
  if (v === null || v === undefined) return '';
  if (c.fmt === 'date') return dotStr_(isoOf_(v)) || String(v);
  if (c.map) return c.map[v] || String(v);
  return String(v);
}
// 날짜 글자: '2026-11-07' ↔ '2026.11.07.'
function dotStr_(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[1] + '.' + m[2] + '.' + m[3] + '.' : ''; }
// 시트에 적힌 날짜(점·줄표·빗금, 끝 점, 띄어쓰기, 날짜 값) → '2026-11-07' (못 읽으면 '')
function isoOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const t = String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, '').replace(/[.\/-]+$/, '');
  const m = t.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
function fromCell_(c, v) {
  if (c.t === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  if (c.t === 'num') { const n = Number(v); return (v === '' || v === null || isNaN(n)) ? 0 : n; }
  if (c.t === 'ts') {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v > 1e11 ? v : 0;
    const m = String(v || '').trim().match(/^(\d{4})[.\/-]\s?(\d{1,2})[.\/-]\s?(\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2}))?/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
  }
  if (c.fmt === 'date') return isoOf_(v);
  if (v instanceof Date) {
    const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, tz, c.fmt === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
  }
  let out = (v === null || v === undefined) ? '' : String(v);
  if (c.map) { const t = out.trim(); const k = Object.keys(c.map).filter(function (x) { return c.map[x] === t; })[0]; if (k) out = k; }
  return out;
}
function saveTab_(t) {
  const out = [];
  t.rows.forEach(function (o) {
    const row = (o._raw ? o._raw.slice() : []);
    while (row.length < t.ncols) row.push('');
    row.length = t.ncols;
    t.cols.forEach(function (c) { if (c.t !== 'formula') row[t.idx[c.k]] = toCell_(c, o[c.k]); });
    out.push(row);
  });
  // 계산 칸(수식)은 건너뛰고 나머지 칸 묶음만 쓴다
  const skip = t.cols.filter(function (c) { return c.t === 'formula'; }).map(function (c) { return t.idx[c.k]; });
  const segs = []; let st = -1;
  for (let j = 0; j <= t.ncols; j++) {
    const ok = j < t.ncols && skip.indexOf(j) < 0;
    if (ok && st < 0) st = j;
    if (!ok && st >= 0) { segs.push([st, j - st]); st = -1; }
  }
  const sh = t.sh;
  tidyRows_(t, out.length);
  const maxR = sh.getMaxRows();
  segs.forEach(function (g) {
    if (out.length) sh.getRange(2, g[0] + 1, out.length, g[1]).setValues(out.map(function (r) { return r.slice(g[0], g[0] + g[1]); }));
    const left = Math.min(t.nOld, maxR - 1) - out.length;
    if (left > 0) sh.getRange(2 + out.length, g[0] + 1, left, g[1]).clearContent();
  });
  t.nOld = out.length;
}

/* ---------- 줄째 지운 항목의 기록 (숨긴 탭 '삭제 기록') ---------- */
function memoEmpty_(html) { // 빈 메모: 글자도 이미지도 첨부도 없음 (띄어쓰기·줄바꿈·체크 상자만 있어도 빈 것)
  const h = String(html || '');
  if (/<img\b|data-fid=/i.test(h)) return false;
  return !h.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[☐☑\s\u00a0\u200b]/g, '');
}
function loadDelLog_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DEL_TAB), map = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (!r[0] || !r[1]) return;
    (map[r[0]] = map[r[0]] || {})[String(r[1])] = { _u: Number(r[2]) || 0, su: Number(r[3]) || 0 };
  });
  return map;
}
function saveDelLog_(map) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DEL_TAB);
  const rows = [];
  Object.keys(map).forEach(function (k) { Object.keys(map[k]).forEach(function (id) { rows.push([k, id, map[k][id]._u, map[k][id].su]); }); });
  if (!sh) {
    if (!rows.length) return;
    sh = ss.insertSheet(DEL_TAB, ss.getSheets().length);
    sh.getRange(1, 1, 1, 4).setValues([['종류', 'ID', '수정(ms)', '서버(ms)']]).setBackground(HEAD_BG).setFontColor('#000000').setFontWeight('normal').setHorizontalAlignment('center');
    sh.getRange(1, 1).setNote('앱이 쓰는 칸이에요. 지운 빈 포스트잇을 다른 기기에도 지우려고 30일 동안 번호만 적어 둬요. 고치지 마세요.');
    sh.setFrozenRows(1); sh.setColumnWidths(1, 4, 110); sh.getRange('C:D').setNumberFormat('0'); sh.hideSheet();
  }
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 4).clearContent();
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }
}
function whenStr_(ms) { return Utilities.formatDate(new Date(ms), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy.MM.dd. HH:mm'); }
function newId_() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ============================ 보기 탭 (인쇄용) ============================ */
// 기록 탭의 칸 위치 → 수식에 쓸 범위 글자 ('진도'!A2:A)
function recRef_(key) {
  const t = openTab_(key), q = "'" + SPECS[key].name + "'!", o = {};
  t.cols.forEach(function (c) { const L = colLetter_(t.idx[c.k] + 1); o[c.k] = q + L + '2:' + L; });
  return o;
}
function headRow_(sh, r, c, labels) {
  sh.getRange(r, c, 1, labels.length).setValues([labels]).setBackground(HEAD_BG).setFontColor('#000000').setFontWeight('normal').setHorizontalAlignment('center').setVerticalAlignment('middle');
}
function viewTab_(name) {
  const ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(name)) return null; // 이미 있으면 선생님이 고친 것을 지킨다
  const sh = ss.insertSheet(name);
  sh.setTabColor(TAB_COLOR.view);
  return sh;
}
function inputCell_(r) { return r.setBackground('#fff8e1').setHorizontalAlignment('center'); }
// 점 날짜 글자('2026.11.07.')를 수식에서 날짜로: 끝 점을 떼고 구분자를 '-'로 바꿔 DATEVALUE
function DVX_(x) { return 'DATEVALUE(REGEXREPLACE(REGEXREPLACE(TO_TEXT(' + x + '),"\\.\\s*$",""),"\\s*[./]\\s*","-"))'; }
const WD_ = 'MID("일월화수목금토",WEEKDAY(' + DVX_('INDEX(g,0,1)') + '),1)';
const DV_ = function (cell) { return 'LET(v,' + cell + ',IF(ISNUMBER(v),v,' + DVX_('v') + '))'; };

function defaultPeriods_() {
  const n = new Date(), Y = n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
  const D = function (y, m, d) { return new Date(y, m - 1, d); };
  return [
    ['1학기', D(Y, 3, 1), D(Y, 8, 15)], ['2학기', D(Y, 8, 16), D(Y + 1, 3, 0)],
    ['1학기 1차 지필', D(Y, 3, 1), D(Y, 4, 30)], ['1학기 2차 지필', D(Y, 5, 1), D(Y, 7, 31)],
    ['2학기 1차 지필', D(Y, 8, 16), D(Y, 10, 15)], ['2학기 2차 지필', D(Y, 10, 16), D(Y, 12, 31)],
    ['직접 입력', D(Y, 3, 1), D(Y, 3, 31)],
  ];
}
// 앱의 진도 인쇄가 쓰는 기간표 (진도 기록부 탭 오른쪽 표)
function periods_() {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const f = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : (isoOf_(v) || String(v || '').trim()); };
  const sh = SpreadsheetApp.getActive().getSheetByName(VIEW.prog);
  const rows = sh ? sh.getRange(3, 7, 7, 3).getValues() : defaultPeriods_();
  return rows.filter(function (r) { return String(r[0] || '').trim(); }).map(function (r) { return [String(r[0]).trim(), f(r[1]), f(r[2])]; });
}

// 보기 탭 수식 (처음 만들 때 + 시트 모양 버전이 올라갈 때 다시 씀)
function progFormulas_(sh, P) {
  sh.getRange(3, 1).setFormula('=IF(OR($B$2="",$D$2=""),"위에서 반과 기간을 골라 주세요",TEXT(' + DV_('VLOOKUP($D$2,$G$3:$I$9,2,FALSE)') + ',"yyyy.mm.dd.")&" ~ "&TEXT(' + DV_('VLOOKUP($D$2,$G$3:$I$9,3,FALSE)') + ',"yyyy.mm.dd.")&"  ·  "&COUNT($A$5:$A)&"차시")');
  sh.getRange(5, 1).setFormula('=IF(OR($B$2="",$D$2=""),"",ARRAYFORMULA(LET(s,' + DV_('VLOOKUP($D$2,$G$3:$I$9,2,FALSE)') + ',e,' + DV_('VLOOKUP($D$2,$G$3:$I$9,3,FALSE)') +
    ',d,' + P.date + ',c,' + P.cls + ',t,' + P.text + ',x,' + P.del + ',dv,IFERROR(' + DVX_('d') + ',0),f,IFERROR(FILTER({d,t},c=$B$2,x<>TRUE,dv>=s,dv<=e),""),' +
    'IF(ROWS(f)*COLUMNS(f)=1,"(이 기간 기록이 없어요)",LET(g,SORT(f,1,TRUE),{SEQUENCE(ROWS(g)),INDEX(g,0,1),' + WD_ + ',INDEX(g,0,2)})))))');
}
function todoFormulas_(sh, T) {
  sh.getRange(4, 1).setFormula('=ARRAYFORMULA(LET(t,' + T.title + ',c,' + T.cat + ',du,' + T.due + ',rp,' + T.rep + ',dn,' + T.done + ',x,' + T.del +
    ',f,IFERROR(FILTER({du,c,t,rp},t<>"",dn<>TRUE,x<>TRUE),""),IF(ROWS(f)*COLUMNS(f)=1,"(남은 할 일이 없어요)",LET(k,INDEX(f,0,1),g,SORT(f,IF(k="","9999.99.99.",k),TRUE),gd,INDEX(g,0,1),dd,IFERROR(' + DVX_('gd') + '-TODAY(),""),' +
    '{gd,IF(gd="","",IF(dd="","",IF(dd=0,"오늘",IF(dd=1,"내일",IF(dd<0,-dd&"일 지남","D-"&dd))))),INDEX(g,0,2),INDEX(g,0,3),INDEX(g,0,4)}))))');
  sh.getRange(4, 7).setFormula('=ARRAYFORMULA(LET(t,' + T.title + ',c,' + T.cat + ',da,' + T.doneAt + ',dn,' + T.done + ',x,' + T.del +
    ',f,IFERROR(FILTER({TEXT(da,"yyyy.mm.dd."),c,t},dn=TRUE,x<>TRUE,TEXT(da,"yyyy-mm")=TEXT(TODAY(),"yyyy-mm")),""),IF(ROWS(f)*COLUMNS(f)=1,"(이번 달 끝낸 일이 없어요)",SORT(f,1,FALSE))))');
}
function monthFormulas_(sh, E, D) {
  sh.getRange(1, 4).setNote('예: 2026.11 · 비워 두면 이번 달');
  const mm = function (x) { return 'IFERROR(TEXT(' + DVX_(x) + ',"yyyy.mm"),"")'; };
  sh.getRange(3, 1).setFormula('=ARRAYFORMULA(LET(m,IF($D$1="",TEXT(TODAY(),"yyyy.mm"),IFERROR(TEXT(' + DVX_('REGEXREPLACE(TO_TEXT($D$1),"[.\\s]+$","")&".1"') + ',"yyyy.mm"),"")),ed,' + E.date + ',et,' + E.time + ',en,' + E.title + ',ex,' + E.del +
    ',dd,' + D.date + ',dn,' + D.title + ',dx,' + D.del +
    ',a,IFERROR(FILTER({ed,et,en,IF(ed="","","내 일정")},' + mm('ed') + '=m,en<>"",ex<>TRUE),{"","","",""}),b,IFERROR(FILTER({dd,IF(dd="","",""),dn,IF(dd="","","D-Day")},' + mm('dd') + '=m,dn<>"",dx<>TRUE),{"","","",""}),' +
    'v,{a;b},IFERROR(LET(g,SORT(FILTER(v,INDEX(v,0,1)<>""),1,TRUE,2,TRUE),{INDEX(g,0,1),' + WD_ + ',INDEX(g,0,2),INDEX(g,0,3),INDEX(g,0,4)}),"(이 달 일정이 없어요)")))');
}

function setupViews_() {
  let sh;
  // ── 진도 기록부: 반·기간을 고르면 날짜순 정리 ──
  if ((sh = viewTab_(VIEW.prog))) {
    const P = recRef_('progress');
    sh.getRange(1, 1).setValue('진도 기록부').setFontSize(14);
    sh.getRange(2, 1, 1, 4).setValues([['반', '', '기간', '']]);
    inputCell_(sh.getRange(2, 2)).setNote('반을 고르세요 (진도 탭에 적힌 반이 나와요)');
    inputCell_(sh.getRange(2, 4)).setNote('기간을 고르세요. 날짜는 오른쪽 표에서 고쳐요.');
    sh.getRange(2, 2).setNumberFormat('@');
    sh.getRange(3, 1, 1, 5).merge().setFontColor('#6b6980');
    headRow_(sh, 4, 1, ['차시', '날짜', '요일', '진도 내용', '비고']);
    progFormulas_(sh, P);
    sh.getRange(1, 7, 1, 3).merge().setValue('기간 설정 · 매년 날짜만 고쳐요').setHorizontalAlignment('center');
    headRow_(sh, 2, 7, ['기간', '시작일', '종료일']);
    sh.getRange(3, 7, 7, 3).setValues(defaultPeriods_());
    inputCell_(sh.getRange(3, 8, 7, 2)).setNumberFormat('yyyy.mm.dd.');
    sh.getRange(10, 7, 1, 3).merge().setValue('지필 기간은 이전 지필 다음 날부터 이번 지필 날까지 적어요').setFontColor('#8a8a8a').setFontSize(9).setWrap(true);
    sh.getRange(1, 11).setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + P.cls + ',' + P.cls + '<>"",' + P.del + '<>TRUE))),"")');
    sh.getRange(2, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange(1, 11, 200, 1), true).setAllowInvalid(true).build());
    sh.getRange(2, 4).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange(3, 7, 7, 1), true).setAllowInvalid(false).build());
    [46, 92, 40, 330, 120, 16, 116, 92, 92, 16, 60].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.hideColumns(11);
    sh.getRange(5, 1, sh.getMaxRows() - 4, 3).setHorizontalAlignment('center');
    sh.getRange(5, 4, sh.getMaxRows() - 4, 1).setWrap(true);
    sh.setFrozenRows(4);
  }
  // ── 할 일 현황: 안 끝낸 일(마감순) + 이번 달 끝낸 일 ──
  if ((sh = viewTab_(VIEW.todo))) {
    const T = recRef_('todos');
    sh.getRange(1, 1).setValue('할 일 현황').setFontSize(14);
    sh.getRange(2, 1).setValue('안 끝낸 일 · 마감순').setFontColor('#6b6980');
    sh.getRange(2, 7).setValue('이번 달 끝낸 일').setFontColor('#6b6980');
    headRow_(sh, 3, 1, ['마감', '남은 날', '분류', '할 일', '반복']);
    headRow_(sh, 3, 7, ['끝낸 날', '분류', '할 일']);
    todoFormulas_(sh, T);
    [92, 74, 60, 300, 52, 16, 92, 60, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange(4, 1, sh.getMaxRows() - 3, 3).setHorizontalAlignment('center');
    sh.getRange(4, 5, sh.getMaxRows() - 3, 1).setHorizontalAlignment('center');
    sh.getRange(4, 7, sh.getMaxRows() - 3, 2).setHorizontalAlignment('center');
    sh.getRange(4, 4, sh.getMaxRows() - 3, 1).setWrap(true);
    sh.getRange(4, 9, sh.getMaxRows() - 3, 1).setWrap(true).setFontColor('#6b6980');
    sh.setFrozenRows(3);
  }
  // ── 월간 일정: 내 일정 + D-Day ──
  if ((sh = viewTab_(VIEW.month))) {
    const E = recRef_('events'), D = recRef_('ddays');
    sh.getRange(1, 1).setValue('월간 일정').setFontSize(14);
    sh.getRange(1, 3).setValue('월').setHorizontalAlignment('right');
    inputCell_(sh.getRange(1, 4)).setNumberFormat('@');
    headRow_(sh, 2, 1, ['날짜', '요일', '시간', '일정', '구분']);
    monthFormulas_(sh, E, D);
    [92, 40, 56, 360, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange(3, 1, sh.getMaxRows() - 2, 3).setHorizontalAlignment('center');
    sh.getRange(3, 5, sh.getMaxRows() - 2, 1).setHorizontalAlignment('center').setFontColor('#6b6980');
    sh.getRange(3, 4, sh.getMaxRows() - 2, 1).setWrap(true);
    sh.setFrozenRows(2);
  }
  // ── 메모 모아보기: 2열 카드 (스크립트가 다시 그린다) ──
  if ((sh = viewTab_(VIEW.memo))) { /* 아래에서 채운다 */ }
  refreshMemoView_();
}

const MEMO_BG = { butter: '#fbf6df', pink: '#f8e8ec', sky: '#e8f0f6', mint: '#e8f3eb', lav: '#eeebf6', peach: '#f9ece3' };
function refreshMemoView_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(VIEW.memo) || viewTab_(VIEW.memo);
  const t = openTab_('memos');
  const list = t.rows.filter(function (r) { return !r.del && !r.trash && String(r.plain || memoText_(r.html)).trim(); })
    .sort(function (a, b) { return (Number(b._u) || 0) - (Number(a._u) || 0); });
  const tz = ss.getSpreadsheetTimeZone();
  sh.clear();
  [330, 14, 330].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1).setValue('포스트잇 모음').setFontSize(14);
  sh.getRange(2, 1, 1, 3).merge().setValue('붙어 있는 메모 ' + list.length + '개 · 최근 고친 순 · 앱과 동기화할 때 자동으로 다시 정리돼요 (휴지통 메모는 빼요)').setFontColor('#6b6980').setFontSize(9);
  list.forEach(function (m, i) {
    const r = 4 + Math.floor(i / 2) * 2, c = i % 2 ? 3 : 1;
    const when = Number(m._u) ? Utilities.formatDate(new Date(Number(m._u)), tz, 'M.d.') + ' 고침\n' : '';
    sh.getRange(r, c).setNumberFormat('@').setValue(when + String(m.plain || memoText_(m.html)))
      .setWrap(true).setVerticalAlignment('top').setBackground(MEMO_BG[m.color] || MEMO_BG.butter)
      .setBorder(true, true, true, true, false, false, '#b9b7c4', SpreadsheetApp.BorderStyle.SOLID);
    if (c === 1) sh.setRowHeight(r + 1, 10);
  });
  return list.length;
}

/* ============================ 설정 탭 ============================ */
function openSettings_() {
  const ss = SpreadsheetApp.getActive();
  const isNew = !ss.getSheetByName(SETTINGS_TAB);
  const sh = createTab_(ss, SETTINGS_TAB);
  if (isNew || sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== '항목') {
    const head = ['항목', '값', '수정(ms)', '서버(ms)', '설명'];
    if (sh.getMaxColumns() < 5) sh.insertColumnsAfter(sh.getMaxColumns(), 5 - sh.getMaxColumns());
    sh.getRange(1, 1, 1, 5).setValues([head]);
    [160, 380, 100, 100, 420].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); styleHeader_(sh, i + 1, true); });
    sh.getRange(1, 3).setNote('앱이 적는 칸'); sh.getRange(1, 4).setNote('앱이 적는 칸');
    sh.setFrozenRows(1); sh.setRowHeight(1, 28);
    const mx = sh.getMaxRows();
    if (mx > 1) {
      sh.getRange(2, 1, mx - 1, 2).setNumberFormat('@');
      sh.getRange(2, 5, mx - 1, 1).setNumberFormat('@');
      sh.getRange(2, 3, mx - 1, 2).setNumberFormat('0').setFontColor('#8a8a8a').setBackground(APP_BG);
    }
  }
  // 직접 채우는 칸 3개 (없으면 만든다)
  const vals = sh.getDataRange().getValues();
  const have = {};
  for (let i = 1; i < vals.length; i++) have[String(vals[i][0])] = i + 1;
  RESERVED.forEach(function (k) {
    if (have[k]) return;
    const r = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(r, 1, 1, 5).setValues([[k, '', '', '', SETTING_NOTES[k][0] + ' — ' + SETTING_NOTES[k][1]]]);
    sh.getRange(r, 1, 1, 5).setBackground('#fbf6df');
  });
  return sh;
}
function loadSettings_() {
  const sh = openSettings_();
  const vals = sh.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || '').trim();
    if (!k) continue;
    map[k] = { row: i + 1, v: String(vals[i][1] === null || vals[i][1] === undefined ? '' : vals[i][1]), _u: Number(vals[i][2]) || 0, su: Number(vals[i][3]) || 0 };
  }
  return { sh: sh, map: map };
}
function reservedVal_(k) {
  const s = loadSettings_();
  const sh = s.sh;
  const r = s.map[k];
  return r ? String(sh.getRange(r.row, 2).getDisplayValue()).trim() : '';
}
function setReserved_(k, v) {
  const s = loadSettings_();
  if (s.map[k]) s.sh.getRange(s.map[k].row, 2).setValue(v);
  else s.sh.appendRow([k, v, '', '', '']);
}
function flags_() {
  const s = loadSettings_();
  const has = function (k) { return !!(s.map[k] && String(s.sh.getRange(s.map[k].row, 2).getDisplayValue()).trim()); };
  let maker = ''; // 앱 정보에 보이는 제작자: 설정 탭 '제작자 정보' 줄 (없으면 B6 칸)
  try { maker = s.map['제작자 정보'] ? String(s.sh.getRange(s.map['제작자 정보'].row, 2).getDisplayValue()).trim() : String(s.sh.getRange(6, 2).getDisplayValue()).trim(); } catch (e) {}
  const bp = PropertiesService.getScriptProperties();
  const bk = { on: bp.getProperty('bkOn') === '1', last: Number(bp.getProperty('bkLast')) || 0 }; // 시트 자동 백업 (1.4.17부터)
  return { neis: has('neisKey'), air: has('airKey'), admin: has('adminPw'), maker: maker, notes: true, backup: bk, v: VERSION, shell: typeof RD_SHELL !== 'undefined' ? RD_SHELL : 0 }; // notes: 일정 노트·분류·끝 날짜 칸을 아는 서버 · v: 서버 판 (1.5.1부터, 앱이 업데이트 안내에 씀)
}

/* ============================ 동기화 ============================ */
function sync_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    try { upgrade_(); } catch (e) { console.error('upgrade', e); }
    const now = Date.now();
    const cur = Number(req.cur) || 0;
    const ch = req.ch || {};
    const out = {};
    const purgeBefore = now - KEEP_DEL_DAYS * 864e5;
    let memoChanged = false;
    const delLog = loadDelLog_(), log0 = JSON.stringify(delLog);

    COL_ORDER.forEach(function (key) {
      const t = openTab_(key);
      const byId = {};
      let wrote = false;
      t.rows.forEach(function (r, i) {
        if (!r.id) { r.id = newId_(); r._u = now; r.su = now; r.when = whenStr_(now); wrote = true; }
        byId[r.id] = i;
        // 포스트잇·일정 노트: 시트에서 글자 칸('내용'·'노트')을 고쳤으면 그 글자로 서식을 다시 만들고, 비어 있으면 서식에서 글자를 뽑는다
        if (RICH_TABS.indexOf(key) >= 0 && !r.del) {
          const p0 = String(r.plain || '').trim(), plain = p0 ? memoText_(textHtml_(p0)) : '', fromHtml = memoText_(r.html);
          if (plain && plain !== fromHtml && plain !== memoText_(r.html, true) && plain !== memoTextOld_(r.html)) { r.html = textHtml_(plain); r.plain = plain; wrote = true; }
          else if (p0 !== fromHtml) { r.plain = fromHtml; wrote = true; }
        }
      });
      // 줄째 지운 것(숨긴 탭에 번호만 있음)도 함께 따져야 다른 기기에 '지웠다'를 알려 준다
      const logged = delLog[key] || {};
      Object.keys(logged).forEach(function (id) {
        if (byId[id] !== undefined) return;
        t.rows.push({ id: id, _u: logged[id]._u, su: logged[id].su, del: true }); byId[id] = t.rows.length - 1;
      });
      // 빈 포스트잇은 '삭제됨'으로 남기지 않고 줄째 뺀다 (번호만 숨긴 탭에)
      const gone = function (r) { return key === 'memos' && r.del && memoEmpty_(r.html); };
      if (t.rows.some(function (r) { return gone(r) && !logged[r.id]; })) wrote = true;
      (ch[key] || []).forEach(function (inc) {
        if (!inc || !inc.id) return;
        const i = byId[inc.id];
        const inU = Number(inc._u) || 0;
        let r;
        if (i === undefined) { r = { id: inc.id, _u: 0, su: 0, del: false }; t.rows.push(r); byId[inc.id] = t.rows.length - 1; }
        else r = t.rows[i];
        if (inU <= (Number(r._u) || 0) && i !== undefined) return; // 시트에 더 새 것이 있으면 그쪽이 이긴다
        // 떼어 낸 포스트잇은 [되살리기](rs)로만 다시 붙는다. 예전 화면 기기의 늦은 저장은 내용만 받고 휴지통에 둔다
        const keepTrash = key === 'memos' && i !== undefined && !r.del && r.trash === true && !inc.del && !inc.trash && !inc.rs;
        if (inc.del) { r.del = true; if (key === 'memos' && inc.empty) r.html = ''; } else { // 빈 포스트잇으로 지운 것: 시트에 남은 예전 글은 비운다 → 줄째 빠짐
          r.del = false;
          dataCols_(key).forEach(function (c) { if (inc[c.k] !== undefined) r[c.k] = inc[c.k]; });
          if (RICH_TABS.indexOf(key) >= 0) r.plain = memoText_(r.html);
          if (keepTrash) r.trash = true;
        }
        r._u = keepTrash ? inU + 1 : inU; r.su = now; r.when = whenStr_(r._u); // +1: 보낸 기기도 휴지통 상태를 다시 받게
        wrote = true;
      });
      // 오래된 삭제 줄 정리
      const before = t.rows.length;
      t.rows = t.rows.filter(function (r) { return !(r.del && Number(r.su) < purgeBefore && Number(r.su) < cur); });
      if (t.rows.length !== before) wrote = true;
      const all = t.rows, shown = all.filter(function (r) { return !gone(r); });
      delete delLog[key];
      all.forEach(function (r) { if (gone(r)) (delLog[key] = delLog[key] || {})[r.id] = { _u: Number(r._u) || 0, su: Number(r.su) || 0 }; });
      t.rows = shown;
      // 줄 수가 '쓴 줄 + 빈 줄 5개'가 아니면(예전 시트는 1000줄) 다시 써서 정리. 중간의 빈 줄도 이때 메워진다
      if (wrote || t.sh.getMaxRows() !== shown.length + 1 + SPARE_ROWS) { saveTab_(t); if (key === 'memos') memoChanged = true; }
      t.rows = all;
      out[key] = t.rows.filter(function (r) { return Number(r.su) >= cur; }).map(function (r) { return wire_(key, r); });
    });
    if (JSON.stringify(delLog) !== log0) saveDelLog_(delLog);

    // 설정
    const s = loadSettings_();
    let sw = false;
    (ch.settings || []).forEach(function (inc) {
      if (!inc || !inc.k || RESERVED.indexOf(inc.k) >= 0) return;
      const inU = Number(inc._u) || 0;
      const ex = s.map[inc.k];
      if (ex && inU <= ex._u) return;
      const note = SETTING_NOTES[inc.k] ? SETTING_NOTES[inc.k][0] + (SETTING_NOTES[inc.k][1] ? ' — ' + SETTING_NOTES[inc.k][1] : '') : '';
      if (ex) { s.sh.getRange(ex.row, 2, 1, 3).setValues([[String(inc.v), inU, now]]); ex.v = String(inc.v); ex._u = inU; ex.su = now; }
      else {
        const r = Math.max(s.sh.getLastRow(), 1) + 1;
        s.sh.getRange(r, 1, 1, 5).setValues([[inc.k, String(inc.v), inU, now, note]]);
        s.map[inc.k] = { row: r, v: String(inc.v), _u: inU, su: now };
      }
      sw = true;
    });
    if (memoChanged) { try { refreshMemoView_(); } catch (e) {} }
    out.settings = Object.keys(s.map).filter(function (k) { return RESERVED.indexOf(k) < 0 && s.map[k].su >= cur && s.map[k].v !== ''; })
      .map(function (k) { return { k: k, v: s.map[k].v, _u: s.map[k]._u }; });

    return { ok: true, now: now, cur: now, ch: out, flags: flags_() };
  } finally {
    lock.releaseLock();
  }
}
function wire_(key, r) {
  if (r.del) return { id: r.id, _u: Number(r._u) || 0, del: true };
  const o = { id: r.id, _u: Number(r._u) || 0 };
  dataCols_(key).forEach(function (c) {
    const v = r[c.k];
    o[c.k] = (c.t === 'num' || c.t === 'ts') ? (v === '' || v === undefined || Number(v) === 0 ? null : Number(v)) : v;
  });
  return o;
}
// 포스트잇·일정 노트 서식(html) ↔ 글자
// 줄을 여는 태그(<div> 등) 앞에서도 줄을 바꾼다: 첫 줄은 그냥 글자, 둘째 줄부터 <div>로 저장되기 때문 (안 그러면 첫 줄과 둘째 줄이 붙는다)
function memoText_(html, legacy) {
  return memoTextRaw_(String(html || '').replace(/<(div|p|ul|ol|hr)\b[^>]*>/gi, '\u0001$&'), legacy)
    .replace(/(^|\n)[ \t]*\u0001+/g, '$1').replace(/[ \t]*\u0001+(?=[ \t]*\n)/g, '').replace(/[ \t]*\u0001+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// 1.4.11까지의 글자 뽑기 (시트 '내용' 칸에 예전 방식으로 적힌 글자를 '선생님이 고친 것'으로 잘못 알지 않으려고 남겨 둔다)
function memoTextOld_(html) { return memoTextRaw_(html, true).replace(/\u0001/g, ''); }
// legacy: 1.5.2까지의 방식 (표 칸은 띄어쓰기, 첨부 앞 📎는 글 안에 있었음) → 시트에 예전 방식으로 적힌 글자를 '고친 것'으로 잘못 알지 않게
function memoTextRaw_(html, legacy) {
  let s = String(html || '');
  if (!legacy) s = s
    .replace(/(<a\b[^>]*class="[^"]*\bmfile\b[^"]*"[^>]*>)(?!\s*📎)/gi, '$1📎 ') // 첨부: 📎 이름 · 크기 (주소)
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, function (m, inner) { // 표: | 칸 | 칸 | (줄마다 한 줄)
      const cells = inner.split(/<\/t[dh]>/i).slice(0, -1).map(function (c) { return c.replace(/<t[dh]\b[^>]*>/i, '').replace(/\u0001/g, '').replace(/<br\s*\/?>|<\/?(div|p|li|ul|ol)\b[^>]*>/gi, ' '); });
      return '\u0002| ' + cells.join(' | ') + ' |\u0002';
    });
  return s
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, h, t) { return t + ' (' + h + ')'; }) // 글자에 건 링크: 글자 (주소)
    .replace(/<\/t[dh]>/gi, ' ').replace(/<\/tr>/gi, '\n') // (예전 방식) 표: 칸은 띄어쓰기, 줄은 줄바꿈
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<img[^>]*>/gi, '\n[이미지]\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\u0002+/g, '\n').replace(/\n+(?=\| )/g, '\n').replace(/^\| .*\|[ \t]*$/gm, function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }) // 표 줄: 빈 줄 없이, 칸 안 빈칸은 하나로
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function textHtml_(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[☐☑]/g, function (m) { return '<span class="ckb" contenteditable="false">' + m + '</span>'; })
    .replace(/\n/g, '<br>');
}

// 시트에서 직접 고치면 수정 시각을 갱신해 다른 기기로 퍼지게 한다
function onEdit(e) {
  try {
    const sh = e.range.getSheet(), name = sh.getName();
    const r0 = e.range.getRow(), nr = Math.min(e.range.getNumRows(), 500);
    const c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    if (r0 < 2) return;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const now = Date.now();
    const one = nr === 1 && c1 === c2;
    // 앱이 쓰는 칸을 고쳤으면: 한 칸이면 원래 값으로 되돌리고, 여러 칸이면 알림만
    const guard = function (appCols) {
      const hit = []; for (let c = c1; c <= c2; c++) if (appCols.indexOf(c) >= 0) hit.push(c);
      if (!hit.length) return false;
      if (one) { if (e.oldValue !== undefined) e.range.setValue(e.oldValue); else e.range.clearContent(); }
      SpreadsheetApp.getActive().toast(APP_ONLY_MSG + (one ? '' : ' (여러 칸을 한꺼번에 고친 건 되돌리지 못했어요)'), '로망데스크', 5);
      return hit.length === c2 - c1 + 1; // 앱 칸만 고쳤으면 여기서 끝
    };
    const key = COL_ORDER.filter(function (k) { return SPECS[k].name === name; })[0];
    if (name === SETTINGS_TAB) {
      const cu = head.indexOf('수정(ms)') + 1, cs = head.indexOf('서버(ms)') + 1;
      if (!cu || !cs) return;
      if (guard([cu, cs])) return;
      if (c1 > 2) return;
      for (let i = 0; i < nr; i++) { const r = r0 + i; sh.getRange(r, cu, 1, 2).setValues([[now, now]]); }
      return;
    }
    if (!key) return;
    const cols = allCols_(key);
    const ci = {}; cols.forEach(function (c) { ci[c.k] = head.indexOf(c.h) + 1; });
    if (guard(cols.filter(isAppCol_).map(function (c) { return ci[c.k]; }).filter(Boolean))) return;
    // 날짜 칸을 한 칸 고쳤으면 '2026.11.07.' 모양으로 맞춘다
    const dc = cols.filter(function (c) { return c.fmt === 'date' && ci[c.k] === c1; })[0];
    if (one && dc && e.value !== undefined && String(e.value).trim() !== '') {
      const iso = isoOf_(e.range.getValue());
      if (iso) { if (dotStr_(iso) !== String(e.range.getValue())) e.range.setNumberFormat('@').setValue(dotStr_(iso)); }
      else SpreadsheetApp.getActive().toast('날짜는 2026.12.25.처럼 적어 주세요.', '로망데스크', 5);
    }
    for (let i = 0; i < nr; i++) {
      const r = r0 + i;
      if (ci.id && !sh.getRange(r, ci.id).getValue()) sh.getRange(r, ci.id).setValue(newId_());
      sh.getRange(r, ci._u).setValue(now); sh.getRange(r, ci.su).setValue(now);
      if (ci.when) sh.getRange(r, ci.when).setValue(whenStr_(now));
    }
  } catch (err) { /* 단순 트리거는 조용히 */ }
}

/* ============================ 중계: 나이스 · 에어코리아 · iCal ============================ */
function cacheGet_(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
function cachePut_(k, v, sec) { try { if (v.length < 90000) CacheService.getScriptCache().put(k, v, sec); } catch (e) {} }
function qs_(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }

function neis_(req) {
  const svc = String(req.svc || '');
  if (NEIS_SVC.indexOf(svc) < 0) return { ok: false, code: 'BAD', error: '지원하지 않는 나이스 서비스' };
  const key = reservedVal_('neisKey');
  const p = Object.assign({ Type: 'json', pIndex: '1' }, req.params || {});
  if (!p.pSize) p.pSize = key ? '1000' : '5';
  delete p.KEY;
  if (key) p.KEY = key;
  const url = 'https://open.neis.go.kr/hub/' + svc + '?' + qs_(p);
  const ck = 'n:' + hash_(url).slice(0, 40);
  const hit = cacheGet_(ck);
  if (hit) return { ok: true, data: JSON.parse(hit), cached: true };
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const txt = r.getContentText();
  let data;
  try { data = JSON.parse(txt); } catch (e) { return { ok: false, code: 'UP', error: '나이스 응답을 읽지 못했어요 (HTTP ' + r.getResponseCode() + ')' }; }
  cachePut_(ck, JSON.stringify(data), 1800);
  return { ok: true, data: data };
}

function dataKey_(k) { k = String(k || '').trim(); return /%[0-9A-F]{2}/i.test(k) ? k : encodeURIComponent(k); }
function airItems_(key, sido) {
  const url = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=' + dataKey_(key) +
    '&returnType=json&numOfRows=300&pageNo=1&sidoName=' + encodeURIComponent(sido) + '&ver=1.0';
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const txt = r.getContentText();
  let j;
  try { j = JSON.parse(txt); } catch (e) {
    const m = txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<errMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</);
    throw new Error(m ? m[1] : '응답을 읽지 못했어요 (HTTP ' + r.getResponseCode() + ')');
  }
  const err = j.OpenAPI_ServiceResponse && j.OpenAPI_ServiceResponse.cmmMsgHeader;
  if (err) {
    const msg = err.returnAuthMsg || err.errMsg || '오류';
    throw new Error(/등록되지 않은|NOT_REGISTERED/.test(msg)
      ? '등록되지 않은 키예요. "에어코리아 대기오염정보" 활용신청이 됐는지 확인하고, 승인 직후라면 1~2시간 뒤 다시 해 보세요.' : msg);
  }
  const h = j.response && j.response.header;
  if (h && h.resultCode !== '00') throw new Error(h.resultMsg || ('오류 ' + h.resultCode));
  return (j.response && j.response.body && j.response.body.items) || [];
}
function air_(req) {
  const key = reservedVal_('airKey');
  if (!key) return { ok: false, code: 'NOKEY', error: '에어코리아 인증키가 없어요' };
  const sido = String(req.sido || '');
  const ck = 'a:' + sido;
  const hit = cacheGet_(ck);
  if (hit) return { ok: true, data: JSON.parse(hit), cached: true };
  try {
    const items = airItems_(key, sido);
    cachePut_(ck, JSON.stringify(items), 600);
    return { ok: true, data: items };
  } catch (e) { return { ok: false, code: 'UP', error: e.message }; }
}

// 기상청 단기예보 (같은 공공데이터포털 인증키). 초단기실황(기온·습도·강수) + 초단기예보(하늘) + 단기예보(최고·최저·강수확률)
function kmaGet_(key, op, base, nx, ny, rows) {
  const url = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/' + op + '?serviceKey=' + dataKey_(key) + '&' +
    qs_({ pageNo: '1', numOfRows: String(rows || 100), dataType: 'JSON', base_date: base.d, base_time: base.t, nx: String(nx), ny: String(ny) });
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const txt = r.getContentText();
  let j; try { j = JSON.parse(txt); } catch (e) {
    throw new Error(/SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은/.test(txt) ? '기상청 단기예보 활용신청이 안 된 키예요' : '기상청 응답을 읽지 못했어요');
  }
  const h = j.response && j.response.header;
  if (h && h.resultCode !== '00') throw new Error(h.resultMsg || ('기상청 오류 ' + h.resultCode));
  return (j.response.body.items && j.response.body.items.item) || [];
}
function kmaBase_(now, every, from, lag) { // every시간마다 from시(또는 매시 30분)에 발표, lag분 뒤부터 받을 수 있음
  let t = now.getTime() - lag * 60000;
  let h = Number(Utilities.formatDate(new Date(t), 'Asia/Seoul', 'HH'));
  if (every > 1) { const back = (h - from + 24) % every; t -= back * 3600000; h = (h - back + 24) % 24; }
  return { d: Utilities.formatDate(new Date(t), 'Asia/Seoul', 'yyyyMMdd'), t: ('0' + h).slice(-2) + (from === 30 ? '30' : '00') };
}
function kma_(req) {
  const key = reservedVal_('airKey');
  if (!key) return { ok: false, code: 'NOKEY', error: '공공데이터포털 인증키가 없어요' };
  const nx = Number(req.nx), ny = Number(req.ny);
  if (!(nx > 0 && ny > 0)) return { ok: false, code: 'BAD', error: '격자 좌표가 없어요' };
  const ck = 'k:' + nx + ',' + ny;
  const hit = cacheGet_(ck);
  if (hit) return { ok: true, data: JSON.parse(hit), cached: true };
  try {
    const now = new Date(), today = Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd');
    const out = { nx: nx, ny: ny };
    const nb = kmaBase_(now, 1, 0, 40); // 실황: 매시 정각 자료를 40분 뒤부터
    kmaGet_(key, 'getUltraSrtNcst', nb, nx, ny, 20).forEach(function (x) { out[x.category] = Number(x.obsrValue); });
    out.at = nb.d + nb.t;
    try { // 하늘: 초단기예보(매시 30분 발표, 45분 뒤부터)의 가장 가까운 시각
      const fb = kmaBase_(now, 1, 30, 45);
      const it = kmaGet_(key, 'getUltraSrtFcst', fb, nx, ny, 60).filter(function (x) { return x.category === 'SKY'; })
        .sort(function (a, b) { return (a.fcstDate + a.fcstTime) < (b.fcstDate + b.fcstTime) ? -1 : 1; })[0];
      if (it) out.SKY = Number(it.fcstValue);
    } catch (e) {}
    try { // 오늘 최고·최저·강수확률: 단기예보
      // 오늘 02시 발표분(02:10부터)에 오늘 최고·최저가 모두 들어 있다. 그 전이면 어제 23시 발표분
      const hm = Number(Utilities.formatDate(now, 'Asia/Seoul', 'HH')) * 60 + Number(Utilities.formatDate(now, 'Asia/Seoul', 'mm'));
      const vb = hm >= 130 ? { d: today, t: '0200' } : { d: Utilities.formatDate(new Date(now.getTime() - 864e5), 'Asia/Seoul', 'yyyyMMdd'), t: '2300' };
      let pop = null;
      kmaGet_(key, 'getVilageFcst', vb, nx, ny, 1000).forEach(function (x) {
        if (x.fcstDate !== today) return;
        const v = Number(x.fcstValue);
        if (x.category === 'TMX') out.TMX = v; else if (x.category === 'TMN') out.TMN = v;
        else if (x.category === 'POP') pop = Math.max(pop === null ? 0 : pop, v);
        else if (x.category === 'TMP') { out._hi = Math.max(out._hi === undefined ? -99 : out._hi, v); out._lo = Math.min(out._lo === undefined ? 99 : out._lo, v); }
      });
      if (out.TMX === undefined && out._hi !== undefined) out.TMX = out._hi; // 오후에는 TMX/TMN이 빠지므로 시간별 기온으로 대신
      if (out.TMN === undefined && out._lo !== undefined) out.TMN = out._lo;
      delete out._hi; delete out._lo;
      if (pop !== null) out.POP = pop;
    } catch (e) {}
    cachePut_(ck, JSON.stringify(out), 600);
    return { ok: true, data: out };
  } catch (e) { return { ok: false, code: 'UP', error: e.message }; }
}

// GPS 위치 → 가장 가까운 미세먼지 측정소 (에어코리아 측정소정보, 같은 인증키)
// 에어코리아는 TM 좌표(베셀 타원체, 중부원점 38°N 127°E, 가산 200000/500000)를 쓴다 → 위도·경도를 바꿔서 묻는다
function wgsToTm_(lat, lon) {
  const D = Math.PI / 180;
  const a1 = 6378137, f1 = 1 / 298.257223563, e1 = f1 * (2 - f1);
  const p = lat * D, l = lon * D, N1 = a1 / Math.sqrt(1 - e1 * Math.sin(p) * Math.sin(p));
  let X = N1 * Math.cos(p) * Math.cos(l), Y = N1 * Math.cos(p) * Math.sin(l), Z = N1 * (1 - e1) * Math.sin(p);
  X += 146.43; Y -= 507.89; Z -= 681.46; // WGS84 → 베셀 (한국 측지계 3변수 근사)
  const a = 6377397.155, f = 1 / 299.1528128, e2 = f * (2 - f), b = a * (1 - f), ep2 = (a * a - b * b) / (b * b);
  const r = Math.sqrt(X * X + Y * Y), th = Math.atan2(Z * a, r * b);
  const phi = Math.atan2(Z + ep2 * b * Math.pow(Math.sin(th), 3), r - e2 * a * Math.pow(Math.cos(th), 3)), lam = Math.atan2(Y, X);
  // 가로 메르카토르 (k0=1)
  const M = function (x) { return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * x - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * x) + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * x) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * x)); };
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi)), T = Math.pow(Math.tan(phi), 2), C = ep2 * Math.pow(Math.cos(phi), 2), A = (lam - 127 * D) * Math.cos(phi);
  const x = 200000 + N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120);
  const y = 500000 + (M(phi) - M(38 * D) + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
  return [x, y];
}
const SIDO_SHORT = [['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'], ['충청북', '충북'], ['충북', '충북'], ['충청남', '충남'], ['충남', '충남'], ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['전남', '전남'], ['경상북', '경북'], ['경북', '경북'], ['경상남', '경남'], ['경남', '경남'], ['제주', '제주']];
function airNear_(req) {
  const key = reservedVal_('airKey');
  if (!key) return { ok: false, code: 'NOKEY', error: '공공데이터포털 인증키가 없어요' };
  const lat = Number(req.lat), lon = Number(req.lon);
  if (!(lat > 32 && lat < 39.5 && lon > 124 && lon < 132)) return { ok: false, code: 'BAD', error: '우리나라 안의 위치가 아니에요' };
  const ck = 'n:' + lat.toFixed(2) + ',' + lon.toFixed(2);
  const hit = cacheGet_(ck);
  if (hit) return { ok: true, data: JSON.parse(hit), cached: true };
  const tm = wgsToTm_(lat, lon);
  const url = 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList?serviceKey=' + dataKey_(key) + '&' + qs_({ returnType: 'json', tmX: tm[0].toFixed(3), tmY: tm[1].toFixed(3), ver: '1.1' });
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const txt = r.getContentText();
  let j; try { j = JSON.parse(txt); } catch (e) {
    return { ok: false, code: 'UP', error: /SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은/.test(txt) ? '측정소정보 활용신청이 아직 반영되지 않았어요 (승인 뒤 1~2시간)' : '측정소정보 응답을 읽지 못했어요' };
  }
  const h = j.response && j.response.header;
  if (h && h.resultCode !== '00') return { ok: false, code: 'UP', error: h.resultMsg || '측정소정보 오류' };
  const list = ((j.response.body && j.response.body.items) || []).map(function (x) {
    const addr = String(x.addr || ''), hitS = SIDO_SHORT.filter(function (s) { return addr.indexOf(s[0]) === 0; })[0];
    return { station: x.stationName, sido: hitS ? hitS[1] : '', km: Number(x.tm) };
  }).filter(function (x) { return x.station && x.sido; });
  cachePut_(ck, JSON.stringify(list), 6 * 3600);
  return { ok: true, data: list };
}

// 인증키를 시트에 저장하기 전에 먼저 확인한다
function checkKey_(req) {
  const which = req.which, value = String(req.value || '').trim();
  if (which === 'neis') {
    if (!value) { setReserved_('neisKey', ''); return { ok: true, valid: true, cleared: true, flags: flags_() }; }
    const q = { Type: 'json', KEY: value, pSize: '1' }; if (req.code) q.SD_SCHUL_CODE = String(req.code); // 학교를 아직 안 골랐으면 키만 확인
    const r = UrlFetchApp.fetch('https://open.neis.go.kr/hub/schoolInfo?' + qs_(q), { muteHttpExceptions: true });
    let j; try { j = JSON.parse(r.getContentText()); } catch (e) { return { ok: true, valid: false, message: '나이스 응답을 읽지 못했어요' }; }
    const rc = (j.RESULT && j.RESULT.CODE) || (j.schoolInfo && j.schoolInfo[0] && j.schoolInfo[0].head && j.schoolInfo[0].head[1] && j.schoolInfo[0].head[1].RESULT && j.schoolInfo[0].head[1].RESULT.CODE) || '';
    if (/^ERROR/.test(rc)) return { ok: true, valid: false, message: (j.RESULT && j.RESULT.MESSAGE) || rc };
    setReserved_('neisKey', value);
    return { ok: true, valid: true, flags: flags_() };
  }
  if (which === 'air') {
    if (!value) { setReserved_('airKey', ''); return { ok: true, valid: true, cleared: true, flags: flags_() }; }
    const sido = String(req.sido || '서울'); // 지역을 아직 안 골랐으면 키 확인용으로만 서울을 조회 (저장하지 않음)
    try {
      const items = airItems_(value, sido);
      setReserved_('airKey', value);
      const st = {}; items.forEach(function (x) { st[x.stationName] = 1; });
      return { ok: true, valid: true, stations: Object.keys(st).sort(), flags: flags_() };
    } catch (e) { return { ok: true, valid: false, message: e.message }; }
  }
  return { ok: false, code: 'BAD', error: '알 수 없는 키 종류' };
}

function ics_(req) {
  let url = String(req.url || '').trim().replace(/^webcal:/i, 'https:');
  if (!/^https?:\/\//i.test(url)) return { ok: false, code: 'BAD', error: '주소 모양이 아니에요' };
  const base = 'i:' + hash_(url).slice(0, 40);
  const cache = CacheService.getScriptCache();
  try {
    const n = Number(cache.get(base + ':n') || 0);
    if (n) {
      const keys = []; for (let i = 0; i < n; i++) keys.push(base + ':' + i);
      const got = cache.getAll(keys);
      if (keys.every(function (k) { return got[k] !== undefined; })) return { ok: true, text: keys.map(function (k) { return got[k]; }).join(''), cached: true };
    }
  } catch (e) {}
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) return { ok: false, code: 'UP', error: '캘린더를 불러오지 못했어요 (HTTP ' + r.getResponseCode() + ')' };
  const text = r.getContentText();
  try {
    const parts = {}, size = 30000, n = Math.ceil(text.length / size);
    for (let i = 0; i < n; i++) parts[base + ':' + i] = text.slice(i * size, (i + 1) * size);
    parts[base + ':n'] = String(n);
    cache.putAll(parts, 1800);
  } catch (e) {}
  return { ok: true, text: text };
}

// 앱 제목 앞 관리자 아이콘 → 비밀번호가 맞으면 원본 시트 주소를 돌려준다
function admin_(req) {
  const p = PropertiesService.getScriptProperties();
  const now = Date.now();
  const until = Number(p.getProperty('adminLock') || 0);
  if (now < until) return { ok: false, code: 'LOCK', error: '비밀번호를 여러 번 틀려 잠시 잠겼어요. ' + Math.ceil((until - now) / 60000) + '분 뒤에 다시 해 주세요.' };
  const pw = reservedVal_('adminPw');
  if (!pw) return { ok: false, code: 'NOPW', error: '시트 [설정] 탭의 adminPw 칸이 비어 있어요. 비밀번호를 적어 두면 열 수 있어요.' };
  if (String(req.pw || '') === pw) { p.deleteProperty('adminFails'); return { ok: true, url: SpreadsheetApp.getActive().getUrl() }; }
  const n = Number(p.getProperty('adminFails') || 0) + 1;
  if (n >= MAX_FAILS) { p.setProperty('adminLock', String(now + 5 * 60000)); p.deleteProperty('adminFails'); } else p.setProperty('adminFails', String(n));
  return { ok: false, code: 'PW', error: '비밀번호가 맞지 않아요' };
}

/* ============================ 메모·노트 이미지 ============================ */
// 그림은 구글 드라이브의 '로망데스크 이미지' 폴더(이 시트와 같은 폴더 안)에 둔다. 공유는 하지 않는다 (선생님 계정만 볼 수 있음).
// 처음 한 번: 편집기 위쪽에서 함수 prepareImageFolder 를 골라 [실행] → 드라이브 권한 허용
const IMG_FOLDER = '로망데스크 이미지';
const IMG_MAX = 8 * 1024 * 1024; // 한 장 8MB까지 (앱이 미리 줄여서 보낸다)
function imgFolder_() { return subFolder_('imgFolder', IMG_FOLDER); }
// 시트와 같은 폴더 안의 하위 폴더 (번호를 기억해 두고, 지워졌으면 다시 만든다)
function subFolder_(prop, name) {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty(prop);
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  let parent = DriveApp.getRootFolder();
  try { const ps = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents(); if (ps.hasNext()) parent = ps.next(); } catch (e) {}
  const it = parent.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : parent.createFolder(name);
  p.setProperty(prop, f.getId());
  return f;
}
// 1.4.20 첨부·정리·구글 문서 내보내기를 처음 쓸 때: 편집기 위쪽에서 함수 prepareFiles 를 골라 [실행] → 권한 허용 (드라이브에 직접 이어 올리는 권한이 새로 필요)
function prepareFiles() {
  const a = fileFolder_(), b = imgFolder_();
  ScriptApp.getOAuthToken(); UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  try { SpreadsheetApp.getActive().toast('첨부 준비 완료: ' + a.getName() + ' · ' + b.getName(), '로망데스크', 5); } catch (e) {}
}
function prepareImageFolder() {
  const f = imgFolder_();
  try { SpreadsheetApp.getActive().toast('이미지 폴더 준비 완료: ' + f.getName(), '로망데스크', 5); } catch (e) {}
  Logger.log('이미지 폴더: ' + f.getUrl());
}
function imgUp_(req) {
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(String(req.mime || '')) ? String(req.mime) : 'image/jpeg';
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const bytes = Utilities.base64Decode(String(req.data || ''));
  const tb = req.tdata ? Utilities.base64Decode(String(req.tdata)) : null;
  if (!bytes.length) return { ok: false, code: 'BAD', error: '이미지가 비어 있어요' };
  if (bytes.length > IMG_MAX || (tb && tb.length > IMG_MAX)) return { ok: false, code: 'BIG', error: '이미지가 너무 커요 (8MB까지)' };
  const folder = imgFolder_();
  const name = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd. HH.mm.ss') + '_' + Utilities.getUuid().slice(0, 6);
  const f = folder.createFile(Utilities.newBlob(bytes, mime, name + '.' + ext));
  f.setDescription('로망데스크 메모 이미지' + (req.name ? ' · ' + String(req.name).slice(0, 80) : ''));
  const t = tb ? folder.createFile(Utilities.newBlob(tb, mime, name + '_작게.' + ext)) : f;
  return { ok: true, id: f.getId(), tid: t.getId() };
}
function imgGet_(req) {
  const id = String(req.id || '');
  if (!/^[\w-]{10,}$/.test(id)) return { ok: false, code: 'BAD', error: '이미지 번호가 이상해요' };
  let f;
  try { f = DriveApp.getFileById(id); } catch (e) { return { ok: false, code: 'GONE', error: '드라이브에서 이미지를 찾지 못했어요' }; }
  // 로망데스크 이미지 폴더 안의 그림만 내보낸다 (다른 드라이브 파일은 못 읽게)
  const fid = imgFolder_().getId(), ps = f.getParents();
  let inside = false;
  while (ps.hasNext()) if (ps.next().getId() === fid) { inside = true; break; }
  if (!inside || f.isTrashed()) return { ok: false, code: 'GONE', error: '이미지가 지워졌거나 옮겨졌어요' };
  const b = f.getBlob();
  if (b.getBytes().length > IMG_MAX) return { ok: false, code: 'BIG', error: '이미지가 너무 커요' };
  return { ok: true, mime: b.getContentType() || 'image/jpeg', data: Utilities.base64Encode(b.getBytes()) };
}

/* ============================ 첨부 파일 (크기 제한 없이 나눠 올리기) ============================ */
// 앱이 파일을 조각(FILE_CHUNK)으로 나눠 보내면, 서버가 드라이브의 '이어 올리기(resumable upload)'로 한 파일에 이어 붙인다.
// 파일은 '로망데스크 첨부' 폴더(시트와 같은 폴더 안)에 원본 그대로. 공유하지 않는다. 다 올라가기 전에 끊기면 파일이 생기지 않는다.
const FILE_FOLDER = '로망데스크 첨부', DOC_FOLDER = '로망데스크 문서';
var FILE_CHUNK = 8 * 1024 * 1024; // 드라이브 규칙: 마지막 조각 말고는 256KB의 배수
function fileFolder_() { return subFolder_('fileFolder', FILE_FOLDER); }
function driveApi_(url, o) {
  o = o || {};
  o.headers = Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, o.headers || {});
  o.muteHttpExceptions = true;
  return UrlFetchApp.fetch(url, o);
}
function fileStart_(req) {
  const size = Math.floor(Number(req.size) || 0);
  if (size <= 0) return { ok: false, code: 'BAD', error: '빈 파일은 올릴 수 없어요' };
  const name = String(req.name || '첨부').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || '첨부';
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(req.mime || '')) ? String(req.mime) : 'application/octet-stream';
  const r = driveApi_('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post', contentType: 'application/json; charset=UTF-8',
    headers: { 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    payload: JSON.stringify({ name: name, parents: [fileFolder_().getId()], description: '로망데스크 첨부' }),
  });
  const h = r.getHeaders ? r.getHeaders() : {}, loc = h.Location || h.location;
  if (r.getResponseCode() !== 200 || !loc) return { ok: false, code: 'ERR', error: '드라이브에 올릴 준비를 하지 못했어요 (' + r.getResponseCode() + ')' };
  const tok = Utilities.getUuid();
  CacheService.getScriptCache().put('up_' + tok, JSON.stringify({ loc: loc, size: size }), 21600); // 6시간
  return { ok: true, tok: tok, chunk: FILE_CHUNK };
}
function fileChunk_(req) {
  const c = CacheService.getScriptCache().get('up_' + String(req.tok || ''));
  if (!c) return { ok: false, code: 'GONE', error: '올리기가 끊겼어요. 처음부터 다시 올려 주세요' };
  const s = JSON.parse(c), off = Math.floor(Number(req.off) || 0), bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || off < 0 || off + bytes.length > s.size) return { ok: false, code: 'BAD', error: '조각이 이상해요' };
  const r = driveApi_(s.loc, { method: 'put', contentType: 'application/octet-stream', payload: bytes, headers: { 'Content-Range': 'bytes ' + off + '-' + (off + bytes.length - 1) + '/' + s.size } });
  const code = r.getResponseCode();
  if (code === 308) { // 아직 남음 → 드라이브가 받은 데까지 알려 준다
    const h = r.getHeaders ? r.getHeaders() : {}, m = /bytes=0-(\d+)/.exec(h.Range || h.range || '');
    return { ok: true, done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) {
    let id = ''; try { id = JSON.parse(r.getContentText()).id; } catch (e) {}
    try { CacheService.getScriptCache().remove('up_' + req.tok); } catch (e) {}
    return { ok: true, done: true, id: id };
  }
  return { ok: false, code: code === 404 || code === 410 ? 'GONE' : 'ERR', error: '조각을 올리지 못했어요 (' + code + ')' };
}

/* ---------- 이미지·첨부 정리: 어느 메모·노트에도 쓰이지 않는 것은 드라이브 휴지통으로 (30일 안에는 되살릴 수 있음) ---------- */
// 쓰이는 것 = 시트의 지워지지 않은 줄(삭제됨 체크 안 된 줄)에 data-f="번호"(이미지)·data-fid="번호"(첨부)로 적힌 것
function mediaRefs_() {
  const set = {}, re = /data-(?:f|fid)=\\?["']([\w-]{10,})/g;
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    const v = sh.getDataRange().getValues();
    if (!v.length) return;
    let di = -1;
    for (let r = 0; r < Math.min(3, v.length) && di < 0; r++) di = v[r].indexOf('삭제됨');
    for (let i = 0; i < v.length; i++) {
      if (di >= 0 && v[i][di] === true) continue;
      for (let j = 0; j < v[i].length; j++) {
        const c = v[i][j];
        if (typeof c !== 'string' || c.indexOf('data-f') < 0) continue;
        let m; re.lastIndex = 0;
        while ((m = re.exec(c))) set[m[1]] = 1;
      }
    }
  });
  return set;
}
const GC_EVERY = 7 * 864e5, GC_AGE = 3 * 864e5; // 일주일에 한 번 / 만든 지 3일 안 된 것은 아직 동기화 전일 수 있어 두기
function fileGc_(req) {
  const refs = mediaRefs_(), now = Date.now(), fds = [imgFolder_(), fileFolder_()], fids = fds.map(function (f) { return f.getId(); });
  const ours = function (f) { const ps = f.getParents(); while (ps.hasNext()) if (fids.indexOf(ps.next().getId()) >= 0) return true; return false; };
  let n = 0;
  // 1) 방금 영구 삭제한 메모·노트에 있던 것 (다른 곳에서 안 쓰면 바로)
  (Array.isArray(req.ids) ? req.ids : []).slice(0, 300).forEach(function (id) {
    id = String(id);
    if (!/^[\w-]{10,}$/.test(id) || refs[id]) return;
    try { const f = DriveApp.getFileById(id); if (!f.isTrashed() && ours(f)) { f.setTrashed(true); n++; } } catch (e) {}
  });
  // 2) 일주일에 한 번: 두 폴더를 훑어 아무 데도 안 쓰이는 것 (예전 '_작게' 그림 포함)
  const p = PropertiesService.getScriptProperties(), last = Number(p.getProperty('gcAt') || 0);
  let swept = false;
  if (now - last > GC_EVERY || req.force === true) {
    p.setProperty('gcAt', String(now)); swept = true;
    fds.forEach(function (fd) {
      const it = fd.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (refs[f.getId()] || f.isTrashed()) continue;
        if (now - f.getDateCreated().getTime() < GC_AGE) continue;
        f.setTrashed(true); n++;
      }
    });
  }
  return { ok: true, trashed: n, swept: swept };
}

/* ---------- 노트를 구글 문서로 (드라이브 '로망데스크 문서' 폴더) ---------- */
function toDoc_(req) {
  const title = String(req.title || '로망데스크 노트').slice(0, 150);
  const fid = imgFolder_().getId();
  // 이미지는 드라이브의 그림을 문서 안에 넣는다 (로망데스크 이미지 폴더 안의 그림만)
  const html = String(req.html || '').replace(/<img\b[^>]*data-f="([\w-]{10,})"[^>]*>/gi, function (m, id) {
    try {
      const f = DriveApp.getFileById(id), ps = f.getParents(); let inside = false;
      while (ps.hasNext()) if (ps.next().getId() === fid) inside = true;
      if (!inside || f.isTrashed()) return '[이미지]';
      const b = f.getBlob();
      return '<img src="data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()) + '" width="600">';
    } catch (e) { return '[이미지]'; }
  });
  const doc = '<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  const bd = 'rd' + Utilities.getUuid().replace(/-/g, '');
  const head = '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document', parents: [subFolder_('docFolder', DOC_FOLDER).getId()] }) + '\r\n--' + bd + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n';
  const payload = Utilities.newBlob(head).getBytes().concat(Utilities.newBlob(doc).getBytes()).concat(Utilities.newBlob('\r\n--' + bd + '--\r\n').getBytes());
  const r = driveApi_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'post', contentType: 'multipart/related; boundary=' + bd, payload: payload });
  if (r.getResponseCode() !== 200) return { ok: false, code: 'ERR', error: '구글 문서를 만들지 못했어요 (' + r.getResponseCode() + ')' };
  const j = JSON.parse(r.getContentText());
  return { ok: true, id: j.id, url: j.webViewLink || ('https://docs.google.com/document/d/' + j.id + '/edit') };
}

/* ============================ 시트 자동 백업 ============================ */
// 매월 1일 새벽 3~4시에 이 시트의 사본을 '로망데스크 백업' 폴더(이 시트와 같은 폴더 안)에 만든다.
// 최근 BACKUP_KEEP개만 남기고 오래된 사본은 휴지통으로 보낸다 (선생님이 정리할 일 없음). 포스트잇 이미지는 드라이브에 따로 있으므로 사본에 넣지 않는다.
// 처음 한 번: 시트의 커스텀 메뉴 [로망데스크 → 자동 백업 켜기]를 눌러 권한을 허락한다 (매달 도는 예약은 선생님 계정으로 만들어야 해서)
const BACKUP_FOLDER = '로망데스크 백업';
const BACKUP_PREFIX = '로망데스크 백업 ';
const BACKUP_KEEP = 12;
function backupFolder_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('bkFolder');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  let parent = DriveApp.getRootFolder();
  try { const ps = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents(); if (ps.hasNext()) parent = ps.next(); } catch (e) {}
  const it = parent.getFoldersByName(BACKUP_FOLDER);
  const f = it.hasNext() ? it.next() : parent.createFolder(BACKUP_FOLDER);
  p.setProperty('bkFolder', f.getId());
  return f;
}
// 사본 하나 만들기. 같은 날 이미 만든 사본이 있으면 새것으로 바꾼다(하루 한 개). 그 뒤 오래된 사본 정리
function backupNow_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000); // 동기화가 시트를 쓰는 도중에 복사하지 않게
  try {
    const folder = backupFolder_(), now = new Date();
    const name = BACKUP_PREFIX + Utilities.formatDate(now, 'Asia/Seoul', 'yyyy.MM.dd.');
    SpreadsheetApp.flush();
    const copy = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy(name, folder);
    try { copy.setDescription('로망데스크 자동 백업 · 원본 시트: ' + SpreadsheetApp.getActive().getName()); } catch (e) {}
    const list = [], it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed() || f.getName().indexOf(BACKUP_PREFIX) !== 0) continue; // 선생님이 직접 넣은 다른 파일은 건드리지 않는다
      list.push(f);
    }
    // 새것부터. 같은 이름(같은 날)은 방금 만든 것만 남긴다
    list.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
    const seen = {};
    let kept = 0, removed = 0;
    list.forEach(function (f) {
      const n = f.getName(), mine = f.getId() === copy.getId();
      if (!mine && (seen[n] || n === name)) { f.setTrashed(true); removed++; return; }
      seen[n] = true;
      if (++kept > BACKUP_KEEP) { f.setTrashed(true); removed++; kept--; }
    });
    PropertiesService.getScriptProperties().setProperty('bkLast', String(now.getTime()));
    return { ok: true, name: name, kept: kept, removed: removed };
  } finally {
    lock.releaseLock();
  }
}
// 매달 예약이 부르는 함수 (이름을 바꾸면 예약이 끊긴다)
function backupMonthly() { backupNow_(); }
function menuBackupOn() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupMonthly') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupMonthly').timeBased().onMonthDay(1).atHour(3).inTimezone('Asia/Seoul').create();
  PropertiesService.getScriptProperties().setProperty('bkOn', '1');
  const r = backupNow_(); // 켜자마자 한 번 만들어 잘 되는지 보여 준다
  SpreadsheetApp.getUi().alert('자동 백업을 켰어요',
    '매월 1일 새벽에 이 시트의 사본을 [' + BACKUP_FOLDER + '] 폴더(이 시트와 같은 폴더 안)에 만들어요.\n최근 ' + BACKUP_KEEP + '개만 남기고 오래된 사본은 알아서 휴지통으로 보내요.\n\n방금 첫 사본을 만들었어요: ' + r.name,
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuBackupNow() {
  const r = backupNow_();
  SpreadsheetApp.getActive().toast('백업했어요: ' + r.name + ' (' + BACKUP_FOLDER + ' 폴더)', '로망데스크', 6);
}

/* ============================ 서버 업데이트 ============================ */
// 1.5.4부터 시트의 Code.gs는 '껍데기'(backend/Loader.gs)이고, 이 서버 코드는 공개 저장소에서 받아 스크립트 속성에 보관해 쓴다.
// 껍데기가 몇 시간에 한 번 새 판을 확인해 저절로 바꾼다. 이 메뉴는 '지금 바로 확인'.
// (Apps Script API로 코드를 바꾸던 1.5.1 방식은 숨겨진 기본 클라우드 프로젝트에서 API를 켤 수 없어 쓰지 않는다)
function verNum_(v) { const p = String(v || '0').split('.'); return (Number(p[0]) || 0) * 1e6 + (Number(p[1]) || 0) * 1e3 + (Number(p[2]) || 0); }
function menuServerUpdate() {
  const ui = SpreadsheetApp.getUi();
  if (typeof rdUpdate_ !== 'function') {
    ui.alert('서버 업데이트', '이 시트는 옛 방식 서버예요. 마지막으로 한 번만 Code.gs를 새 껍데기로 바꿔 주세요.\n(사용설명서 「서버 처음 업데이트」 · 그 뒤로는 저절로 바뀌어요)', ui.ButtonSet.OK);
    return;
  }
  const r = rdUpdate_(true);
  if (!r.ok) ui.alert('서버 업데이트', '새 판을 확인하지 못했어요: ' + r.error + '\n인터넷 연결을 확인하고 잠시 뒤 다시 눌러 주세요. (지금 판 ' + VERSION + '은 그대로 써요)', ui.ButtonSet.OK);
  else if (r.changed) ui.alert('서버 업데이트', '✅ 서버를 ' + r.to + '(으)로 바꿨어요. 시트를 새로고침(F5)하면 메뉴도 새 판으로 바뀌어요.\n앱은 그대로 쓰면 돼요.', ui.ButtonSet.OK);
  else ui.alert('서버 업데이트', '이미 최신 판이에요 (' + VERSION + ').\n새 판이 나오면 몇 시간 안에 저절로 바뀌어요.', ui.ButtonSet.OK);
}


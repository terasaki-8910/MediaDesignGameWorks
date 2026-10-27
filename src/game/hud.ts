// DOM overlay: title screen, prompts, Fold Mode panel, hints, pause menu and the clear screen.
export interface Settings { sensitivity: number; invertY: boolean; reduceMotion: boolean; quality: 'low' | 'medium' | 'high'; telemetry: boolean; muted: boolean }

export interface FoldPanel {
  title: string;
  index: number;
  count: number;
  label: string;
  blocked: string | null;
  opens: number;
  closes: number;
}

export interface ClearStats {
  totalSec: number;
  sections: { name: string; sec: number; actions: number; optimal: number }[];
}

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Hud {
  private titleEl = h('div', 'layer title interactive');
  private toastEl = h('div', 'toast');
  private promptEl = h('div', 'prompt');
  private panelEl = h('div', 'panel');
  private hintEl = h('div', 'hint');
  private statusEl = h('div', 'status-bar');
  private pauseEl = h('div', 'layer modal');
  private clearEl = h('div', 'layer modal');
  private flashEl = h('div', 'layer flash');
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    root.append(this.statusEl, this.toastEl, this.promptEl, this.panelEl, this.hintEl, this.flashEl, this.pauseEl, this.clearEl, this.titleEl);
  }

  title(o: { revision: number; updated: string; recent: string[]; consent: boolean; onConsent(v: boolean): void; onStart(): void }) {
    this.titleEl.innerHTML = '';
    this.titleEl.append(
      h('h1', '', 'FOLD <span>/</span> CITY'),
      h('div', 'sub', '折り畳まれた都市を歩き、建築を折り直して道を作る'),
    );
    const rev = h('div', 'rev', `都市改訂 第${o.revision}版 ・ ${o.updated}`);
    if (o.recent.length) {
      const ul = h('ul');
      for (const r of o.recent.slice(0, 3)) ul.append(h('li', '', `― ${escapeHtml(r)}`));
      rev.append(ul);
    }
    const start = h('button', 'btn', '歩きはじめる');
    start.addEventListener('click', () => o.onStart());
    const keys = h('div', 'keys',
      '<b>WASD</b><span>移動（Shiftでダッシュ、Spaceでジャンプ）</span><b>マウス</b><span>視点（クリックで固定）</span>' +
      '<b>E</b><span>コンソールを起動・決定</span><b>A / D</b><span>変形先を選ぶ（Fold Mode）</span><b>R</b><span>パズルをやり直す</span><b>Esc</b><span>ポーズ</span>');
    const consent = h('label', 'consent');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = o.consent;
    box.addEventListener('change', () => o.onConsent(box.checked));
    consent.append(box, document.createTextNode(
      ' 匿名のプレイデータ（操作の回数・時間・おおまかな位置）を送信し、AIによる都市の改訂に使うことに協力する。個人を特定する情報は集めません。'));
    this.titleEl.append(rev, start, keys, consent);
    this.titleEl.style.display = 'flex';
    this.titleEl.style.opacity = '1';
  }

  hideTitle() {
    this.titleEl.style.opacity = '0';
    setTimeout(() => (this.titleEl.style.display = 'none'), 800);
  }

  status(text: string) {
    this.statusEl.textContent = text;
  }

  toast(t1: string, t2 = '', ms = 3200) {
    this.toastEl.innerHTML = `<div class="t1">${escapeHtml(t1)}</div><div class="t2">${escapeHtml(t2)}</div>`;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  prompt(html: string | null) {
    if (html) this.promptEl.innerHTML = html;
    this.promptEl.classList.toggle('show', !!html);
  }

  fold(p: FoldPanel | null) {
    this.panelEl.classList.toggle('show', !!p);
    if (!p) return;
    const status = p.blocked
      ? `<div class="status blocked">干渉しています：${escapeHtml(p.blocked)}</div>`
      : `<div class="status ok">${p.opens ? `新しく行ける場所 ${p.opens} マス` : '行ける場所は増えません'}${p.closes ? ` ・ 行けなくなる場所 ${p.closes} マス` : ''}</div>`;
    this.panelEl.innerHTML =
      `<div class="head">FOLD MODE ・ ${escapeHtml(p.title)}</div>` +
      `<div class="opt">◀ ${escapeHtml(p.label)} ▶ <span style="font-size:13px;opacity:.6">${p.index + 1} / ${p.count}</span></div>` +
      status +
      `<div class="help"><kbd>A</kbd>/<kbd>D</kbd> 選択　<kbd>E</kbd> 実行　<kbd>Esc</kbd> 戻る</div>`;
  }

  hint(text: string | null) {
    if (text) this.hintEl.innerHTML = text;
    this.hintEl.classList.toggle('show', !!text);
  }

  flash() {
    this.flashEl.classList.add('on');
    setTimeout(() => this.flashEl.classList.remove('on'), 90);
  }

  pause(open: boolean, s?: Settings, onChange?: (s: Settings) => void, onResume?: () => void) {
    this.pauseEl.classList.toggle('show', open);
    if (!open || !s || !onChange || !onResume) return;
    this.pauseEl.innerHTML = '';
    const box = h('div', 'box');
    box.append(h('h2', '', 'PAUSE'));
    const row = (label: string, input: HTMLElement) => {
      const r = h('div', 'row');
      r.append(h('span', '', label), input);
      box.append(r);
    };
    const sens = Object.assign(document.createElement('input'), { type: 'range', min: '0.3', max: '2.5', step: '0.1', value: String(s.sensitivity) });
    sens.addEventListener('input', () => onChange({ ...s, sensitivity: Number(sens.value) }));
    row('視点の感度', sens);
    const check = (label: string, key: 'invertY' | 'reduceMotion' | 'telemetry' | 'muted') => {
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s[key] });
      c.addEventListener('change', () => onChange({ ...s, [key]: c.checked }));
      row(label, c);
    };
    check('上下反転', 'invertY');
    check('演出の動きを減らす', 'reduceMotion');
    check('プレイデータを送信する', 'telemetry');
    check('ミュート', 'muted');
    const q = document.createElement('select');
    for (const [v, l] of [['low', '低'], ['medium', '中'], ['high', '高']]) {
      const o = Object.assign(document.createElement('option'), { value: v, textContent: l, selected: s.quality === v });
      q.append(o);
    }
    q.addEventListener('change', () => onChange({ ...s, quality: q.value as Settings['quality'] }));
    row('画質（再読み込み後に反映）', q);
    const resume = h('button', 'btn small', '再開');
    resume.addEventListener('click', () => onResume());
    box.append(resume);
    this.pauseEl.append(box);
  }

  clear(stats: ClearStats, onFeedback: (f: { fun?: number; difficulty?: number; clarity?: number; text?: string }) => void, onAgain: () => void) {
    this.clearEl.innerHTML = '';
    const box = h('div', 'box');
    box.append(h('h2', '', '第一区画 踏破'));
    const rows = stats.sections
      .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${fmt(s.sec)}</td><td>変形 ${s.actions} 回（最短 ${s.optimal}）</td></tr>`)
      .join('');
    box.append(h('div', '', `<table>${rows}<tr><td>合計</td><td>${fmt(stats.totalSec)}</td><td></td></tr></table>`));
    const fb: { fun?: number; difficulty?: number; clarity?: number; text?: string } = {};
    const rating = (label: string, key: 'fun' | 'difficulty' | 'clarity') => {
      const r = h('div', 'row');
      const g = h('span', 'rating');
      for (let i = 1; i <= 5; i++) {
        const b = h('button', '', String(i));
        b.addEventListener('click', () => {
          fb[key] = i;
          for (const x of g.querySelectorAll('button')) x.classList.toggle('on', Number(x.textContent) === i);
        });
        g.append(b);
      }
      r.append(h('span', '', label), g);
      box.append(r);
    };
    rating('面白さ', 'fun');
    rating('難しさ（5=難しい）', 'difficulty');
    rating('分かりやすさ', 'clarity');
    const ta = Object.assign(document.createElement('textarea'), { rows: 2, maxLength: 200, placeholder: '感想（任意・200字まで）' });
    box.append(ta);
    const send = h('button', 'btn small', '送信して終える');
    send.addEventListener('click', () => {
      onFeedback({ ...fb, text: ta.value.trim() || undefined });
      send.textContent = 'ありがとうございました';
      (send as HTMLButtonElement).disabled = true;
    });
    const again = h('button', 'btn small', 'もう一度遊ぶ');
    again.style.marginLeft = '10px';
    again.addEventListener('click', () => onAgain());
    const btns = h('div', 'row');
    btns.style.justifyContent = 'flex-end';
    btns.append(send, again);
    box.append(btns);
    this.clearEl.append(box);
    this.clearEl.classList.add('show');
  }

  hideClear() {
    this.clearEl.classList.remove('show');
  }

  mobileNotice(root: HTMLElement) {
    const m = h('div', 'layer mobile', 'FOLD / CITY はPCのブラウザ（キーボードとマウス）で遊ぶゲームです。<br>パソコンで開いてください。');
    root.append(m);
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

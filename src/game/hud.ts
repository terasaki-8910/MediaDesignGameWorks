// DOM overlay: title screen, prompts, Fold Mode panel, hints, pause menu and the clear screen.
// Structure and behaviour only: every colour, size and space comes from the tokens in styles.css.
import type { Quality, QualitySetting } from './quality.ts';

export interface Settings { sensitivity: number; invertY: boolean; reduceMotion: boolean; quality: QualitySetting; telemetry: boolean; muted: boolean }

const TIER_JA: Record<Quality, string> = { low: '低', medium: '中', high: '高' };

export interface FoldPanel {
  title: string;
  index: number;
  count: number;
  label: string;
  blocked: string | null;
  /** What could move the thing in the way, when the option is blocked. */
  fix: string | null;
  /** Other consoles' actions this option frees from interference. */
  frees: string[];
  opens: number;
  closes: number;
}

export interface ClearStats {
  totalSec: number;
  sections: { name: string; sec: number; actions: number; optimal: number }[];
}

export interface RevisionEntry { date: string; summary: string }

export interface TitleOptions {
  revision: number;
  updated: string;
  /** Newest first. */
  recent: RevisionEntry[];
  consent: boolean;
  /** False while the scene is still loading: Start is disabled and says so until setStartReady(). */
  ready: boolean;
  onConsent(v: boolean): void;
  onStart(): void;
  onSettings(): void;
}

const START_LABEL = '歩きはじめる';
const LOADING_LABEL = '読み込み中…';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const button = (label: string, cls = 'btn') => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The key list of the "操作方法" panel: key caps (or a plain label for the mouse) and what they do. */
const KEYS: { caps?: string[]; label?: string; text: string }[] = [
  { caps: ['WASD'], text: '移動（Shiftでダッシュ、Spaceでジャンプ）' },
  { label: 'マウス', text: '視点（クリックで固定）' },
  { caps: ['E'], text: 'コンソールを起動・決定' },
  { caps: ['A', 'D'], text: '変形先を選ぶ（Fold Mode）' },
  { caps: ['R'], text: 'パズルをやり直す' },
  { caps: ['Esc'], text: 'ポーズ' },
];

let dialogIds = 0;
/** A labelled modal box with its heading. */
const dialogBox = (heading: string, cls = '') => {
  const id = `dialog-title-${++dialogIds}`;
  const box = h('div', `box ${cls}`.trim());
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', id);
  const title = h('h2', '', heading);
  title.id = id;
  box.append(title);
  return box;
};

/** The dialog on screen: what dismisses it (Escape, a click on the backdrop) and where focus goes back to. */
interface OpenDialog { el: HTMLElement; dismiss: (() => void) | null; opener: HTMLElement | null }

export class Hud {
  private titleEl = h('div', 'layer title interactive');
  private toastEl = h('div', 'toast');
  private promptEl = h('div', 'prompt');
  private panelEl = h('div', 'panel');
  private hintEl = h('div', 'hint');
  private statusEl = h('div', 'status-bar');
  private controlsEl = h('div', 'layer modal');
  private pauseEl = h('div', 'layer modal');
  private clearEl = h('div', 'layer modal');
  private flashEl = h('div', 'layer flash');
  private toastTimer = 0;
  private titleTimer = 0;
  private titleShown = false;
  private startBtn: HTMLButtonElement | null = null;
  private consentBox: HTMLInputElement | null = null;
  private dialog: OpenDialog | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.toastEl.setAttribute('role', 'status');
    this.hintEl.setAttribute('role', 'status');
    // later siblings paint on top: the dialogs go over the title
    root.append(this.toastEl, this.statusEl, this.promptEl, this.panelEl, this.hintEl, this.flashEl, this.titleEl, this.controlsEl, this.pauseEl, this.clearEl);
    // Capture phase on window: this runs before the game's own key handler, which swallows Tab and Space and would
    // otherwise see the Escape that closes a dialog.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  private onKey(e: KeyboardEvent) {
    const d = this.dialog;
    if (d) {
      e.stopPropagation(); // keys belong to the dialog; the game must not walk or fold underneath it
      if (e.key === 'Escape' && d.dismiss) {
        e.preventDefault();
        d.dismiss();
      } else if (e.key === 'Tab') this.trapTab(d.el, e);
      return;
    }
    if (!this.titleShown) return;
    if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation(); // keep the game's handler from cancelling Tab and Space on the title
    const idle = !document.activeElement || document.activeElement === document.body;
    // nothing focused (the backdrop was clicked): Enter or Space still starts
    if (idle && e.key !== 'Tab' && !e.repeat) {
      e.preventDefault();
      this.startBtn?.click();
    }
  }

  private trapTab(root: HTMLElement, e: KeyboardEvent) {
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (!root.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Show a dialog: the title behind it stops taking focus, focus moves in (to `focus`, else the first control). */
  private openDialog(el: HTMLElement, dismiss: (() => void) | null, focus: HTMLElement | null) {
    const active = document.activeElement;
    const opener = this.dialog?.opener ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    this.dialog = { el, dismiss, opener };
    this.titleEl.inert = true;
    el.classList.add('show');
    (focus ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
  }

  private closeDialog(el: HTMLElement) {
    el.classList.remove('show');
    if (this.dialog?.el !== el) return;
    const { opener } = this.dialog;
    this.dialog = null;
    this.titleEl.inert = !this.titleShown;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  title(o: TitleOptions) {
    clearTimeout(this.titleTimer);
    const t = this.titleEl;
    t.innerHTML = '';
    const main = h('div', 'title-main');
    main.append(
      h('h1', '', 'FOLD <span>/</span> CITY'),
      h('p', 'sub', '折り畳まれた都市を歩き、建築を折り直して道を作る'),
    );

    const start = button(o.ready ? START_LABEL : LOADING_LABEL, 'btn primary');
    if (!o.ready) {
      start.disabled = true;
      start.setAttribute('aria-busy', 'true');
    }
    start.addEventListener('click', () => o.onStart());
    const controls = button('操作方法');
    controls.addEventListener('click', () => this.openControls());
    const settings = button('設定');
    settings.addEventListener('click', () => o.onSettings());
    const secondary = h('div', 'secondary');
    secondary.append(controls, settings);
    const actions = h('div', 'title-actions');
    actions.append(start, secondary);

    const consent = h('label', 'consent');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = o.consent;
    box.addEventListener('change', () => o.onConsent(box.checked));
    consent.append(box, h('span', '', '匿名のプレイデータ（操作の回数・時間・おおまかな位置）を送信し、AIによる都市の改訂に使うことに協力する。個人を特定する情報は集めません。'));
    main.append(actions, consent);

    t.append(main, this.revisionPanel(o));
    this.startBtn = start;
    this.consentBox = box;
    this.titleShown = true;
    t.inert = !!this.dialog;
    t.style.display = '';
    t.style.opacity = '1';
    this.statusEl.style.visibility = 'hidden';
    if (!this.dialog) start.focus({ preventScroll: true });
  }

  /** Loading has finished: Start becomes available and, if nothing else has the focus, takes it. */
  setStartReady() {
    const s = this.startBtn;
    if (!s || !s.disabled) return;
    s.disabled = false;
    s.textContent = START_LABEL;
    s.removeAttribute('aria-busy');
    const idle = !document.activeElement || document.activeElement === document.body;
    if (this.titleShown && !this.dialog && idle) s.focus({ preventScroll: true });
  }

  /** "都市改訂 第N版": the latest entry in full, earlier ones as a line each, so the title stays readable as the log grows. */
  private revisionPanel(o: TitleOptions) {
    const rev = h('section', 'rev');
    rev.setAttribute('aria-label', '都市改訂');
    rev.append(h('h2', 'rev-head', `<span>都市改訂 第${o.revision}版</span><time>${escapeHtml(o.updated)}</time>`));
    if (!o.recent.length) return rev;
    const ul = h('ul');
    // earlier entries are cut to one line by the stylesheet
    o.recent.slice(0, 3).forEach((r, i) => {
      const text = escapeHtml(r.summary);
      ul.append(h('li', i ? 'older' : '', `<time>${escapeHtml(r.date)}</time>${i ? `<span>${text}</span>` : text}`));
    });
    rev.append(ul);
    return rev;
  }

  /** The key list, in a small dialog over the title. */
  openControls() {
    const el = this.controlsEl;
    el.innerHTML = '';
    const box = dialogBox('操作方法');
    box.append(h('dl', 'keys', KEYS.map((k) =>
      `<dt>${k.caps ? k.caps.map((c) => `<kbd>${c}</kbd>`).join('') : escapeHtml(k.label ?? '')}</dt><dd>${escapeHtml(k.text)}</dd>`).join('')));
    const close = button('閉じる');
    close.addEventListener('click', () => this.closeControls());
    const actions = h('div', 'actions');
    actions.append(close);
    box.append(actions);
    el.append(box);
    el.onclick = (e) => {
      if (e.target === el) this.closeControls();
    };
    this.openDialog(el, () => this.closeControls(), close);
  }

  closeControls() {
    this.closeDialog(this.controlsEl);
  }

  /** Show or hide the whole overlay at once (review shots; `?hud=0` does the same from the URL). */
  setVisible(visible: boolean) {
    this.root.style.display = visible ? '' : 'none';
  }

  hideTitle() {
    this.titleShown = false; // keys go back to the game at once, not after the fade
    this.titleEl.inert = true; // and the still-focused start button cannot take a second Enter during the fade
    if (this.titleEl.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.titleEl.style.opacity = '0';
    this.statusEl.style.visibility = '';
    clearTimeout(this.titleTimer);
    this.titleTimer = window.setTimeout(() => (this.titleEl.style.display = 'none'), 800);
  }

  /**
   * Review shots: drop every overlay at once, with no fade or timer left behind, so the next shot starts from a bare
   * screen. The caller shows what the shot needs afterwards.
   */
  resetForShot() {
    clearTimeout(this.titleTimer);
    clearTimeout(this.toastTimer);
    this.dialog = null;
    for (const el of [this.controlsEl, this.pauseEl, this.clearEl]) el.classList.remove('show');
    this.toastEl.classList.remove('show');
    this.titleShown = false;
    this.titleEl.inert = true;
    this.titleEl.style.display = 'none';
    this.statusEl.style.visibility = '';
    this.hint(null);
    this.prompt(null);
    this.fold(null);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
      ? `<div class="status blocked">干渉しています：${escapeHtml(p.blocked)}</div>` +
        (p.fix ? `<div class="status fix">${escapeHtml(p.fix)}</div>` : '')
      : `<div class="status ok">${p.opens ? `新しく行ける場所 ${p.opens} マス` : '行ける場所は増えません'}${p.closes ? ` ・ 行けなくなる場所 ${p.closes} マス` : ''}</div>` +
        p.frees.map((f) => `<div class="status frees">${escapeHtml(f)}</div>`).join('');
    this.panelEl.innerHTML =
      `<div class="head">FOLD MODE ・ ${escapeHtml(p.title)}</div>` +
      `<div class="opt"><span class="arrow" aria-hidden="true">◀</span><span class="name">${escapeHtml(p.label)}</span><span class="arrow" aria-hidden="true">▶</span>` +
      `<span class="count">${p.index + 1} / ${p.count}</span></div>` +
      status +
      `<div class="help"><kbd>A</kbd><kbd>D</kbd> 選択　<kbd>E</kbd> 実行　<kbd>Esc</kbd> 戻る</div>`;
  }

  hint(text: string | null) {
    if (text) this.hintEl.innerHTML = text;
    this.hintEl.classList.toggle('show', !!text);
  }

  flash() {
    this.flashEl.classList.add('on');
    setTimeout(() => this.flashEl.classList.remove('on'), 90);
  }

  /**
   * The pause menu (in game) or the settings dialog (from the title): Escape and a click on the backdrop call
   * `onClose` like the button does. `open = false` closes it.
   */
  pause(open: boolean, s?: Settings, onChange?: (s: Settings) => void, onClose?: () => void, kind: 'pause' | 'settings' = 'pause', auto?: Quality) {
    if (!open) return this.closeDialog(this.pauseEl);
    if (!s || !onChange || !onClose) return;
    const el = this.pauseEl;
    el.innerHTML = '';
    let cur = s; // every change builds on the latest settings, not on the ones the dialog opened with
    const change = (patch: Partial<Settings>) => {
      cur = { ...cur, ...patch };
      onChange(cur);
      if (this.consentBox) this.consentBox.checked = cur.telemetry; // the title's consent box shows the same setting
    };
    const box = dialogBox(kind === 'pause' ? 'PAUSE' : '設定');
    const row = (label: string, input: HTMLElement) => {
      const r = h('label', 'row');
      r.append(h('span', '', label), input);
      box.append(r);
    };
    const sens = Object.assign(document.createElement('input'), { type: 'range', min: '0.3', max: '2.5', step: '0.1', value: String(s.sensitivity) });
    sens.addEventListener('input', () => change({ sensitivity: Number(sens.value) }));
    row('視点の感度', sens);
    const check = (label: string, key: 'invertY' | 'reduceMotion' | 'telemetry' | 'muted') => {
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s[key] });
      c.addEventListener('change', () => change({ [key]: c.checked }));
      row(label, c);
    };
    check('上下反転', 'invertY');
    check('演出の動きを減らす', 'reduceMotion');
    check('プレイデータを送信する', 'telemetry');
    check('ミュート', 'muted');
    const q = document.createElement('select');
    // (自動 says which tier it has chosen for this machine: the GPU's name first, then the frames the title measured)
    for (const [v, l] of [['auto', auto ? `自動（${TIER_JA[auto]}）` : '自動'], ['low', '低'], ['medium', '中'], ['high', '高']]) {
      const o = Object.assign(document.createElement('option'), { value: v, textContent: l, selected: s.quality === v });
      q.append(o);
    }
    q.addEventListener('change', () => change({ quality: q.value as Settings['quality'] }));
    row('画質（再読み込み後に反映）', q);
    const close = kind === 'pause' ? button('再開', 'btn primary') : button('閉じる');
    close.addEventListener('click', () => onClose());
    const actions = h('div', 'actions');
    actions.append(close);
    box.append(actions);
    el.append(box);
    el.onclick = (e) => {
      if (e.target === el) onClose();
    };
    this.openDialog(el, onClose, close);
  }

  clear(stats: ClearStats, onFeedback: (f: { fun?: number; difficulty?: number; clarity?: number; text?: string }) => void, onAgain: () => void) {
    this.clearEl.innerHTML = '';
    const box = dialogBox('第一区画 踏破', 'wide');
    box.tabIndex = -1; // focus lands on the dialog itself; Tab then goes to the first rating
    const rows = stats.sections
      .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${fmt(s.sec)}</td><td>変形 ${s.actions} 回（最短 ${s.optimal}）</td></tr>`)
      .join('');
    box.append(h('div', '', `<table>${rows}<tr><td>合計</td><td>${fmt(stats.totalSec)}</td><td></td></tr></table>`));
    const fb: { fun?: number; difficulty?: number; clarity?: number; text?: string } = {};
    const rating = (label: string, key: 'fun' | 'difficulty' | 'clarity') => {
      const r = h('div', 'row rating-row');
      const g = h('div', 'rating');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', label);
      for (let i = 1; i <= 5; i++) {
        const b = button(String(i), '');
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          fb[key] = i;
          for (const x of g.querySelectorAll('button')) {
            const on = Number(x.textContent) === i;
            x.classList.toggle('on', on);
            x.setAttribute('aria-pressed', String(on));
          }
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
    ta.setAttribute('aria-label', '感想');
    box.append(ta);
    const send = button('送信して終える', 'btn primary');
    send.addEventListener('click', () => {
      onFeedback({ ...fb, text: ta.value.trim() || undefined });
      send.textContent = 'ありがとうございました';
      send.disabled = true;
    });
    const again = button('もう一度遊ぶ');
    again.addEventListener('click', () => onAgain());
    const actions = h('div', 'actions');
    actions.append(again, send);
    box.append(actions);
    this.clearEl.append(box);
    this.openDialog(this.clearEl, null, box); // no light dismiss: the buttons are the way on
  }

  hideClear() {
    this.closeDialog(this.clearEl);
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

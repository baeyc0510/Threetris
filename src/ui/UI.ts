import type { GameManager } from "../core/GameManager";
import type { BoardSize, CameraMode, PieceType, Settings } from "../core/types";
import { BOARD_SIZES, PIECE_COLORS } from "../core/constants";
import { PIECE_OFFSETS } from "../core/pieces";
import { getRecord, getTotalPlayTime } from "../core/storage";
import { yawResidual } from "../core/orient";

export interface UIHandlers {
  start(): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  openSettings(): void;
  quit(): void;
  applySettings(s: Settings): void;
}

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Draw a small 2D footprint of a tetromino into a canvas (for NEXT / HOLD). */
function drawMini(canvas: HTMLCanvasElement, type: PieceType | null): void {
  const ctx = canvas.getContext("2d")!;
  const W = (canvas.width = canvas.clientWidth * 2);
  const H = (canvas.height = canvas.clientHeight * 2);
  ctx.clearRect(0, 0, W, H);
  if (!type) return;
  const cells = PIECE_OFFSETS[type];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const cell = Math.min(W / (gw + 1), H / (gh + 1));
  const ox = (W - gw * cell) / 2;
  const oy = (H - gh * cell) / 2;
  const color = "#" + PIECE_COLORS[type].toString(16).padStart(6, "0");
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (const c of cells) {
    const x = ox + (c.x - minX) * cell;
    // Flip Y so it reads upright.
    const y = oy + (maxY - c.y) * cell;
    ctx.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
  }
}

/**
 * Owns every HTML overlay: menu, settings, HUD, pause, game over. Reads the
 * current game state to decide which screen is visible and forwards keyboard
 * navigation from Input.
 */
export class UI {
  private root: HTMLElement;
  private handlers: UIHandlers;
  private game: GameManager;
  private settings: Settings;

  // Focus indices per screen.
  private menuFocus = 0;
  private settingsFocus = 0;
  private pauseFocus = 0;
  private gameoverFocus = 0;

  // Cached elements.
  private screens: Record<string, HTMLElement> = {};
  private hudEls: Record<string, HTMLElement> = {};
  private nextCanvases: HTMLCanvasElement[] = [];
  private holdCanvas!: HTMLCanvasElement;
  private lastNextSig = "";
  private lastHold: PieceType | null = null;

  constructor(
    root: HTMLElement,
    game: GameManager,
    settings: Settings,
    handlers: UIHandlers,
  ) {
    this.root = root;
    this.game = game;
    this.settings = settings;
    this.handlers = handlers;
    this.build();
    this.showFor(game.state);
  }

  // --- Build DOM ---

  private build(): void {
    this.root.innerHTML = "";
    this.buildMenu();
    this.buildSettings();
    this.buildHud();
    this.buildPause();
    this.buildGameOver();
    this.buildFlash();
  }

  private buildMenu(): void {
    const s = el("div", "screen screen-center", "");
    s.innerHTML = `
      <div class="title-wrap">
        <h1 class="title">TETRIS<span class="title-3d">3D</span></h1>
        <p class="subtitle">SYNTHWAVE BLOCK WELL</p>
      </div>`;
    const menu = el("div", "menu-list");
    const mk = (label: string, action: () => void) => {
      const b = el("button", "menu-btn", label);
      b.addEventListener("click", action);
      menu.appendChild(b);
      return b;
    };
    mk("START", () => this.handlers.start());
    mk("SETTINGS", () => this.handlers.openSettings());
    mk("QUIT", () => this.handlers.quit());
    s.appendChild(menu);
    s.appendChild(el("p", "hint", "방향키로 이동 · Enter로 선택"));
    this.screens.menu = s;
    this.root.appendChild(s);
  }

  private buildSettings(): void {
    const s = el("div", "screen screen-center");
    s.appendChild(el("h2", "screen-title", "SETTINGS"));
    const list = el("div", "settings-list");

    // Board size row.
    const sizeRow = el("div", "setting-row");
    sizeRow.appendChild(el("span", "setting-label", "난이도 (BOARD)"));
    const sizeOpts = el("div", "opt-group");
    BOARD_SIZES.forEach((sz) => {
      const o = el("button", "opt", `${sz}×${sz}`);
      o.dataset.size = String(sz);
      o.addEventListener("click", () => this.setBoardSize(sz));
      sizeOpts.appendChild(o);
    });
    sizeRow.appendChild(sizeOpts);
    list.appendChild(sizeRow);

    // Camera row.
    const camRow = el("div", "setting-row");
    camRow.appendChild(el("span", "setting-label", "카메라 (CAMERA)"));
    const camOpts = el("div", "opt-group");
    (["corner", "face"] as CameraMode[]).forEach((m) => {
      const o = el("button", "opt", m === "corner" ? "CORNER" : "FACE");
      o.dataset.cam = m;
      o.addEventListener("click", () => this.setCamera(m));
      camOpts.appendChild(o);
    });
    camRow.appendChild(camOpts);
    list.appendChild(camRow);

    // Sound row.
    const sndRow = el("div", "setting-row");
    sndRow.appendChild(el("span", "setting-label", "사운드 (SOUND)"));
    const sndOpts = el("div", "opt-group");
    (["on", "off"] as const).forEach((v) => {
      const o = el("button", "opt", v.toUpperCase());
      o.dataset.snd = v;
      o.addEventListener("click", () => this.setSound(v === "on"));
      sndOpts.appendChild(o);
    });
    sndRow.appendChild(sndOpts);
    list.appendChild(sndRow);

    // Back button.
    const back = el("button", "menu-btn", "BACK");
    back.dataset.back = "1";
    back.addEventListener("click", () => this.handlers.toMenu());
    list.appendChild(back);

    s.appendChild(list);
    s.appendChild(el("p", "hint", "← → 값 변경 · ↑ ↓ 이동 · Esc 뒤로"));
    this.screens.settings = s;
    this.root.appendChild(s);
    this.refreshSettingsUI();
  }

  private buildHud(): void {
    const hud = el("div", "hud");

    // Left column: score / stats.
    const left = el("div", "hud-col hud-left");
    const statBlock = el("div", "panel");
    const addStat = (key: string, label: string) => {
      const row = el("div", "stat");
      row.appendChild(el("div", "stat-label", label));
      const val = el("div", "stat-val", "0");
      this.hudEls[key] = val;
      row.appendChild(val);
      statBlock.appendChild(row);
    };
    addStat("score", "SCORE");
    addStat("level", "LEVEL");
    addStat("layers", "CLEARED LAYERS");
    addStat("time", "TIME");
    left.appendChild(statBlock);

    const holdPanel = el("div", "panel");
    holdPanel.appendChild(el("div", "panel-title", "HOLD"));
    this.holdCanvas = el("canvas", "mini hold-mini");
    holdPanel.appendChild(this.holdCanvas);
    left.appendChild(holdPanel);

    const recPanel = el("div", "panel");
    recPanel.appendChild(el("div", "panel-title", "RECORDS"));
    const diffRow = el("div", "stat small");
    diffRow.appendChild(el("div", "stat-label", "DIFFICULTY"));
    this.hudEls.difficulty = el("div", "stat-val", "9×9");
    diffRow.appendChild(this.hudEls.difficulty);
    recPanel.appendChild(diffRow);
    const bestRow = el("div", "stat small");
    bestRow.appendChild(el("div", "stat-label", "BEST SCORE"));
    this.hudEls.best = el("div", "stat-val", "0");
    bestRow.appendChild(this.hudEls.best);
    recPanel.appendChild(bestRow);
    const bestTimeRow = el("div", "stat small");
    bestTimeRow.appendChild(el("div", "stat-label", "BEST TIME"));
    this.hudEls.bestTime = el("div", "stat-val", "0:00");
    bestTimeRow.appendChild(this.hudEls.bestTime);
    recPanel.appendChild(bestTimeRow);
    left.appendChild(recPanel);

    hud.appendChild(left);

    // Right column: next queue + controls.
    const right = el("div", "hud-col hud-right");
    const nextPanel = el("div", "panel");
    nextPanel.appendChild(el("div", "panel-title", "NEXT"));
    const nextWrap = el("div", "next-wrap");
    for (let i = 0; i < 5; i++) {
      const c = el("canvas", "mini next-mini");
      this.nextCanvases.push(c);
      nextWrap.appendChild(c);
    }
    nextPanel.appendChild(nextWrap);
    right.appendChild(nextPanel);

    // Movement compass: shows where each arrow key sends the piece on screen.
    const compassPanel = el("div", "panel compass-panel");
    compassPanel.appendChild(el("div", "panel-title", "COMPASS"));
    const compass = el("div", "compass");
    compass.innerHTML = `
      <div class="compass-rot">
        <span class="compass-board"></span>
        <span class="compass-arrow ca-up">↑</span>
        <span class="compass-arrow ca-down">↓</span>
        <span class="compass-arrow ca-left">←</span>
        <span class="compass-arrow ca-right">→</span>
      </div>`;
    this.hudEls.compass = compass.querySelector<HTMLElement>(".compass-rot")!;
    compassPanel.appendChild(compass);
    compassPanel.appendChild(el("div", "compass-hint", "화면 기준 이동 방향"));
    right.appendChild(compassPanel);

    const help = el("div", "panel controls");
    help.innerHTML = `
      <div class="panel-title">CONTROLS</div>
      <div class="ctrl-grid">
        <span>이동</span><b>← ↑ → ↓</b>
        <span>눕히기</span><b>W / S</b>
        <span>좌우 회전</span><b>A / D</b>
        <span>카메라</span><b>Q / E</b>
        <span>하드드롭</span><b>Space</b>
        <span>소프트</span><b>Shift</b>
        <span>홀드</span><b>C</b>
        <span>일시정지</span><b>P / Esc</b>
        <span>재시작</span><b>R</b>
      </div>`;
    right.appendChild(help);
    hud.appendChild(right);

    this.screens.hud = hud;
    this.root.appendChild(hud);
  }

  private buildPause(): void {
    const s = el("div", "screen overlay");
    const box = el("div", "modal");
    box.appendChild(el("h2", "screen-title", "PAUSED"));
    const list = el("div", "menu-list");
    const mk = (label: string, action: () => void) => {
      const b = el("button", "menu-btn", label);
      b.addEventListener("click", action);
      list.appendChild(b);
    };
    mk("RESUME", () => this.handlers.resume());
    mk("RESTART", () => this.handlers.restart());
    mk("MAIN MENU", () => this.handlers.toMenu());
    box.appendChild(list);
    s.appendChild(box);
    this.screens.pause = s;
    this.root.appendChild(s);
  }

  private buildGameOver(): void {
    const s = el("div", "screen overlay");
    const box = el("div", "modal");
    box.appendChild(el("h2", "screen-title danger", "GAME OVER"));
    const stats = el("div", "go-stats");
    this.hudEls.goScore = el("div", "go-stat", "");
    this.hudEls.goLayers = el("div", "go-stat", "");
    this.hudEls.goTime = el("div", "go-stat", "");
    this.hudEls.goRecord = el("div", "go-record", "");
    stats.appendChild(this.hudEls.goScore);
    stats.appendChild(this.hudEls.goLayers);
    stats.appendChild(this.hudEls.goTime);
    stats.appendChild(this.hudEls.goRecord);
    box.appendChild(stats);
    const list = el("div", "menu-list");
    const mk = (label: string, action: () => void) => {
      const b = el("button", "menu-btn", label);
      b.addEventListener("click", action);
      list.appendChild(b);
    };
    mk("RESTART", () => this.handlers.restart());
    mk("MAIN MENU", () => this.handlers.toMenu());
    box.appendChild(list);
    s.appendChild(box);
    this.screens.gameover = s;
    this.root.appendChild(s);
  }

  private buildFlash(): void {
    const f = el("div", "screen-flash");
    this.screens.flash = f;
    this.root.appendChild(f);
  }

  // --- Settings option helpers ---

  private setBoardSize(sz: BoardSize): void {
    this.settings.boardSize = sz;
    this.handlers.applySettings(this.settings);
    this.refreshSettingsUI();
  }
  private setCamera(m: CameraMode): void {
    this.settings.cameraMode = m;
    this.handlers.applySettings(this.settings);
    this.refreshSettingsUI();
  }
  private setSound(on: boolean): void {
    this.settings.sound = on;
    this.handlers.applySettings(this.settings);
    this.refreshSettingsUI();
  }

  private refreshSettingsUI(): void {
    const s = this.screens.settings;
    s.querySelectorAll<HTMLElement>("[data-size]").forEach((o) => {
      o.classList.toggle("selected", Number(o.dataset.size) === this.settings.boardSize);
    });
    s.querySelectorAll<HTMLElement>("[data-cam]").forEach((o) => {
      o.classList.toggle("selected", o.dataset.cam === this.settings.cameraMode);
    });
    s.querySelectorAll<HTMLElement>("[data-snd]").forEach((o) => {
      o.classList.toggle("selected", (o.dataset.snd === "on") === this.settings.sound);
    });
    this.updateFocus();
  }

  // --- Screen visibility ---

  showFor(state: string): void {
    const map: Record<string, string[]> = {
      menu: ["menu"],
      settings: ["settings"],
      playing: ["hud"],
      paused: ["hud", "pause"],
      gameover: ["hud", "gameover"],
    };
    const active = new Set(map[state] ?? []);
    for (const [name, e] of Object.entries(this.screens)) {
      if (name === "flash") continue;
      e.classList.toggle("visible", active.has(name));
    }
    // Reset focus on entering a screen.
    if (state === "menu") this.menuFocus = 0;
    if (state === "settings") this.settingsFocus = 0;
    if (state === "paused") this.pauseFocus = 0;
    if (state === "gameover") this.gameoverFocus = 0;
    this.root.classList.toggle("dim-board", state === "paused" || state === "gameover");
    this.updateFocus();
  }

  // --- Focus / keyboard navigation ---

  private currentButtons(): HTMLButtonElement[] {
    const state = this.game.state;
    if (state === "menu") return Array.from(this.screens.menu.querySelectorAll("button"));
    if (state === "paused") return Array.from(this.screens.pause.querySelectorAll("button"));
    if (state === "gameover") return Array.from(this.screens.gameover.querySelectorAll("button"));
    return [];
  }

  private focusIndexRef(): { get: () => number; set: (n: number) => void } | null {
    const state = this.game.state;
    if (state === "menu") return { get: () => this.menuFocus, set: (n) => (this.menuFocus = n) };
    if (state === "paused") return { get: () => this.pauseFocus, set: (n) => (this.pauseFocus = n) };
    if (state === "gameover")
      return { get: () => this.gameoverFocus, set: (n) => (this.gameoverFocus = n) };
    return null;
  }

  private updateFocus(): void {
    // Clear all.
    this.root.querySelectorAll(".focused").forEach((e) => e.classList.remove("focused"));
    const state = this.game.state;
    if (state === "settings") {
      const rows = this.settingsRows();
      const item = rows[this.settingsFocus];
      if (item) item.classList.add("focused");
      return;
    }
    const buttons = this.currentButtons();
    const ref = this.focusIndexRef();
    if (ref && buttons.length) {
      const i = Math.max(0, Math.min(ref.get(), buttons.length - 1));
      buttons[i]?.classList.add("focused");
    }
  }

  private settingsRows(): HTMLElement[] {
    return Array.from(this.screens.settings.querySelectorAll<HTMLElement>(".setting-row, [data-back]"));
  }

  nav(dx: number, dy: number): void {
    const state = this.game.state;
    if (state === "settings") {
      const rows = this.settingsRows();
      if (dy !== 0) {
        this.settingsFocus = (this.settingsFocus + dy + rows.length) % rows.length;
        this.updateFocus();
      } else if (dx !== 0) {
        this.changeSettingRow(this.settingsFocus, dx);
      }
      return;
    }
    const buttons = this.currentButtons();
    const ref = this.focusIndexRef();
    if (!ref || !buttons.length) return;
    if (dy !== 0) {
      const n = (ref.get() + dy + buttons.length) % buttons.length;
      ref.set(n);
      this.updateFocus();
    }
  }

  private changeSettingRow(index: number, dir: number): void {
    // Rows: 0 = size, 1 = camera, 2 = sound, 3 = back (no horizontal).
    if (index === 0) {
      const cur = BOARD_SIZES.indexOf(this.settings.boardSize);
      const n = (cur + dir + BOARD_SIZES.length) % BOARD_SIZES.length;
      this.setBoardSize(BOARD_SIZES[n]);
    } else if (index === 1) {
      this.setCamera(this.settings.cameraMode === "corner" ? "face" : "corner");
    } else if (index === 2) {
      this.setSound(!this.settings.sound);
    }
  }

  select(): void {
    const state = this.game.state;
    if (state === "settings") {
      const rows = this.settingsRows();
      const item = rows[this.settingsFocus];
      if (item && item.hasAttribute("data-back")) this.handlers.toMenu();
      return;
    }
    const buttons = this.currentButtons();
    const ref = this.focusIndexRef();
    if (ref && buttons.length) {
      const i = Math.max(0, Math.min(ref.get(), buttons.length - 1));
      buttons[i]?.click();
    }
  }

  back(): void {
    const state = this.game.state;
    if (state === "settings") this.handlers.toMenu();
    else if (state === "paused") this.handlers.resume();
    else if (state === "gameover") this.handlers.toMenu();
    // menu: no-op
  }

  restart(): void {
    this.handlers.restart();
  }

  // --- Flash & HUD updates ---

  flashScreen(): void {
    const f = this.screens.flash;
    f.classList.remove("flash-anim");
    // Force reflow to restart the animation.
    void f.offsetWidth;
    f.classList.add("flash-anim");
  }

  updateHud(): void {
    if (this.game.state !== "playing" && this.game.state !== "paused" && this.game.state !== "gameover")
      return;
    const sc = this.game.score;
    this.hudEls.score.textContent = sc.score.toLocaleString();
    this.hudEls.level.textContent = String(sc.level);
    this.hudEls.layers.textContent = String(sc.clearedLayers);
    this.hudEls.time.textContent = fmtTime(this.game.elapsedMs);
    this.hudEls.difficulty.textContent = `${this.settings.boardSize}×${this.settings.boardSize}`;
    const rec = getRecord(this.settings.boardSize);
    this.hudEls.best.textContent = Math.max(rec.bestScore, sc.score).toLocaleString();
    this.hudEls.bestTime.textContent = fmtTime(Math.max(rec.bestTimeMs, this.game.elapsedMs));

    // NEXT queue.
    const queue = this.game.nextQueue(5);
    const sig = queue.join("");
    if (sig !== this.lastNextSig) {
      this.lastNextSig = sig;
      queue.forEach((t, i) => drawMini(this.nextCanvases[i], t));
    }
    // HOLD.
    if (this.game.holdType !== this.lastHold) {
      this.lastHold = this.game.holdType;
      drawMini(this.holdCanvas, this.game.holdType);
    }
  }

  /**
   * Point the compass at the camera. Input quantizes the yaw to the nearest 90
   * degrees before picking a board axis, so every arrow key is off screen-square
   * by exactly the same residual angle (0 in face view, 45 in corner view).
   * Rotating the whole widget by that residual therefore shows, for all four
   * keys at once, which way the piece actually travels on screen.
   */
  updateCompass(yaw: number): void {
    const deg = (yawResidual(yaw) * 180) / Math.PI;
    this.hudEls.compass.style.transform = `rotate(${deg.toFixed(2)}deg)`;
  }

  showGameOver(newBestScore: boolean, newBestTime: boolean): void {
    const sc = this.game.score;
    this.hudEls.goScore.textContent = `SCORE  ${sc.score.toLocaleString()}`;
    this.hudEls.goLayers.textContent = `LAYERS  ${sc.clearedLayers}`;
    this.hudEls.goTime.textContent = `TIME  ${fmtTime(this.game.elapsedMs)}`;
    const badges: string[] = [];
    if (newBestScore) badges.push("★ NEW BEST SCORE");
    if (newBestTime) badges.push("★ NEW BEST TIME");
    this.hudEls.goRecord.textContent = badges.join("   ");
  }

  /** Refresh HOLD/NEXT immediately (e.g. on new game). */
  resetMiniCache(): void {
    this.lastNextSig = "";
    this.lastHold = null;
  }

  totalPlayLabel(): string {
    return fmtTime(getTotalPlayTime());
  }
}

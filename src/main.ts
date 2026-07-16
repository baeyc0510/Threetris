import { GameManager } from "./core/GameManager";
import type { GameEvents } from "./core/GameManager";
import { CameraRig } from "./render/CameraRig";
import { Renderer } from "./render/Renderer";
import { Input } from "./input/Input";
import { UI } from "./ui/UI";
import type { UIHandlers } from "./ui/UI";
import { Sound } from "./audio/Sound";
import { pieceColor } from "./render/materials";
import { loadSettings, saveSettings, addTotalPlayTime, submitResult } from "./core/storage";
import type { Settings } from "./core/types";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const settings: Settings = loadSettings();
const sound = new Sound();
sound.setEnabled(settings.sound);

const rig = new CameraRig(window.innerWidth / window.innerHeight);
rig.setMode(settings.cameraMode);

// --- Game events feed sound + effects + UI. Rendering pulls state each frame. ---
const events: GameEvents = {
  onMove: () => sound.move(),
  onRotate: () => sound.rotate(),
  onSoftDrop: () => sound.softDrop(),
  onHardDrop: () => sound.hardDrop(),
  onLock: () => sound.lock(),
  onHold: () => sound.hold(),
  onLevelUp: () => sound.levelUp(),
  onLayerClear: (zs, layers, _spin, type) => {
    sound.clear(layers);
    if (zs.length > 0) {
      ui.flashScreen();
      renderer.playLayerClear(zs, pieceColor(type));
    }
  },
  onGameOver: () => {
    sound.gameOver();
    endRun(true);
  },
  onStateChange: (state) => ui.showFor(state),
};

const game = new GameManager(settings.boardSize, events);
const renderer = new Renderer(canvas, rig, settings.boardSize);

// --- Run lifecycle (records + total play time) ---
let runActive = false;

function endRun(showOver: boolean): void {
  if (!runActive) return;
  runActive = false;
  addTotalPlayTime(game.elapsedMs);
  const r = submitResult(settings.boardSize, game.score.score, game.elapsedMs);
  if (showOver) ui.showGameOver(r.newBestScore, r.newBestTime);
}

function startNewGame(): void {
  endRun(false); // finalize any lingering run first
  renderer.setBoardSize(settings.boardSize);
  renderer.clearBoardVisual();
  ui.resetMiniCache();
  rig.setMode(settings.cameraMode);
  runActive = true;
  game.newGame(settings.boardSize);
}

// --- UI handlers ---
const uiHandlers: UIHandlers = {
  start: () => {
    sound.resume();
    startNewGame();
  },
  resume: () => game.resume(),
  restart: () => {
    sound.resume();
    startNewGame();
  },
  toMenu: () => {
    endRun(false);
    game.toMenu();
  },
  openSettings: () => game.toSettings(),
  quit: () => {
    // Browsers only allow closing script-opened windows; otherwise return to menu.
    window.close();
    game.toMenu();
  },
  applySettings: (s) => {
    saveSettings(s);
    sound.setEnabled(s.sound);
    rig.setMode(s.cameraMode);
    if (game.state !== "playing" && game.state !== "paused") {
      renderer.setBoardSize(s.boardSize);
    }
  },
};

const ui = new UI(uiRoot, game, settings, uiHandlers);
const input = new Input(game, rig, {
  nav: (dx, dy) => ui.nav(dx, dy),
  select: () => ui.select(),
  back: () => ui.back(),
  restart: () => ui.restart(),
});

// Unlock audio on first interaction.
const unlock = () => sound.resume();
window.addEventListener("pointerdown", unlock, { once: true });
window.addEventListener("keydown", unlock, { once: true });

// --- Resize ---
window.addEventListener("resize", () => renderer.resize());

// --- Main loop ---
let last = performance.now();
function frame(now: number): void {
  const dtMs = Math.min(now - last, 100); // clamp huge gaps (tab switches)
  last = now;
  const dt = dtMs / 1000;

  game.update(dtMs);
  input.update(dtMs);

  if (game.state === "menu") rig.nudgeYaw(0.12 * dt);
  rig.update(dt, game.effectiveStackHeight());

  renderer.sync(game);
  renderer.render(dt);
  ui.updateHud();

  requestAnimationFrame(frame);
}

// Show the menu at start.
ui.showFor("menu");
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// Expose for debugging in dev.
(window as unknown as { __game?: unknown }).__game = { game, renderer, rig };

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

export function screensaverShortcutLabel(): string {
  return isMacPlatform() ? "⌘ ⌥ L" : "Ctrl + Shift + L";
}

/** Windows/Linux: Ctrl+Shift+L · macOS: Command+Option+L (Option harfi değiştirdiği için tuş koduna bakılır). */
export function isScreensaverShortcut(event: KeyboardEvent): boolean {
  if (event.code !== "KeyL" && event.key.toLowerCase() !== "l") return false;
  return isMacPlatform()
    ? event.metaKey && event.altKey && !event.ctrlKey
    : event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
}

const GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF{}[]<>/=+*;:$#@&|";
const BASE_TOKENS = ["LISTEN", "200 OK", "SYN/ACK", "0x7F00", "localhost", "GET /", "PID", "TCP", "::1", "UTF-8"];

export interface ScreensaverStats {
  running: number;
  ports: number;
  errors: number;
  projects: number;
}

export function Screensaver({
  words,
  stats,
  onExit,
}: {
  /** Yağmura karışan gerçek veriler: portlar, uygulama adları… */
  words: string[];
  stats: ScreensaverStats;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [nudge, setNudge] = useState(0);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Çıkış kısayolu dışındaki tüm tuşları yut; kullanıcıya nasıl çıkacağını hatırlat.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isScreensaverShortcut(event)) onExit();
      else if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) setNudge((value) => value + 1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const fontSize = 17;
    let width = 0;
    let height = 0;
    let columns = 0;
    let rows: number[] = [];
    let lastRows: number[] = [];
    let speeds: number[] = [];
    let colors: string[] = [];
    let queues: string[][] = [];
    let previous: string[] = [];
    let frame = 0;
    let lastTime = 0;

    const pickColor = () => {
      const roll = Math.random();
      if (roll < 0.08) return "#29f0ff";
      if (roll < 0.12) return "#ff2bd6";
      return "#39ff88";
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.ceil(width / fontSize);
      rows = Array.from({ length: columns }, () => -Math.random() * (height / fontSize) * 1.5);
      lastRows = rows.map(() => -1);
      speeds = rows.map(() => 0.25 + Math.random() * 0.75);
      colors = rows.map(pickColor);
      queues = rows.map(() => []);
      previous = rows.map(() => "");
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
    };

    const nextGlyph = (column: number) => {
      const queue = queues[column];
      if (queue.length) return queue.shift()!;
      if (Math.random() < 0.012) {
        const pool = [...BASE_TOKENS, ...wordsRef.current];
        const token = pool[Math.floor(Math.random() * pool.length)] ?? "";
        queues[column] = [...token];
        if (queues[column].length) return queues[column].shift()!;
      }
      return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    };

    const draw = (time: number) => {
      frame = window.requestAnimationFrame(draw);
      if (time - lastTime < 33) return;
      lastTime = time;
      // Önceki kareyi karartarak iz bırak.
      context.fillStyle = "rgba(0, 5, 3, 0.085)";
      context.fillRect(0, 0, width, height);
      context.font = `${fontSize}px "JetBrains Mono Variable", Consolas, monospace`;
      context.textBaseline = "top";
      for (let column = 0; column < columns; column += 1) {
        const row = Math.floor(rows[column]);
        if (row !== lastRows[column]) {
          const x = column * fontSize;
          // Bir önceki baş karakteri iz rengine boya.
          if (previous[column] && lastRows[column] >= 0) {
            context.fillStyle = colors[column];
            context.globalAlpha = 0.85;
            context.fillText(previous[column], x, lastRows[column] * fontSize);
            context.globalAlpha = 1;
          }
          if (row >= 0) {
            const glyph = nextGlyph(column);
            context.fillStyle = "#eafff2";
            context.shadowColor = colors[column];
            context.shadowBlur = 10;
            context.fillText(glyph, x, row * fontSize);
            context.shadowBlur = 0;
            previous[column] = glyph;
          }
          lastRows[column] = row;
        }
        rows[column] += speeds[column];
        if (rows[column] * fontSize > height && Math.random() > 0.97) {
          rows[column] = -Math.random() * 12;
          lastRows[column] = -1;
          speeds[column] = 0.25 + Math.random() * 0.75;
          colors[column] = pickColor();
          queues[column] = [];
          previous[column] = "";
        }
      }
    };

    resize();
    frame = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <div
      className="screensaver"
      role="dialog"
      aria-modal="true"
      aria-label="Ekran koruyucu"
      onMouseDown={(event) => {
        event.preventDefault();
        setNudge((value) => value + 1);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <canvas ref={canvasRef} className="screensaver-canvas" />
      <div className="screensaver-vignette" />
      <div className="screensaver-hud">
        <LogoMark size={46} />
        <div className="screensaver-time">{time}</div>
        <div className="screensaver-date">{date}</div>
        <div className="screensaver-stats">
          <span>
            <b>{stats.running}</b> çalışan
          </span>
          <span>
            <b>{stats.ports}</b> port
          </span>
          <span className={stats.errors ? "is-alert" : ""}>
            <b>{stats.errors}</b> hata
          </span>
          <span>
            <b>{stats.projects}</b> proje
          </span>
        </div>
      </div>
      <div key={nudge} className={`screensaver-hint ${nudge ? "is-nudged" : ""}`}>
        Çıkmak için <kbd>{screensaverShortcutLabel()}</kbd>
      </div>
    </div>
  );
}

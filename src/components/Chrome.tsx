import {
  Activity,
  Binary,
  Bug,
  Command,
  FolderKanban,
  Minus,
  Radar,
  Settings2,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { windowControls } from "../api";
import { formatClock } from "../lib/format";
import { Logo } from "./Logo";
import { screensaverShortcutLabel } from "./Screensaver";
import { Kbd } from "./ui";

export type ViewId = "radar" | "projects" | "events" | "problems";

export function TitleBar({
  onOpenPalette,
  scanning,
}: {
  onOpenPalette: () => void;
  scanning: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const desktop = windowControls.available();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <Logo />
      <div className="titlebar-spacer" data-tauri-drag-region />
      <button type="button" className="palette-trigger" onClick={onOpenPalette}>
        <Command size={14} />
        <span>Komut çalıştır, proje veya port ara…</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>
      <div className="titlebar-spacer" data-tauri-drag-region />
      {!desktop && (
        <span
          className="preview-badge"
          title="Tarayıcıda çalışıyor: portlar, klasör taraması ve süreçler örnek veridir. Gerçek kullanım için npm run tauri dev."
        >
          ÖNİZLEME · ÖRNEK VERİ
        </span>
      )}
      <div className="titlebar-clock" data-tauri-drag-region>
        <span className={`scan-pulse ${scanning ? "is-active" : ""}`} />
        <span data-tauri-drag-region>{formatClock(now)}</span>
      </div>
      {desktop && (
        <div className="window-controls">
          <button type="button" aria-label="Küçült" onClick={() => void windowControls.minimize()}>
            <Minus size={14} />
          </button>
          <button
            type="button"
            aria-label="Büyüt"
            onClick={() => void windowControls.toggleMaximize()}
          >
            <Square size={11} />
          </button>
          <button
            type="button"
            className="window-close"
            aria-label="Kapat"
            onClick={() => void windowControls.close()}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </header>
  );
}

export function ActivityBar({
  view,
  onView,
  panelOpen,
  onTogglePanel,
  onOpenSettings,
  runningCount,
  eventCount,
  problemCount,
  onScreensaver,
}: {
  view: ViewId;
  onView: (view: ViewId) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  runningCount: number;
  eventCount: number;
  problemCount: number;
  onScreensaver: () => void;
}) {
  const items: Array<{ id: ViewId; label: string; icon: typeof Radar; badge?: number }> = [
    { id: "radar", label: "Port Radarı", icon: Radar },
    { id: "projects", label: "Projeler", icon: FolderKanban, badge: runningCount },
    { id: "events", label: "Olay Akışı", icon: Activity, badge: eventCount },
    { id: "problems", label: "Sorunlar", icon: Bug, badge: problemCount },
  ];
  return (
    <nav className="activity-bar" aria-label="Ana gezinme">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={view === item.id ? "is-active" : ""}
          onClick={() => onView(item.id)}
          title={item.label}
          aria-label={item.label}
        >
          <item.icon size={20} strokeWidth={1.6} />
          {Boolean(item.badge) && <span className="activity-badge">{item.badge}</span>}
        </button>
      ))}
      <button
        type="button"
        className={panelOpen ? "is-toggled" : ""}
        onClick={onTogglePanel}
        title="Konsol (Ctrl+`)"
        aria-label="Konsolu aç/kapat"
      >
        <TerminalSquare size={20} strokeWidth={1.6} />
      </button>
      <span className="activity-spacer" />
      <button type="button" onClick={onScreensaver} title={`Ekran koruyucu (${screensaverShortcutLabel()})`} aria-label="Ekran koruyucu">
        <Binary size={20} strokeWidth={1.6} />
      </button>
      <button type="button" onClick={onOpenSettings} title="Ayarlar" aria-label="Ayarlar">
        <Settings2 size={20} strokeWidth={1.6} />
      </button>
    </nav>
  );
}

export function StatusBar({
  portCount,
  runningCount,
  projectCount,
  platform,
  scannedAt,
  refreshInterval,
  errorCount,
  onShowProblems,
  onOpenPalette,
}: {
  portCount: number;
  runningCount: number;
  projectCount: number;
  platform: string | null;
  scannedAt: number | null;
  refreshInterval: number;
  errorCount: number;
  onShowProblems: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <footer className="status-bar">
      <span className="status-live">
        <i />
        CANLI{refreshInterval ? ` · ${refreshInterval / 1000}sn` : " · DURAKLATILDI"}
      </span>
      <span>
        <b>{portCount}</b> port
      </span>
      <span>
        <b>{runningCount}</b> çalışan
      </span>
      <span>
        <b>{projectCount}</b> proje
      </span>
      {errorCount > 0 && (
        <button type="button" className="status-errors" onClick={onShowProblems} title="Sorunları göster">
          <b>{errorCount}</b> hata
        </button>
      )}
      <span className="status-spacer" />
      {scannedAt && <span>son tarama {formatClock(scannedAt)}</span>}
      {platform && <span className="status-platform">{platform.toUpperCase()}</span>}
      <button type="button" onClick={onOpenPalette}>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>
    </footer>
  );
}

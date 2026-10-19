import {
  AlertTriangle,
  CheckCircle2,
  CornerDownLeft,
  FolderSearch,
  Info,
  Loader2,
  Radar,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isTauriRuntime, pickFolder, scanWorkspace } from "../api";
import { DEMO_ROOT } from "../mock/mockBackend";
import type { Preferences } from "../lib/projectStore";
import { KIND_META } from "../lib/stacks";
import type { PortCheck, ProcessPortGroup, WorkspaceScan } from "../types";
import { LogoMark } from "./Logo";
import { Kbd, StackBadge } from "./ui";

export function Modal({
  children,
  onClose,
  className = "",
  labelledBy,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  labelledBy?: string;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal glass ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="modal-corner modal-corner--tl" />
        <span className="modal-corner modal-corner--br" />
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yeni proje
// ---------------------------------------------------------------------------

export function NewProjectDialog({
  onClose,
  onCreate,
  existingPaths,
}: {
  onClose: () => void;
  onCreate: (scan: WorkspaceScan, name: string) => void;
  existingPaths: string[];
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<WorkspaceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = !isTauriRuntime();

  async function runScan(target: string) {
    if (!target.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const result = await scanWorkspace(target.trim());
      setScan(result);
      setPath(result.root);
      setName((current) => current || result.name);
    } catch (reason) {
      setScan(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScanning(false);
    }
  }

  async function browse() {
    try {
      const selected = await pickFolder();
      if (selected) {
        setPath(selected);
        setName("");
        await runScan(selected);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const duplicate = scan && existingPaths.some((item) => item.toLowerCase() === scan.root.toLowerCase());

  return (
    <Modal onClose={onClose} className="modal--wide" labelledBy="new-project-title">
      <header className="modal-header">
        <div>
          <p className="eyebrow">// YENİ PROJE</p>
          <h2 id="new-project-title">Çalışma klasörünü bağla</h2>
          <p>
            Klasör taranır; içindeki ayağa kaldırılabilir tüm frontend, backend ve altyapı uygulamaları otomatik
            tespit edilir.
          </p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
          <X size={16} />
        </button>
      </header>

      {preview && (
        <div className="callout callout--amber">
          <AlertTriangle size={14} />
          <span>
            Tarayıcı önizlemesindesin: gerçek klasör seçimi ve taraması yalnızca masaüstü uygulamasında
            (<code>npm run tauri dev</code>) çalışır. Arayüzü denemek için örnek projeyi yükleyebilirsin.
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setPath(DEMO_ROOT);
              setName("");
              void runScan(DEMO_ROOT);
            }}
          >
            Örnek projeyi yükle
          </button>
        </div>
      )}

      <form
        className="path-picker"
        onSubmit={(event) => {
          event.preventDefault();
          void runScan(path);
        }}
      >
        <FolderSearch size={16} />
        <input
          autoFocus
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="D:\development\benim-projem"
          aria-label="Klasör yolu"
          spellCheck={false}
        />
        <button
          type="button"
          className="neon-button neon-button--ghost neon-button--small"
          onClick={() => void browse()}
          disabled={preview}
          title={preview ? "Klasör seçici yalnızca masaüstü uygulamasında çalışır" : "Klasör seç"}
        >
          Gözat…
        </button>
        <button type="submit" className="neon-button neon-button--small" disabled={!path.trim() || scanning}>
          {scanning ? <Loader2 size={13} className="spin" /> : <Radar size={13} />}
          Tara
        </button>
      </form>

      {error && (
        <div className="callout callout--red">
          <XCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {scanning && (
        <div className="scan-progress">
          <div className="scan-bar" />
          <span>Manifestler aranıyor: package.json · pom.xml · *.csproj · go.mod · Cargo.toml · compose…</span>
        </div>
      )}

      {scan && !scanning && (
        <div className="scan-result">
          <div className="scan-summary">
            <strong>{scan.apps.length}</strong> uygulama bulundu
            <span>
              {scan.scannedDirectories} klasör · {scan.durationMs} ms{scan.truncated ? " · tarama sınırına ulaşıldı" : ""}
            </span>
          </div>
          <ul className="detected-list">
            {scan.apps.map((app, index) => (
              <li
                key={app.id}
                style={{ "--kind": KIND_META[app.kind].color, animationDelay: `${index * 60}ms` } as CSSProperties}
              >
                <StackBadge stack={app.stack} size="sm" />
                <div>
                  <strong>{app.name}</strong>
                  <span>
                    {app.framework} · <code>./{app.relativePath === "." ? "" : app.relativePath}</code>
                  </span>
                </div>
                <span className="kind-tag">{KIND_META[app.kind].label}</span>
                <code className="detected-port">{app.defaultPort ? `:${app.defaultPort}` : "—"}</code>
              </li>
            ))}
            {scan.apps.length === 0 && (
              <li className="detected-empty">
                Bu klasörde çalıştırılabilir uygulama bulunamadı. Yine de projeyi ekleyip daha sonra yeniden
                tarayabilirsiniz.
              </li>
            )}
          </ul>
          <label className="field">
            <span>Proje adı</span>
            <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Proje adı" />
          </label>
          {duplicate && (
            <div className="callout callout--amber">
              <AlertTriangle size={14} />
              <span>Bu klasör zaten bir proje olarak ekli.</span>
            </div>
          )}
        </div>
      )}

      <footer className="modal-footer">
        <button type="button" className="neon-button neon-button--ghost" onClick={onClose}>
          Vazgeç
        </button>
        <button
          type="button"
          className="neon-button"
          disabled={!scan || scanning}
          onClick={() => scan && onCreate(scan, name)}
        >
          <Sparkles size={14} />
          Projeyi oluştur
        </button>
      </footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Komut paleti
// ---------------------------------------------------------------------------

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keywords?: string;
  accent?: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const tokens = query.toLocaleLowerCase("tr-TR").split(/\s+/).filter(Boolean);
    if (!tokens.length) return commands;
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.group} ${command.hint ?? ""} ${command.keywords ?? ""}`.toLocaleLowerCase("tr-TR");
      return tokens.every((token) => haystack.includes(token));
    });
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function execute(command: PaletteCommand | undefined) {
    if (!command) return;
    onClose();
    window.setTimeout(command.run, 0);
  }

  let lastGroup = "";
  return (
    <div className="modal-backdrop modal-backdrop--top" onMouseDown={onClose}>
      <div className="palette glass" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Komut paleti">
        <div className="palette-input">
          <span className="palette-prompt">❯</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Komut yazın: başlat, durdur, :5173, proje adı…"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(filtered.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(filtered[index]);
              } else if (event.key === "Escape") {
                onClose();
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="palette-list" ref={listRef}>
          {filtered.length === 0 && <li className="palette-empty">Eşleşen komut yok</li>}
          {filtered.map((command, position) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {header && <span className="palette-group">{header}</span>}
                <button
                  type="button"
                  className={position === index ? "is-selected" : ""}
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => execute(command)}
                  style={command.accent ? ({ "--accent": command.accent } as CSSProperties) : undefined}
                >
                  <span className="palette-label">{command.label}</span>
                  {command.hint && <span className="palette-hint">{command.hint}</span>}
                  {position === index && <CornerDownLeft size={13} className="palette-enter" />}
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="palette-footer">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> gezin
          </span>
          <span>
            <Kbd>Enter</Kbd> çalıştır
          </span>
          <span>{filtered.length} komut</span>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onay ve çakışma diyalogları
// ---------------------------------------------------------------------------

export function ConfirmStopDialog({
  process,
  busy,
  onCancel,
  onConfirm,
}: {
  process: ProcessPortGroup;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ports = [...new Set(process.ports.map((port) => port.port))];
  return (
    <Modal onClose={onCancel} className="modal--danger" labelledBy="stop-title">
      <header className="modal-header">
        <div>
          <p className="eyebrow eyebrow--danger">// SÜREÇ SONLANDIRILACAK</p>
          <h2 id="stop-title">{process.projectName ?? process.displayName}</h2>
          <p>
            Bu süreç PortControl dışından başlatılmış. Durdurulduğunda süreç ve aşağıdaki tüm portları kapanır;
            kaydedilmemiş veriler kaybolabilir.
          </p>
        </div>
      </header>
      <dl className="stop-details">
        <div>
          <dt>Süreç</dt>
          <dd>
            {process.processName} · PID {process.pid}
          </dd>
        </div>
        <div>
          <dt>Portlar</dt>
          <dd>{ports.map((port) => `:${port}`).join("  ")}</dd>
        </div>
        {process.command && (
          <div>
            <dt>Komut</dt>
            <dd>
              <code>{process.command}</code>
            </dd>
          </div>
        )}
      </dl>
      <footer className="modal-footer">
        <button type="button" className="neon-button neon-button--ghost" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
        <button type="button" className="neon-button neon-button--danger" onClick={onConfirm} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <XCircle size={14} />}
          Süreci durdur
        </button>
      </footer>
    </Modal>
  );
}

export function PortConflictDialog({
  appName,
  check,
  suggestion,
  onCancel,
  onUseSuggestion,
  onForce,
}: {
  appName: string;
  check: PortCheck;
  suggestion: number | null;
  onCancel: () => void;
  onUseSuggestion: () => void;
  onForce: () => void;
}) {
  return (
    <Modal onClose={onCancel} className="modal--warn" labelledBy="conflict-title">
      <header className="modal-header">
        <div>
          <p className="eyebrow eyebrow--warn">// PORT ÇAKIŞMASI</p>
          <h2 id="conflict-title">:{check.port} zaten kullanımda</h2>
          <p>
            <b>{appName}</b> başlatılmak istenen port{" "}
            {check.processName ? (
              <>
                <code>{check.processName}</code> (PID {check.pid})
              </>
            ) : (
              "başka bir süreç"
            )}{" "}
            tarafından dinleniyor.
          </p>
        </div>
      </header>
      <div className="conflict-options">
        {suggestion && (
          <button type="button" className="conflict-option conflict-option--primary" onClick={onUseSuggestion}>
            <strong>:{suggestion} portunda başlat</strong>
            <span>En yakın boş port. Ayar bu uygulama için kaydedilir.</span>
          </button>
        )}
        <button type="button" className="conflict-option" onClick={onForce}>
          <strong>Yine de :{check.port} ile başlat</strong>
          <span>Uygulama kendisi alternatif port seçebilir ya da hata verebilir.</span>
        </button>
      </div>
      <footer className="modal-footer">
        <button type="button" className="neon-button neon-button--ghost" onClick={onCancel}>
          Vazgeç
        </button>
      </footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------

export function SettingsDialog({
  preferences,
  onChange,
  onClose,
}: {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy="settings-title">
      <header className="modal-header">
        <div>
          <p className="eyebrow">// SİSTEM</p>
          <h2 id="settings-title">Ayarlar</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
          <X size={16} />
        </button>
      </header>
      <div className="settings-grid">
        <label className="field">
          <span>Port tarama aralığı</span>
          <select
            value={preferences.refreshInterval}
            onChange={(event) => onChange({ refreshInterval: Number(event.target.value) })}
          >
            <option value={0}>Kapalı</option>
            <option value={2000}>2 saniye</option>
            <option value={3000}>3 saniye</option>
            <option value={5000}>5 saniye</option>
            <option value={10000}>10 saniye</option>
          </select>
        </label>
        <label className="field">
          <span>Editör komutu</span>
          <input
            value={preferences.editorCommand}
            onChange={(event) => onChange({ editorCommand: event.target.value.replace(/[^\w.-]/g, "") })}
            placeholder="code, cursor, idea64…"
          />
        </label>
        <label className="field">
          <span>Ekran koruyucu (boşta kalınca)</span>
          <select
            value={preferences.screensaverIdle}
            onChange={(event) => onChange({ screensaverIdle: Number(event.target.value) })}
          >
            <option value={0}>Kapalı · yalnızca kısayolla</option>
            <option value={1}>1 dakika</option>
            <option value={3}>3 dakika</option>
            <option value={5}>5 dakika</option>
            <option value={10}>10 dakika</option>
            <option value={15}>15 dakika</option>
            <option value={30}>30 dakika</option>
          </select>
        </label>
        <Toggle
          label="Altyapı servislerini göster"
          detail="PostgreSQL, Redis, Docker gibi geliştirme altyapısı portlarını radara ekler."
          value={preferences.includeInfrastructure}
          onChange={(value) => onChange({ includeInfrastructure: value })}
        />
        <Toggle
          label="Hazır bildirimleri"
          detail="Bir uygulama adres yayınladığında bildirim gösterir."
          value={preferences.notifyReady}
          onChange={(value) => onChange({ notifyReady: value })}
        />
        <Toggle
          label="Açılış animasyonu"
          detail="Uygulama açılırken kısa sistem başlatma sekansı."
          value={preferences.bootAnimation}
          onChange={(value) => onChange({ bootAnimation: value })}
        />
      </div>
    </Modal>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button type="button" className={`toggle-row ${value ? "is-on" : ""}`} onClick={() => onChange(!value)} aria-pressed={value}>
      <span className="toggle-switch">
        <i />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bildirimler ve açılış
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  tone: "success" | "error" | "info" | "warn";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          {toast.tone === "success" ? (
            <CheckCircle2 size={17} />
          ) : toast.tone === "error" ? (
            <XCircle size={17} />
          ) : toast.tone === "warn" ? (
            <AlertTriangle size={17} />
          ) : (
            <Info size={17} />
          )}
          <div>
            <strong>{toast.title}</strong>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Kapat">
            <X size={13} />
          </button>
          <span className="toast-timer" />
        </div>
      ))}
    </div>
  );
}

const BOOT_LINES = [
  "PORT//CONTROL çekirdeği başlatılıyor",
  "soket tablosu eşleniyor",
  "süreç ağacı çözümleniyor",
  "sistem gürültüsü filtreleniyor",
  "radar kalibre edildi",
];

export function BootSplash({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= BOOT_LINES.length) {
      const timer = window.setTimeout(onDone, 380);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setStep((value) => value + 1), 190);
    return () => window.clearTimeout(timer);
  }, [step, onDone]);

  return (
    <div className={`boot-splash ${step >= BOOT_LINES.length ? "is-leaving" : ""}`} onClick={onDone}>
      <div className="boot-core">
        <LogoMark size={64} />
        <h1 className="glitch" data-text="PORT//CONTROL">
          PORT//CONTROL
        </h1>
        <ul>
          {BOOT_LINES.slice(0, step).map((line) => (
            <li key={line}>
              <span>[ OK ]</span> {line}
            </li>
          ))}
        </ul>
        <div className="boot-bar">
          <i style={{ width: `${(step / BOOT_LINES.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

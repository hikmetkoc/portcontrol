import {
  ArrowDownToLine,
  Download,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Eraser,
  ExternalLink,
  Maximize2,
  Minimize2,
  RotateCw,
  Search,
  ShieldAlert,
  Square,
  TerminalSquare,
  WrapText,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseAnsi, stripAnsi, type AnsiSegment } from "../lib/ansi";
import { formatClock, formatDuration } from "../lib/format";
import { classifyLine, isContinuation } from "../lib/severity";
import { useRunLogs, type RunRecord } from "../state/runStore";
import type { LogLine } from "../types";
import { StatusLed } from "./ui";

/** Bir seferde çizilen satır sayısı; daha eskileri isteğe bağlı açılır. */
const RENDER_STEP = 3000;

interface ParsedLine {
  line: LogLine;
  segments: AnsiSegment[];
  plain: string;
  severity: "error" | "warn" | "normal";
}

const parseCache = new WeakMap<LogLine, ParsedLine>();

function parseLine(line: LogLine): ParsedLine {
  const cached = parseCache.get(line);
  if (cached) return cached;
  const parsed: ParsedLine = {
    line,
    segments: parseAnsi(line.text),
    plain: stripAnsi(line.text),
    severity: line.stream === "system" || line.stream === "input" ? "normal" : displaySeverity(line.text),
  };
  parseCache.set(line, parsed);
  return parsed;
}

function displaySeverity(text: string): ParsedLine["severity"] {
  const plain = stripAnsi(text);
  // Java stack frame'leri ve "Caused by" satırları hata bloğunun parçası olarak vurgulanır.
  if (isContinuation(plain) && /^\s+at\s|^\s*Caused by:|^\s*\.\.\. \d+/.test(plain)) return "error";
  return classifyLine(plain);
}

export interface TerminalPanelProps {
  runs: RunRecord[];
  /** Belirli bir log satırına kaydır ve vurgula (çökme analizinden gelir). */
  focus: { runId: string; seq: number; at: number } | null;
  activeRunId: string | null;
  height: number;
  maximized: boolean;
  showTimestamps: boolean;
  wrap: boolean;
  onSelect: (runId: string) => void;
  onClose: (run: RunRecord) => void;
  onStop: (run: RunRecord) => void;
  onRestart: (run: RunRecord) => void;
  onClear: (run: RunRecord) => void;
  onSendInput: (run: RunRecord, text: string) => void;
  onOpenUrl: (url: string) => void;
  onSaveLog: (run: RunRecord) => void;
  onShowProblems: (run: RunRecord) => void;
  onResize: (height: number) => void;
  onToggleMaximize: () => void;
  onHide: () => void;
  onToggleTimestamps: () => void;
  onToggleWrap: () => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  const {
    runs,
    activeRunId,
    height,
    maximized,
    onSelect,
    onClose,
    onResize,
    onToggleMaximize,
    onHide,
  } = props;
  const active = runs.find((run) => run.runId === activeRunId) ?? runs[runs.length - 1] ?? null;
  const dragging = useRef(false);

  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    dragging.current = true;
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      const next = startHeight + (startY - moveEvent.clientY);
      onResize(Math.max(150, Math.min(window.innerHeight - 180, next)));
    };
    const stop = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }

  return (
    <section
      className={`terminal-panel ${maximized ? "is-maximized" : ""}`}
      style={maximized ? undefined : { height }}
      aria-label="Konsol"
    >
      <div className="terminal-resize" onMouseDown={startResize} />
      <header className="terminal-tabs">
        <span className="terminal-title">
          <TerminalSquare size={14} />
          KONSOL
        </span>
        <div className="tab-strip">
          {runs.length === 0 && <span className="tab-placeholder">Henüz çalışan süreç yok</span>}
          {runs.map((run) => (
            <div
              key={run.runId}
              className={`terminal-tab ${active?.runId === run.runId ? "is-active" : ""}`}
              onClick={() => onSelect(run.runId)}
              role="tab"
              aria-selected={active?.runId === run.runId}
            >
              <StatusLed state={run.status === "running" ? (run.urls.length ? "running" : "starting") : run.status} />
              <span>{run.label}</span>
              {run.errorCount > 0 && <b className="tab-errors">{run.errorCount}</b>}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(run);
                }}
                aria-label={run.status === "running" ? "Durdur ve kapat" : "Sekmeyi kapat"}
                title={run.status === "running" ? "Durdur ve kapat" : "Sekmeyi kapat"}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-window-actions">
          <button type="button" onClick={onToggleMaximize} aria-label={maximized ? "Küçült" : "Büyüt"} title={maximized ? "Küçült" : "Büyüt"}>
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" onClick={onHide} aria-label="Paneli gizle" title="Paneli gizle (Ctrl+`)">
            <ChevronDown size={15} />
          </button>
        </div>
      </header>
      {active ? (
        <RunConsole key={active.runId} run={active} {...props} />
      ) : (
        <div className="terminal-empty">
          <TerminalSquare size={28} strokeWidth={1.2} />
          <p>Bir uygulamayı başlattığınızda canlı çıktısı burada akar.</p>
        </div>
      )}
    </section>
  );
}

function RunConsole({
  run,
  focus,
  showTimestamps,
  wrap,
  onStop,
  onRestart,
  onClear,
  onSendInput,
  onOpenUrl,
  onToggleTimestamps,
  onToggleWrap,
  onSaveLog,
  onShowProblems,
}: TerminalPanelProps & { run: RunRecord }) {
  const { lines: logs, version } = useRunLogs(run.runId);
  const [limit, setLimit] = useState(RENDER_STEP);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [input, setInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const running = run.status === "running";

  // Çökme özetinden "hata satırına git" istendiğinde filtreleri temizleyip satıra kaydır.
  useEffect(() => {
    if (!focus || focus.runId !== run.runId) return;
    setQuery("");
    setErrorsOnly(false);
    setFollow(false);
    setFlashSeq(focus.seq);
    // Hedef satır çizilen pencerenin dışındaysa pencereyi genişlet.
    const index = logs.findIndex((line) => line.seq === focus.seq);
    if (index >= 0 && logs.length - index > limit) setLimit(logs.length - index + 200);
    const frame = window.requestAnimationFrame(() => {
      scroller.current
        ?.querySelector(`[data-seq="${focus.seq}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    const timer = window.setTimeout(() => setFlashSeq(null), 2600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focus, run.runId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const { parsed, hidden } = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    // Filtre yoksa yalnızca kuyruğu ayrıştır; 50.000 satırda her partide tam tarama yapılmaz.
    if (!needle && !errorsOnly) {
      const start = Math.max(0, logs.length - limit);
      return { parsed: logs.slice(start).map(parseLine), hidden: start };
    }
    const list: ParsedLine[] = [];
    for (const line of logs) {
      const item = parseLine(line);
      if (errorsOnly && item.severity === "normal") continue;
      if (needle && !item.plain.toLocaleLowerCase("tr-TR").includes(needle)) continue;
      list.push(item);
    }
    const start = Math.max(0, list.length - limit);
    return { parsed: start ? list.slice(start) : list, hidden: start };
    // version: log dizisi yerinde büyüdüğü için değişikliği sürüm numarası bildirir.
  }, [logs, version, query, errorsOnly, limit]);

  useLayoutEffect(() => {
    if (follow && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [parsed, follow]);

  function handleScroll() {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(logs.map((line) => stripAnsi(line.text)).join("\n"));
    } catch {
      // Panoya erişim yoksa sessizce yoksay.
    }
  }

  const duration = (run.endedAt ?? now) - run.startedAt;

  return (
    <div className="run-console">
      <div className="console-toolbar">
        <div className="console-meta">
          <span className={`run-state run-state--${run.status}`}>{run.status.toUpperCase()}</span>
          <span>PID {run.pid}</span>
          <span title={run.droppedLines ? `${run.droppedLines.toLocaleString("tr-TR")} eski satır bellekten düştü` : undefined}>
            {logs.length.toLocaleString("tr-TR")} satır{run.droppedLines ? " +" : ""}
          </span>
          {run.activeProfile && (
            <span className="console-profile" title="Loglardan okunan etkin profil">
              profil: {run.activeProfile}
            </span>
          )}
          <span>{formatDuration(duration)}</span>
          {run.exitCode !== null && <span>çıkış {run.exitCode}</span>}
          {run.urls.slice(0, 2).map((url) => (
            <button type="button" key={url} className="console-url" onClick={() => onOpenUrl(url)}>
              {url.replace(/^https?:\/\//, "")}
              <ExternalLink size={11} />
            </button>
          ))}
        </div>
        <div className="console-actions">
          {searchOpen && (
            <label className="console-search">
              <Search size={12} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Loglarda ara"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
              />
              <span>{parsed.length}</span>
            </label>
          )}
          <ToolButton active={searchOpen} onClick={() => setSearchOpen((value) => !value)} label="Ara">
            <Search size={13} />
          </ToolButton>
          <ToolButton active={errorsOnly} onClick={() => setErrorsOnly((value) => !value)} label="Yalnızca hata ve uyarılar">
            <ShieldAlert size={13} />
          </ToolButton>
          <ToolButton active={showTimestamps} onClick={onToggleTimestamps} label="Zaman damgaları">
            <Clock3 size={13} />
          </ToolButton>
          <ToolButton active={wrap} onClick={onToggleWrap} label="Satır kaydır">
            <WrapText size={13} />
          </ToolButton>
          <button
            type="button"
            className={`problems-button ${run.errorCount ? "has-errors" : run.warnCount ? "has-warnings" : ""}`}
            onClick={() => onShowProblems(run)}
            title="Bu çalıştırmanın hata ve uyarıları"
          >
            <ShieldAlert size={12} />
            {run.errorCount} hata · {run.warnCount} uyarı
          </button>
          <ToolButton onClick={() => onSaveLog(run)} label="Logu dosyaya kaydet">
            <Download size={13} />
          </ToolButton>
          <ToolButton onClick={() => void copyAll()} label="Tümünü kopyala">
            <Copy size={13} />
          </ToolButton>
          <ToolButton onClick={() => onClear(run)} label="Temizle">
            <Eraser size={13} />
          </ToolButton>
          <span className="toolbar-divider" />
          <ToolButton onClick={() => onRestart(run)} label="Yeniden başlat">
            <RotateCw size={13} />
          </ToolButton>
          {running && (
            <ToolButton onClick={() => onStop(run)} label="Durdur" danger>
              <Square size={12} />
            </ToolButton>
          )}
        </div>
      </div>

      {run.crash && (
        <div className="crash-banner">
          <ShieldAlert size={13} />
          <strong>{run.crash.title}</strong>
          {run.crash.hint && <span>{run.crash.hint}</span>}
          {run.crash.seq && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setErrorsOnly(false);
                setFollow(false);
                setFlashSeq(run.crash!.seq);
                window.requestAnimationFrame(() =>
                  scroller.current?.querySelector(`[data-seq="${run.crash!.seq}"]`)?.scrollIntoView({ block: "center" }),
                );
                window.setTimeout(() => setFlashSeq(null), 2600);
              }}
            >
              satıra git
            </button>
          )}
        </div>
      )}

      <div
        ref={scroller}
        className={`log-view ${wrap ? "is-wrapped" : ""} ${showTimestamps ? "has-timestamps" : ""}`}
        onScroll={handleScroll}
      >
        {hidden > 0 && (
          <button
            type="button"
            className="older-lines"
            onClick={() => {
              setFollow(false);
              setLimit((value) => value + RENDER_STEP);
            }}
          >
            ↑ {hidden.toLocaleString("tr-TR")} eski satır daha var · {Math.min(hidden, RENDER_STEP).toLocaleString("tr-TR")} satır
            daha göster
          </button>
        )}
        {parsed.map((item) => (
          <div
            key={item.line.seq}
            data-seq={item.line.seq}
            className={`log-line log-line--${item.line.stream} log-line--${item.severity} ${flashSeq === item.line.seq ? "is-flash" : ""}`}
          >
            {showTimestamps && <span className="log-ts">{formatClock(item.line.ts, true)}</span>}
            <span className="log-text">
              {item.segments.map((segment, index) => (
                <span
                  key={index}
                  style={{
                    color: segment.fg ?? undefined,
                    backgroundColor: segment.bg ?? undefined,
                    fontWeight: segment.bold ? 700 : undefined,
                    opacity: segment.dim ? 0.6 : undefined,
                    fontStyle: segment.italic ? "italic" : undefined,
                    textDecoration: segment.underline ? "underline" : undefined,
                  }}
                >
                  {renderText(segment.text, query, onOpenUrl)}
                </span>
              ))}
              {item.segments.length === 0 && " "}
            </span>
          </div>
        ))}
      </div>

      {!follow && (
        <button
          type="button"
          className="follow-button"
          onClick={() => {
            setFollow(true);
            if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
          }}
        >
          <ArrowDownToLine size={13} />
          Canlı akışa dön
        </button>
      )}

      <form
        className="console-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() && input !== "") return;
          onSendInput(run, input);
          setInput("");
        }}
      >
        <span className="prompt">{running ? "stdin ›" : "kapalı"}</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!running}
          placeholder={running ? "Sürece girdi gönder (ör. y, rs, q) ve Enter'a bas" : "Süreç çalışmıyor"}
          aria-label="Sürece girdi gönder"
        />
        <ChevronUp size={14} className="input-icon" />
      </form>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  label,
  active,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tool-button ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

const LINK_PATTERN = /(https?:\/\/[^\s'"<>)\]]+)/g;

function renderText(text: string, query: string, onOpenUrl: (url: string) => void): ReactNode {
  const parts = text.split(LINK_PATTERN);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const clean = part.replace(/[.,;:]+$/, "");
      return (
        <Fragment key={index}>
          <a
            href={clean}
            onClick={(event) => {
              event.preventDefault();
              onOpenUrl(clean.replace("0.0.0.0", "localhost"));
            }}
          >
            {clean}
          </a>
          {part.slice(clean.length)}
        </Fragment>
      );
    }
    return <Fragment key={index}>{highlight(part, query)}</Fragment>;
  });
}

function highlight(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLocaleLowerCase("tr-TR");
  const target = needle.toLocaleLowerCase("tr-TR");
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(target);
  while (index !== -1) {
    nodes.push(text.slice(cursor, index));
    nodes.push(<mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = lower.indexOf(target, cursor);
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

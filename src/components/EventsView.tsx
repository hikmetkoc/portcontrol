import { ArrowDownRight, ArrowUpRight, Ban, CircleCheck, Play, Square, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { PortEvent } from "../hooks/usePortScan";
import { formatClock, formatRelative } from "../lib/format";

export interface ActivityEntry {
  id: string;
  at: number;
  kind: "start" | "ready" | "stop" | "crash" | "exit";
  title: string;
  detail: string;
}

type TimelineItem =
  | { source: "port"; at: number; id: string; event: PortEvent }
  | { source: "run"; at: number; id: string; entry: ActivityEntry };

const RUN_ICONS = {
  start: Play,
  ready: CircleCheck,
  stop: Square,
  crash: Ban,
  exit: CircleCheck,
};

export function EventsView({
  portEvents,
  activity,
  onClear,
}: {
  portEvents: PortEvent[];
  activity: ActivityEntry[];
  onClear: () => void;
}) {
  const items = useMemo<TimelineItem[]>(
    () =>
      [
        ...portEvents.map((event) => ({ source: "port" as const, at: event.at, id: event.id, event })),
        ...activity.map((entry) => ({ source: "run" as const, at: entry.at, id: entry.id, entry })),
      ].sort((a, b) => b.at - a.at),
    [portEvents, activity],
  );
  const opened = portEvents.filter((event) => event.type === "open").length;
  const closed = portEvents.length - opened;
  const crashes = activity.filter((entry) => entry.kind === "crash").length;

  return (
    <section className="view events-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">// TELEMETRİ</p>
          <h1 className="glitch" data-text="Olay Akışı">
            Olay Akışı
          </h1>
          <p className="view-subtitle">
            Bu oturumda açılan/kapanan portlar ve PortControl'ün yönettiği süreçlerin yaşam döngüsü.
          </p>
        </div>
        <div className="view-actions">
          <span className="chip chip--lime">{opened} açıldı</span>
          <span className="chip chip--magenta">{closed} kapandı</span>
          {crashes > 0 && <span className="chip chip--red">{crashes} çökme</span>}
          <button type="button" className="neon-button neon-button--ghost neon-button--small" onClick={onClear} disabled={!items.length}>
            <Trash2 size={13} />
            Temizle
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty-panel glass">
          <div className="empty-orb" />
          <strong>Henüz olay yok</strong>
          <p>Bir port açıldığında veya bir uygulama başlatıldığında burada zaman çizelgesi oluşur.</p>
        </div>
      ) : (
        <ol className="timeline">
          {items.map((item) => {
            if (item.source === "port") {
              const { event } = item;
              const Icon = event.type === "open" ? ArrowUpRight : ArrowDownRight;
              return (
                <li key={item.id} className={`timeline-item timeline-item--${event.type}`}>
                  <span className="timeline-dot">
                    <Icon size={13} />
                  </span>
                  <time title={formatRelative(event.at)}>{formatClock(event.at)}</time>
                  <div>
                    <strong>
                      :{event.port} {event.type === "open" ? "açıldı" : "kapandı"}
                    </strong>
                    <span>
                      {event.label} · {event.technology}
                      {event.managed ? " · PortControl" : " · harici"}
                    </span>
                  </div>
                </li>
              );
            }
            const { entry } = item;
            const Icon = RUN_ICONS[entry.kind];
            return (
              <li key={item.id} className={`timeline-item timeline-item--${entry.kind}`}>
                <span className="timeline-dot">
                  <Icon size={13} />
                </span>
                <time title={formatRelative(entry.at)}>{formatClock(entry.at)}</time>
                <div>
                  <strong>{entry.title}</strong>
                  <span>{entry.detail}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

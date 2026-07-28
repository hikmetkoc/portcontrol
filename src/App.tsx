import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  Eye,
  EyeOff,
  Info,
  Network,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scanPorts, stopProcesses } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Logo } from "./components/Logo";
import { ProcessCard } from "./components/ProcessCard";
import {
  ProjectPortDialog,
  type AddProjectPortInput,
  type ProjectPortSelection,
} from "./components/ProjectPortDialog";
import { ProjectGroups } from "./components/ProjectGroups";
import { StatCard } from "./components/StatCard";
import {
  addProjectMember,
  loadProjectGroups,
  memberId,
  newProjectGroup,
  removeProjectMember,
  renameProjectGroup,
  renameProjectMember,
  saveProjectGroups,
} from "./projectGroups";
import {
  hiddenPortRecord,
  loadCollapsedPortKeys,
  loadHiddenPorts,
  portViewKey,
  saveCollapsedPortKeys,
  saveHiddenPorts,
} from "./portVisibility";
import type {
  CategoryFilter,
  PortBinding,
  ProcessPortGroup,
  Protocol,
  RoleFilter,
  ScanResponse,
  SocketView,
  StopResult,
} from "./types";
import { filterProcesses, formatScanTime } from "./utils";

const refreshOptions = [
  { label: "Kapalı", value: 0 },
  { label: "3 saniye", value: 3000 },
  { label: "5 saniye", value: 5000 },
  { label: "10 saniye", value: 10000 },
];

const categoryOptions: Array<{ label: string; value: CategoryFilter }> = [
  { label: "Tüm uygulamalar", value: "all" },
  { label: "Geliştirme araçları", value: "developer" },
  { label: "Editörler", value: "editor" },
  { label: "Veritabanları", value: "database" },
  { label: "Konteynerler", value: "container" },
  { label: "Geliştirme projeleri", value: "development" },
  { label: "Çalışma zamanları", value: "runtime" },
  { label: "Diğer", value: "other" },
  { label: "Sistem", value: "system" },
];

const socketViewOptions: Array<{ label: string; value: SocketView }> = [
  { label: "Sunucu uçları", value: "servers" },
  { label: "TCP LISTEN", value: "listeners" },
  { label: "Aktif bağlantılar", value: "connections" },
  { label: "UDP BOUND", value: "udp" },
  { label: "Tümü", value: "all" },
];

const roleOptions: Array<{ label: string; value: RoleFilter }> = [
  { label: "Tüm amaçlar", value: "all" },
  { label: "Yayındaki projeler", value: "published" },
  { label: "IDE / araç içi", value: "toolInternal" },
  { label: "Veritabanı / konteyner", value: "infrastructure" },
  { label: "Aktif bağlantılar", value: "outbound" },
  { label: "Sistem / güvenlik", value: "system" },
  { label: "Belirsiz", value: "unknown" },
];

interface ToastState {
  tone: "success" | "error";
  title: string;
  detail: string;
}

export default function App() {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [protocol, setProtocol] = useState<"all" | Protocol>("all");
  const [socketView, setSocketView] = useState<SocketView>("servers");
  const [role, setRole] = useState<RoleFilter>("all");
  const [includeSystem, setIncludeSystem] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [projectGroups, setProjectGroups] = useState(loadProjectGroups);
  const [hiddenPorts, setHiddenPorts] = useState(loadHiddenPorts);
  const [collapsedPortKeys, setCollapsedPortKeys] = useState(
    () => new Set(loadCollapsedPortKeys()),
  );
  const [projectPortDialog, setProjectPortDialog] = useState<{
    initialSelection: ProjectPortSelection | null;
    preselectedGroupId: string | null;
  } | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(
    async (silent = false) => {
      const currentRequest = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const response = await scanPorts(includeSystem);
        if (currentRequest !== requestId.current) return;
        setScan(response);
        setError(null);
        setSelected((current) => {
          const livePids = new Set(response.processes.map((item) => item.pid));
          return new Set([...current].filter((pid) => livePids.has(pid)));
        });
      } catch (reason) {
        if (currentRequest !== requestId.current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : `Portlar okunamadı: ${String(reason)}`,
        );
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [includeSystem],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshInterval) return;
    const timer = window.setInterval(() => void refresh(true), refreshInterval);
    return () => window.clearInterval(timer);
  }, [refresh, refreshInterval]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    saveProjectGroups(projectGroups);
  }, [projectGroups]);

  useEffect(() => {
    saveHiddenPorts(hiddenPorts);
  }, [hiddenPorts]);

  useEffect(() => {
    saveCollapsedPortKeys([...collapsedPortKeys]);
  }, [collapsedPortKeys]);

  const visibleProcesses = useMemo(
    () =>
      filterProcesses(
        scan?.processes ?? [],
        search,
        category,
        protocol,
        socketView,
        role,
      ),
    [scan?.processes, search, category, protocol, socketView, role],
  );
  const hiddenPortKeys = useMemo(
    () => new Set(hiddenPorts.map((record) => record.key)),
    [hiddenPorts],
  );
  const groupedMemberIds = useMemo(
    () =>
      new Set(
        projectGroups.flatMap((group) =>
          group.members.map((member) => member.id),
        ),
      ),
    [projectGroups],
  );
  const ungroupedProcesses = useMemo(
    () =>
      visibleProcesses
        .map((process) => ({
          ...process,
          ports: process.ports.filter(
            (port) =>
              port.activity === "connection" ||
              !groupedMemberIds.has(memberId(port.protocol, port.port)),
          ),
        }))
        .filter((process) => process.ports.length > 0),
    [groupedMemberIds, visibleProcesses],
  );
  const livePortKeys = useMemo(
    () =>
      new Set(
        (scan?.processes ?? []).flatMap((process) =>
          process.ports.map((port) => portViewKey(process, port)),
        ),
      ),
    [scan?.processes],
  );

  const selectedProcesses = useMemo(
    () =>
      (scan?.processes ?? []).filter((process) => selected.has(process.pid)),
    [scan?.processes, selected],
  );

  const allSockets = useMemo(
    () => (scan?.processes ?? []).flatMap((process) => process.ports),
    [scan?.processes],
  );
  const listenerCount = allSockets.filter(
    (socket) => socket.activity === "listener",
  ).length;
  const publishedCount = allSockets.filter(
    (socket) => socket.role === "published",
  ).length;
  const connectionCount = allSockets.filter(
    (socket) => socket.activity === "connection",
  ).length;
  const exposedServerCount = allSockets.filter(
    (socket) =>
      socket.activity !== "connection" && socket.exposure !== "local",
  ).length;

  function toggleProcess(pid: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function toggleAllVisible() {
    const selectable = visibleProcesses.filter((process) => !process.protected);
    const allSelected =
      selectable.length > 0 &&
      selectable.every((process) => selected.has(process.pid));
    setSelected((current) => {
      const next = new Set(current);
      selectable.forEach((process) =>
        allSelected ? next.delete(process.pid) : next.add(process.pid),
      );
      return next;
    });
  }

  async function confirmStop() {
    setStopping(true);
    try {
      const results = await stopProcesses(
        selectedProcesses.map((process) => ({
          pid: process.pid,
          startedAt: process.startedAt,
        })),
      );
      const stopped = results.filter((result) => result.stopped);
      const failed = results.filter((result) => !result.stopped);
      setConfirmOpen(false);
      setSelected(new Set());
      setToast(buildStopToast(stopped, failed));
      window.setTimeout(() => void refresh(true), 750);
    } catch (reason) {
      setToast({
        tone: "error",
        title: "Süreçler durdurulamadı",
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setStopping(false);
    }
  }

  function createProject(name: string) {
    setProjectGroups((current) => [...current, newProjectGroup(name)]);
    setToast({
      tone: "success",
      title: "Proje grubu oluşturuldu",
      detail: `${name.trim()} grubuna artık port ekleyebilirsiniz.`,
    });
  }

  function addPortToProject(input: AddProjectPortInput) {
    const createdGroup = input.groupId
      ? null
      : newProjectGroup(input.newGroupName);
    const groupId = input.groupId ?? createdGroup!.id;
    const targetName =
      createdGroup?.name ??
      projectGroups.find((group) => group.id === groupId)?.name ??
      "Proje";
    setProjectGroups((current) => {
      const next = createdGroup ? [...current, createdGroup] : current;
      return addProjectMember(next, groupId, {
        label: input.label,
        protocol: input.protocol,
        port: input.port,
      });
    });
    setProjectPortDialog(null);
    setToast({
      tone: "success",
      title: `${input.label.trim()} gruba eklendi`,
      detail: `${targetName} · ${input.protocol} :${input.port}`,
    });
  }

  function hidePort(process: ProcessPortGroup, port: PortBinding) {
    const record = hiddenPortRecord(process, port);
    setHiddenPorts((current) => [
      record,
      ...current.filter((item) => item.key !== record.key),
    ]);
    setCollapsedPortKeys((current) => {
      const next = new Set(current);
      next.delete(record.key);
      return next;
    });
    setToast({
      tone: "success",
      title: `:${port.port} gizlendi`,
      detail: "Portu Gizlenmiş Portlar alanından yeniden gösterebilirsiniz.",
    });
  }

  function restorePort(key: string) {
    setHiddenPorts((current) => current.filter((record) => record.key !== key));
  }

  function togglePortCollapsed(key: string) {
    setCollapsedPortKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectableProcesses = visibleProcesses.filter(
    (process) => !process.protected,
  );
  const allVisibleSelected =
    selectableProcesses.length > 0 &&
    selectableProcesses.every((process) => selected.has(process.pid));
  const visibleSocketCount = visibleProcesses.reduce(
    (total, process) => total + process.ports.length,
    0,
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <div className="topbar-status">
          <span className="live-dot" />
          <span>
            {scan ? `${scan.platform} üzerinde izleniyor` : "Bağlanıyor"}
          </span>
          <span className="topbar-divider" />
          <span className="scan-time">
            <Clock3 size={14} />
            {scan ? formatScanTime(scan.scannedAt) : "—"}
          </span>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">
              <Sparkles size={14} />
              Süreç, port ve kaynak görünümü
            </p>
            <h1>Hangi portu, neden açtığını bilin.</h1>
            <p className="hero-copy">
              Yayındaki projeleri IDE iç servislerinden ayırın; TCP durumunu,
              süreç sahibini ve anlık CPU, RAM, disk kullanımını tek yerde
              izleyin.
            </p>
          </div>
          <button
            className="button button--refresh"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Şimdi tara
          </button>
        </section>

        <section className="stats" aria-label="Ağ özeti">
          <StatCard
            icon={Server}
            label="TCP LISTEN"
            value={scan ? listenerCount : "—"}
            detail="Bağlantı bekleyen uç"
            tone="mint"
          />
          <StatCard
            icon={RadioTower}
            label="Yayındaki proje"
            value={scan ? publishedCount : "—"}
            detail="Proje sunucusu olarak sınıflandı"
          />
          <StatCard
            icon={ArrowRightLeft}
            label="Aktif bağlantı"
            value={scan ? connectionCount : "—"}
            detail="LISTEN olmayan TCP oturumu"
          />
          <StatCard
            icon={Network}
            label="Ağa açık"
            value={scan ? exposedServerCount : "—"}
            detail="Loopback dışındaki sunucu ucu"
            tone={exposedServerCount > 0 ? "amber" : "default"}
          />
        </section>

        <section className="state-guide" aria-label="Soket durum açıklamaları">
          <Info size={17} />
          <div>
            <span>
              <b className="guide-state guide-state--listen">LISTEN</b>
              TCP bağlantısı bekler; gerçek bir sunucu portudur.
            </span>
            <span>
              <b className="guide-state guide-state--established">
                ESTABLISHED
              </b>
              Aktif bağlantıdır, yayın portu değildir.
            </span>
            <span>
              <b className="guide-state guide-state--bound">UDP BOUND</b>
              UDP portu ayrılmıştır; tek başına yayın anlamına gelmez.
            </span>
          </div>
        </section>

        {scan?.permissionNotice && (
          <div className="notice">
            <AlertCircle size={18} />
            <span>{scan.permissionNotice}</span>
          </div>
        )}

        {error && (
          <div className="notice notice--error">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void refresh()}>
              Tekrar dene
            </button>
          </div>
        )}

        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Süreçler ve ağ uçları</p>
              <h2>Canlı ağ görünümü</h2>
            </div>
            <div className="auto-refresh">
              <span>Otomatik yenile</span>
              <label className="select-control">
                <select
                  value={refreshInterval}
                  onChange={(event) =>
                    setRefreshInterval(Number(event.target.value))
                  }
                  aria-label="Otomatik yenileme aralığı"
                >
                  {refreshOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
          </div>

          <div className="toolbar">
            <label className="search-control">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Uygulama, PID, port, durum veya amaç ara…"
                aria-label="Uygulama, PID, port, durum veya amaç ara"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Aramayı temizle"
                  onClick={() => setSearch("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>

            <div className="filter-group" aria-label="Protokol filtresi">
              {(["all", "TCP", "UDP"] as const).map((item) => (
                <button
                  type="button"
                  className={protocol === item ? "active" : ""}
                  key={item}
                  onClick={() => setProtocol(item)}
                >
                  {item === "all" ? "Tümü" : item}
                </button>
              ))}
            </div>

            <label className="select-control category-filter">
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as CategoryFilter)
                }
                aria-label="Uygulama kategorisi"
              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>

          <div className="classification-toolbar">
            <div className="view-tabs" aria-label="Soket durumu filtresi">
              {socketViewOptions.map((option) => (
                <button
                  type="button"
                  className={socketView === option.value ? "active" : ""}
                  key={option.value}
                  onClick={() => setSocketView(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="select-control role-filter">
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as RoleFilter)
                }
                aria-label="Port amacı filtresi"
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>

          <div className="list-actions">
            <button
              type="button"
              className="select-all"
              onClick={toggleAllVisible}
              disabled={selectableProcesses.length === 0}
            >
              <span className={allVisibleSelected ? "checked" : ""}>
                {allVisibleSelected && <CheckCircle2 size={14} />}
              </span>
              Görünen süreçlerin tümünü seç
            </button>
            <button
              type="button"
              className={`system-toggle ${includeSystem ? "active" : ""}`}
              onClick={() => setIncludeSystem((value) => !value)}
            >
              {includeSystem ? <Eye size={15} /> : <EyeOff size={15} />}
              Sistem ve güvenlik süreçleri
              {!includeSystem && scan && scan.hiddenSystemProcesses > 0 && (
                <span>{scan.hiddenSystemProcesses}</span>
              )}
            </button>
          </div>

          <div className="process-list" aria-live="polite">
            {loading && !scan ? (
              <LoadingState />
            ) : (
              <>
                <ProjectGroups
                  groups={projectGroups}
                  processes={visibleProcesses}
                  allProcesses={scan?.processes ?? []}
                  selected={selected}
                  hiddenPortKeys={hiddenPortKeys}
                  collapsedPortKeys={collapsedPortKeys}
                  onToggleProcess={toggleProcess}
                  onHidePort={hidePort}
                  onTogglePortCollapsed={togglePortCollapsed}
                  onAddProjectPort={addPortToProject}
                  onCreate={createProject}
                  onRename={(groupId, name) =>
                    setProjectGroups((current) =>
                      renameProjectGroup(current, groupId, name),
                    )
                  }
                  onDelete={(groupId) =>
                    setProjectGroups((current) =>
                      current.filter((group) => group.id !== groupId),
                    )
                  }
                  onRemoveMember={(groupId, projectMemberId) =>
                    setProjectGroups((current) =>
                      removeProjectMember(
                        current,
                        groupId,
                        projectMemberId,
                      ),
                    )
                  }
                  onRenameMember={(groupId, projectMemberId, label) =>
                    setProjectGroups((current) =>
                      renameProjectMember(
                        current,
                        groupId,
                        projectMemberId,
                        label,
                      ),
                    )
                  }
                  onRequestAddPort={(groupId) =>
                    setProjectPortDialog({
                      initialSelection: null,
                      preselectedGroupId: groupId,
                    })
                  }
                />
                {ungroupedProcesses.map((process) => (
                  <ProcessCard
                    key={process.pid}
                    process={process}
                    selected={selected.has(process.pid)}
                    onToggle={toggleProcess}
                    projectGroups={projectGroups}
                    onAddProjectPort={addPortToProject}
                    hiddenPortKeys={hiddenPortKeys}
                    collapsedPortKeys={collapsedPortKeys}
                    onHidePort={hidePort}
                    onTogglePortCollapsed={togglePortCollapsed}
                  />
                ))}
                {!projectGroups.length && !ungroupedProcesses.length && (
                  <EmptyState search={search} />
                )}
              </>
            )}
          </div>

          {hiddenPorts.length > 0 && (
            <section
              className="hidden-ports"
              aria-labelledby="hidden-ports-title"
            >
              <header>
                <div>
                  <EyeOff size={17} />
                  <span>
                    <strong id="hidden-ports-title">Gizlenmiş Portlar</strong>
                    <small>
                      Canlı görünümden kaldırılan {hiddenPorts.length} port
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setHiddenPorts([])}
                >
                  <RotateCcw size={14} />
                  Tümünü göster
                </button>
              </header>
              <div className="hidden-port-list">
                {hiddenPorts.map((record) => (
                  <div
                    className={`hidden-port-item ${
                      livePortKeys.has(record.key)
                        ? "is-online"
                        : "is-offline"
                    }`}
                    key={record.key}
                  >
                    <span className="member-status" />
                    <div>
                      <strong>{record.processName}</strong>
                      <small>{record.technology}</small>
                    </div>
                    <code>
                      {record.protocol} :{record.port}
                    </code>
                    <span className="hidden-port-state">
                      {livePortKeys.has(record.key)
                        ? "Çalışıyor"
                        : "Şu anda kapalı"}
                    </span>
                    <button
                      type="button"
                      onClick={() => restorePort(record.key)}
                    >
                      <RotateCcw size={13} />
                      Tekrar göster
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="workspace-footer">
            <span>
              {visibleProcesses.length} süreç · {visibleSocketCount} ağ uç
              noktası gösteriliyor
            </span>
            {scan && scan.inaccessibleSockets > 0 && (
              <span>
                {scan.inaccessibleSockets} uç nokta için süreç bilgisi alınamadı
              </span>
            )}
          </footer>
        </section>
      </main>

      {selected.size > 0 && (
        <div className="action-dock">
          <div>
            <span className="action-count">{selected.size}</span>
            <span>
              <strong>Süreç seçildi</strong>
              <small>
                Bu süreçlere ait tüm ağ uçları kapatılacak
              </small>
            </span>
          </div>
          <button
            type="button"
            className="clear-selection"
            onClick={() => setSelected(new Set())}
          >
            Seçimi temizle
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setConfirmOpen(true)}
          >
            <CircleStop size={17} />
            Seçilenleri durdur
          </button>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          processes={selectedProcesses}
          busy={stopping}
          onCancel={() => !stopping && setConfirmOpen(false)}
          onConfirm={() => void confirmStop()}
        />
      )}

      {projectPortDialog && (
        <ProjectPortDialog
          groups={projectGroups}
          processes={scan?.processes ?? []}
          initialSelection={projectPortDialog.initialSelection}
          preselectedGroupId={projectPortDialog.preselectedGroupId}
          onCancel={() => setProjectPortDialog(null)}
          onAdd={addPortToProject}
        />
      )}

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status">
          {toast.tone === "success" ? (
            <CheckCircle2 size={19} />
          ) : (
            <AlertCircle size={19} />
          )}
          <div>
            <strong>{toast.title}</strong>
            <span>{toast.detail}</span>
          </div>
          <button
            type="button"
            aria-label="Bildirimi kapat"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function buildStopToast(
  stopped: StopResult[],
  failed: StopResult[],
): ToastState {
  if (!failed.length) {
    return {
      tone: "success",
      title: `${stopped.length} süreç durduruldu`,
      detail: "İlgili portlar yeniden taranıyor.",
    };
  }
  return {
    tone: "error",
    title: `${failed.length} süreç durdurulamadı`,
    detail: failed.map((result) => result.message).join(" · "),
  };
}

function LoadingState() {
  return (
    <div className="loading-state">
      <span className="radar">
        <i />
      </span>
      <strong>Ağ uçları ve kaynaklar taranıyor</strong>
      <p>Soketler süreç ağacıyla eşleştiriliyor…</p>
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="empty-state">
      <div>
        <Search size={23} />
      </div>
      <strong>
        {search ? "Eşleşen süreç bulunamadı" : "Filtreye uyan ağ ucu yok"}
      </strong>
      <p>
        {search
          ? "Arama ifadenizi veya filtrelerinizi değiştirmeyi deneyin."
          : "Soket durumu veya port amacı filtresini değiştirebilirsiniz."}
      </p>
    </div>
  );
}

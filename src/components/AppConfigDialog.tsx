import {
  Activity,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  GitBranch,
  Layers3,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { probeService, readEnvFile, writeEnvFile } from "../api";
import { isSecretKey } from "../lib/launch";
import type { AppRuntime } from "../lib/runtime";
import type { AppSettings, DetectedApp, EnvPair, EnvProfile, ProbeResult } from "../types";
import { Modal } from "./Overlays";
import { StackBadge } from "./ui";

export type ConfigTab = "env" | "files" | "deps";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function joinPath(base: string, name: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/** Anahtar/değer tablosu; gizli değerler göz ikonuyla açılana kadar maskeli kalır. */
function VarTable({
  vars,
  onChange,
  emptyText,
}: {
  vars: EnvPair[];
  onChange: (vars: EnvPair[]) => void;
  emptyText: string;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const update = (index: number, patch: Partial<EnvPair>) =>
    onChange(vars.map((pair, position) => (position === index ? { ...pair, ...patch } : pair)));

  return (
    <div className="var-table">
      {vars.length === 0 && <p className="var-empty">{emptyText}</p>}
      {vars.map((pair, index) => {
        const secret = isSecretKey(pair.key);
        const hidden = secret && !revealed.has(index);
        return (
          <div className={`var-row ${secret ? "is-secret" : ""}`} key={index}>
            <input
              className="var-key"
              value={pair.key}
              placeholder="ANAHTAR"
              spellCheck={false}
              onChange={(event) => update(index, { key: event.target.value.replace(/[^\w.-]/g, "") })}
              aria-label="Değişken adı"
            />
            <span className="var-eq">=</span>
            <input
              className="var-value"
              type={hidden ? "password" : "text"}
              value={pair.value}
              placeholder="değer"
              spellCheck={false}
              onChange={(event) => update(index, { value: event.target.value })}
              aria-label={`${pair.key || "değişken"} değeri`}
            />
            {secret ? (
              <button
                type="button"
                className="icon-button icon-button--ghost"
                onClick={() =>
                  setRevealed((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
                aria-label={hidden ? "Değeri göster" : "Değeri gizle"}
                title={hidden ? "Değeri göster" : "Değeri gizle"}
              >
                {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            ) : (
              <span className="var-spacer" />
            )}
            <button
              type="button"
              className="icon-button icon-button--ghost icon-button--danger"
              onClick={() => onChange(vars.filter((_, position) => position !== index))}
              aria-label="Değişkeni sil"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="link-button var-add"
        onClick={() => onChange([...vars, { key: "", value: "" }])}
      >
        <Plus size={12} />
        değişken ekle
      </button>
    </div>
  );
}

export function AppConfigDialog({
  runtime,
  apps,
  initialTab = "env",
  onSave,
  onClose,
  onNotify,
}: {
  runtime: AppRuntime;
  apps: DetectedApp[];
  initialTab?: ConfigTab;
  onSave: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  onNotify: (tone: "success" | "error", title: string, detail?: string) => void;
}) {
  const { app, settings, dependencies, expectations } = runtime;
  const [tab, setTab] = useState<ConfigTab>(initialTab);
  const [profiles, setProfiles] = useState<EnvProfile[]>(settings.envProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(settings.activeProfileId);
  const [editingId, setEditingId] = useState<string | null>(settings.activeProfileId ?? settings.envProfiles[0]?.id ?? null);
  const [frameworkProfile, setFrameworkProfile] = useState<string | null>(settings.frameworkProfile);
  const [dependsOn, setDependsOn] = useState<string[] | null>(settings.dependsOn);
  const [healthMode, setHealthMode] = useState<"auto" | "tcp" | "custom">(
    settings.healthPath === null ? "auto" : settings.healthPath === "" ? "tcp" : "custom",
  );
  const [customHealth, setCustomHealth] = useState(settings.healthPath || app.healthPath || "/health");
  const [autoRestart, setAutoRestart] = useState(settings.autoRestart);

  // .env dosyası düzenleyici
  const envFiles = app.envFiles.length ? app.envFiles : [];
  const [envFile, setEnvFile] = useState<string>(envFiles[0] ?? ".env");
  const [envVars, setEnvVars] = useState<EnvPair[]>([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);
  const [envDirty, setEnvDirty] = useState(false);

  const [externalStatus, setExternalStatus] = useState<Record<number, ProbeResult | "loading">>({});

  useEffect(() => {
    if (tab !== "files") return;
    let cancelled = false;
    setEnvLoading(true);
    readEnvFile(joinPath(app.path, envFile))
      .then((entries) => {
        if (!cancelled) {
          setEnvVars(entries);
          setEnvDirty(false);
        }
      })
      .catch((reason) => onNotify("error", ".env okunamadı", String(reason)))
      .finally(() => !cancelled && setEnvLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tab, envFile, app.path, onNotify]);

  const editing = profiles.find((profile) => profile.id === editingId) ?? null;
  const detectedIds = dependencies.detected.map((item) => item.appId);
  const selectedDeps = dependsOn ?? detectedIds;
  const appName = (id: string) => apps.find((item) => item.id === id)?.name ?? id;
  const otherApps = apps.filter((item) => item.id !== app.id);

  const dirty = useMemo(
    () =>
      JSON.stringify({ profiles, activeProfileId, frameworkProfile, dependsOn, healthMode, customHealth, autoRestart }) !==
      JSON.stringify({
        profiles: settings.envProfiles,
        activeProfileId: settings.activeProfileId,
        frameworkProfile: settings.frameworkProfile,
        dependsOn: settings.dependsOn,
        healthMode: settings.healthPath === null ? "auto" : settings.healthPath === "" ? "tcp" : "custom",
        customHealth: settings.healthPath || app.healthPath || "/health",
        autoRestart: settings.autoRestart,
      }),
    [profiles, activeProfileId, frameworkProfile, dependsOn, healthMode, customHealth, autoRestart, settings, app.healthPath],
  );

  function save() {
    onSave({
      envProfiles: profiles.map((profile) => ({
        ...profile,
        name: profile.name.trim() || "Profil",
        vars: profile.vars.filter((pair) => pair.key.trim()),
      })),
      activeProfileId: profiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : null,
      frameworkProfile,
      dependsOn,
      healthPath: healthMode === "auto" ? null : healthMode === "tcp" ? "" : customHealth.trim() || "/",
      autoRestart,
    });
    onClose();
  }

  function addProfile(copyFrom?: EnvProfile) {
    const profile: EnvProfile = {
      id: newId(),
      name: copyFrom ? `${copyFrom.name} kopya` : profiles.length ? `Profil ${profiles.length + 1}` : "Yerel",
      vars: copyFrom ? copyFrom.vars.map((pair) => ({ ...pair })) : [],
    };
    setProfiles((list) => [...list, profile]);
    setEditingId(profile.id);
    if (!activeProfileId) setActiveProfileId(profile.id);
  }

  function toggleDependency(id: string) {
    const current = new Set(selectedDeps);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const next = [...current];
    const sameAsDetected =
      next.length === detectedIds.length && next.every((value) => detectedIds.includes(value));
    setDependsOn(sameAsDetected ? null : next);
  }

  async function checkExternal(port: number) {
    setExternalStatus((status) => ({ ...status, [port]: "loading" }));
    const result = await probeService(port, null, 1200).catch(
      (reason): ProbeResult => ({ ok: false, status: null, latencyMs: 0, error: String(reason) }),
    );
    setExternalStatus((status) => ({ ...status, [port]: result }));
  }

  async function saveEnvFile() {
    setEnvSaving(true);
    try {
      const entries = envVars.filter((pair) => pair.key.trim());
      await writeEnvFile(joinPath(app.path, envFile), entries);
      setEnvVars(entries);
      setEnvDirty(false);
      onNotify("success", `${envFile} kaydedildi`, `${entries.length} değişken · ${app.name}`);
    } catch (reason) {
      onNotify("error", `${envFile} kaydedilemedi`, String(reason));
    } finally {
      setEnvSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} className="modal--wide config-modal" labelledBy="config-title">
      <header className="modal-header">
        <div className="config-title">
          <StackBadge stack={app.stack} size="lg" />
          <div>
            <p className="eyebrow">// YAPILANDIRMA</p>
            <h2 id="config-title">{app.name}</h2>
            <p>
              {app.framework} · <code>./{app.relativePath === "." ? "" : app.relativePath}</code>
            </p>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
          <X size={16} />
        </button>
      </header>

      <div className="segmented config-tabs" role="tablist">
        <button type="button" className={tab === "env" ? "is-active" : ""} onClick={() => setTab("env")}>
          <Layers3 size={13} /> ORTAM
        </button>
        <button type="button" className={tab === "files" ? "is-active" : ""} onClick={() => setTab("files")}>
          <FileCode2 size={13} /> .ENV <span>{app.envFiles.length}</span>
        </button>
        <button type="button" className={tab === "deps" ? "is-active" : ""} onClick={() => setTab("deps")}>
          <GitBranch size={13} /> BAĞIMLILIK & SAĞLIK
        </button>
      </div>

      {tab === "env" && (
        <div className="config-body">
          {app.profiles.length > 0 && app.profileEnv && (
            <section className="config-section">
              <h3>
                Framework profili <code>{app.profileEnv}</code>
              </h3>
              <div className="chip-picker">
                <button
                  type="button"
                  className={frameworkProfile === null ? "is-active" : ""}
                  onClick={() => setFrameworkProfile(null)}
                >
                  varsayılan
                </button>
                {app.profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile}
                    className={frameworkProfile === profile ? "is-active" : ""}
                    onClick={() => setFrameworkProfile(profile)}
                  >
                    {profile}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="config-section">
            <h3>Ortam profilleri</h3>
            <p className="config-hint">
              Adlandırılmış değişken setleri ("Yerel", "Test DB" gibi). Etkin profil başlatmada süreç ortamına eklenir;
              yalnızca bu bilgisayarda saklanır.
            </p>
            <div className="profile-strip">
              <button
                type="button"
                className={`profile-pill ${activeProfileId === null ? "is-active" : ""}`}
                onClick={() => setActiveProfileId(null)}
              >
                profil yok
              </button>
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  className={`profile-pill ${activeProfileId === profile.id ? "is-active" : ""} ${editingId === profile.id ? "is-editing" : ""}`}
                  onClick={() => {
                    setActiveProfileId(profile.id);
                    setEditingId(profile.id);
                  }}
                >
                  {profile.name || "adsız"}
                  <span>{profile.vars.filter((pair) => pair.key).length}</span>
                </button>
              ))}
              <button type="button" className="profile-pill profile-pill--add" onClick={() => addProfile()}>
                <Plus size={12} /> yeni
              </button>
            </div>

            {editing && (
              <div className="profile-editor glass">
                <div className="profile-editor-head">
                  <input
                    value={editing.name}
                    onChange={(event) =>
                      setProfiles((list) =>
                        list.map((profile) =>
                          profile.id === editing.id ? { ...profile, name: event.target.value.slice(0, 40) } : profile,
                        ),
                      )
                    }
                    aria-label="Profil adı"
                  />
                  <button type="button" className="icon-button" onClick={() => addProfile(editing)} title="Kopyala" aria-label="Profili kopyala">
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => {
                      setProfiles((list) => list.filter((profile) => profile.id !== editing.id));
                      if (activeProfileId === editing.id) setActiveProfileId(null);
                      setEditingId(profiles.find((profile) => profile.id !== editing.id)?.id ?? null);
                    }}
                    title="Profili sil"
                    aria-label="Profili sil"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <VarTable
                  vars={editing.vars}
                  emptyText="Bu profilde değişken yok."
                  onChange={(vars) =>
                    setProfiles((list) =>
                      list.map((profile) => (profile.id === editing.id ? { ...profile, vars } : profile)),
                    )
                  }
                />
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "files" && (
        <div className="config-body">
          <section className="config-section">
            <div className="file-strip">
              {(envFiles.length ? envFiles : [".env"]).map((file) => (
                <button
                  type="button"
                  key={file}
                  className={`profile-pill ${envFile === file ? "is-active" : ""}`}
                  onClick={() => setEnvFile(file)}
                >
                  <FileCode2 size={12} />
                  {file}
                </button>
              ))}
            </div>
            {!envFiles.length && (
              <p className="config-hint">
                Bu klasörde .env dosyası yok. Değişken ekleyip kaydettiğinde <code>.env</code> oluşturulur.
              </p>
            )}
            <p className="config-hint">
              Değişiklikler doğrudan diske, <code>{joinPath(app.path, envFile)}</code> dosyasına yazılır. Yorumlar ve
              satır sırası korunur.
            </p>
            {envLoading ? (
              <div className="var-loading">
                <Loader2 size={16} className="spin" /> okunuyor…
              </div>
            ) : (
              <VarTable
                vars={envVars}
                emptyText="Dosyada değişken yok."
                onChange={(vars) => {
                  setEnvVars(vars);
                  setEnvDirty(true);
                }}
              />
            )}
            <div className="file-actions">
              <button
                type="button"
                className="neon-button neon-button--small"
                onClick={() => void saveEnvFile()}
                disabled={!envDirty || envSaving}
              >
                {envSaving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                {envFile} dosyasını kaydet
              </button>
            </div>
          </section>
        </div>
      )}

      {tab === "deps" && (
        <div className="config-body">
          <section className="config-section">
            <h3>
              Bağımlı olduğu uygulamalar
              {dependsOn !== null && (
                <button type="button" className="link-button" onClick={() => setDependsOn(null)}>
                  <RotateCcw size={11} /> otomatiğe dön
                </button>
              )}
            </h3>
            <p className="config-hint">
              Zincirle başlatmada önce bunlar ayağa kaldırılır ve sağlıklı olmaları beklenir.
            </p>
            <div className="dep-list">
              {otherApps.length === 0 && <p className="var-empty">Projede başka uygulama yok.</p>}
              {otherApps.map((other) => {
                const detected = dependencies.detected.find((item) => item.appId === other.id);
                const checked = selectedDeps.includes(other.id);
                return (
                  <label key={other.id} className={`dep-row ${checked ? "is-on" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleDependency(other.id)} />
                    <StackBadge stack={other.stack} size="sm" />
                    <strong>{other.name}</strong>
                    {detected ? (
                      <span className="dep-source" title={`${detected.source} · ${detected.key}`}>
                        otomatik · {detected.source} <code>{detected.key}</code> → :{detected.port}
                      </span>
                    ) : (
                      <span className="dep-source">{checked ? "manuel" : ""}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>

          {dependencies.external.length > 0 && (
            <section className="config-section">
              <h3>Harici gereksinimler</h3>
              <div className="dep-list">
                {dependencies.external.map((item) => {
                  const status = externalStatus[item.port];
                  return (
                    <div key={item.port} className="dep-row">
                      <span className={`ext-dot ${status && status !== "loading" ? (status.ok ? "is-up" : "is-down") : ""}`} />
                      <strong>
                        {item.label} :{item.port}
                      </strong>
                      <span className="dep-source">
                        {item.source} <code>{item.key}</code>
                      </span>
                      <button
                        type="button"
                        className="neon-button neon-button--small neon-button--ghost"
                        onClick={() => void checkExternal(item.port)}
                      >
                        {status === "loading" ? <Loader2 size={12} className="spin" /> : <Activity size={12} />}
                        {status && status !== "loading" ? (status.ok ? "çalışıyor" : "yanıt yok") : "kontrol et"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {expectations.length > 0 && (
            <section className="config-section">
              <h3>Beklenen port</h3>
              {expectations.map((item) => (
                <div key={`${item.byAppId}-${item.port}`} className="callout callout--amber">
                  <span>
                    <b>{appName(item.byAppId)}</b> bu servisi <b>:{item.port}</b> portunda bekliyor ({item.source}{" "}
                    <code>{item.key}</code>).
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="config-section">
            <h3>Sağlık kontrolü</h3>
            <div className="chip-picker">
              <button type="button" className={healthMode === "auto" ? "is-active" : ""} onClick={() => setHealthMode("auto")}>
                otomatik {app.healthPath ? `(${app.healthPath})` : "(TCP)"}
              </button>
              <button type="button" className={healthMode === "tcp" ? "is-active" : ""} onClick={() => setHealthMode("tcp")}>
                yalnızca TCP
              </button>
              <button type="button" className={healthMode === "custom" ? "is-active" : ""} onClick={() => setHealthMode("custom")}>
                özel yol
              </button>
            </div>
            {healthMode === "custom" && (
              <div className="health-input">
                <span>http://localhost:{runtime.displayPort ?? "PORT"}</span>
                <input value={customHealth} onChange={(event) => setCustomHealth(event.target.value)} aria-label="Sağlık yolu" />
              </div>
            )}
            <p className="config-hint">500'ün altındaki her HTTP yanıtı sağlıklı sayılır.</p>
          </section>

          <section className="config-section">
            <button type="button" className={`toggle-row ${autoRestart ? "is-on" : ""}`} onClick={() => setAutoRestart(!autoRestart)}>
              <span className="toggle-switch">
                <i />
              </span>
              <span>
                <strong>Çökme bekçisi</strong>
                <small>Süreç beklenmedik şekilde kapanırsa 2 sn, 5 sn ve 10 sn arayla en fazla 3 kez yeniden başlatır.</small>
              </span>
            </button>
          </section>
        </div>
      )}

      <footer className="modal-footer">
        <button type="button" className="neon-button neon-button--ghost" onClick={onClose}>
          Vazgeç
        </button>
        <button type="button" className="neon-button" onClick={save} disabled={!dirty}>
          <Save size={14} />
          Kaydet
        </button>
      </footer>
    </Modal>
  );
}

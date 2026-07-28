import { FolderPlus, Plus, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type {
  PortBinding,
  ProcessPortGroup,
  ProjectGroup,
  Protocol,
} from "../types";

export interface ProjectPortSelection {
  process: ProcessPortGroup;
  port: PortBinding;
}

export interface AddProjectPortInput {
  groupId: string | null;
  newGroupName: string;
  label: string;
  protocol: Protocol;
  port: number;
}

interface ProjectPortDialogProps {
  groups: ProjectGroup[];
  processes: ProcessPortGroup[];
  initialSelection: ProjectPortSelection | null;
  preselectedGroupId: string | null;
  onCancel: () => void;
  onAdd: (input: AddProjectPortInput) => void;
}

const NEW_GROUP = "__new_project_group__";

export function ProjectPortDialog({
  groups,
  processes,
  initialSelection,
  preselectedGroupId,
  onCancel,
  onAdd,
}: ProjectPortDialogProps) {
  const candidates = useMemo(
    () => collectCandidates(processes),
    [processes],
  );
  const initialKey = initialSelection
    ? candidateKey(initialSelection.port)
    : candidates[0]?.key ?? "";
  const initialCandidate =
    candidates.find((candidate) => candidate.key === initialKey) ??
    (initialSelection
      ? {
          key: initialKey,
          process: initialSelection.process,
          port: initialSelection.port,
        }
      : undefined);
  const [groupId, setGroupId] = useState(
    preselectedGroupId ?? groups[0]?.id ?? NEW_GROUP,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const [label, setLabel] = useState(
    initialCandidate ? suggestedLabel(initialCandidate.process) : "",
  );
  const selectedCandidate =
    candidates.find((candidate) => candidate.key === selectedKey) ??
    initialCandidate;
  const creatingGroup = groupId === NEW_GROUP;
  const valid =
    Boolean(selectedCandidate) &&
    Boolean(label.trim()) &&
    (!creatingGroup || Boolean(newGroupName.trim()));

  function selectCandidate(key: string) {
    setSelectedKey(key);
    const candidate = candidates.find((item) => item.key === key);
    if (candidate) setLabel(suggestedLabel(candidate.process));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !selectedCandidate) return;
    onAdd({
      groupId: creatingGroup ? null : groupId,
      newGroupName,
      label,
      protocol: selectedCandidate.port.protocol,
      port: selectedCandidate.port.port,
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog project-port-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-port-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onCancel}
          aria-label="Pencereyi kapat"
        >
          <X size={18} />
        </button>
        <div className="dialog-icon project-dialog-icon">
          <FolderPlus size={24} />
        </div>
        <p className="eyebrow">Proje düzeni</p>
        <h2 id="project-port-dialog-title">Portu proje grubuna ekle</h2>
        <p>
          Port, PID değişse veya servis kapansa bile protokol ve port numarasıyla
          bu grupta kalır.
        </p>

        <form className="project-port-form" onSubmit={submit}>
          <label>
            <span>Proje grubu</span>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              {groups.map((group) => (
                <option value={group.id} key={group.id}>
                  {group.name}
                </option>
              ))}
              <option value={NEW_GROUP}>+ Yeni proje grubu</option>
            </select>
          </label>

          {creatingGroup && (
            <label>
              <span>Yeni grubun adı</span>
              <input
                autoFocus
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="Örn. MeteorPanel"
                maxLength={80}
              />
            </label>
          )}

          <label>
            <span>Çalışan port</span>
            <select
              value={selectedKey}
              onChange={(event) => selectCandidate(event.target.value)}
              disabled={Boolean(initialSelection)}
            >
              {candidates.map((candidate) => (
                <option value={candidate.key} key={candidate.key}>
                  {candidate.process.serviceKind} · {candidate.process.technology} ·{" "}
                  {candidate.port.protocol} :{candidate.port.port}
                </option>
              ))}
              {initialCandidate &&
                !candidates.some(
                  (candidate) => candidate.key === initialCandidate.key,
                ) && (
                  <option value={initialCandidate.key}>
                    {initialCandidate.process.serviceKind} ·{" "}
                    {initialCandidate.port.protocol} :
                    {initialCandidate.port.port}
                  </option>
                )}
            </select>
          </label>

          <label>
            <span>Bu gruptaki etiketi</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Frontend, Backend, PostgreSQL…"
              maxLength={80}
            />
          </label>

          {selectedCandidate && (
            <div className="selected-port-preview">
              <span className="member-status" />
              <div>
                <strong>
                  {selectedCandidate.process.displayName} · :
                  {selectedCandidate.port.port}
                </strong>
                <small>
                  {selectedCandidate.process.technology} · PID{" "}
                  {selectedCandidate.process.pid}
                </small>
              </div>
            </div>
          )}

          {!candidates.length && !initialSelection && (
            <p className="project-port-form-error">
              Şu anda gruba eklenebilecek dinleme veya UDP portu yok.
            </p>
          )}

          <div className="dialog-actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onCancel}
            >
              Vazgeç
            </button>
            <button type="submit" className="button project-add-submit" disabled={!valid}>
              <Plus size={16} />
              Gruba ekle
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function collectCandidates(processes: ProcessPortGroup[]) {
  const candidates = new Map<
    string,
    { key: string; process: ProcessPortGroup; port: PortBinding }
  >();

  for (const process of processes) {
    for (const port of process.ports) {
      if (port.activity === "connection") continue;
      const key = candidateKey(port);
      const existing = candidates.get(key);
      if (!existing || port.role === "published") {
        candidates.set(key, { key, process, port });
      }
    }
  }

  return [...candidates.values()].sort(
    (left, right) =>
      left.port.port - right.port.port ||
      left.port.protocol.localeCompare(right.port.protocol),
  );
}

function candidateKey(port: Pick<PortBinding, "protocol" | "port">): string {
  return `${port.protocol}:${port.port}`;
}

function suggestedLabel(process: ProcessPortGroup): string {
  if (process.serviceKind === "Frontend") return "Frontend";
  if (process.serviceKind.startsWith("Backend")) return "Backend";
  if (process.category === "database") return process.technology;
  if (process.technology.includes("Redis")) return "Redis";
  if (process.category === "container") return process.technology;
  return process.serviceKind;
}

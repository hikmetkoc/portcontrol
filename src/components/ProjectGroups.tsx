import {
  Check,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { memberId } from "../projectGroups";
import type {
  PortBinding,
  ProcessPortGroup,
  ProjectGroup,
  ProjectGroupMember,
} from "../types";
import { ProcessCard } from "./ProcessCard";
import type { AddProjectPortInput } from "./ProjectPortDialog";

interface ProjectGroupsProps {
  groups: ProjectGroup[];
  processes: ProcessPortGroup[];
  allProcesses: ProcessPortGroup[];
  selected: ReadonlySet<number>;
  hiddenPortKeys: ReadonlySet<string>;
  collapsedPortKeys: ReadonlySet<string>;
  onToggleProcess: (pid: number) => void;
  onHidePort: (process: ProcessPortGroup, port: PortBinding) => void;
  onTogglePortCollapsed: (key: string) => void;
  onAddProjectPort: (input: AddProjectPortInput) => void;
  onCreate: (name: string) => void;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
  onRemoveMember: (groupId: string, memberId: string) => void;
  onRenameMember: (
    groupId: string,
    memberId: string,
    label: string,
  ) => void;
  onRequestAddPort: (groupId: string) => void;
}

interface LiveMember {
  process: ProcessPortGroup;
  port: PortBinding;
}

export function ProjectGroups({
  groups,
  processes,
  allProcesses,
  selected,
  hiddenPortKeys,
  collapsedPortKeys,
  onToggleProcess,
  onHidePort,
  onTogglePortCollapsed,
  onAddProjectPort,
  onCreate,
  onRename,
  onDelete,
  onRemoveMember,
  onRenameMember,
  onRequestAddPort,
}: ProjectGroupsProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function submitNewGroup(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    onCreate(newName);
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="live-projects">
      <div className="live-projects-toolbar">
        <div>
          <FolderOpen size={17} />
          <span>
            <strong>Projeler</strong>
            Canlı portlar tam ayrıntılarıyla kendi proje çerçevesinde gösterilir.
          </span>
        </div>
        {creating ? (
          <form className="new-project-form" onSubmit={submitNewGroup}>
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Örn. MeteorPanel"
              aria-label="Yeni proje grubunun adı"
              maxLength={80}
            />
            <button type="submit" disabled={!newName.trim()}>
              <Check size={15} />
              Oluştur
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              aria-label="Yeni proje grubunu iptal et"
            >
              <X size={16} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="new-project-button"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} />
            Yeni proje grubu
          </button>
        )}
      </div>

      {groups.map((group, index) => (
        <LiveProjectGroup
          key={group.id}
          group={group}
          tone={index % 4}
          groups={groups}
          processes={processes}
          allProcesses={allProcesses}
          selected={selected}
          hiddenPortKeys={hiddenPortKeys}
          collapsedPortKeys={collapsedPortKeys}
          onToggleProcess={onToggleProcess}
          onHidePort={onHidePort}
          onTogglePortCollapsed={onTogglePortCollapsed}
          onAddProjectPort={onAddProjectPort}
          onRename={onRename}
          onDelete={onDelete}
          onRemoveMember={onRemoveMember}
          onRenameMember={onRenameMember}
          onRequestAddPort={onRequestAddPort}
        />
      ))}
    </div>
  );
}

function LiveProjectGroup({
  group,
  tone,
  groups,
  processes,
  allProcesses,
  selected,
  hiddenPortKeys,
  collapsedPortKeys,
  onToggleProcess,
  onHidePort,
  onTogglePortCollapsed,
  onAddProjectPort,
  onRename,
  onDelete,
  onRemoveMember,
  onRenameMember,
  onRequestAddPort,
}: {
  group: ProjectGroup;
  tone: number;
  groups: ProjectGroup[];
  processes: ProcessPortGroup[];
  allProcesses: ProcessPortGroup[];
  selected: ReadonlySet<number>;
  hiddenPortKeys: ReadonlySet<string>;
  collapsedPortKeys: ReadonlySet<string>;
  onToggleProcess: (pid: number) => void;
  onHidePort: (process: ProcessPortGroup, port: PortBinding) => void;
  onTogglePortCollapsed: (key: string) => void;
  onAddProjectPort: (input: AddProjectPortInput) => void;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
  onRemoveMember: (groupId: string, memberId: string) => void;
  onRenameMember: (
    groupId: string,
    memberId: string,
    label: string,
  ) => void;
  onRequestAddPort: (groupId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(group.name);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [memberLabel, setMemberLabel] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const liveMembers = useMemo(
    () =>
      new Map(
        group.members.map((member) => [
          member.id,
          findLiveMember(allProcesses, member),
        ]),
      ),
    [allProcesses, group.members],
  );
  const memberIds = useMemo(
    () => new Set(group.members.map((member) => member.id)),
    [group.members],
  );
  const projectProcesses = useMemo(
    () =>
      processes
        .map((process) => ({
          ...process,
          ports: process.ports.filter(
            (port) =>
              port.activity !== "connection" &&
              memberIds.has(memberId(port.protocol, port.port)),
          ),
        }))
        .filter((process) => process.ports.length > 0),
    [memberIds, processes],
  );
  const onlineCount = [...liveMembers.values()].filter(Boolean).length;

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onRename(group.id, name);
    setEditingName(false);
  }

  function submitMemberLabel(event: FormEvent, member: ProjectGroupMember) {
    event.preventDefault();
    if (!memberLabel.trim()) return;
    onRenameMember(group.id, member.id, memberLabel);
    setEditingMember(null);
    setMemberLabel("");
  }

  return (
    <section className={`live-project-group live-project-group--tone-${tone}`}>
      <header className="live-project-header">
        <div className="project-group-icon">
          <FolderOpen size={20} />
        </div>
        {editingName ? (
          <form className="inline-name-form" onSubmit={submitName}>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={`${group.name} proje grubunun yeni adı`}
              maxLength={80}
            />
            <button type="submit" aria-label="Proje adını kaydet">
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingName(false);
                setName(group.name);
              }}
              aria-label="Proje adı değişikliğini iptal et"
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <div className="project-group-title">
            <p>CANLI PROJE</p>
            <h3>{group.name}</h3>
            <span>
              {onlineCount}/{group.members.length} port çalışıyor
            </span>
          </div>
        )}
        <div className="project-group-actions">
          <button
            type="button"
            className="add-live-project-port"
            onClick={() => onRequestAddPort(group.id)}
          >
            <Plus size={14} />
            Port ekle
          </button>
          {!editingName && (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              aria-label={`${group.name} adını değiştir`}
              title="Proje adını değiştir"
            >
              <Pencil size={14} />
            </button>
          )}
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="confirm-delete"
                onClick={() => onDelete(group.id)}
              >
                Grubu sil
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                aria-label="Grup silmeyi iptal et"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`${group.name} grubunu sil`}
              title="Proje grubunu sil"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="live-project-members" aria-label={`${group.name} yapısı`}>
        {group.members.map((member) => {
          const live = liveMembers.get(member.id);
          return (
            <div
              className={`live-project-member ${
                live ? "is-online" : "is-offline"
              }`}
              key={member.id}
            >
              <span className="member-status" />
              <div>
                {editingMember === member.id ? (
                  <form
                    className="member-label-form"
                    onSubmit={(event) => submitMemberLabel(event, member)}
                  >
                    <input
                      autoFocus
                      value={memberLabel}
                      onChange={(event) => setMemberLabel(event.target.value)}
                      aria-label={`${member.port} portunun etiketi`}
                      maxLength={80}
                    />
                    <button type="submit" aria-label="Etiketi kaydet">
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMember(null)}
                      aria-label="Etiket değişikliğini iptal et"
                    >
                      <X size={13} />
                    </button>
                  </form>
                ) : (
                  <strong>{member.label}</strong>
                )}
                <code>
                  {member.protocol} :{member.port}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingMember(member.id);
                  setMemberLabel(member.label);
                }}
                aria-label={`${member.label} etiketini değiştir`}
                title="Etiketi değiştir"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                className="remove-member"
                onClick={() => onRemoveMember(group.id, member.id)}
                aria-label={`${member.label} portunu ${group.name} grubundan çıkar`}
                title="Gruptan çıkar"
              >
                <Unlink size={13} />
              </button>
            </div>
          );
        })}
        {!group.members.length && (
          <button
            type="button"
            className="empty-live-project"
            onClick={() => onRequestAddPort(group.id)}
          >
            <Plus size={15} />
            Bu projeye çalışan bir port ekleyin
          </button>
        )}
      </div>

      <div className="live-project-processes">
        {projectProcesses.map((process) => (
          <ProcessCard
            key={`${group.id}-${process.pid}`}
            process={process}
            selected={selected.has(process.pid)}
            onToggle={onToggleProcess}
            projectGroups={groups}
            projectGroupId={group.id}
            onAddProjectPort={onAddProjectPort}
            hiddenPortKeys={hiddenPortKeys}
            collapsedPortKeys={collapsedPortKeys}
            onHidePort={onHidePort}
            onTogglePortCollapsed={onTogglePortCollapsed}
          />
        ))}
        {group.members.length > 0 && !projectProcesses.length && (
          <p className="project-filter-empty">
            Bu projenin çalışan portları mevcut filtrelerde görünmüyor.
          </p>
        )}
      </div>
    </section>
  );
}

function findLiveMember(
  processes: ProcessPortGroup[],
  member: ProjectGroupMember,
): LiveMember | undefined {
  for (const process of processes) {
    const port = process.ports.find(
      (candidate) =>
        candidate.protocol === member.protocol &&
        candidate.port === member.port &&
        candidate.activity !== "connection",
    );
    if (port) return { process, port };
  }
  return undefined;
}

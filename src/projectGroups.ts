import type {
  ProjectGroup,
  ProjectGroupMember,
  Protocol,
} from "./types";

const STORAGE_KEY = "portcontrol.project-groups.v1";

export function loadProjectGroups(): ProjectGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return isProjectGroupList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjectGroups(groups: ProjectGroup[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Uygulama çalışmaya devam eder; depolama alanı kullanılamıyorsa grup
    // yalnızca mevcut oturum boyunca state içinde kalır.
  }
}

export function newProjectGroup(name: string): ProjectGroup {
  return {
    id: createId(),
    name: normalizeName(name, "İsimsiz proje"),
    createdAt: Date.now(),
    members: [],
  };
}

export function addProjectMember(
  groups: ProjectGroup[],
  groupId: string,
  member: Omit<ProjectGroupMember, "id">,
): ProjectGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const id = memberId(member.protocol, member.port);
    const nextMember: ProjectGroupMember = {
      ...member,
      id,
      label: normalizeName(member.label, `Port ${member.port}`),
    };
    const alreadyExists = group.members.some((item) => item.id === id);
    return {
      ...group,
      members: alreadyExists
        ? group.members.map((item) => (item.id === id ? nextMember : item))
        : [...group.members, nextMember],
    };
  });
}

export function removeProjectMember(
  groups: ProjectGroup[],
  groupId: string,
  memberIdToRemove: string,
): ProjectGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          members: group.members.filter(
            (member) => member.id !== memberIdToRemove,
          ),
        }
      : group,
  );
}

export function renameProjectGroup(
  groups: ProjectGroup[],
  groupId: string,
  name: string,
): ProjectGroup[] {
  const normalized = normalizeName(name, "İsimsiz proje");
  return groups.map((group) =>
    group.id === groupId ? { ...group, name: normalized } : group,
  );
}

export function renameProjectMember(
  groups: ProjectGroup[],
  groupId: string,
  memberIdToRename: string,
  label: string,
): ProjectGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          members: group.members.map((member) =>
            member.id === memberIdToRename
              ? {
                  ...member,
                  label: normalizeName(label, `Port ${member.port}`),
                }
              : member,
          ),
        }
      : group,
  );
}

export function memberId(protocol: Protocol, port: number): string {
  return `${protocol}:${port}`;
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return normalized || fallback;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isProjectGroupList(value: unknown): value is ProjectGroup[] {
  return (
    Array.isArray(value) &&
    value.every(
      (group) =>
        typeof group === "object" &&
        group !== null &&
        typeof group.id === "string" &&
        typeof group.name === "string" &&
        typeof group.createdAt === "number" &&
        Array.isArray(group.members) &&
        group.members.every(isProjectGroupMember),
    )
  );
}

function isProjectGroupMember(value: unknown): value is ProjectGroupMember {
  if (typeof value !== "object" || value === null) return false;
  const member = value as Partial<ProjectGroupMember>;
  return (
    typeof member.id === "string" &&
    typeof member.label === "string" &&
    (member.protocol === "TCP" || member.protocol === "UDP") &&
    typeof member.port === "number" &&
    Number.isInteger(member.port) &&
    member.port > 0 &&
    member.port <= 65535
  );
}

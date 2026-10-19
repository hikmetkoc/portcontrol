import { ChevronRight, FolderPlus, Play, Plus, Square } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { AppRuntime } from "../lib/runtime";
import { isActive } from "../lib/runtime";
import { runKey } from "../state/runStore";
import type { Project } from "../types";
import { StackBadge, StatusLed } from "./ui";

export function Sidebar({
  projects,
  runtimes,
  activeProjectId,
  onSelectProject,
  onNewProject,
  onStart,
  onStop,
}: {
  projects: Project[];
  runtimes: Map<string, AppRuntime>;
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  onStart: (runtime: AppRuntime) => void;
  onStop: (runtime: AppRuntime) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (projectId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>PROJELER</span>
        <button type="button" onClick={onNewProject} title="Yeni proje" aria-label="Yeni proje">
          <Plus size={15} />
        </button>
      </div>

      {projects.length === 0 && (
        <button type="button" className="sidebar-empty" onClick={onNewProject}>
          <FolderPlus size={22} strokeWidth={1.4} />
          <strong>Henüz proje yok</strong>
          <span>Çalışma klasörünü ekleyin; frontend ve backend uygulamaları otomatik bulunsun.</span>
        </button>
      )}

      <div className="project-tree">
        {projects.map((project) => {
          const items = project.apps.map((app) => runtimes.get(runKey(project.id, app.id))!).filter(Boolean);
          const running = items.filter((item) => isActive(item.state)).length;
          const open = !collapsed.has(project.id);
          return (
            <div
              key={project.id}
              className={`tree-project ${activeProjectId === project.id ? "is-active" : ""}`}
              style={{ "--accent": project.accent } as CSSProperties}
            >
              <div className="tree-project-row">
                <button
                  type="button"
                  className={`tree-caret ${open ? "is-open" : ""}`}
                  onClick={() => toggle(project.id)}
                  aria-label={open ? "Daralt" : "Genişlet"}
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="tree-project-name"
                  onClick={() => onSelectProject(project.id)}
                >
                  <span className="tree-accent" />
                  <span className="tree-label">{project.name}</span>
                  <span className={`tree-count ${running ? "is-live" : ""}`}>
                    {running}/{items.length}
                  </span>
                </button>
              </div>
              {open && (
                <ul className="tree-apps">
                  {items.map((runtime) => {
                    const active = isActive(runtime.state);
                    const port = runtime.displayPort;
                    return (
                      <li key={runtime.key} className={`tree-app tree-app--${runtime.state}`}>
                        <button
                          type="button"
                          className="tree-app-main"
                          onClick={() => onSelectProject(project.id)}
                          title={`${runtime.app.framework} · ${runtime.app.relativePath}`}
                        >
                          <StatusLed state={runtime.state} />
                          <StackBadge stack={runtime.app.stack} size="sm" />
                          <span className="tree-label">{runtime.app.name}</span>
                          {port && <code>:{port}</code>}
                        </button>
                        <button
                          type="button"
                          className={`tree-action ${active ? "is-stop" : ""}`}
                          onClick={() => (active ? onStop(runtime) : onStart(runtime))}
                          aria-label={active ? "Durdur" : "Başlat"}
                          title={active ? "Durdur" : "Başlat"}
                        >
                          {active ? <Square size={11} /> : <Play size={12} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

import type { AppKind } from "../types";

export interface StackMeta {
  label: string;
  glyph: string;
  color: string;
}

const STACKS: Record<string, StackMeta> = {
  react: { label: "React", glyph: "Re", color: "#61e3ff" },
  vue: { label: "Vue", glyph: "Vu", color: "#42ffb0" },
  angular: { label: "Angular", glyph: "Ng", color: "#ff3d6e" },
  next: { label: "Next.js", glyph: "Nx", color: "#e9ecff" },
  nuxt: { label: "Nuxt", glyph: "Nu", color: "#00f08a" },
  svelte: { label: "Svelte", glyph: "Sv", color: "#ff6a2b" },
  solid: { label: "Solid", glyph: "So", color: "#5b8cff" },
  astro: { label: "Astro", glyph: "As", color: "#ff5bd2" },
  remix: { label: "Remix", glyph: "Rx", color: "#9aa6ff" },
  vite: { label: "Vite", glyph: "Vi", color: "#c26bff" },
  tauri: { label: "Tauri", glyph: "Ta", color: "#ffc131" },
  electron: { label: "Electron", glyph: "El", color: "#9feaf9" },
  node: { label: "Node.js", glyph: "No", color: "#7cff6b" },
  nest: { label: "NestJS", glyph: "Ne", color: "#ff2d6f" },
  spring: { label: "Spring", glyph: "Sp", color: "#6dff4f" },
  java: { label: "Java", glyph: "Jv", color: "#ff9f43" },
  dotnet: { label: ".NET", glyph: ".N", color: "#b18cff" },
  django: { label: "Django", glyph: "Dj", color: "#2ee6a0" },
  fastapi: { label: "FastAPI", glyph: "Fa", color: "#00f0c8" },
  flask: { label: "Flask", glyph: "Fl", color: "#e8ecff" },
  python: { label: "Python", glyph: "Py", color: "#ffd84d" },
  go: { label: "Go", glyph: "Go", color: "#00e0ff" },
  rust: { label: "Rust", glyph: "Rs", color: "#ff8045" },
  php: { label: "PHP", glyph: "Ph", color: "#8d9bff" },
  ruby: { label: "Ruby", glyph: "Rb", color: "#ff4b5c" },
  flutter: { label: "Flutter", glyph: "Fr", color: "#45d1fd" },
  docker: { label: "Docker", glyph: "Dk", color: "#2f9bff" },
  database: { label: "Veritabanı", glyph: "Db", color: "#ffb347" },
};

const FALLBACK: StackMeta = { label: "Servis", glyph: "◆", color: "#29f0ff" };

export function stackMeta(stack: string | null | undefined): StackMeta {
  if (!stack) return FALLBACK;
  return STACKS[stack] ?? FALLBACK;
}

/** Port taramasındaki teknoloji adından görsel yığını tahmin eder. */
export function stackFromTechnology(technology: string, category?: string): string {
  const value = technology.toLowerCase();
  if (category === "database") return "database";
  if (category === "container") return "docker";
  const pairs: Array<[string, string]> = [
    ["tauri", "tauri"],
    ["angular", "angular"],
    ["next", "next"],
    ["nuxt", "nuxt"],
    ["svelte", "svelte"],
    ["astro", "astro"],
    ["react", "react"],
    ["vue", "vue"],
    ["vite", "vite"],
    ["spring", "spring"],
    [".net", "dotnet"],
    ["dotnet", "dotnet"],
    ["django", "django"],
    ["fastapi", "fastapi"],
    ["flask", "flask"],
    ["python", "python"],
    ["rust", "rust"],
    ["java", "java"],
    ["kotlin", "java"],
    ["flutter", "flutter"],
    ["go", "go"],
    ["php", "php"],
    ["ruby", "ruby"],
    ["docker", "docker"],
    ["javascript", "node"],
    ["node", "node"],
  ];
  return pairs.find(([needle]) => value.includes(needle))?.[1] ?? "node";
}

export const KIND_META: Record<AppKind, { label: string; color: string }> = {
  frontend: { label: "FRONTEND", color: "var(--neon-cyan)" },
  backend: { label: "BACKEND", color: "var(--neon-magenta)" },
  fullstack: { label: "FULLSTACK", color: "var(--neon-violet)" },
  desktop: { label: "MASAÜSTÜ", color: "var(--neon-amber)" },
  infra: { label: "ALTYAPI", color: "var(--neon-lime)" },
};

export const PROJECT_ACCENTS = [
  "#29f0ff",
  "#ff2bd6",
  "#7cff6b",
  "#ffb300",
  "#9b6bff",
  "#ff4d7e",
  "#00ffc6",
  "#4da3ff",
];

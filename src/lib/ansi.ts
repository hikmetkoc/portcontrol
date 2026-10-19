/** Terminal çıktısındaki ANSI SGR kodlarını renkli parçalara dönüştürür. */

export interface AnsiSegment {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

// Neon paletine uyarlanmış 16 temel renk.
const BASE_COLORS = [
  "#3b4058", // black
  "#ff4d7e", // red
  "#4dffa6", // green
  "#ffd84d", // yellow
  "#4da3ff", // blue
  "#ff5bf0", // magenta
  "#29f0ff", // cyan
  "#d9def5", // white
  "#6b7194", // bright black
  "#ff7a9c", // bright red
  "#8affc4", // bright green
  "#ffe680", // bright yellow
  "#7dbcff", // bright blue
  "#ff8ff5", // bright magenta
  "#7ff7ff", // bright cyan
  "#ffffff", // bright white
];

// CSI dizileri (renk dışı imleç/silme komutları dahil) ve OSC başlıkları.
const ESCAPE_PATTERN = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMc]/g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_PATTERN, "");
}

function color256(index: number): string {
  if (index < 16) return BASE_COLORS[index];
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level}, ${level}, ${level})`;
  }
  const value = index - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  const r = steps[Math.floor(value / 36) % 6];
  const g = steps[Math.floor(value / 6) % 6];
  const b = steps[value % 6];
  return `rgb(${r}, ${g}, ${b})`;
}

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const RESET: Style = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

function applyCodes(style: Style, raw: string): Style {
  const codes = raw === "" ? [0] : raw.split(";").map((code) => Number(code) || 0);
  let next = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0) next = { ...RESET };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = BASE_COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = BASE_COLORS[code - 90 + 8];
    else if (code >= 40 && code <= 47) next.bg = BASE_COLORS[code - 40];
    else if (code >= 100 && code <= 107) next.bg = BASE_COLORS[code - 100 + 8];
    else if (code === 39) next.fg = null;
    else if (code === 49) next.bg = null;
    else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      let value: string | null = null;
      if (mode === 5) {
        value = color256(codes[index + 2] ?? 0);
        index += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[index + 2], codes[index + 3], codes[index + 4]];
        value = `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`;
        index += 4;
      }
      if (code === 38) next.fg = value;
      else next.bg = value;
    }
  }
  return next;
}

export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: Style = { ...RESET };
  let cursor = 0;
  ESCAPE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  const push = (chunk: string) => {
    if (!chunk) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.fg === style.fg &&
      last.bg === style.bg &&
      last.bold === style.bold &&
      last.dim === style.dim &&
      last.italic === style.italic &&
      last.underline === style.underline
    ) {
      last.text += chunk;
    } else {
      segments.push({ text: chunk, ...style });
    }
  };
  while ((match = ESCAPE_PATTERN.exec(text)) !== null) {
    push(text.slice(cursor, match.index));
    if (match[2] === "m") style = applyCodes(style, match[1] ?? "");
    cursor = match.index + match[0].length;
  }
  push(text.slice(cursor));
  return segments;
}

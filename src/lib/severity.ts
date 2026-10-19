/**
 * Log satırlarını hata/uyarı olarak sınıflandırır. Log seviyesi (INFO, WARN,
 * ERROR…) varsa yalnızca ona bakılır; böylece "INFO ... ErrorPageFilter" gibi
 * satırlar yanlışlıkla hata sayılmaz.
 */
export type Severity = "error" | "warn" | "normal";

const LEVEL_PATTERN =
  /(?:^|[\s[|(])(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL)(?=[\s\]|):]|$)/;
const EXCEPTION_LINE = /^\s*(?:Exception in thread "[^"]*"\s+)?(?:[\w$]+\.)*[A-Z][\w$]*(?:Exception|Error)(?::|\s*$)/;
const STACK_FRAME = /^\s+at\s+\S|^\s*\.\.\. \d+ (?:more|common frames omitted)|^\s*Caused by:|^\s{2,}File "|^\s{4,}\S/;

export function classifyLine(text: string): Severity {
  const level = text.match(LEVEL_PATTERN)?.[1];
  if (level) {
    if (/ERROR|FATAL|SEVERE|CRITICAL/.test(level)) return "error";
    if (level.startsWith("WARN")) return "warn";
    return "normal";
  }
  const trimmed = text.trim();
  if (!trimmed) return "normal";
  if (/^\[(ERROR|FATAL)\]/i.test(trimmed) || /\bnpm ERR!/.test(trimmed) || /^(✘|×|✖)\s/.test(trimmed)) {
    return "error";
  }
  if (/^\[(WARN|WARNING)\]/i.test(trimmed) || /^⚠\s/.test(trimmed)) return "warn";
  if (/^(Exception in thread|Caused by:|Traceback \(most recent call last\))/.test(trimmed)) return "error";
  if (EXCEPTION_LINE.test(text)) return "error";
  if (/^(error|Error|ERR)(\s+[\w-]*\d*)?(\[[^\]]*\])?:/.test(trimmed)) return "error";
  if (/\b(EADDRINUSE|ECONNREFUSED|APPLICATION FAILED TO START|BUILD FAILURE|Unhandled(?:PromiseRejection)?|panicked at)\b/.test(trimmed)) {
    return "error";
  }
  if (/^(warning|Warning|WARNING)(\s+[\w-]*\d*)?:/.test(trimmed)) return "warn";
  return "normal";
}

/** Stack trace veya traceback devam satırı mı (kendi başına sorun değil, bir öncekinin ayrıntısı). */
export function isContinuation(text: string): boolean {
  return STACK_FRAME.test(text);
}

export function isExceptionLine(text: string): boolean {
  return EXCEPTION_LINE.test(text) && !LEVEL_PATTERN.test(text);
}

/** Aynı mesajın tekrarlarını birleştirmek için zaman damgası ve sayıları normalleştirir. */
export function problemKey(text: string): string {
  return text
    .replace(/^\s*\S*\d{2}:\d{2}:\d{2}[.,\d]*\S*\s*/, "")
    .replace(/\[[\w\s-]*-\d+\]/g, "[#]")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * Spring/logback biçimli satırı ("zaman LEVEL pid --- [app] [thread] logger : mesaj")
 * okunur parçalara ayırır; diğer satırlarda yalnızca baştaki zaman damgasını atar.
 */
export function splitLogLine(text: string): { logger: string | null; message: string } {
  const withoutTime = text.replace(
    /^\s*\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.,\d]*(?:Z|[+-]\d{2}:?\d{2})?\s*/,
    "",
  );
  const spring = withoutTime.match(
    /^(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\d+\s+---\s+(?:\[[^\]]*\]\s+)*(\S+)\s+:\s+(.*)$/,
  );
  if (spring) return { logger: spring[1], message: spring[2] };
  return { logger: null, message: withoutTime };
}

/** Loglardan çalışan uygulamanın etkin profilini/ortamını çıkarır. */
export function detectProfile(text: string): string | null {
  const spring = text.match(/The following (?:\d+ )?profiles? (?:is|are) active: (.+?)\s*$/);
  if (spring) return spring[1].replace(/"/g, "").trim();
  const fallback = text.match(/No active profile set, falling back to (?:\d+ )?default profiles?: (.+?)\s*$/);
  if (fallback) return `${fallback[1].replace(/"/g, "").trim()} (varsayılan)`;
  const dotnet = text.match(/Hosting environment: (\w+)/);
  if (dotnet) return dotnet[1];
  const quarkus = text.match(/Profile (\w+) activated/);
  if (quarkus) return quarkus[1];
  return null;
}

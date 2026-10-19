import type { CrashReport, LogLine } from "../types";
import { stripAnsi } from "./ansi";

interface PlainLine {
  seq: number;
  text: string;
}

function clip(text: string, max = 220): string {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Çöken sürecin loglarından en olası nedeni, ayrıntıyı ve çözüm önerisini çıkarır. */
export function analyzeCrash(logs: LogLine[]): CrashReport | null {
  const lines: PlainLine[] = logs
    .filter((line) => line.stream !== "system" && line.stream !== "input")
    .slice(-1500)
    .map((line) => ({ seq: line.seq, text: stripAnsi(line.text) }));
  if (!lines.length) return null;

  // 1) Port çakışması
  for (const line of lines) {
    const match =
      line.text.match(/Port (\d{2,5}) (?:is|was) already in use/i) ??
      line.text.match(/EADDRINUSE[^\d]*(?:[\w.:[\]]*:)?(\d{2,5})/i) ??
      line.text.match(/address already in use[^\d]*(\d{2,5})?/i) ??
      line.text.match(/Failed to bind to address[^\d]*:(\d{2,5})/i);
    if (match) {
      const port = match[1] ? `:${match[1]} ` : "";
      return {
        title: `Port ${port}zaten kullanımda`,
        detail: clip(line.text),
        hint: "Portu tutan süreci durdurun ya da uygulamayı kartından farklı bir portta başlatın.",
        seq: line.seq,
      };
    }
  }

  // 2) Spring Boot "APPLICATION FAILED TO START" bloğu
  const failedIndex = lines.findIndex((line) => /APPLICATION FAILED TO START/.test(line.text));
  if (failedIndex >= 0) {
    const block = lines.slice(failedIndex, failedIndex + 40);
    const section = (name: string) => {
      const start = block.findIndex((line) => line.text.trim() === `${name}:`);
      if (start < 0) return null;
      const collected: string[] = [];
      for (const line of block.slice(start + 1)) {
        const text = line.text.trim();
        if (/^(Description|Action):$/.test(text)) break;
        if (text) collected.push(text);
        else if (collected.length) break;
      }
      return collected.length ? clip(collected.join(" "), 320) : null;
    };
    return {
      title: "Spring Boot başlatılamadı",
      detail: section("Description"),
      hint: section("Action"),
      seq: lines[failedIndex].seq,
    };
  }

  // 3) Python traceback: son istisna satırı asıl hatadır.
  const tracebackIndex = lines.map((line) => line.text.trim()).lastIndexOf("Traceback (most recent call last):");
  if (tracebackIndex >= 0) {
    const tail = lines.slice(tracebackIndex + 1, tracebackIndex + 120);
    const error = tail.find((line) => /^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt)\b/.test(line.text.trim()));
    if (error) {
      const text = error.text.trim();
      const module = text.match(/No module named '([^']+)'/);
      return {
        title: clip(text, 140),
        detail: null,
        hint: module
          ? `Sanal ortamda '${module[1]}' kurulu değil: pip install -r requirements.txt`
          : null,
        seq: error.seq,
      };
    }
  }

  // 4) Java/Kotlin istisnası: en son "Caused by" kök nedendir.
  const causedBy = [...lines].reverse().find((line) => /^\s*Caused by: /.test(line.text));
  if (causedBy) {
    return {
      title: clip(causedBy.text.replace(/^\s*Caused by:\s*/, ""), 160),
      detail: null,
      hint: connectionHint(causedBy.text),
      seq: causedBy.seq,
    };
  }

  // 5) Node.js modül hataları
  for (const line of lines) {
    const missing = line.text.match(/Cannot find module '([^']+)'/);
    if (missing) {
      return {
        title: `Modül bulunamadı: ${missing[1]}`,
        detail: clip(line.text),
        hint: "Bağımlılıkları kurun (npm install) veya dosya yolunu kontrol edin.",
        seq: line.seq,
      };
    }
  }

  // 6) Bulunamayan komut / çalıştırılabilir dosya
  for (const line of lines) {
    const windows = line.text.match(/'([^']+)' is not recognized as an internal or external command/i);
    const unix = line.text.match(/(?:^|: )([\w.-]+): (?:command )?not found/i);
    const name = windows?.[1] ?? unix?.[1];
    if (name) {
      return {
        title: `Komut bulunamadı: ${name}`,
        detail: clip(line.text),
        hint: `${name} kurulu değil ya da PATH'te yok. Kurup PortControl'ü yeniden başlatın.`,
        seq: line.seq,
      };
    }
  }

  // 7) Maven/Gradle derleme hatası
  const buildFailure = lines.find((line) =>
    /\[ERROR\] Failed to execute goal|BUILD FAILURE|FAILURE: Build failed|Compilation failed/.test(line.text),
  );
  if (buildFailure) {
    const firstError = lines.find((line) => /\[ERROR\] .+\.(java|kt):/.test(line.text));
    return {
      title: "Derleme başarısız",
      detail: clip((firstError ?? buildFailure).text),
      hint: "Konsoldaki ilk [ERROR] satırı genellikle asıl nedendir.",
      seq: (firstError ?? buildFailure).seq,
    };
  }

  // 8) Bağlantı reddi (veritabanı veya bağımlı servis kapalı)
  const refused = lines.find((line) =>
    /ECONNREFUSED|Connection refused|could not connect to server|Connection to [\w.]+:\d+ refused/i.test(line.text),
  );
  if (refused) {
    return {
      title: "Bağlantı reddedildi",
      detail: clip(refused.text),
      hint: connectionHint(refused.text),
      seq: refused.seq,
    };
  }

  // 9) Genel istisna/hata satırı
  const generic = [...lines]
    .reverse()
    .find((line) => /^\s*(?:Uncaught\s+)?\w*(Error|Exception)(?::|\s)|^\s*(ERROR|FATAL|ERR!)\b/.test(line.text));
  if (generic) {
    return { title: clip(generic.text, 160), detail: null, hint: null, seq: generic.seq };
  }
  return null;
}

function connectionHint(text: string): string | null {
  const port = text.match(/(?:localhost|127\.0\.0\.1)[:/](\d{2,5})/)?.[1];
  if (/Connection refused|ECONNREFUSED|could not connect|Connection to/i.test(text)) {
    return port
      ? `:${port} portunda dinleyen servis yok. Bağımlı servis (ör. veritabanı) çalışıyor mu?`
      : "Bağımlı servis (ör. veritabanı) çalışıyor mu? Bağlantı ayarlarını kontrol edin.";
  }
  return null;
}

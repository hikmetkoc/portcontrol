import { FolderPlus, Gauge, Radar, ScrollText, Workflow } from "lucide-react";
import { StackBadge } from "./ui";

const SHOWCASE = [
  "react",
  "angular",
  "vue",
  "next",
  "svelte",
  "spring",
  "dotnet",
  "fastapi",
  "django",
  "go",
  "rust",
  "nest",
  "php",
  "docker",
];

export function Welcome({ onNewProject, onOpenRadar }: { onNewProject: () => void; onOpenRadar: () => void }) {
  return (
    <section className="view welcome">
      <div className="welcome-hero">
        <p className="eyebrow">// GELİŞTİRME KOMUTA MERKEZİ</p>
        <h1 className="welcome-title">
          Projelerini bağla.
          <br />
          <span className="gradient-text">Tek tıkla ayağa kaldır.</span>
        </h1>
        <p className="welcome-copy">
          Çalışma klasörünü ekle; PortControl içindeki tüm frontend, backend ve altyapı uygulamalarını bulur,
          varsayılan ya da seçtiğin portta başlatır, loglarını canlı akıtır ve açık portları radarda izler.
        </p>
        <div className="welcome-actions">
          <button type="button" className="neon-button neon-button--hero" onClick={onNewProject}>
            <FolderPlus size={17} />
            Proje klasörü ekle
          </button>
          <button type="button" className="neon-button neon-button--ghost" onClick={onOpenRadar}>
            <Radar size={16} />
            Canlı port radarı
          </button>
        </div>
        <div className="stack-marquee" aria-hidden="true">
          <div>
            {[...SHOWCASE, ...SHOWCASE].map((stack, index) => (
              <StackBadge key={`${stack}-${index}`} stack={stack} />
            ))}
          </div>
        </div>
      </div>
      <div className="feature-grid">
        <article className="feature glass">
          <Workflow size={20} />
          <strong>Otomatik tespit</strong>
          <p>Vite, Next.js, Angular, Spring Boot, .NET, FastAPI, Django, Go, Rust, Docker Compose ve daha fazlası.</p>
        </article>
        <article className="feature glass">
          <Gauge size={20} />
          <strong>Port kontrolü</strong>
          <p>Varsayılan portta ya da özel portta başlat; çakışmaları önceden yakala, boş portu otomatik bul.</p>
        </article>
        <article className="feature glass">
          <ScrollText size={20} />
          <strong>Canlı konsol</strong>
          <p>Renkli loglar, hata vurgusu, arama, tıklanabilir adresler ve sürece girdi gönderme.</p>
        </article>
      </div>
      <p className="welcome-hint">
        İpucu: <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">K</kbd> ile her şeye klavyeden ulaşabilirsin.
      </p>
    </section>
  );
}

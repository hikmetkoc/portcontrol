import { Copy, ExternalLink, Smartphone, Wifi, WifiOff, X } from "lucide-react";
import { useMemo, useState } from "react";
import { encode } from "uqr";
import { Modal } from "./Overlays";

export interface QrTarget {
  title: string;
  port: number | null;
  /** Yerel ağdan erişilebilen adresler. */
  urls: string[];
  /** Uygulama yalnızca localhost'a bağlıysa önerilecek adresler. */
  suggestedUrls: string[];
  hostHint: string | null;
}

function QrCode({ text }: { text: string }) {
  const { size, cells } = useMemo(() => {
    const result = encode(text, { ecc: "M", border: 2 });
    const filled: Array<[number, number]> = [];
    result.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) filled.push([x, y]);
      }),
    );
    return { size: result.size, cells: filled };
  }, [text]);
  return (
    <svg className="qr-code" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR kod: ${text}`}>
      <defs>
        <linearGradient id="qr-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#003b4a" />
          <stop offset="100%" stopColor="#4a0640" />
        </linearGradient>
      </defs>
      {/* Tüm telefon kameralarının okuyabilmesi için açık zemin üzerinde koyu modüller. */}
      <rect width={size} height={size} fill="#eef7ff" />
      <path
        d={cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")}
        fill="url(#qr-grad)"
        shapeRendering="crispEdges"
      />
    </svg>
  );
}

export function QrDialog({
  target,
  onClose,
  onOpenUrl,
}: {
  target: QrTarget;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const reachable = target.urls.length > 0;
  const options = reachable ? target.urls : target.suggestedUrls;
  const [selected, setSelected] = useState(options[0] ?? "");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(selected);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Panoya erişim yoksa yoksay.
    }
  }

  return (
    <Modal onClose={onClose} className="qr-modal" labelledBy="qr-title">
      <header className="modal-header">
        <div>
          <p className="eyebrow">// AĞDAN ERİŞİM</p>
          <h2 id="qr-title">
            <Smartphone size={18} /> {target.title}
          </h2>
          <p>Aynı Wi-Fi ağındaki telefon veya tabletin kamerasıyla okut.</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
          <X size={16} />
        </button>
      </header>

      {!reachable && (
        <div className="callout callout--amber">
          <WifiOff size={14} />
          <span>
            Uygulama şu an yalnızca <code>localhost</code> üzerinde dinliyor; telefondan açılmaz.
            {target.hostHint ? (
              <>
                {" "}
                Ağa açmak için: <code>{target.hostHint}</code>
              </>
            ) : null}{" "}
            Aşağıdaki kod, ağa açıldığında kullanılacak adrestir.
          </span>
        </div>
      )}

      {selected ? (
        <div className={`qr-stage ${reachable ? "" : "is-dimmed"}`}>
          <div className="qr-frame">
            <QrCode text={selected} />
            <span className="qr-scan" />
          </div>
          <div className="qr-side">
            <span className={`qr-status ${reachable ? "is-live" : ""}`}>
              {reachable ? <Wifi size={13} /> : <WifiOff size={13} />}
              {reachable ? "AĞDA YAYINDA" : "YALNIZCA YEREL"}
            </span>
            <code className="qr-url">{selected}</code>
            {options.length > 1 && (
              <div className="qr-options">
                {options.map((url) => (
                  <button
                    type="button"
                    key={url}
                    className={url === selected ? "is-active" : ""}
                    onClick={() => setSelected(url)}
                  >
                    {url.replace(/^https?:\/\//, "")}
                  </button>
                ))}
              </div>
            )}
            <div className="qr-actions">
              <button type="button" className="neon-button neon-button--small" onClick={() => void copy()}>
                <Copy size={13} />
                {copied ? "Kopyalandı" : "Kopyala"}
              </button>
              <button
                type="button"
                className="neon-button neon-button--small neon-button--ghost"
                onClick={() => onOpenUrl(selected)}
                disabled={!reachable}
              >
                <ExternalLink size={13} />
                Aç
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="callout callout--red">
          <WifiOff size={14} />
          <span>Bu bilgisayarın yerel ağ adresi bulunamadı. Bir Wi-Fi veya Ethernet ağına bağlı mısın?</span>
        </div>
      )}
    </Modal>
  );
}

/** Framework'e göre "ağa aç" ipucu. */
export function hostHintFor(stack: string, framework: string): string | null {
  if (framework.startsWith("Vite") || ["vite", "react", "vue", "svelte", "solid", "astro"].includes(stack)) {
    return "--host 0.0.0.0";
  }
  if (stack === "angular") return "ng serve --host=0.0.0.0";
  if (stack === "next") return "next dev -H 0.0.0.0";
  if (stack === "nuxt") return "--host 0.0.0.0";
  if (stack === "fastapi") return "uvicorn ... --host 0.0.0.0";
  if (stack === "flask") return "flask run --host 0.0.0.0";
  if (stack === "django") return "runserver 0.0.0.0:PORT";
  if (stack === "spring") return "server.address=0.0.0.0 (varsayılan zaten tüm arayüzler)";
  if (stack === "dotnet") return "--urls http://0.0.0.0:PORT";
  return null;
}

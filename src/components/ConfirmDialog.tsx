import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import type { ProcessPortGroup } from "../types";

interface ConfirmDialogProps {
  processes: ProcessPortGroup[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  processes,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const portCount = processes.reduce(
    (total, process) => total + process.ports.length,
    0,
  );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Pencereyi kapat"
        >
          <X size={18} />
        </button>
        <div className="dialog-icon">
          <AlertTriangle size={25} />
        </div>
        <p className="eyebrow">İşlemi doğrulayın</p>
        <h2 id="dialog-title">
          {processes.length} süreci durdurmak üzeresiniz
        </h2>
        <p>
          Bu işlem seçili süreçleri sonlandırır ve kullandıkları {portCount} portu
          serbest bırakır. Kaydedilmemiş çalışma kaybolabilir.
        </p>
        <div className="dialog-processes">
          {processes.map((process) => (
            <div key={process.pid}>
              <span>{process.displayName}</span>
              <small>
                PID {process.pid} ·{" "}
                {process.ports.map((port) => port.port).join(", ")}
              </small>
            </div>
          ))}
        </div>
        <div className="dialog-safety">
          <ShieldAlert size={16} />
          PortControl, süreç kimliğini ve başlangıç zamanını yeniden
          doğrulayacaktır.
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : null}
            {busy ? "Durduruluyor…" : "Süreçleri durdur"}
          </button>
        </div>
      </section>
    </div>
  );
}

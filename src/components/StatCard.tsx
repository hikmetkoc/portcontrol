import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "amber" | "mint";
}

export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: StatCardProps) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <div className="stat-icon">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

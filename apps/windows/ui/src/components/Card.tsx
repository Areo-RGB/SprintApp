import { ReactNode } from "react";

type CardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function Card({ title, subtitle, children }: CardProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
      {subtitle ? <p className="mb-3 text-xs text-slate-500">{subtitle}</p> : null}
      {children}
    </section>
  );
}

import { ReactNode } from "react";

type CardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function Card({ title, subtitle, children }: CardProps) {
  return (
    <section className="border-[3px] border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
      {(title || subtitle) && (
        <div className="mb-5 border-b-[3px] border-black pb-3">
          {title && <h2 className="text-xl font-bold uppercase tracking-tight text-black">{title}</h2>}
          {subtitle && <p className="mt-1 text-sm font-medium text-gray-700">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

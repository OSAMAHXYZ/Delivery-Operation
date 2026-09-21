"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { I18nProvider, useI18n } from "@/lib/i18n/context";

function ShellInner({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { dir } = useI18n();

  return (
    <div className="flex min-h-screen bg-slate-50" dir={dir}>
      <Suspense fallback={<aside className="w-72 shrink-0 border-r border-slate-200 bg-[#111827]" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export function AppShell(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      <ShellInner {...props} />
    </I18nProvider>
  );
}

export function KpiCard({
  label,
  value,
  href,
  suffix,
}: {
  label: string;
  value: string | number;
  href: string;
  suffix?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#EB0A1E]/30 hover:shadow-md"
    >
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-900">
        {value}
        {suffix ? <span className="ms-1 text-base font-semibold text-slate-500">{suffix}</span> : null}
      </p>
      <p className="mt-3 text-xs font-semibold text-[#EB0A1E] opacity-0 transition group-hover:opacity-100">
        View details →
      </p>
    </Link>
  );
}

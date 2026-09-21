"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const stockStatus = [
  { name: "Free", value: 4 },
  { name: "Reserved", value: 1 },
  { name: "Allocated", value: 1 },
  { name: "Sold", value: 1 },
];

const aging = [
  { bucket: "0-15", count: 2 },
  { bucket: "16-30", count: 1 },
  { bucket: "31-60", count: 1 },
  { bucket: "60+", count: 2 },
];

const byProduct = [
  { product: "Camry", count: 2 },
  { product: "Land Cruiser", count: 1 },
  { product: "RAV4", count: 1 },
  { product: "Hilux", count: 1 },
  { product: "Corolla Cross", count: 1 },
];

const colors = ["#EB0A1E", "#111827", "#64748b", "#f59e0b", "#0ea5e9"];

export function DashboardCharts() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Stock Status">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={stockStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
              {stockStatus.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Back Order Aging">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={aging}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#EB0A1E" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Back Orders by Product">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byProduct} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="product" width={100} />
            <Tooltip />
            <Bar dataKey="count" fill="#111827" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="VIN Matching Status">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={[
              { label: "Matched", value: 2 },
              { label: "Open", value: 3 },
              { label: "Cancelled", value: 1 },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

import Chart from 'react-apexcharts';
import SectionCard from './SectionCard';

const baseChart = {
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: 'Inter, Tajawal, sans-serif',
    foreColor: '#94A3B8'
  },
  grid: {
    borderColor: 'rgba(255,255,255,0.06)',
    strokeDashArray: 4
  },
  tooltip: {
    theme: 'dark'
  }
};

export default function ChartCard({ title, subtitle, type = 'area', series, options = {}, height = 280, emptyText = 'لا توجد بيانات' }) {
  const hasData = Array.isArray(series) && series.some((s) => (s.data || []).some((v) => Number(v) > 0));

  return (
    <SectionCard title={title} subtitle={subtitle} className="chart-card">
      {!hasData ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <Chart
          type={type}
          height={height}
          series={series}
          options={{
            ...baseChart,
            ...options,
            chart: { ...baseChart.chart, ...(options.chart || {}) }
          }}
        />
      )}
    </SectionCard>
  );
}

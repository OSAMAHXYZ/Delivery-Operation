import Chart from 'react-apexcharts'

const base = {
  chart: {
    toolbar: { show: false },
    zoom: { enabled: false },
    background: 'transparent',
    fontFamily: 'Inter, sans-serif',
  },
  theme: { mode: 'dark' },
  grid: {
    borderColor: 'rgba(255,255,255,0.06)',
    strokeDashArray: 3,
  },
  dataLabels: { enabled: false },
  legend: {
    labels: { colors: '#94A3B8' },
    fontSize: '12px',
  },
  tooltip: { theme: 'dark' },
}

export function AreaTrendChart({ categories, series, height = 280 }) {
  const options = {
    ...base,
    chart: { ...base.chart, type: 'area' },
    stroke: { curve: 'smooth', width: 2.5, colors: ['#3B82F6'] },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.02,
        stops: [0, 90, 100],
      },
    },
    colors: ['#3B82F6'],
    xaxis: {
      categories,
      labels: { style: { colors: '#94A3B8', fontSize: '11px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#94A3B8', fontSize: '11px' } },
    },
  }
  return <Chart type="area" height={height} options={options} series={series} />
}

export function HorizontalBarChart({ categories, data, color = '#3B82F6', height = 320 }) {
  const options = {
    ...base,
    chart: { ...base.chart, type: 'bar' },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 8,
        barHeight: '62%',
      },
    },
    colors: [color],
    xaxis: {
      categories,
      labels: { style: { colors: '#94A3B8', fontSize: '11px' } },
    },
    yaxis: {
      labels: { style: { colors: '#F8FAFC', fontSize: '12px' } },
    },
  }
  return (
    <Chart
      type="bar"
      height={height}
      options={options}
      series={[{ name: 'العدد', data }]}
    />
  )
}

export function StatusDonut({ labels, series, colors, height = 260 }) {
  const options = {
    ...base,
    chart: { ...base.chart, type: 'donut' },
    labels,
    colors,
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          labels: {
            show: true,
            name: { color: '#94A3B8' },
            value: { color: '#F8FAFC', fontWeight: 700, fontSize: '22px' },
            total: {
              show: true,
              label: 'الإجمالي',
              color: '#94A3B8',
              formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0),
            },
          },
        },
      },
    },
  }
  return <Chart type="donut" height={height} options={options} series={series} />
}

export default function StatusBadge({ item }) {
  if (!item) return <span className="badge">—</span>
  if (item.status === 'available') return <span className="badge badge--success">متاح</span>
  if (item.agentStatus === 'delivered') return <span className="badge badge--success">تم الترحيل</span>
  if (item.agentStatus === 'ready_for_delivery') return <span className="badge badge--info">Ready</span>
  if (item.agentStatus === 'out_of_delivery') return <span className="badge badge--warning">Out</span>
  if (item.agentStatus === 'in_stock') return <span className="badge badge--info">In Stock</span>
  return <span className="badge badge--warning">{item.statusLabel || 'محجوز'}</span>
}

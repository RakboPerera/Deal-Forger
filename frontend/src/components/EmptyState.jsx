import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon: Icon = Inbox,
  title = 'Nothing here yet',
  description = '',
  action = '',
  onAction,
}) {
  return (
    <div className="empty-state">
      <Icon size={48} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && onAction && (
        <button className="btn btn-primary mt-3" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

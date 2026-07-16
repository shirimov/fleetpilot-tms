'use client';

interface TaskCardProps {
  card: any;
}

export default function TaskCard({ card }: TaskCardProps) {
  return (
    <div className="bg-slate-50 border-l-4 border-blue-500 rounded p-3 hover:shadow-md transition">
      <p className="font-medium text-slate-800 text-sm">{card.title}</p>
      {card.description && (
        <p className="text-xs text-slate-600 mt-1 line-clamp-2">{card.description}</p>
      )}
      <div className="flex gap-2 mt-2 text-xs flex-wrap">
        {card.priority && (
          <span
            className={`px-2 py-1 rounded font-semibold ${
              card.priority === 'URGENT'
                ? 'bg-red-100 text-red-700'
                : card.priority === 'HIGH'
                ? 'bg-orange-100 text-orange-700'
                : card.priority === 'MEDIUM'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-green-100 text-green-700'
            }`}
          >
            {card.priority}
          </span>
        )}
        {card.dueDate && (
          <span className="text-slate-500">
            {new Date(card.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

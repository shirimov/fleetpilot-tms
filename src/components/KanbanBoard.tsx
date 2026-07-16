'use client';

import { useState } from 'react';
import TaskCard from './TaskCard';

interface Board {
  id: string;
  name: string;
  order: number;
  cards: any[];
}

interface KanbanBoardProps {
  project: any;
  onUpdate: () => void;
}

export default function KanbanBoard({ project, onUpdate }: KanbanBoardProps) {
  const [boards, setBoards] = useState<Board[]>(project.boards || []);
  const [draggedCard, setDraggedCard] = useState<any>(null);

  const handleAddCard = async (boardId: string, title: string) => {
    if (!title.trim()) return;

    try {
      const res = await fetch('/api/tasks/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          boardId,
          title,
        }),
      });
      const newCard = await res.json();
      setBoards(
        boards.map(b =>
          b.id === boardId ? { ...b, cards: [...b.cards, newCard] } : b
        )
      );
    } catch (error) {
      console.error('Failed to add card:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent, card: any) => {
    setDraggedCard(card);
  };

  const handleDrop = async (e: React.DragEvent, boardId: string) => {
    e.preventDefault();
    if (!draggedCard) return;

    try {
      await fetch('/api/tasks/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draggedCard.id,
          boardId,
        }),
      });

      setBoards(
        boards.map(b => {
          if (b.id === draggedCard.boardId) {
            return { ...b, cards: b.cards.filter(c => c.id !== draggedCard.id) };
          }
          if (b.id === boardId) {
            return { ...b, cards: [...b.cards, draggedCard] };
          }
          return b;
        })
      );
      setDraggedCard(null);
    } catch (error) {
      console.error('Failed to move card:', error);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {boards.map(board => (
        <div
          key={board.id}
          className="bg-white rounded-lg shadow-md p-4 min-h-96"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, board.id)}
        >
          <h2 className="font-semibold text-lg text-slate-800 mb-4">{board.name}</h2>

          <div className="space-y-2 min-h-64">
            {board.cards.map(card => (
              <div
                key={card.id}
                draggable
                onDragStart={(e) => handleDragStart(e, card)}
                className="cursor-move"
              >
                <TaskCard card={card} />
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              const title = prompt('Enter card title:');
              if (title) handleAddCard(board.id, title);
            }}
            className="w-full mt-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition"
          >
            + Add Card
          </button>
        </div>
      ))}
    </div>
  );
}

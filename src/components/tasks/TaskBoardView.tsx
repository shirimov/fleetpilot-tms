'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';
import TaskCard from '@/components/TaskCard';
import type {
  KanbanCard,
  KanbanColumn,
  KanbanProject,
} from '@/lib/tasks/kanban-types';

export type TaskBoardMove = {
  cardId: string;
  sourceBoardId: string;
  destinationBoardId: string;
  destinationIndex: number;
};

type TaskBoardViewProps = {
  project: KanbanProject;
  moving: boolean;
  movementDisabled: boolean;
  onMove: (move: TaskBoardMove) => Promise<void>;
  onOpenCard: (cardId: string) => void;
};

function SortableTaskCard({
  card,
  boardId,
  disabled,
  onOpen,
}: {
  card: KanbanCard;
  boardId: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', boardId },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="focus-within:z-10"
    >
      <TaskCard
        card={card}
        isDragging={isDragging}
        onOpen={onOpen}
        dragHandle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Move ${card.title}`}
            className="cursor-grab rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden="true">⠿</span>
          </button>
        }
      />
    </div>
  );
}

function BoardGroup({
  board,
  moving,
  movementDisabled,
  onOpenCard,
}: {
  board: KanbanColumn;
  moving: boolean;
  movementDisabled: boolean;
  onOpenCard: (cardId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `board:${board.id}`,
    data: { type: 'board', boardId: board.id },
    disabled: moving || movementDisabled || board.status === null,
  });

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`board-title-${board.id}`}
      className={`flex w-[min(88vw,21rem)] shrink-0 flex-col overflow-hidden rounded-xl border bg-[#171a24] shadow-sm transition ${
        isOver
          ? 'border-blue-400 ring-2 ring-blue-400/20'
          : 'border-white/8'
      }`}
    >
      <header className="border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-7 w-1 rounded-full"
            style={{ backgroundColor: board.color ?? '#64748b' }}
            aria-hidden="true"
          />
          <h2
            id={`board-title-${board.id}`}
            className="min-w-0 flex-1 truncate text-sm font-semibold text-white"
          >
            {board.name}
          </h2>
          <span className="rounded-md bg-white/6 px-2 py-0.5 text-xs text-slate-400">
            {board.cards.length}
          </span>
        </div>
        {board.status === null && (
          <p className="mt-2 rounded-md bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200">
            Legacy group · status mapping required before moving cards
          </p>
        )}
      </header>

      <SortableContext
        items={board.cards.map(({ id }) => id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          aria-label={`${board.name} tasks`}
          className="min-h-40 flex-1 space-y-2 bg-[#11131b]/70 p-2.5"
        >
          {board.cards.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-white/10 px-5 text-center text-xs text-slate-500">
              No tasks match this view
            </div>
          ) : (
            board.cards.map((card) => (
              <SortableTaskCard
                key={card.id}
                card={card}
                boardId={board.id}
                disabled={moving || movementDisabled || board.status === null}
                onOpen={() => onOpenCard(card.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default function TaskBoardView({
  project,
  moving,
  movementDisabled,
  onMove,
  onOpenCard,
}: TaskBoardViewProps) {
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const locations = useMemo(() => {
    const cardLocations = new Map<string, { boardId: string; index: number }>();
    project.boards.forEach((board) =>
      board.cards.forEach((card, index) =>
        cardLocations.set(card.id, { boardId: board.id, index }),
      ),
    );
    return cardLocations;
  }, [project]);

  function handleDragStart(event: DragStartEvent) {
    const cardId = String(event.active.id);
    const location = locations.get(cardId);
    setActiveCard(
      project.boards
        .find(({ id }) => id === location?.boardId)
        ?.cards.find(({ id }) => id === cardId) ?? null,
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    if (!event.over || moving || movementDisabled) return;

    const cardId = String(event.active.id);
    const source = locations.get(cardId);
    if (!source) return;
    const overType = event.over.data.current?.type;
    const destinationBoardId =
      overType === 'board'
        ? String(event.over.data.current?.boardId)
        : locations.get(String(event.over.id))?.boardId;
    if (!destinationBoardId) return;

    const destinationBoard = project.boards.find(
      ({ id }) => id === destinationBoardId,
    );
    if (!destinationBoard?.status) return;
    const destinationIndex =
      overType === 'board'
        ? destinationBoard.cards.length
        : destinationBoard.cards.findIndex(
            ({ id }) => id === String(event.over?.id),
          );
    if (
      destinationIndex < 0 ||
      (source.boardId === destinationBoardId &&
        source.index === destinationIndex)
    ) {
      return;
    }
    await onMove({
      cardId,
      sourceBoardId: source.boardId,
      destinationBoardId,
      destinationIndex,
    });
  }

  if (project.boards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-14 text-center text-slate-400">
        This project has no task groups yet.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveCard(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <div className="flex gap-3 overflow-x-auto pb-5">
        {project.boards.map((board) => (
          <BoardGroup
            key={board.id}
            board={board}
            moving={moving}
            movementDisabled={movementDisabled}
            onOpenCard={onOpenCard}
          />
        ))}
      </div>
      <DragOverlay>
        {activeCard ? (
          <div className="w-[min(82vw,20rem)] rotate-2">
            <TaskCard card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

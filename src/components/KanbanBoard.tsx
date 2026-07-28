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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  KanbanCard,
  KanbanColumn,
  KanbanProject,
} from '@/lib/tasks/kanban-types';
import { moveCardInBoardState } from '@/lib/tasks/kanban-state';
import TaskCard from './TaskCard';

type KanbanBoardProps = {
  projectId: string;
};

function SortableTaskCard({
  card,
  boardId,
  disabled,
}: {
  card: KanbanCard;
  boardId: string;
  disabled: boolean;
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
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="focus-within:z-10"
    >
      <TaskCard
        card={card}
        isDragging={isDragging}
        dragHandle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Move ${card.title}`}
            className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:cursor-grabbing"
          >
            <span aria-hidden="true">⠿</span>
          </button>
        }
      />
    </div>
  );
}

function KanbanColumnView({
  board,
  moving,
}: {
  board: KanbanColumn;
  moving: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `board:${board.id}`,
    data: { type: 'board', boardId: board.id },
    disabled: moving || board.status === null,
  });

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`board-title-${board.id}`}
      className={`flex w-[min(86vw,22rem)] shrink-0 flex-col rounded-2xl border bg-slate-900/70 p-3 transition ${
        isOver
          ? 'border-blue-400 bg-blue-500/10 ring-2 ring-blue-400/30'
          : 'border-slate-800'
      }`}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`board-title-${board.id}`}
            className="truncate font-semibold text-slate-100"
          >
            {board.name}
          </h2>
          <p className="text-xs text-slate-400">
            {board.cards.length} {board.cards.length === 1 ? 'card' : 'cards'}
          </p>
        </div>
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-white/20"
          style={{ backgroundColor: board.color ?? '#475569' }}
          aria-hidden="true"
        />
      </header>

      {board.status === null && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
          Moves are disabled until this legacy board receives a status mapping.
        </p>
      )}

      <SortableContext
        items={board.cards.map(({ id }) => id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={`min-h-28 flex-1 space-y-2 rounded-xl p-1 ${
            board.cards.length === 0 ? 'border border-dashed border-slate-700' : ''
          }`}
          aria-label={`${board.name} cards`}
        >
          {board.cards.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              No cards in this board
            </p>
          ) : (
            board.cards.map((card) => (
              <SortableTaskCard
                key={card.id}
                card={card}
                boardId={board.id}
                disabled={moving}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default function KanbanBoard({ projectId }: KanbanBoardProps) {
  const [project, setProject] = useState<KanbanProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/tasks/projects/${projectId}/board`);
      if (response.status === 404) {
        setNotFound(true);
        setProject(null);
        return;
      }
      if (!response.ok) {
        throw new Error('The board could not be loaded.');
      }
      setProject((await response.json()) as KanbanProject);
    } catch (loadError) {
      setProject(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The board could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const cardLocations = useMemo(() => {
    const locations = new Map<string, { boardId: string; index: number }>();
    for (const board of project?.boards ?? []) {
      board.cards.forEach((card, index) => {
        locations.set(card.id, { boardId: board.id, index });
      });
    }
    return locations;
  }, [project]);

  function handleDragStart(event: DragStartEvent) {
    if (!project || moving) return;
    const cardId = String(event.active.id);
    const location = cardLocations.get(cardId);
    const card = project.boards
      .find(({ id }) => id === location?.boardId)
      ?.cards.find(({ id }) => id === cardId);
    setActiveCard(card ?? null);
    setError(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    if (!project || !event.over || moving) return;

    const cardId = String(event.active.id);
    const source = cardLocations.get(cardId);
    if (!source) return;

    const overType = event.over.data.current?.type;
    const destinationBoardId =
      overType === 'board'
        ? String(event.over.data.current?.boardId)
        : cardLocations.get(String(event.over.id))?.boardId;
    if (!destinationBoardId) return;

    const destinationBoard = project.boards.find(
      ({ id }) => id === destinationBoardId,
    );
    if (!destinationBoard?.status) {
      setError('This board has no status mapping and cannot accept moved cards.');
      return;
    }

    const destinationIndex =
      overType === 'board'
        ? destinationBoard.cards.length
        : destinationBoard.cards.findIndex(
            ({ id }) => id === String(event.over?.id),
          );
    if (destinationIndex < 0) return;
    if (
      source.boardId === destinationBoardId &&
      source.index === destinationIndex
    ) {
      return;
    }

    const sourceCard = project.boards
      .find(({ id }) => id === source.boardId)
      ?.cards.find(({ id }) => id === cardId);
    if (!sourceCard) return;

    const snapshot = project;
    const optimisticBoards = moveCardInBoardState(project.boards, {
      cardId,
      destinationBoardId,
      destinationIndex,
    });
    if (optimisticBoards === project.boards) return;

    setProject({ ...project, boards: optimisticBoards });
    setMoving(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/cards/${cardId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBoardId: source.boardId,
          destinationBoardId,
          destinationIndex,
          expectedUpdatedAt: sourceCard.updatedAt,
        }),
      });
      const responseBody = (await response.json()) as
        | KanbanProject
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in responseBody && responseBody.error
            ? responseBody.error
            : 'The card move could not be saved.',
        );
      }
      setProject(responseBody as KanbanProject);
    } catch (moveError) {
      setProject(snapshot);
      setError(
        moveError instanceof Error
          ? `${moveError.message} The previous board state was restored.`
          : 'The card move failed. The previous board state was restored.',
      );
    } finally {
      setMoving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-slate-300">
        Loading Kanban board…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8">
        <h2 className="text-lg font-semibold text-rose-100">Project not found</h2>
        <p className="mt-2 text-sm text-rose-200/80">
          This task project may have been removed.
        </p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8">
        <p className="text-rose-100">{error ?? 'The board could not be loaded.'}</p>
        <button
          type="button"
          onClick={() => void loadProject()}
          className="mt-4 rounded-lg bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="kanban-project-title">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="kanban-project-title" className="text-2xl font-bold text-white">
            {project.name}
          </h1>
          {project.description && (
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              {project.description}
            </p>
          )}
        </div>
        {moving && (
          <p role="status" className="text-sm font-medium text-blue-300">
            Saving card move…
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100"
        >
          {error}
        </div>
      )}

      {project.boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
          This project has no boards yet.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveCard(null)}
          onDragEnd={(event) => void handleDragEnd(event)}
        >
          <p id="kanban-drag-instructions" className="sr-only">
            Use the move button to drag a card. Keyboard users can press Space,
            use arrow keys to choose a position, and press Space again to drop.
          </p>
          <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-4">
            {project.boards.map((board) => (
              <KanbanColumnView key={board.id} board={board} moving={moving} />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[min(82vw,21rem)] rotate-2">
                <TaskCard card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
}

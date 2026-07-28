import type { KanbanColumn } from './kanban-types';

export type OptimisticCardMove = {
  cardId: string;
  destinationBoardId: string;
  destinationIndex: number;
};

export function moveCardInBoardState(
  boards: KanbanColumn[],
  move: OptimisticCardMove,
): KanbanColumn[] {
  const sourceBoard = boards.find((board) =>
    board.cards.some((card) => card.id === move.cardId),
  );
  const destinationBoard = boards.find(
    (board) => board.id === move.destinationBoardId,
  );

  if (!sourceBoard || !destinationBoard || !destinationBoard.status) {
    return boards;
  }

  const movingCard = sourceBoard.cards.find((card) => card.id === move.cardId);
  if (!movingCard) return boards;

  const sourceCards = sourceBoard.cards.filter(
    (card) => card.id !== move.cardId,
  );
  const destinationCards =
    sourceBoard.id === destinationBoard.id
      ? sourceCards
      : destinationBoard.cards.filter((card) => card.id !== move.cardId);

  if (
    move.destinationIndex < 0 ||
    move.destinationIndex > destinationCards.length
  ) {
    return boards;
  }

  destinationCards.splice(move.destinationIndex, 0, {
    ...movingCard,
    status: destinationBoard.status,
  });

  return boards.map((board) => {
    if (board.id === sourceBoard.id && board.id === destinationBoard.id) {
      return {
        ...board,
        cards: destinationCards.map((card, order) => ({ ...card, order })),
      };
    }
    if (board.id === sourceBoard.id) {
      return {
        ...board,
        cards: sourceCards.map((card, order) => ({ ...card, order })),
      };
    }
    if (board.id === destinationBoard.id) {
      return {
        ...board,
        cards: destinationCards.map((card, order) => ({ ...card, order })),
      };
    }
    return board;
  });
}

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramDeliveryPayload =
  | {
      kind: 'ASSIGNMENT';
      text: string;
      replyMarkup: TelegramInlineKeyboardMarkup;
    }
  | {
      kind: 'UPDATE_REQUEST';
      text: string;
      replyMarkup: TelegramInlineKeyboardMarkup;
      updateRequestId: string;
    }
  | {
      kind: 'COMMAND_RESPONSE';
      text: string;
      replyMarkup?: TelegramInlineKeyboardMarkup;
    }
  | {
      kind: 'CALLBACK_RESPONSE';
      text: string;
      replyMarkup?: TelegramInlineKeyboardMarkup;
    };

export type TelegramMessageSender = {
  id: bigint;
  username: string | null;
};

export type TelegramMessageContext = {
  messageId: bigint;
  chatId: bigint;
  chatType: string | null;
  from: TelegramMessageSender | null;
  text: string | null;
};

export type TelegramCallbackContext = {
  id: string;
  from: TelegramMessageSender;
  data: string | null;
  messageId: bigint | null;
  chatId: bigint | null;
  chatType: string | null;
};

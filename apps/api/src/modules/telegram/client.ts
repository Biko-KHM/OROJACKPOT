import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';

export interface SendMessageOptions {
  parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  reply_markup?: unknown;
  disable_web_page_preview?: boolean;
}

export interface EditMessageOptions {
  parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  reply_markup?: unknown;
  disable_web_page_preview?: boolean;
}

export interface AnswerCallbackQueryOptions {
  text?: string;
  show_alert?: boolean;
  url?: string;
  cache_time?: number;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export class TelegramRateLimitError extends Error {
  public readonly retryAfter: number;
  constructor(retryAfter: number, message?: string) {
    super(message || `Telegram rate limit exceeded. Retry after ${retryAfter} seconds.`);
    this.name = 'TelegramRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class TelegramApiError extends Error {
  public readonly errorCode: number;
  constructor(errorCode: number, description: string) {
    super(`Telegram API Error ${errorCode}: ${description}`);
    this.name = 'TelegramApiError';
    this.errorCode = errorCode;
  }
}

export class TelegramNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`Telegram Network Error: ${message}`);
    this.name = 'TelegramNetworkError';
  }
}

export interface ITelegramClient {
  sendMessage(
    chatId: string | number | bigint,
    text: string,
    options?: SendMessageOptions,
  ): Promise<Record<string, unknown>>;
  editMessageText(
    chatId: string | number | bigint,
    messageId: number | bigint,
    text: string,
    options?: EditMessageOptions,
  ): Promise<Record<string, unknown>>;
  answerCallbackQuery(
    callbackQueryId: string,
    options?: AnswerCallbackQueryOptions,
  ): Promise<boolean>;
  sendPhoto(
    chatId: string | number | bigint,
    photo: Buffer,
    filename: string,
    caption?: string,
    options?: { parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown' },
  ): Promise<{ file_id: string; message_id: number }>;
  sendDocument(
    chatId: string | number | bigint,
    document: Buffer,
    filename: string,
    caption?: string,
    options?: { parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown' },
  ): Promise<{ file_id: string; message_id: number }>;
  getFile(fileId: string): Promise<{ file_id: string; file_path: string; file_size?: number }>;
  downloadFile(filePath: string): Promise<Buffer>;
  getMe(): Promise<{ id: number; is_bot: boolean; first_name: string; username?: string }>;
  getChat(chatId: string | number | bigint): Promise<{ id: number | bigint; type: string; title?: string; username?: string }>;
  getChatMember(
    chatId: string | number | bigint,
    userId: number | bigint,
  ): Promise<{ status: string; can_post_messages?: boolean; can_edit_messages?: boolean }>;
}

export class DefaultTelegramClient implements ITelegramClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(token: string = config.TELEGRAM_BOT_TOKEN) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async request<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body, (_key, val) =>
          typeof val === 'bigint' ? val.toString() : val,
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      logger.error({ err, method }, 'Telegram network connection failed');
      throw new TelegramNetworkError(msg, err);
    }

    let data: TelegramApiResponse<T>;
    try {
      data = (await response.json()) as TelegramApiResponse<T>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TelegramNetworkError(`Failed to parse Telegram response for ${method}: ${msg}`);
    }

    if (response.status === 429 || data.parameters?.retry_after) {
      const retryAfter = data.parameters?.retry_after || 5;
      logger.warn({ method, retryAfter }, 'Telegram 429 rate limit hit');
      throw new TelegramRateLimitError(retryAfter, data.description);
    }

    if (!data.ok) {
      logger.error({ method, data }, 'Telegram API returned error');
      throw new TelegramApiError(data.error_code || response.status, data.description || 'Unknown error');
    }

    return data.result as T;
  }

  async sendMessage(
    chatId: string | number | bigint,
    text: string,
    options?: SendMessageOptions,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('sendMessage', {
      chat_id: chatId.toString(),
      text,
      parse_mode: options?.parse_mode ?? 'HTML',
      reply_markup: options?.reply_markup,
      disable_web_page_preview: options?.disable_web_page_preview,
    });
  }

  async editMessageText(
    chatId: string | number | bigint,
    messageId: number | bigint,
    text: string,
    options?: EditMessageOptions,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('editMessageText', {
      chat_id: chatId.toString(),
      message_id: Number(messageId),
      text,
      parse_mode: options?.parse_mode ?? 'HTML',
      reply_markup: options?.reply_markup,
      disable_web_page_preview: options?.disable_web_page_preview,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    options?: AnswerCallbackQueryOptions,
  ): Promise<boolean> {
    return this.request<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: options?.text,
      show_alert: options?.show_alert,
      url: options?.url,
      cache_time: options?.cache_time,
    });
  }

  async sendPhoto(
    chatId: string | number | bigint,
    photo: Buffer,
    filename: string,
    caption?: string,
    options?: { parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown' },
  ): Promise<{ file_id: string; message_id: number }> {
    const url = `${this.baseUrl}/sendPhoto`;
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('photo', new Blob([new Uint8Array(photo)]), filename || 'receipt.jpg');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', options?.parse_mode ?? 'HTML');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      logger.error({ err }, 'Telegram sendPhoto network error');
      throw new TelegramNetworkError(msg, err);
    }

    const data = (await response.json()) as TelegramApiResponse<{
      message_id: number;
      photo?: Array<{ file_id: string }>;
    }>;

    if (!data.ok || !data.result) {
      logger.error({ data }, 'Telegram sendPhoto returned error');
      throw new TelegramApiError(
        data.error_code || response.status,
        data.description || 'Unknown error',
      );
    }

    const photoArr = data.result.photo;
    const fileId = photoArr && photoArr.length > 0 ? photoArr[photoArr.length - 1]!.file_id : '';
    return {
      file_id: fileId,
      message_id: data.result.message_id,
    };
  }

  async sendDocument(
    chatId: string | number | bigint,
    document: Buffer,
    filename: string,
    caption?: string,
    options?: { parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown' },
  ): Promise<{ file_id: string; message_id: number }> {
    const url = `${this.baseUrl}/sendDocument`;
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('document', new Blob([new Uint8Array(document)]), filename || 'receipt.pdf');
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', options?.parse_mode ?? 'HTML');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      logger.error({ err }, 'Telegram sendDocument network error');
      throw new TelegramNetworkError(msg, err);
    }

    const data = (await response.json()) as TelegramApiResponse<{
      message_id: number;
      document?: { file_id: string };
    }>;

    if (!data.ok || !data.result) {
      logger.error({ data }, 'Telegram sendDocument returned error');
      throw new TelegramApiError(
        data.error_code || response.status,
        data.description || 'Unknown error',
      );
    }

    const fileId = data.result.document?.file_id || '';
    return {
      file_id: fileId,
      message_id: data.result.message_id,
    };
  }

  async getFile(
    fileId: string,
  ): Promise<{ file_id: string; file_path: string; file_size?: number }> {
    return this.request<{ file_id: string; file_path: string; file_size?: number }>('getFile', {
      file_id: fileId,
    });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      logger.error({ err, filePath }, 'Telegram file download network error');
      throw new TelegramNetworkError(msg, err);
    }

    if (!response.ok) {
      throw new TelegramApiError(
        response.status,
        `Failed to download file from Telegram: ${response.statusText}`,
      );
    }

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async getMe(): Promise<{ id: number; is_bot: boolean; first_name: string; username?: string }> {
    return this.request<{ id: number; is_bot: boolean; first_name: string; username?: string }>('getMe', {});
  }

  async getChat(
    chatId: string | number | bigint,
  ): Promise<{ id: number | bigint; type: string; title?: string; username?: string }> {
    return this.request<{ id: number | bigint; type: string; title?: string; username?: string }>('getChat', {
      chat_id: chatId.toString(),
    });
  }

  async getChatMember(
    chatId: string | number | bigint,
    userId: number | bigint,
  ): Promise<{ status: string; can_post_messages?: boolean; can_edit_messages?: boolean }> {
    return this.request<{ status: string; can_post_messages?: boolean; can_edit_messages?: boolean }>(
      'getChatMember',
      {
        chat_id: chatId.toString(),
        user_id: Number(userId),
      },
    );
  }
}

// Global injectable client reference for testing
let currentClient: ITelegramClient = new DefaultTelegramClient();

export function getTelegramClient(): ITelegramClient {
  return currentClient;
}

export function setTelegramClient(client: ITelegramClient): void {
  currentClient = client;
}

export function resetTelegramClient(): void {
  currentClient = new DefaultTelegramClient();
}

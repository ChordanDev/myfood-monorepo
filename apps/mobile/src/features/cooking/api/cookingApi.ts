import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import type {
  CookingAnswer,
  CookingChatMessage,
  CookingFinish,
  CookingSession,
} from '../types/cookingApi';

const COOKING_PATH = '/api/cooking';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every post changes the server (a session opens, a question is stored, stock is consumed), so a
// repeat after a lost answer could not be told from a second one: none is ever retried.
function sessionPath(sessionId: string): string {
  return `${COOKING_PATH}/sessions/${encodeURIComponent(sessionId)}`;
}

function postOptions(options?: RequestOptions) {
  return { ...options, auth: true, retry: false };
}

/**
 * Opens the Cooking session of a Scheduled meal, or returns the active one it already has with
 * its chat history; the server refuses a meal not on its today.
 */
export async function startCookingSession(
  scheduledMealId: string,
  options?: RequestOptions
): Promise<CookingSession> {
  const response = await apiClient.post<unknown>(
    `${COOKING_PATH}/start`,
    { scheduledMealId },
    postOptions(options)
  );

  return parseSessionResponse(response);
}

/** Reads a Cooking session with its chat history, oldest turn first. */
export async function getCookingSession(
  sessionId: string,
  options?: RequestOptions
): Promise<CookingSession> {
  const response = await apiClient.get<unknown>(sessionPath(sessionId), {
    ...options,
    auth: true,
  });

  return parseSessionResponse(response);
}

/**
 * Asks the Cooking chat a question. The answer arrives whole, with the two turns the server
 * stored; it refuses a meal not on its today and a session that already finished.
 */
export async function askCookingSession(
  sessionId: string,
  message: string,
  options?: RequestOptions
): Promise<CookingAnswer> {
  const response = await apiClient.post<unknown>(
    `${sessionPath(sessionId)}/ask`,
    { message },
    postOptions(options)
  );

  return parseAnswerResponse(response);
}

/**
 * Finishes a Cooking session: the meal is cooked, its Ingredients leave the Inventory oldest
 * lot first and the answer says what was consumed and what the stock could not cover.
 */
export async function finishCookingSession(
  sessionId: string,
  options?: RequestOptions
): Promise<CookingFinish> {
  const response = await apiClient.post<unknown>(
    `${sessionPath(sessionId)}/finish`,
    undefined,
    postOptions(options)
  );

  return parseFinishResponse(response);
}

// The transport does not check the shape of a 2xx answer, so one without the members the app
// reads is treated like any other unintelligible server answer.
function parseSessionResponse(response: unknown): CookingSession {
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    typeof data.sessionId !== 'string' ||
    data.sessionId === '' ||
    !isChatMessageList(data.chatMessages)
  ) {
    throw new ApiError('unknown_error', 'Malformed cooking session response');
  }

  return data as unknown as CookingSession;
}

function parseAnswerResponse(response: unknown): CookingAnswer {
  const data = isRecord(response) ? response.data : undefined;

  // The chat appends exactly what the server stored: the question, then its answer.
  if (
    !isRecord(data) ||
    !isChatMessageList(data.turns) ||
    data.turns.length !== 2 ||
    data.turns[0].role !== 'user' ||
    data.turns[1].role !== 'assistant'
  ) {
    throw new ApiError('unknown_error', 'Malformed cooking answer response');
  }

  return data as unknown as CookingAnswer;
}

function isChatMessageList(value: unknown): value is CookingChatMessage[] {
  return Array.isArray(value) && value.every(isChatMessage);
}

function isChatMessage(value: unknown): value is CookingChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.insertedAt === 'string'
  );
}

function parseFinishResponse(response: unknown): CookingFinish {
  const data = isRecord(response) ? response.data : undefined;

  if (
    !isRecord(data) ||
    !isRecord(data.scheduledMeal) ||
    !Array.isArray(data.inventoryMutations) ||
    !Array.isArray(data.shortages)
  ) {
    throw new ApiError('unknown_error', 'Malformed cooking finish response');
  }

  return data as unknown as CookingFinish;
}

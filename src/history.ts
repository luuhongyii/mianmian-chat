import type { ChatMessage } from './api';

export const HISTORY_KEY = 'mianmian.chat-history.v1';
export const INTERRUPTED_REPLY = 'This reply was interrupted. You can send your message again.';

export type ChatTurn = {
  id: string;
  user: string;
  assistant: string;
  status: 'pending' | 'complete' | 'interrupted' | 'error';
  error?: string;
};

export type Conversation = {
  id: string;
  updatedAt: number;
  turns: ChatTurn[];
};

export type ChatHistory = {
  version: 1;
  activeId: string;
  conversations: Conversation[];
};

export function newConversation(): Conversation {
  return { id: crypto.randomUUID(), updatedAt: Date.now(), turns: [] };
}

export function emptyHistory(): ChatHistory {
  const conversation = newConversation();
  return { version: 1, activeId: conversation.id, conversations: [conversation] };
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.turns[0]?.user.replace(/\s+/g, ' ').trim() || 'New chat';
}

export function modelContext(turns: ChatTurn[]): ChatMessage[] {
  return turns.filter(turn => turn.status === 'complete').flatMap(turn => [
    { role: 'user' as const, content: turn.user },
    { role: 'assistant' as const, content: turn.assistant },
  ]);
}

function isTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as ChatTurn;
  return typeof turn.id === 'string' && Boolean(turn.id)
    && typeof turn.user === 'string' && Boolean(turn.user.trim())
    && typeof turn.assistant === 'string'
    && ['pending', 'complete', 'interrupted', 'error'].includes(turn.status)
    && (turn.status !== 'complete' || Boolean(turn.assistant.trim()))
    && (turn.error === undefined || typeof turn.error === 'string');
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as Conversation;
  return typeof conversation.id === 'string' && Boolean(conversation.id)
    && Number.isFinite(conversation.updatedAt)
    && Array.isArray(conversation.turns) && conversation.turns.every(isTurn)
    && new Set(conversation.turns.map(turn => turn.id)).size === conversation.turns.length;
}

export function loadHistory(): ChatHistory {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (raw === null) return emptyHistory();
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.conversations)
    || !value.conversations.every(isConversation)
    || !value.conversations.some((conversation: Conversation) => conversation.id === value.activeId)
    || new Set(value.conversations.map((conversation: Conversation) => conversation.id)).size !== value.conversations.length) {
    throw new Error('Invalid saved chat history');
  }
  return {
    version: 1,
    activeId: value.activeId,
    conversations: value.conversations.map((conversation: Conversation) => ({
      ...conversation,
      turns: conversation.turns.map(turn => turn.status === 'pending'
        ? { ...turn, status: 'interrupted' as const, error: INTERRUPTED_REPLY }
        : turn),
    })),
  };
}

export function saveHistory(history: ChatHistory): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

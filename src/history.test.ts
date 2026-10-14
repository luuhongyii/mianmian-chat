import { beforeEach, describe, expect, it } from 'vitest';
import { conversationTitle, emptyHistory, HISTORY_KEY, INTERRUPTED_REPLY, loadHistory, modelContext, newConversation, saveHistory, type ChatTurn } from './history';

beforeEach(() => localStorage.clear());

describe('saved conversations', () => {
  it('round-trips multiple conversations and the active selection without losing Unicode', () => {
    const history = emptyHistory();
    history.conversations[0].turns = [{ id: 'one', user: '你好 🐰', assistant: 'Hello!', status: 'complete' }];
    const next = newConversation();
    history.conversations.push(next);
    history.activeId = next.id;
    saveHistory(history);
    expect(loadHistory()).toEqual(history);
    expect(conversationTitle(history.conversations[0])).toBe('你好 🐰');
  });

  it('restores interrupted streams with their partial text but excludes them from model context', () => {
    const history = emptyHistory();
    const turns: ChatTurn[] = [
      { id: 'one', user: 'A', assistant: 'B', status: 'complete' },
      { id: 'two', user: 'C', assistant: 'Partial', status: 'pending' },
      { id: 'three', user: 'D', assistant: '', status: 'error', error: 'Network error' },
    ];
    history.conversations[0].turns = turns;
    saveHistory(history);
    const restored = loadHistory().conversations[0].turns;
    expect(restored[1]).toEqual({ ...turns[1], status: 'interrupted', error: INTERRUPTED_REPLY });
    expect(modelContext(restored)).toEqual([{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }]);
  });

  it.each(['{', '{}', '{"version":2,"conversations":[]}'])('rejects invalid stored data without overwriting it: %s', raw => {
    localStorage.setItem(HISTORY_KEY, raw);
    expect(() => loadHistory()).toThrow();
    expect(localStorage.getItem(HISTORY_KEY)).toBe(raw);
  });
});

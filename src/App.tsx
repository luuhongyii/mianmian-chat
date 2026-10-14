import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatBot, { Button, type Flow, type Params, type Settings, type Styles } from 'react-chatbotify';
import { getChatStatus, requestReply, type ChatMessage, type ChatStatus } from './api';
import { conversationTitle, emptyHistory, INTERRUPTED_REPLY, loadHistory, modelContext, newConversation, saveHistory, type ChatHistory, type ChatTurn, type Conversation } from './history';

const settings: Settings = {
  general: {
    embedded: true,
    showHeader: false,
    showFooter: false,
    primaryColor: '#b7767c',
    secondaryColor: '#a2696f',
    fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  },
  chatHistory: { disabled: true },
  chatWindow: { showScrollbar: true, autoJumpToBottom: true, showMessagePrompt: false },
  chatInput: {
    enabledPlaceholderText: 'Write something…',
    disabledPlaceholderText: 'Mianmian is thinking…',
    botDelay: 0,
    allowNewline: true,
    buttons: [Button.SEND_MESSAGE_BUTTON],
  },
  botBubble: { showAvatar: true, avatar: '/bunny.svg', simulateStream: false },
  userBubble: { showAvatar: false },
  notification: { disabled: true },
  audio: { disabled: true },
  voice: { disabled: true },
  fileAttachment: { disabled: true },
  emoji: { disabled: true },
  ariaLabel: { inputTextArea: 'Chat message', sendButton: 'Send message' },
  device: { applyMobileOptimizations: false },
};

const styles: Styles = {
  chatWindowStyle: { width: '100%', height: '100%', borderRadius: 0, boxShadow: 'none', border: 'none' },
  bodyStyle: { background: '#fffdfa', padding: '12px 20px 24px' },
  botBubbleStyle: { background: '#f4efe9', color: '#514840', borderRadius: '18px 18px 18px 5px', padding: '13px 17px', lineHeight: 1.8, fontSize: 14, maxWidth: '82%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  userBubbleStyle: { background: '#eed9da', color: '#574145', borderRadius: '18px 18px 5px 18px', padding: '13px 17px', lineHeight: 1.8, fontSize: 14, maxWidth: '82%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  chatInputContainerStyle: { margin: '8px 22px 18px', padding: '8px 10px 8px 16px', background: '#fff', border: '1px solid #e7ded5', borderRadius: 20, boxShadow: 'none', minHeight: 60, alignItems: 'center' },
  chatInputAreaStyle: { background: 'transparent', color: '#514840', fontSize: 14, lineHeight: 1.7, padding: '7px 4px', maxHeight: 130 },
  chatInputAreaFocusedStyle: { background: 'transparent', boxShadow: 'none' },
  chatInputAreaDisabledStyle: { background: 'transparent', color: '#93847b' },
  sendButtonStyle: { background: '#b7767c', borderRadius: 14, width: 40, height: 40, margin: 0, flexShrink: 0, alignItems: 'center' },
  sendButtonHoveredStyle: { background: '#9e6268' },
  sendButtonDisabledStyle: { background: '#e9d9d8', borderRadius: 14 },
  sendIconStyle: { fill: '#fff', width: 19, height: 19, transform: 'none' },
  sendIconHoveredStyle: { fill: '#fff' },
  sendIconDisabledStyle: { fill: '#a58e8d' },
  rcbTypingIndicatorDotStyle: { backgroundColor: '#b7767c' },
};

function Welcome() {
  return (
    <div className="welcome">
      <div className="mascot-wrap">
        <span className="sparkle sparkle-one" aria-hidden="true">✧</span>
        <img className="mascot" src="/bunny.svg" alt="Mianmian the bunny" width="116" height="116" />
        <span className="sparkle sparkle-two" aria-hidden="true">✦</span>
      </div>
      <span className="eyebrow">HELLO, LITTLE FRIEND</span>
      <h2>Hi, I'm Mianmian<span className="welcome-dot">.</span></h2>
      <p>What's on your mind today?<br />A question, a little inspiration, or everyday moments.</p>
      <div className="welcome-divider" aria-hidden="true"><span />♡<span /></div>
    </div>
  );
}

function ChatSession({ status, conversation, onSave }: {
  status: ChatStatus;
  conversation: Conversation;
  onSave: (id: string, turns: ChatTurn[]) => void;
}) {
  const turns = useRef(conversation.turns);
  const initialTurns = useRef(conversation.turns);
  const restored = useRef(false);
  const pending = useRef<{ controller: AbortController; turnId: string } | null>(null);
  const lastTurn = initialTurns.current.at(-1);
  const [error, setError] = useState(lastTurn?.error || '');
  const [busy, setBusy] = useState(false);
  const [retryInput, setRetryInput] = useState<string | null>(lastTurn?.error ? lastTurn.user : null);

  const persist = useCallback((next: ChatTurn[]) => {
    turns.current = next;
    onSave(conversation.id, next);
  }, [conversation.id, onSave]);

  const updateTurn = useCallback((id: string, update: Partial<ChatTurn>) => {
    persist(turns.current.map(turn => turn.id === id ? { ...turn, ...update } : turn));
  }, [persist]);

  useEffect(() => () => {
    const request = pending.current;
    if (!request) return;
    request.controller.abort();
    if (turns.current.some(turn => turn.id === request.turnId && turn.status === 'pending')) {
      updateTurn(request.turnId, { status: 'interrupted', error: INTERRUPTED_REPLY });
    }
  }, [updateTurn]);

  const flow = useMemo<Flow>(() => {
    const reply = async (params: Params) => {
      if (!params.userInput.trim()) return;
      const input = params.userInput;
      const messages: ChatMessage[] = [...modelContext(turns.current), { role: 'user', content: input }];
      const turnId = crypto.randomUUID();
      persist([...turns.current, { id: turnId, user: input, assistant: '', status: 'pending' }]);
      if (!status.configured) {
        const message = 'No model is connected yet. Configure the cloud API to start chatting.';
        updateTurn(turnId, { status: 'error', error: message });
        setError(message);
        return;
      }
      setError('');
      setRetryInput(null);
      setBusy(true);
      const controller = new AbortController();
      pending.current = { controller, turnId };
      try {
        const answer = await requestReply(messages, controller.signal, async text => {
          if (controller.signal.aborted) return;
          updateTurn(turnId, { assistant: text });
          await params.streamMessage(text);
        });
        if (controller.signal.aborted) return;
        updateTurn(turnId, { assistant: answer, status: 'complete' });
      } catch (cause) {
        if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : 'Connection failed. Please try again later.';
          updateTurn(turnId, { status: 'error', error: message });
          setError(message);
          setRetryInput(input);
        }
      } finally {
        if (!controller.signal.aborted) {
          await params.endStreamMessage('bot');
          setBusy(false);
          pending.current = null;
        }
      }
    };
    return {
      start: {
        component: async (params: Params) => {
          if (restored.current) return;
          restored.current = true;
          if (!initialTurns.current.length) return <Welcome />;
          for (const turn of initialTurns.current) {
            await params.injectMessage(turn.user, 'user');
            if (turn.assistant) await params.injectMessage(turn.assistant, 'bot');
          }
        },
        function: reply,
        path: 'chat',
      },
      chat: { function: reply, path: 'chat' },
    };
  }, [status.configured, persist, updateTurn]);

  return (
    <>
      <div className="chat-content" aria-busy={busy}>
        <ChatBot id="mianmian" flow={flow} settings={settings} styles={styles} />
      </div>
      {error && <div className="chat-error" role="alert">{error}{retryInput && ' This message was not completed. You can send it again.'}</div>}
    </>
  );
}

export default function App() {
  const [initial] = useState(() => {
    try { return { history: loadHistory(), error: '' }; }
    catch { return { history: emptyHistory(), error: 'Saved chats could not be loaded. Existing browser data has not been changed; new chats will not be saved.' }; }
  });
  const [history, setHistory] = useState(initial.history);
  const historyRef = useRef(history);
  const [storageError, setStorageError] = useState(initial.error);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButton = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<ChatStatus>({ configured: false });
  const [checking, setChecking] = useState(true);
  const conversation = history.conversations.find(item => item.id === history.activeId)!;

  const updateHistory = useCallback((update: (current: ChatHistory) => ChatHistory) => {
    const next = update(historyRef.current);
    historyRef.current = next;
    setHistory(next);
    if (initial.error) return;
    try { saveHistory(next); setStorageError(''); }
    catch { setStorageError('Chat history could not be saved in this browser. Your current conversation is still available until you close this page.'); }
  }, [initial.error]);

  const saveConversation = useCallback((id: string, turns: ChatTurn[]) => {
    updateHistory(current => ({
      ...current,
      conversations: current.conversations.map(item => item.id === id ? { ...item, turns, updatedAt: Date.now() } : item),
    }));
  }, [updateHistory]);

  const closeHistory = () => {
    setHistoryOpen(false);
    historyButton.current?.focus();
  };

  const startNewChat = () => {
    const next = newConversation();
    updateHistory(current => ({ ...current, activeId: next.id, conversations: [next, ...current.conversations] }));
    setHistoryOpen(false);
  };

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    getChatStatus(controller.signal)
      .then(setStatus)
      .catch(() => { if (!controller.signal.aborted) setStatus({ configured: false }); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [history.activeId]);

  return (
    <main className="page">
      <header className="page-header">
        <a className="brand" href="/" aria-label="Mianmian home">
          <img src="/bunny.svg" width="36" height="36" alt="" />
          <span>Mianmian <small>CHAT</small></span>
        </a>
        <div className="header-tools">
          <span className="header-note">A little softness for every day <span aria-hidden="true">✿</span></span>
          <button ref={historyButton} className="history-toggle" aria-expanded={historyOpen} aria-controls="chat-history" onClick={() => setHistoryOpen(open => !open)}>History</button>
        </div>
      </header>

      {historyOpen && <section className="history-panel" id="chat-history" aria-label="Chat history" onKeyDown={event => { if (event.key === 'Escape') closeHistory(); }}>
        <header className="history-header"><h2>Chat history</h2><button autoFocus onClick={closeHistory} aria-label="Close history">×</button></header>
        <nav className="history-list" aria-label="Saved conversations">
          {[...history.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(item => (
            <button key={item.id} className="history-item" aria-current={item.id === history.activeId ? 'true' : undefined} aria-label={`Open chat: ${conversationTitle(item)}`} title={conversationTitle(item)} onClick={() => {
              updateHistory(current => ({ ...current, activeId: item.id }));
              closeHistory();
            }}>{conversationTitle(item)}</button>
          ))}
        </nav>
        <p className="history-note">Saved in this browser</p>
      </section>}

      <section className="chat-card" aria-label="Chat with Mianmian">
        <header className="chat-header">
          <div className="chat-identity">
            <div className="avatar-frame"><img src="/bunny.svg" width="43" height="43" alt="" /></div>
            <div><h1>Mianmian's chat nook <span aria-hidden="true">♡</span></h1>
              <p className="connection-status" role="status">
                <span className={`status-dot ${status.configured ? 'ready' : ''}`} aria-hidden="true" />
                {checking ? 'Checking connection…' : status.configured ? `Configured · ${status.model || 'Cloud model'}` : 'Waiting for a cloud model'}
              </p>
            </div>
          </div>
          <button className="reset-button" onClick={startNewChat} title="Start a new conversation. Previous chats are saved.">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></svg>
            <span>New chat</span>
          </button>
        </header>
        {storageError && <div className="chat-error" role="alert">{storageError}</div>}
        <ChatSession key={conversation.id} status={status} conversation={conversation} onSave={saveConversation} />
        <div className="input-hint">Enter to send <span>·</span> Shift + Enter for a new line</div>
      </section>

      <footer className="page-footer"><span aria-hidden="true">✧</span> A little window. Take your time to chat.<span aria-hidden="true">✧</span></footer>
    </main>
  );
}

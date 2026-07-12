import React, { useState, useEffect, useRef } from 'react';

const API_URL_KEY = 'secondbrain_api_url';

export default function App() {
  // Backend API URL Configuration
  const [apiUrl, setApiUrl] = useState(() => {
    return localStorage.getItem(API_URL_KEY) || '';
  });
  const [isConfigOpen, setIsConfigOpen] = useState(!localStorage.getItem(API_URL_KEY));
  const [tempApiUrl, setTempApiUrl] = useState(apiUrl);

  // Ingest State
  const [noteText, setNoteText] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState({ type: '', message: '' });

  // Chat State
  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'welcome',
      role: 'ai',
      text: "Hello! I am your SecondBrain Assistant. Ask me anything about the notes you've stored."
    }
  ]);
  const [isAsking, setIsAsking] = useState(false);
  const chatBottomRef = useRef(null);

  // Resurfaced Note State
  const [resurfacedNote, setResurfacedNote] = useState(null);
  const [isResurfacing, setIsResurfacing] = useState(false);
  const [resurfaceError, setResurfaceError] = useState('');

  // Fetch resurfaced note on mount & when API URL changes
  useEffect(() => {
    if (apiUrl) {
      fetchResurfacedNote();
    }
  }, [apiUrl]);

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isAsking]);

  const saveConfig = (e) => {
    e.preventDefault();
    const cleanUrl = tempApiUrl.trim().replace(/\/$/, ''); // Remove trailing slash
    localStorage.setItem(API_URL_KEY, cleanUrl);
    setApiUrl(cleanUrl);
    setIsConfigOpen(false);
    setIngestStatus({ type: '', message: '' });
  };

  const fetchResurfacedNote = async () => {
    if (!apiUrl) return;
    setIsResurfacing(true);
    setResurfaceError('');
    try {
      const response = await fetch(`${apiUrl}/resurface`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setResurfacedNote(data.note);
    } catch (err) {
      console.error('Error fetching resurfaced note:', err);
      setResurfaceError('Unable to fetch daily note. Check connection or API path.');
    } finally {
      setIsResurfacing(false);
    }
  };

  const handleIngestSubmit = async (e) => {
    e.preventDefault();
    if (!apiUrl) {
      setIsConfigOpen(true);
      return;
    }

    const trimmed = noteText.trim();
    if (!trimmed) {
      setIngestStatus({ type: 'error', message: 'Note cannot be empty or only whitespace.' });
      return;
    }
    if (noteText.length > 4000) {
      setIngestStatus({ type: 'error', message: 'Note cannot exceed 4000 characters.' });
      return;
    }

    setIsIngesting(true);
    setIngestStatus({ type: '', message: '' });

    try {
      const response = await fetch(`${apiUrl}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned HTTP ${response.status}`);
      }

      setIngestStatus({ type: 'success', message: 'Note successfully memorized into your SecondBrain!' });
      setNoteText('');
      
      // Auto fade-out success banner after 5 seconds
      setTimeout(() => {
        setIngestStatus(prev => prev.type === 'success' ? { type: '', message: '' } : prev);
      }, 5000);

      // Trigger resurface fetch as notes count might now be >= 2
      fetchResurfacedNote();

    } catch (err) {
      console.error('Ingest error:', err);
      setIngestStatus({ 
        type: 'error', 
        message: err.message || 'Network failure. Please ensure your API is running and CORS is configured.' 
      });
    } finally {
      setIsIngesting(false);
    }
  };

  const handleAskSubmit = async (e) => {
    e.preventDefault();
    if (!apiUrl) {
      setIsConfigOpen(true);
      return;
    }

    const trimmed = question.trim();
    if (!trimmed) return;

    const userMsg = { id: `user-${Date.now()}`, role: 'user', text: question };
    setChatMessages(prev => [...prev, userMsg]);
    setQuestion('');
    setIsAsking(true);

    try {
      const response = await fetch(`${apiUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned HTTP ${response.status}`);
      }

      const aiMsg = { 
        id: `ai-${Date.now()}`, 
        role: 'ai', 
        text: data.answer, 
        sourceNoteIds: data.sourceNoteIds || [] 
      };
      setChatMessages(prev => [...prev, aiMsg]);

    } catch (err) {
      console.error('Ask error:', err);
      const errMsg = {
        id: `err-${Date.now()}`,
        role: 'error',
        text: `Error: ${err.message || 'Failed to connect to backend server. Make sure API endpoint is correct and CORS is enabled.'}`
      };
      setChatMessages(prev => [...prev, errMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  const clearChat = () => {
    setChatMessages([
      {
        id: 'welcome',
        role: 'ai',
        text: "Hello! I am your SecondBrain Assistant. Ask me anything about the notes you've stored."
      }
    ]);
  };

  return (
    <div className="app-container">
      {/* App Header */}
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo">🧠</span>
          <div className="app-title-group">
            <h1>SecondBrain AI</h1>
            <p className="app-subtitle">Personal Memory Assistant & RAG Engine</p>
          </div>
        </div>
        <button className="config-badge" onClick={() => setIsConfigOpen(true)}>
          <span className={`config-indicator ${apiUrl ? '' : 'inactive'}`}></span>
          {apiUrl ? 'API Connected' : 'Configure Connection'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </header>

      {/* Daily Resurfaced Note Banner */}
      <section className="resurface-section">
        {isResurfacing ? (
          <div className="glass-panel resurface-card" style={{ opacity: 0.7 }}>
            <div className="resurface-header">Resurfacing your memories...</div>
            <div className="typing-indicator" style={{ padding: '0.2rem 0' }}>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        ) : resurfaceError ? (
          <div className="glass-panel resurface-card" style={{ borderColor: 'var(--status-error)' }}>
            <div className="resurface-header" style={{ color: 'var(--status-error)' }}>Resurface Notice</div>
            <div className="resurface-body" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {resurfaceError}
            </div>
          </div>
        ) : resurfacedNote ? (
          <div className="glass-panel resurface-card">
            <div className="resurface-header">
              <span>💡 Resurfaced Memory</span>
              <div className="resurface-actions">
                <button className="resurface-btn" onClick={fetchResurfacedNote} title="Shuffle Resurfaced Note">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div className="resurface-body">
              &ldquo;{resurfacedNote.text}&rdquo;
            </div>
            <div className="resurface-meta">
              <span>Surfaced: {new Date(resurfacedNote.lastSurfaced).toLocaleTimeString()}</span>
              <span>Added: {new Date(resurfacedNote.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
        ) : (
          <div className="glass-panel resurface-card" style={{ background: 'transparent', borderStyle: 'dashed' }}>
            <div className="resurface-header" style={{ color: 'var(--text-muted)' }}>Memory Resurface</div>
            <div className="resurface-body" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Add at least 2 notes created more than 24 hours ago to unlock daily note resurfacing.
            </div>
          </div>
        )}
      </section>

      {/* Main App Grid */}
      <main className="main-grid">
        {/* Left Side: Note Ingestion Form */}
        <div className="glass-panel form-panel">
          <div>
            <h2 className="panel-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
              Memorize New Note
            </h2>
            <p className="app-subtitle" style={{ marginTop: '0.2rem' }}>Write thoughts, ideas, tasks, or reference docs below. They will be embedded and searchable.</p>
          </div>

          <form onSubmit={handleIngestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">
                <span>Note Content</span>
                <span className={`char-counter ${noteText.length > 3800 ? 'error' : noteText.length > 3500 ? 'warning' : ''}`}>
                  {noteText.length} / 4000 chars
                </span>
              </label>
              <textarea
                className="note-textarea"
                placeholder="Type your notes here... (e.g. 'My garage door keycode is 9872.' or 'The draft budget proposal for Q3 needs review by next Tuesday.')"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                maxLength={4100} // Keep slightly higher than 4000 to trigger server-side/client error validation tests
                disabled={isIngesting}
              />
            </div>

            {ingestStatus.message && (
              <div className={`banner banner-${ingestStatus.type}`}>
                <span className="banner-icon">{ingestStatus.type === 'success' ? '✓' : '⚠️'}</span>
                <span>{ingestStatus.message}</span>
              </div>
            )}

            <button 
              type="submit" 
              className="btn" 
              disabled={isIngesting || !noteText.trim() || noteText.length > 4000}
            >
              {isIngesting ? (
                <>
                  <svg style={{ animation: 'spin 1s linear infinite' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                  </svg>
                  Memorizing...
                </>
              ) : 'Store in SecondBrain'}
            </button>
          </form>
        </div>

        {/* Right Side: Chat Ask Interface */}
        <div className="glass-panel chat-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
            <div>
              <h2 className="panel-title" style={{ margin: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                Ask SecondBrain
              </h2>
            </div>
            <button className="resurface-btn" onClick={clearChat} title="Clear Chat History">
              Clear
            </button>
          </div>

          {/* Chat message display area */}
          <div className="chat-messages">
            {chatMessages.map((msg) => (
              <div 
                key={msg.id} 
                className={`chat-message ${msg.role === 'user' ? 'user' : msg.role === 'error' ? 'error-message' : 'ai'}`}
              >
                <div>{msg.text}</div>
                {msg.sourceNoteIds && msg.sourceNoteIds.length > 0 && (
                  <div className="source-badge-container">
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Sources:</span>
                    {msg.sourceNoteIds.map((id) => (
                      <span key={id} className="source-badge" title={`Database Key: ${id}`}>
                        {id.slice(0, 8)}...
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isAsking && (
              <div className="chat-message ai">
                <div className="typing-indicator">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Form */}
          <form onSubmit={handleAskSubmit} className="chat-input-form">
            <input
              type="text"
              className="chat-input"
              placeholder={apiUrl ? "Ask a question about your notes..." : "Please configure API URL first..."}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={isAsking || !apiUrl}
            />
            <button 
              type="submit" 
              className="chat-send-btn" 
              disabled={isAsking || !question.trim() || !apiUrl}
              title="Ask Question"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      </main>

      {/* Config Overlay Modal */}
      {isConfigOpen && (
        <div className="config-modal-overlay">
          <div className="glass-panel config-modal">
            <div className="modal-header">
              <h2 className="panel-title">Configure Backend URL</h2>
              {apiUrl && (
                <button className="modal-close" onClick={() => setIsConfigOpen(false)}>×</button>
              )}
            </div>
            
            <p className="modal-description">
              Please enter your AWS API Gateway HTTP API endpoint. 
              Example: <code>https://ab12cd34ef.execute-api.ap-south-1.amazonaws.com</code>
            </p>

            <form onSubmit={saveConfig} className="modal-form">
              <input
                type="url"
                required
                className="text-input"
                placeholder="https://xxxxxx.execute-api.ap-south-1.amazonaws.com"
                value={tempApiUrl}
                onChange={(e) => setTempApiUrl(e.target.value)}
              />

              <button type="submit" className="btn">
                Save and Connect
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

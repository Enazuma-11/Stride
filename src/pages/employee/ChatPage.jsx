import { useEffect, useState, useRef, useCallback } from 'react'
import AppShell from '../../components/layout/AppShell'
import { Avatar, Spinner } from '../../components/ui'
import { C, FONTS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  getChannels, createChannel, deleteChannel,
  getMyConversations, getOrCreateConversation,
  getChannelMessages, getConversationMessages,
  sendMessage, deleteMessage, toggleMessageReaction,
  uploadChatFile, CHAT_EMOJIS,
} from '../../lib/api.chat'
import { getAllEmployees } from '../../lib/api'

function timeLabel(date) {
  const d = new Date(date)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return `Yesterday ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Single message bubble ─────────────────────────────────────────────────────
function MessageBubble({ msg, isMe, employeeId, onDelete, onReact }) {
  const [showEmojis, setShowEmojis] = useState(false)
  const reactions = msg.reactions || {}
  const hasReactions = Object.keys(reactions).some(e => reactions[e]?.length > 0)

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, flexDirection: isMe ? 'row-reverse' : 'row' }}
      onMouseEnter={e => e.currentTarget.querySelector('.msg-actions')?.style && (e.currentTarget.querySelector('.msg-actions').style.opacity = '1')}
      onMouseLeave={e => e.currentTarget.querySelector('.msg-actions')?.style && (e.currentTarget.querySelector('.msg-actions').style.opacity = '0')}
    >
      {!isMe && <Avatar initials={msg.sender?.avatar_initials || '??'} size={30} src={msg.sender?.profile_photo_url} />}

      <div style={{ maxWidth: '70%', position: 'relative' }}>
        {!isMe && (
          <div style={{ fontSize: 11, fontWeight: 600, color: C.brand, marginBottom: 3, fontFamily: FONTS.display }}>
            {msg.sender?.full_name}
          </div>
        )}

        <div style={{
          padding: '9px 13px', borderRadius: isMe ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
          background: isMe ? C.brand : C.surface,
          color: isMe ? '#fff' : C.text,
          border: isMe ? 'none' : `1px solid ${C.border}`,
          boxShadow: C.shadow, fontSize: 13, lineHeight: 1.5,
        }}>
          {/* File attachment */}
          {msg.file_url && (
            <div style={{ marginBottom: msg.body ? 8 : 0 }}>
              {msg.file_type?.startsWith('image/') ? (
                <img src={msg.file_url} alt={msg.file_name} style={{ maxWidth: 240, borderRadius: 8, display: 'block' }} />
              ) : (
                <a href={msg.file_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: isMe ? 'rgba(255,255,255,0.15)' : C.bg, textDecoration: 'none', color: isMe ? '#fff' : C.brand }}>
                  <span>📎</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.file_name}</span>
                </a>
              )}
            </div>
          )}
          {msg.body && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.body}</div>}
        </div>

        {/* Reactions display */}
        {hasReactions && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
            {Object.entries(reactions).filter(([, ids]) => ids?.length > 0).map(([emoji, ids]) => (
              <button key={emoji} onClick={() => onReact(msg.id, emoji)} style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 12,
                border: `1px solid ${ids.includes(employeeId) ? C.brand : C.border}`,
                background: ids.includes(employeeId) ? C.brandLight : C.surface,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
              }}>
                {emoji} <span style={{ fontSize: 11, color: C.textMid }}>{ids.length}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: C.textLight, marginTop: 3, textAlign: isMe ? 'right' : 'left' }}>
          {timeLabel(msg.created_at)}
        </div>

        {/* Hover actions */}
        <div className="msg-actions" style={{
          position: 'absolute', top: 0, [isMe ? 'left' : 'right']: -80,
          display: 'flex', gap: 4, background: C.surface,
          borderRadius: 8, padding: '4px 6px', boxShadow: C.shadow,
          border: `1px solid ${C.border}`, opacity: 0, transition: 'opacity 0.15s',
          whiteSpace: 'nowrap',
        }}>
          <button onClick={() => setShowEmojis(!showEmojis)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 2 }}>😊</button>
          {isMe && <button onClick={() => onDelete(msg.id)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 2, color: '#ef444480' }}>🗑</button>}
        </div>

        {/* Emoji picker */}
        {showEmojis && (
          <div style={{
            position: 'absolute', top: 30, [isMe ? 'left' : 'right']: -100, zIndex: 100,
            background: C.surface, borderRadius: 12, padding: '8px',
            boxShadow: C.shadowMd, border: `1px solid ${C.border}`,
            display: 'flex', gap: 4,
          }}>
            {CHAT_EMOJIS.map(e => (
              <button key={e} onClick={() => { onReact(msg.id, e); setShowEmojis(false) }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4, borderRadius: 6 }}
                onMouseEnter={el => el.target.style.background = C.bg}
                onMouseLeave={el => el.target.style.background = 'none'}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message input bar ─────────────────────────────────────────────────────────
function MessageInput({ onSend, senderId }) {
  const [text,      setText]      = useState('')
  const [file,      setFile]      = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  async function handleSend() {
    if (!text.trim() && !file) return
    setUploading(true)
    try {
      let fileData = null
      if (file) {
        fileData = await uploadChatFile(file, senderId)
        setFile(null)
      }
      await onSend({ body: text.trim(), ...fileData ? { fileUrl: fileData.url, fileName: fileData.name, fileType: fileData.type } : {} })
      setText('')
    } finally { setUploading(false) }
  }

  return (
    <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: C.surface }}>
      {file && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: C.bg, borderRadius: 8, marginBottom: 8, fontSize: 12, color: C.text }}>
          <span>📎</span><span style={{ flex: 1 }}>{file.name}</span>
          <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.textLight, padding: '8px 4px', flexShrink: 0 }}>
          📎
        </button>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={1}
          placeholder="Type a message…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: `1.5px solid ${C.border}`, fontSize: 13,
            fontFamily: FONTS.body, outline: 'none', resize: 'none',
            background: C.bg, color: C.text, lineHeight: 1.4,
          }}
          onFocus={e => e.target.style.borderColor = C.teal}
          onBlur={e => e.target.style.borderColor = C.border}
        />
        <button onClick={handleSend} disabled={(!text.trim() && !file) || uploading}
          style={{
            width: 40, height: 40, borderRadius: 10, border: 'none', flexShrink: 0,
            background: (!text.trim() && !file) || uploading ? C.border : C.brand,
            color: '#fff', fontSize: 16, cursor: (!text.trim() && !file) || uploading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {uploading ? '…' : '➤'}
        </button>
      </div>
    </div>
  )
}

// ── Main Chat page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { employee, isHR } = useAuth()
  const [channels,      setChannels]      = useState([])
  const [conversations, setConversations] = useState([])
  const [allEmployees,  setAllEmployees]  = useState([])
  const [messages,      setMessages]      = useState([])
  const [activeChat,    setActiveChat]    = useState(null) // { type: 'channel'|'dm', id, name }
  const [loading,       setLoading]       = useState(true)
  const [showNewChannel,setShowNewChannel]= useState(false)
  const [showNewDM,     setShowNewDM]     = useState(false)
  const [newChName,     setNewChName]     = useState('')
  const [newChDesc,     setNewChDesc]     = useState('')
  const [dmSearch,      setDmSearch]      = useState('')
  const messagesEndRef = useRef()

  async function loadSidebar() {
    const [chs, convs, emps] = await Promise.all([
      getChannels(),
      getMyConversations(employee.id),
      getAllEmployees(),
    ])
    setChannels(chs)
    setConversations(convs)
    setAllEmployees(emps.filter(e => e.id !== employee.id))
    setLoading(false)
    if (!activeChat && chs.length > 0) setActiveChat({ type: 'channel', id: chs[0].id, name: chs[0].name })
  }

  async function loadMessages(chat) {
    if (!chat) return
    const msgs = chat.type === 'channel'
      ? await getChannelMessages(chat.id)
      : await getConversationMessages(chat.id)
    setMessages(msgs)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  useEffect(() => { if (employee) loadSidebar() }, [employee])
  useEffect(() => { if (activeChat) loadMessages(activeChat) }, [activeChat])

  // Realtime subscription
  useEffect(() => {
    if (!activeChat) return
    const sub = supabase.channel(`chat-${activeChat.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_messages',
        filter: activeChat.type === 'channel'
          ? `channel_id=eq.${activeChat.id}`
          : `conversation_id=eq.${activeChat.id}`
      }, () => loadMessages(activeChat))
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [activeChat?.id])

  async function handleSend({ body, fileUrl, fileName, fileType }) {
    await sendMessage({
      channelId:      activeChat.type === 'channel' ? activeChat.id : null,
      conversationId: activeChat.type === 'dm'      ? activeChat.id : null,
      senderId: employee.id,
      body, fileUrl, fileName, fileType,
    })
  }

  async function handleStartDM(emp) {
    const conv = await getOrCreateConversation(employee.id, emp.id)
    await loadSidebar()
    setActiveChat({ type: 'dm', id: conv.id, name: emp.full_name, avatar: emp.avatar_initials, photo: emp.profile_photo_url })
    setShowNewDM(false)
    setDmSearch('')
  }

  async function handleCreateChannel() {
    if (!newChName.trim()) return
    const ch = await createChannel({ name: newChName, description: newChDesc, createdBy: employee.id })
    await loadSidebar()
    setActiveChat({ type: 'channel', id: ch.id, name: ch.name })
    setShowNewChannel(false)
    setNewChName(''); setNewChDesc('')
  }

  const dmFiltered = allEmployees.filter(e =>
    !dmSearch || e.full_name.toLowerCase().includes(dmSearch.toLowerCase())
  )

  const chatHeight = 'calc(100vh - 180px)'

  return (
    <AppShell title="Chat" subtitle="Channels and direct messages">
      <div style={{ display: 'flex', gap: 0, height: chatHeight, background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: C.shadow }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ width: 240, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.surfaceAlt, flexShrink: 0 }}>
          {/* Channels */}
          <div style={{ padding: '14px 12px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase' }}>Channels</div>
              {isHR && (
                <button onClick={() => setShowNewChannel(!showNewChannel)} style={{ background: 'none', border: 'none', color: C.brand, fontSize: 16, cursor: 'pointer', padding: 0 }}>+</button>
              )}
            </div>

            {showNewChannel && (
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={newChName} onChange={e => setNewChName(e.target.value)} placeholder="channel-name"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, outline: 'none' }} />
                <input value={newChDesc} onChange={e => setNewChDesc(e.target.value)} placeholder="Description (optional)"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, outline: 'none' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleCreateChannel} style={{ flex: 1, padding: '6px', borderRadius: 7, border: 'none', background: C.brand, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Create</button>
                  <button onClick={() => setShowNewChannel(false)} style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'none', fontSize: 11, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            )}

            {channels.map(ch => (
              <button key={ch.id} onClick={() => setActiveChat({ type: 'channel', id: ch.id, name: ch.name })} style={{
                width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', textAlign: 'left',
                background: activeChat?.id === ch.id ? C.brandLight : 'transparent',
                color: activeChat?.id === ch.id ? C.brand : C.textMid,
                fontSize: 13, fontWeight: activeChat?.id === ch.id ? 600 : 400,
                cursor: 'pointer', display: 'block', marginBottom: 2,
              }}>
                # {ch.name}
              </button>
            ))}
          </div>

          {/* Direct messages */}
          <div style={{ padding: '8px 12px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, textTransform: 'uppercase' }}>Direct Messages</div>
              <button onClick={() => setShowNewDM(!showNewDM)} style={{ background: 'none', border: 'none', color: C.brand, fontSize: 16, cursor: 'pointer', padding: 0 }}>+</button>
            </div>

            {showNewDM && (
              <div style={{ marginBottom: 10 }}>
                <input value={dmSearch} onChange={e => setDmSearch(e.target.value)} placeholder="Search employee…"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, outline: 'none', marginBottom: 6 }} />
                <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                  {dmFiltered.map(emp => (
                    <button key={emp.id} onClick={() => handleStartDM(emp)} style={{
                      width: '100%', padding: '7px 8px', borderRadius: 8, border: 'none',
                      background: 'transparent', textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text,
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = C.bg}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <Avatar initials={emp.avatar_initials || '??'} size={22} src={emp.profile_photo_url} />
                      {emp.full_name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {conversations.map(conv => {
                const other = conv.member_one === employee.id ? conv.member_two_emp : conv.member_one_emp
                return (
                  <button key={conv.id} onClick={() => setActiveChat({ type: 'dm', id: conv.id, name: other?.full_name, avatar: other?.avatar_initials, photo: other?.profile_photo_url })} style={{
                    width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', textAlign: 'left',
                    background: activeChat?.id === conv.id ? C.brandLight : 'transparent',
                    color: activeChat?.id === conv.id ? C.brand : C.textMid,
                    fontSize: 13, fontWeight: activeChat?.id === conv.id ? 600 : 400,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2,
                  }}>
                    <Avatar initials={other?.avatar_initials || '??'} size={24} src={other?.profile_photo_url} />
                    {other?.full_name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── MAIN CHAT AREA ── */}
        {activeChat ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Chat header */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: C.surface, flexShrink: 0 }}>
              {activeChat.type === 'channel' ? (
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}># {activeChat.name}</div>
              ) : (
                <>
                  <Avatar initials={activeChat.avatar || '??'} size={32} src={activeChat.photo} />
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.display }}>{activeChat.name}</div>
                </>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={28} /></div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: C.textLight, fontSize: 13 }}>
                  {activeChat.type === 'channel' ? `Say hello in #${activeChat.name}! 👋` : `Start a conversation with ${activeChat.name}`}
                </div>
              ) : (
                messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isMe={msg.sender_id === employee?.id}
                    employeeId={employee?.id}
                    onDelete={async (id) => { await deleteMessage(id); loadMessages(activeChat) }}
                    onReact={async (id, emoji) => { await toggleMessageReaction(id, employee.id, emoji); loadMessages(activeChat) }}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <MessageInput onSend={handleSend} senderId={employee?.id} />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textLight, fontSize: 14 }}>
            Select a channel or start a conversation
          </div>
        )}
      </div>
    </AppShell>
  )
}

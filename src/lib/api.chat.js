import { supabase } from './supabase'

// ── Channels ──────────────────────────────────────────────────────────────────
export async function getChannels() {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .order('name')
  if (error) throw error
  return data || []
}

export async function createChannel({ name, description, createdBy }) {
  const clean = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const { data, error } = await supabase
    .from('chat_channels')
    .insert({ name: clean, description, created_by: createdBy })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteChannel(id) {
  const { error } = await supabase.from('chat_channels').delete().eq('id', id)
  if (error) throw error
}

// ── Direct messages ───────────────────────────────────────────────────────────
export async function getOrCreateConversation(myId, theirId) {
  // Ensure consistent ordering
  const [a, b] = [myId, theirId].sort()

  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('*')
    .or(`and(member_one.eq.${a},member_two.eq.${b})`)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ member_one: a, member_two: b })
    .select().single()
  if (error) throw error
  return data
}

export async function getMyConversations(employeeId) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select(`
      *,
      member_one_emp:member_one(id, full_name, avatar_initials, role, profile_photo_url),
      member_two_emp:member_two(id, full_name, avatar_initials, role, profile_photo_url)
    `)
    .or(`member_one.eq.${employeeId},member_two.eq.${employeeId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Messages ──────────────────────────────────────────────────────────────────
export async function getChannelMessages(channelId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`*, sender:sender_id(id, full_name, avatar_initials, profile_photo_url, role)`)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

export async function getConversationMessages(conversationId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`*, sender:sender_id(id, full_name, avatar_initials, profile_photo_url, role)`)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).reverse()
}

export async function sendMessage({ channelId, conversationId, senderId, body, fileUrl, fileName, fileType }) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id:      channelId      || null,
      conversation_id: conversationId || null,
      sender_id:       senderId,
      body:            body || null,
      file_url:        fileUrl   || null,
      file_name:       fileName  || null,
      file_type:       fileType  || null,
    })
    .select(`*, sender:sender_id(id, full_name, avatar_initials, profile_photo_url, role)`)
    .single()
  if (error) throw error
  return data
}

export async function deleteMessage(id) {
  const { error } = await supabase.from('chat_messages').delete().eq('id', id)
  if (error) throw error
}

export async function toggleMessageReaction(messageId, employeeId, emoji) {
  const { data: msg } = await supabase
    .from('chat_messages')
    .select('reactions')
    .eq('id', messageId)
    .single()

  const reactions = msg?.reactions || {}
  const current   = reactions[emoji] || []
  const hasReacted = current.includes(employeeId)

  reactions[emoji] = hasReacted
    ? current.filter(id => id !== employeeId)
    : [...current, employeeId]

  // Clean up empty arrays
  if (reactions[emoji].length === 0) delete reactions[emoji]

  const { error } = await supabase
    .from('chat_messages')
    .update({ reactions })
    .eq('id', messageId)
  if (error) throw error
  return reactions
}

export async function uploadChatFile(file, senderId) {
  const ext  = file.name.split('.').pop()
  const path = `chat/${senderId}/${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('employee-documents')
    .upload(path, file, { upsert: false })
  if (upErr) throw upErr

  const { data: signed } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(path, 60 * 60 * 24 * 30) // 30 days
  return { url: signed.signedUrl, name: file.name, type: file.type }
}

export const CHAT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

'use strict';

const { HighriseTypeError, ErrorCodes, HighrisejsError } = require("../../errors");
const { generateRid } = require("../../utils/Util");
const { ChatRequest, SendPayloadWithoutResponse } = require("../../utils/Models");

// ─────────────────────────────────────────────
// Shared splitter  →  used by PublicMessage/WhisperMessage (256) and DirectMessage (2000)
// ─────────────────────────────────────────────
function splitMessage(text, limit) {
  const chunks = [];
  let remaining = String(text).trim();

  while (remaining.length > limit) {
    // prefer breaking on the last newline within range
    let breakPoint = remaining.lastIndexOf('\n', limit);

    // otherwise prefer the last space within range
    if (breakPoint <= 0) breakPoint = remaining.lastIndexOf(' ', limit);

    // no good break point (one huge word) → hard cut
    if (breakPoint <= 0) breakPoint = limit;

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

const CHAT_CHUNK_LIMIT = 256;
const DM_CHUNK_LIMIT = 2000;

// ─────────────────────────────────────────────
// Public room chat  →  bot.message.send(text)
// ─────────────────────────────────────────────
class PublicMessage {
  constructor(bot) {
    this.bot = bot;
    this.rid = generateRid();
  }

  async send(message) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!message) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
      if (typeof message !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

      const sender = new SendPayloadWithoutResponse(this.bot);

      if (message.length > CHAT_CHUNK_LIMIT) {
        const parts = splitMessage(message, CHAT_CHUNK_LIMIT);
        let failed = 0;

        for (const part of parts) {
          try {
            const chatRequest = new ChatRequest(part, null, generateRid());
            const payload = { _type: "ChatRequest", ...chatRequest };
            await sender.sendPayloadWithoutResponse(payload);
          } catch {
            failed++;
          }
        }

        if (failed === parts.length) {
          throw new HighrisejsError(ErrorCodes.SendFailed || 'SEND_FAILED', 'All message parts failed to send in bot.message.send()');
        }
        return;
      }

      const chatRequest = new ChatRequest(message, null, this.rid);
      const payload = { _type: "ChatRequest", ...chatRequest };
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}

// ─────────────────────────────────────────────
// Whisper  →  bot.whisper.send(userId, text)
// ─────────────────────────────────────────────
class WhisperMessage {
  constructor(bot) {
    this.bot = bot;
    this.rid = generateRid();
  }

  async send(user_id, message) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!message) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
      if (user_id === this.bot.info.user.id) throw new HighriseTypeError(ErrorCodes.AccessDenied, 'user_id', "another user's");
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof message !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

      const sender = new SendPayloadWithoutResponse(this.bot);

      if (message.length > CHAT_CHUNK_LIMIT) {
        const parts = splitMessage(message, CHAT_CHUNK_LIMIT);
        let failed = 0;

        for (const part of parts) {
          try {
            const chatRequest = new ChatRequest(part, user_id, generateRid());
            const payload = { _type: "ChatRequest", ...chatRequest };
            await sender.sendPayloadWithoutResponse(payload);
          } catch {
            failed++;
          }
        }

        if (failed === parts.length) {
          throw new HighrisejsError(ErrorCodes.SendFailed || 'SEND_FAILED', 'All message parts failed to send in bot.whisper.send()');
        }
        return;
      }

      const chatRequest = new ChatRequest(message, user_id, this.rid);
      const payload = { _type: "ChatRequest", ...chatRequest };
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Direct Message  →  bot.direct.send()  /  bot.direct.sendBulk()
//
//   bot.direct.send(conversationId, message)
//     – single DM to one user (needs conversation ID)
//     – messages over 2000 chars are auto-chunked and sent in order
//
//   bot.direct.sendBulk(userIds, message)
//     – DM to up to 100 users at once (needs array of user IDs)
//     – messages over 2000 chars are auto-chunked and sent in order
// ─────────────────────────────────────────────────────────────────────
class DirectMessage {
  constructor(bot) {
    this.bot = bot;
    this.rid = generateRid();
  }

  async send(conversation_id, message) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!conversation_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
      if (!message) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
      if (typeof conversation_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
      if (typeof message !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

      const sender = new SendPayloadWithoutResponse(this.bot);

      if (message.length > DM_CHUNK_LIMIT) {
        const parts = splitMessage(message, DM_CHUNK_LIMIT);
        let failed = 0;

        for (const part of parts) {
          try {
            const payload = {
              _type: 'SendMessageRequest',
              conversation_id,
              content: part,
              type: 'text',
              room_id: null,
              rid: generateRid()
            };
            await sender.sendPayloadWithoutResponse(payload);
          } catch {
            failed++;
          }
        }

        if (failed === parts.length) {
          throw new HighrisejsError(ErrorCodes.SendFailed || 'SEND_FAILED', 'All message parts failed to send in bot.direct.send()');
        }
        return;
      }

      const payload = {
        _type: 'SendMessageRequest',
        conversation_id,
        content: message,
        type: 'text',
        room_id: null,
        rid: this.rid
      };

      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  async sendBulk(userIds, message) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
        throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)');
      if (userIds.length > 100)
        throw new Error('userIds exceeds the maximum of 100 users per bulk request.');
      if (!message) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
      if (typeof message !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

      const sender = new SendPayloadWithoutResponse(this.bot);

      if (message.length > DM_CHUNK_LIMIT) {
        const parts = splitMessage(message, DM_CHUNK_LIMIT);
        let failed = 0;

        for (const part of parts) {
          try {
            const payload = {
              _type: 'SendBulkMessageRequest',
              user_ids: userIds,
              content: part,
              type: 'text',
              rid: generateRid()
            };
            await sender.sendPayloadWithoutResponse(payload);
          } catch {
            failed++;
          }
        }

        if (failed === parts.length) {
          throw new HighrisejsError(ErrorCodes.SendFailed || 'SEND_FAILED', 'All message parts failed to send in bot.direct.sendBulk()');
        }
        return;
      }

      const payload = {
        _type: 'SendBulkMessageRequest',
        user_ids: userIds,
        content: message,
        type: 'text',
        rid: this.rid
      };

      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Invite  →  bot.invite
//
//   bot.invite.send(conversationId, roomId)    – single room invite
//   bot.invite.roomBulk(userIds, roomId)       – bulk room invite (max 100)
//   bot.invite.world(conversationId, worldId)  – single world invite
//   bot.invite.worldBulk(userIds, worldId)     – bulk world invite (max 100)
// ─────────────────────────────────────────────────────────────────────
class Invite {
  constructor(bot) {
    this.bot = bot;
    this.rid = generateRid();
  }

  // Single room invite  →  needs conversation_id
  async send(conversation_id, room_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!conversation_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
      if (!room_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'room_id');
      if (typeof conversation_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
      if (typeof room_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

      const payload = {
        _type: 'SendMessageRequest',
        conversation_id,
        content: '',
        type: 'invite',
        room_id,
        world_id: null,
        rid: this.rid
      };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  // Bulk room invite  →  needs array of user IDs (max 100)
  async roomBulk(userIds, room_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
        throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)');
      if (userIds.length > 100)
        throw new Error('userIds exceeds the maximum of 100 users per bulk invite request.');
      if (!room_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'room_id');
      if (typeof room_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

      const payload = {
        _type: 'SendBulkMessageRequest',
        user_ids: userIds,
        content: '',
        type: 'invite',
        room_id,
        world_id: null,
        rid: this.rid
      };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  // Single world invite  →  needs conversation_id
  async world(conversation_id, world_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!conversation_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
      if (!world_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'world_id');
      if (typeof conversation_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
      if (typeof world_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string');

      const payload = {
        _type: 'SendMessageRequest',
        conversation_id,
        content: '',
        type: 'invite',
        room_id: null,
        world_id,
        rid: this.rid
      };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  // Bulk world invite  →  needs array of user IDs (max 100)
  async worldBulk(userIds, world_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
        throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)');
      if (userIds.length > 100)
        throw new Error('userIds exceeds the maximum of 100 users per bulk invite request.');
      if (!world_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'world_id');
      if (typeof world_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string');

      const payload = {
        _type: 'SendBulkMessageRequest',
        user_ids: userIds,
        content: '',
        type: 'invite',
        room_id: null,
        world_id,
        rid: this.rid
      };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = {
  PublicMessage,
  WhisperMessage,
  Invite,
  DirectMessage
};
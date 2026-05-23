// ════════════════════════════════════════════════════════════════════════════
//  MessagesRequest.js  —  highrise-sdk-adi
//  Messaging layer: single DM, whisper, room invite, world invite,
//  bulk DM, bulk room invite, bulk world invite, batch invite+message.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const { HighriseTypeError, ErrorCodes, HighrisejsError } = require('../../errors');
const { generateRid }                                    = require('../../utils/Util');
const {
  ChatRequest,
  SendPayloadWithoutResponse,
}                                                        = require('../../utils/Models');

// ─────────────────────────────────────────────────────────────────────────────
//  Internal constants
// ─────────────────────────────────────────────────────────────────────────────

const BULK_HARD_LIMIT      = 100;   // Highrise API cap per bulk request
const INTER_CHUNK_DELAY_MS = 120;   // pause between consecutive bulk calls
const MSG_INVITE_GAP_MS    = 80;    // pause between message and invite in same batch

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function _chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function _validateUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0)
    return 'userIds must be a non-empty array';
  if (userIds.length > 10_000)
    return 'userIds exceeds maximum of 10,000 (auto-chunked at 100 per request)';
  const bad = userIds.filter(id => typeof id !== 'string' || !id.trim());
  if (bad.length > 0)
    return `userIds contains ${bad.length} invalid entr${bad.length === 1 ? 'y' : 'ies'} (must be non-empty strings)`;
  return null;
}

async function _sendPayload(bot, payload) {
  if (!bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
  const sender = new SendPayloadWithoutResponse(bot);
  await sender.sendPayloadWithoutResponse({ ...payload, rid: payload.rid || generateRid() });
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. PublicMessage
// ─────────────────────────────────────────────────────────────────────────────

class PublicMessage {
  constructor(bot) { this.bot = bot; }

  async send(message) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!message)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
    if (typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

    const chatRequest = new ChatRequest(message, null, generateRid());
    await _sendPayload(this.bot, { _type: 'ChatRequest', ...chatRequest });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. WhisperMessage
// ─────────────────────────────────────────────────────────────────────────────

class WhisperMessage {
  constructor(bot) { this.bot = bot; }

  async send(user_id, message) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!user_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
    if (!message)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
    if (user_id === this.bot.info.user.id)
      throw new HighriseTypeError(ErrorCodes.AccessDenied, 'user_id', "another user's");
    if (typeof user_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
    if (typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

    const chatRequest = new ChatRequest(message, user_id, generateRid());
    await _sendPayload(this.bot, { _type: 'ChatRequest', ...chatRequest });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. DirectMessage
// ─────────────────────────────────────────────────────────────────────────────

class DirectMessage {
  constructor(bot) { this.bot = bot; }

  async send(conversation_id, message) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!conversation_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
    if (!message)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'message');
    if (typeof conversation_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
    if (typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

    await _sendPayload(this.bot, {
      _type:           'SendMessageRequest',
      conversation_id,
      content:         message,
      type:            'text',
      room_id:         null,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. Invite
// ─────────────────────────────────────────────────────────────────────────────

class Invite {
  constructor(bot) { this.bot = bot; }

  async sendRoom(conversation_id, room_id) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!conversation_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
    if (!room_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'room_id');
    if (typeof conversation_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
    if (typeof room_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

    await _sendPayload(this.bot, {
      _type: 'SendMessageRequest', conversation_id,
      content: '', type: 'invite', room_id,
    });
  }

  async sendWorld(conversation_id, world_id) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!conversation_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'conversation_id');
    if (!world_id)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'world_id');
    if (typeof conversation_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string');
    if (typeof world_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string');

    await _sendPayload(this.bot, {
      _type: 'SendMessageRequest', conversation_id,
      content: '', type: 'invite', world_id,
    });
  }

  async send(conversation_id, room_id) {
    return this.sendRoom(conversation_id, room_id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. BulkMessage
// ─────────────────────────────────────────────────────────────────────────────

class BulkMessage {
  constructor(bot) { this.bot = bot; }

  async send(userIds, message, opts = {}) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);

    const idErr = _validateUserIds(userIds);
    if (idErr) throw new HighriseTypeError(ErrorCodes.MissingParameters, idErr);
    if (!message || typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

    const { chunkDelay = INTER_CHUNK_DELAY_MS, onProgress = null } = opts;
    const chunks = _chunk(userIds, BULK_HARD_LIMIT);
    let sent = 0, failed = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        await _sendPayload(this.bot, {
  _type: 'SendBulkMessageRequest',
  user_ids: chunks[i],
  type: 'invite',
  room_id:  destination.room_id  || null,
  world_id: destination.world_id || null,
});
        sent += chunks[i].length;
      } catch (err) {
        failed += chunks[i].length;
        console.error(`[BulkMessage] Chunk ${i + 1}/${chunks.length} failed:`, err.message);
      }

      if (typeof onProgress === 'function')
        onProgress({ chunk: i + 1, totalChunks: chunks.length, sent, failed, total: userIds.length });

      if (i < chunks.length - 1) await _sleep(chunkDelay);
    }

    return { ok: failed === 0, sent, failed, total: userIds.length, chunks: chunks.length };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  6. BulkInvite
// ─────────────────────────────────────────────────────────────────────────────

class BulkInvite {
  constructor(bot) { this.bot = bot; }

  async sendRoom(userIds, room_id, opts = {}) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);

    const idErr = _validateUserIds(userIds);
    if (idErr) throw new HighriseTypeError(ErrorCodes.MissingParameters, idErr);
    if (!room_id || typeof room_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

    return this._sendBulk(userIds, { room_id }, opts);
  }

  async sendWorld(userIds, world_id, opts = {}) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);

    const idErr = _validateUserIds(userIds);
    if (idErr) throw new HighriseTypeError(ErrorCodes.MissingParameters, idErr);
    if (!world_id || typeof world_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string');

    return this._sendBulk(userIds, { world_id }, opts);
  }

  async send(userIds, room_id, opts = {}) {
    return this.sendRoom(userIds, room_id, opts);
  }

  async _sendBulk(userIds, destination, opts = {}) {
    const { chunkDelay = INTER_CHUNK_DELAY_MS, onProgress = null } = opts;
    const chunks = _chunk(userIds, BULK_HARD_LIMIT);
    let sent = 0, failed = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        await _sendPayload(this.bot, {
  _type: 'SendBulkMessageRequest',
  user_ids: batch,
  type: 'invite',
  room_id:  destination.room_id  || null,
  world_id: destination.world_id || null,
});
        sent += chunks[i].length;
      } catch (err) {
        failed += chunks[i].length;
        console.error(`[BulkInvite] Chunk ${i + 1}/${chunks.length} failed:`, err.message);
      }

      if (typeof onProgress === 'function')
        onProgress({ chunk: i + 1, totalChunks: chunks.length, sent, failed, total: userIds.length });

      if (i < chunks.length - 1) await _sleep(chunkDelay);
    }

    return { ok: failed === 0, sent, failed, total: userIds.length, chunks: chunks.length };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  7. BatchInviteWithMessage
// ─────────────────────────────────────────────────────────────────────────────

class BatchInviteWithMessage {
  constructor(bot) { this.bot = bot; }

  async sendRoom(userIds, message, room_id, opts = {}) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);

    const idErr = _validateUserIds(userIds);
    if (idErr) throw new HighriseTypeError(ErrorCodes.MissingParameters, idErr);
    if (!message || typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');
    if (!room_id || typeof room_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

    return this._sendBatch(userIds, message, { room_id }, opts);
  }

  async sendWorld(userIds, message, world_id, opts = {}) {
    if (!this.bot.isWebSocketOpen())
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);

    const idErr = _validateUserIds(userIds);
    if (idErr) throw new HighriseTypeError(ErrorCodes.MissingParameters, idErr);
    if (!message || typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');
    if (!world_id || typeof world_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string');

    return this._sendBatch(userIds, message, { world_id }, opts);
  }

  async send(userIds, message, room_id, opts = {}) {
    return this.sendRoom(userIds, message, room_id, opts);
  }

  async _sendBatch(userIds, message, destination, opts = {}) {
    const {
      chunkDelay     = INTER_CHUNK_DELAY_MS,
      msgInviteDelay = MSG_INVITE_GAP_MS,
      onProgress     = null,
    } = opts;

    const chunks = _chunk(userIds, BULK_HARD_LIMIT);
    let msgSent = 0, msgFailed = 0, inviteSent = 0, inviteFailed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];

      try {
        await _sendPayload(this.bot, {
          _type: 'SendBulkMessageRequest', user_ids: batch,
          content: message, type: 'text',
        });
        msgSent += batch.length;
      } catch (err) {
        msgFailed += batch.length;
        console.error(`[BatchInviteWithMessage] Msg chunk ${i + 1}/${chunks.length} failed:`, err.message);
      }

      await _sleep(msgInviteDelay);

      try {
        await _sendPayload(this.bot, {
          _type: 'SendBulkMessageRequest', user_ids: batch,
          content: '', type: 'invite',
          room_id:  destination.room_id  || null,
          world_id: destination.world_id || null,
        });
        inviteSent += batch.length;
      } catch (err) {
        inviteFailed += batch.length;
        console.error(`[BatchInviteWithMessage] Invite chunk ${i + 1}/${chunks.length} failed:`, err.message);
      }

      if (typeof onProgress === 'function') {
        onProgress({
          chunk: i + 1, totalChunks: chunks.length, batchSize: batch.length,
          msgSent, msgFailed, inviteSent, inviteFailed, total: userIds.length,
        });
      }

      if (i < chunks.length - 1) await _sleep(chunkDelay);
    }

    return {
      ok: msgFailed === 0 && inviteFailed === 0,
      msgSent, msgFailed, inviteSent, inviteFailed,
      total: userIds.length, chunks: chunks.length,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  PublicMessage,
  WhisperMessage,
  DirectMessage,
  Invite,
  BulkMessage,
  BulkInvite,
  BatchInviteWithMessage,
};

'use strict';

const { HighriseTypeError, ErrorCodes, HighrisejsError } = require("../../errors");
const { generateRid } = require("../../utils/Util");
const { ChatRequest, SendPayloadWithoutResponse, SendPayloadAndGetResponse } = require("../../utils/Models");


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

      const chatRequest = new ChatRequest(message, null, this.rid);
      const payload = { _type: "ChatRequest", ...chatRequest };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}


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

      const chatRequest = new ChatRequest(message, user_id, this.rid);
      const payload = { _type: "ChatRequest", ...chatRequest };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}


class Invite {
  constructor(bot) {
    this.bot = bot;
    this.rid = generateRid();
  }

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
        rid: this.rid
      };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}


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

      const payload = {
        _type: 'SendMessageRequest',
        conversation_id,
        content: message,
        type: 'text',
        room_id: null,
        rid: this.rid
      };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }
}

// ─────────────────────────────────────────────
//  NEW: Bulk DM — sends the same message to up to 100 users at once
//  Uses SendBulkMessageRequest (matches Actions.js broadcast pattern)
//
//  Usage:
//    const bulk = new BulkMessage(bot);
//    await bulk.send(['dataId1', 'dataId2', ...], 'Hello!');
//
//  • userIds  — string[]  (1–100 user dataIds / conversation IDs)
//  • message  — string
//  Returns: { ok: boolean, failed: number, total: number }
// ─────────────────────────────────────────────
const BULK_CHUNK_SIZE = 100;   
const BULK_INTER_CHUNK_DELAY_MS = 200;  

class BulkMessage {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Send the same message to many users.
   * Automatically splits into chunks of 100.
   *
   * @param {string[]} userIds   — array of dataIds (conversation IDs)
   * @param {string}   message
   * @returns {{ ok: boolean, sent: number, failed: number, total: number }}
   */
  async send(userIds, message) {
    if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!Array.isArray(userIds) || userIds.length === 0)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds');
    if (!message || typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');

    const chunks = _chunk(userIds, BULK_CHUNK_SIZE);
    let sent = 0, failed = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const payload = {
          _type: 'SendBulkMessageRequest',
          user_ids: chunks[i],
          content: message,
          type: 'text',
          rid: generateRid()
        };
        const sender = new SendPayloadWithoutResponse(this.bot);
        await sender.sendPayloadWithoutResponse(payload);
        sent += chunks[i].length;
      } catch {
        failed += chunks[i].length;
      }


      if (i < chunks.length - 1) await _sleep(BULK_INTER_CHUNK_DELAY_MS);
    }

    return { ok: failed === 0, sent, failed, total: userIds.length };
  }
}

// ─────────────────────────────────────────────
//  NEW: Bulk Invite — sends room invite to up to 100 users at once
//
//  Usage:
//    const bulkInvite = new BulkInvite(bot);
//    await bulkInvite.send(['dataId1', 'dataId2', ...], 'roomId');
//
//  • userIds  — string[]  (1–100)
//  • room_id  — string
//  Returns: { ok: boolean, sent: number, failed: number, total: number }
// ─────────────────────────────────────────────
class BulkInvite {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Send the same room invite to many users.
   * Automatically splits into chunks of 100.
   *
   * @param {string[]} userIds
   * @param {string}   room_id
   * @returns {{ ok: boolean, sent: number, failed: number, total: number }}
   */
  async send(userIds, room_id) {
    if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!Array.isArray(userIds) || userIds.length === 0)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds');
    if (!room_id || typeof room_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

    const chunks = _chunk(userIds, BULK_CHUNK_SIZE);
    let sent = 0, failed = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const payload = {
          _type: 'SendBulkMessageRequest',
          user_ids: chunks[i],
          content: '',
          type: 'invite',
          room_id,
          world_id: null,
          rid: generateRid()
        };
        const sender = new SendPayloadWithoutResponse(this.bot);
        await sender.sendPayloadWithoutResponse(payload);
        sent += chunks[i].length;
      } catch {
        failed += chunks[i].length;
      }

      if (i < chunks.length - 1) await _sleep(BULK_INTER_CHUNK_DELAY_MS);
    }

    return { ok: failed === 0, sent, failed, total: userIds.length };
  }
}

// ─────────────────────────────────────────────
//  NEW: BatchInviteWithMessage
//  The "super-fast" mode:
//    For each chunk of 100:
//      1. Fire bulk message  (SendBulkMessageRequest type=text)
//      2. Fire bulk invite   (SendBulkMessageRequest type=invite)
//    Then move to next chunk.
//
//  This is the pattern you described:
//  "send message in batch → invite same batch → next batch"
//
//  Usage:
//    const bim = new BatchInviteWithMessage(bot);
//    const result = await bim.send(userIds, message, roomId, {
//      chunkSize: 100,       // default 100
//      chunkDelay: 150,      // ms between chunks (default 150)
//      msgInviteDelay: 80,   // ms between msg and invite within same chunk (default 80)
//      onProgress: ({ chunk, total, sent, failed }) => {}  // optional
//    });
// ─────────────────────────────────────────────
class BatchInviteWithMessage {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * @param {string[]} userIds
   * @param {string}   message
   * @param {string}   room_id
   * @param {object}   [opts]
   * @param {number}   [opts.chunkSize=100]
   * @param {number}   [opts.chunkDelay=150]
   * @param {number}   [opts.msgInviteDelay=80]
   * @param {Function} [opts.onProgress]
   * @returns {{ ok, msgSent, msgFailed, inviteSent, inviteFailed, total, chunks }}
   */
  async send(userIds, message, room_id, opts = {}) {
    if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    if (!Array.isArray(userIds) || userIds.length === 0)
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'userIds');
    if (!message || typeof message !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'message', 'string');
    if (!room_id || typeof room_id !== 'string')
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

    const {
      chunkSize      = BULK_CHUNK_SIZE,
      chunkDelay     = BULK_INTER_CHUNK_DELAY_MS,
      msgInviteDelay = 80,
      onProgress     = null,
    } = opts;

    const chunks = _chunk(userIds, Math.min(chunkSize, 100)); // cap at 100
    let msgSent = 0, msgFailed = 0, inviteSent = 0, inviteFailed = 0;
    const sender = new SendPayloadWithoutResponse(this.bot);

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];


      try {
        await sender.sendPayloadWithoutResponse({
          _type: 'SendBulkMessageRequest',
          user_ids: batch,
          content: message,
          type: 'text',
          rid: generateRid()
        });
        msgSent += batch.length;
      } catch {
        msgFailed += batch.length;
      }


      await _sleep(msgInviteDelay);


      try {
        await sender.sendPayloadWithoutResponse({
          _type: 'SendBulkMessageRequest',
          user_ids: batch,
          content: '',
          type: 'invite',
          room_id,
          world_id: null,
          rid: generateRid()
        });
        inviteSent += batch.length;
      } catch {
        inviteFailed += batch.length;
      }


      if (typeof onProgress === 'function') {
        onProgress({
          chunk: i + 1,
          totalChunks: chunks.length,
          batchSize: batch.length,
          msgSent,
          msgFailed,
          inviteSent,
          inviteFailed,
          total: userIds.length
        });
      }


      if (i < chunks.length - 1) await _sleep(chunkDelay);
    }

    return {
      ok: msgFailed === 0 && inviteFailed === 0,
      msgSent, msgFailed,
      inviteSent, inviteFailed,
      total: userIds.length,
      chunks: chunks.length
    };
  }
}

function _chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {

  PublicMessage,
  WhisperMessage,
  Invite,
  DirectMessage,
  BulkMessage,          
  BulkInvite,           
  BatchInviteWithMessage 
};

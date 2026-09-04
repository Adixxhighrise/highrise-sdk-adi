'use strict';

const { AdiBotTypeError, ErrorCodes, AdiBotjsError } = require("../../errors");
const { generateRid } = require("../../utils/Util");
const { ChatRequest, SendPayloadWithoutResponse } = require("../../utils/Models");
const BotResult = require("../../utils/BotResult");

const MESSAGE_LIMIT = 256;

function splitText(text, limit = MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let at = remaining.lastIndexOf(' ', limit);
    if (at === -1) at = limit;
    chunks.push(remaining.slice(0, at).trimEnd());
    remaining = remaining.slice(at).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

class PublicMessage {
  constructor(bot) { this.bot = bot; this.rid = generateRid(); }

  async send(message) {
    if (!message)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'message'));
    if (typeof message !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'message', 'string'));
    try {
      // guard.wrap already applies rate-limit; _sendChunks must NOT call rateLimit again
      if (this.bot.guard) await this.bot.guard.wrap(() => this._sendChunks(message));
      else {
        await this.bot.rateLimit?.client();
        await this._sendChunks(message);
      }
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async _sendChunks(message) {
    if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
    const chunks = splitText(message);
    const sender = new SendPayloadWithoutResponse(this.bot);
    for (let i = 0; i < chunks.length; i++) {
      // Rate-limit is already applied by QueueManager/guard — do NOT double-acquire here
      await sender.sendPayloadWithoutResponse({ _type: 'ChatRequest', ...new ChatRequest(chunks[i], null, this.rid) });
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
  }
}

class WhisperMessage {
  constructor(bot) { this.bot = bot; this.rid = generateRid(); }

  async send(user_id, message) {
    if (!user_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'user_id'));
    if (!message)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'message'));
    if (typeof user_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string'));
    if (typeof message !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'message', 'string'));
    try {
      if (this.bot.guard) await this.bot.guard.wrap(() => this._sendChunks(user_id, message));
      else {
        await this.bot.rateLimit?.client();
        await this._sendChunks(user_id, message);
      }
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async _sendChunks(user_id, message) {
    if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
    if (user_id === this.bot.info.user.id)
      throw new AdiBotTypeError(ErrorCodes.AccessDenied, 'user_id', "another user's");
    const chunks = splitText(message);
    const sender = new SendPayloadWithoutResponse(this.bot);
    for (let i = 0; i < chunks.length; i++) {
      await sender.sendPayloadWithoutResponse({ _type: 'ChatRequest', ...new ChatRequest(chunks[i], user_id, this.rid) });
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
  }
}

class DirectMessage {
  constructor(bot) { this.bot = bot; this.rid = generateRid(); }

  async send(conversation_id, message) {
    if (!conversation_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'conversation_id'));
    if (!message)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'message'));
    if (typeof conversation_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string'));
    if (typeof message !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'message', 'string'));
    try {
      if (this.bot.guard) await this.bot.guard.wrap(() => this._sendDirect(conversation_id, message));
      else await this._sendDirect(conversation_id, message);
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async _sendDirect(conversation_id, message) {
    if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
    await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
      _type: 'SendMessageRequest', conversation_id, content: message, type: 'text', room_id: null, rid: this.rid
    });
  }

  async sendBulk(userIds, message) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)'));
    if (userIds.length > 100)
      return BotResult.fail(new Error('userIds exceeds the maximum of 100 users per bulk request.'));
    if (!message)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'message'));
    if (typeof message !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'message', 'string'));
    try {
      if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
      await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
        _type: 'SendBulkMessageRequest', user_ids: userIds, content: message, type: 'text', rid: this.rid
      });
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }
}

class Invite {
  constructor(bot) { this.bot = bot; this.rid = generateRid(); }

  async send(conversation_id, room_id) {
    if (!conversation_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'conversation_id'));
    if (!room_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'room_id'));
    if (typeof conversation_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string'));
    if (typeof room_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string'));
    try {
      if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
      await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
        _type: 'SendMessageRequest', conversation_id, content: '', type: 'invite', room_id, world_id: null, rid: this.rid
      });
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async roomBulk(userIds, room_id) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)'));
    if (userIds.length > 100)
      return BotResult.fail(new Error('userIds exceeds the maximum of 100 users per bulk invite request.'));
    if (!room_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'room_id'));
    if (typeof room_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string'));
    try {
      if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
      await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
        _type: 'SendBulkMessageRequest', user_ids: userIds, content: '', type: 'invite', room_id, world_id: null, rid: this.rid
      });
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async world(conversation_id, world_id) {
    if (!conversation_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'conversation_id'));
    if (!world_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'world_id'));
    if (typeof conversation_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'conversation_id', 'string'));
    if (typeof world_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string'));
    try {
      if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
      await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
        _type: 'SendMessageRequest', conversation_id, content: '', type: 'invite', room_id: null, world_id, rid: this.rid
      });
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }

  async worldBulk(userIds, world_id) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'userIds (must be a non-empty array)'));
    if (userIds.length > 100)
      return BotResult.fail(new Error('userIds exceeds the maximum of 100 users per bulk invite request.'));
    if (!world_id)
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.MissingParameters, 'world_id'));
    if (typeof world_id !== 'string')
      return BotResult.fail(new AdiBotTypeError(ErrorCodes.InvalidParameterType, 'world_id', 'string'));
    try {
      if (!this.bot.isWebSocketOpen()) throw new AdiBotjsError(ErrorCodes.WebSocketNotOpen);
      await new SendPayloadWithoutResponse(this.bot).sendPayloadWithoutResponse({
        _type: 'SendBulkMessageRequest', user_ids: userIds, content: '', type: 'invite', room_id: null, world_id, rid: this.rid
      });
      return BotResult.success();
    } catch (err) { return BotResult.fail(err); }
  }
}

module.exports = { PublicMessage, WhisperMessage, Invite, DirectMessage };
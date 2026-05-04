'use strict';


const { HighriseTypeError, ErrorCodes, HighrisejsError } = require('highrise-sdk-adi/src/errors');
const { generateRid } = require('highrise-sdk-adi/src/utils/Rid');
const {
  SendPayloadWithoutResponse,
  ReactionRequest,
  TipUserRequest,
  SendPayloadAndGetResponse,
  Position,
  TeleportRequest,
  MoveUserToRoomRequest,
  InviteSpeakerRequest,
  RemoveSpeakerRequest,
  ModerateRoomRequest,
  GetRoomPrivilegeRequest,
  GetUserOutfitRequest,
} = require('highrise-sdk-adi/src/utils/Models');

class FixedUsers {
  constructor(bot) {
    this.bot = bot;
  }


  /**
   * Play an emote — signature and wire format match highrise.bot exactly:
   *   bot.player.emote(emoteId)               → plays on bot's session; no target_user_id sent
   *   bot.player.emote(emoteId, targetUserId)  → targets another user
   *
   * Wire format when no target (matches highrise.bot JSON.stringify output):
   *   { "_type": "EmoteRequest", "emote_id": "...", "rid": "..." }
   *   target_user_id is omitted; server plays emote on the requesting session.
   *
   * Wire format with target:
   *   { "_type": "EmoteRequest", "emote_id": "...", "target_user_id": "...", "rid": "..." }
   *
   * @param {string} emoteId
   * @param {string} [targetUserId]
   */
  async emote(emoteId, targetUserId) {
    if (!this.bot.isWebSocketOpen()) {
      throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
    }

    if (!emoteId || typeof emoteId !== 'string') {
      throw new HighriseTypeError(ErrorCodes.MissingParameters, 'emoteId');
    }

    if (targetUserId !== undefined && typeof targetUserId !== 'string') {
      throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'targetUserId', 'string');
    }

    const rid = generateRid();

    // target_user_id: targetUserId → undefined when not given, so JSON.stringify
    // drops the field, producing the same wire bytes as highrise.bot.
    const payload = {
      _type: 'EmoteRequest',
      emote_id: emoteId,
      target_user_id: targetUserId,
      rid,
    };

    const sender = new SendPayloadWithoutResponse(this.bot);
    await sender.sendPayloadWithoutResponse(payload);
  }

  /**
   * Safe emote with automatic error handling and retry logic.
   * Never throws. On all retries exhausted, logs to console and returns false.
   *
   * @param {string} emoteId
   * @param {string} [targetUserId]
   * @param {object} [options]
   * @param {number} [options.retries=2]      - Extra retry attempts after first failure
   * @param {number} [options.retryDelay=500] - Delay in ms between retries
   * @returns {Promise<boolean>} true on success, false on all-retry failure
   */
  async emoteSafe(emoteId, targetUserId, { retries = 2, retryDelay = 500 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.emote(emoteId, targetUserId);
        return true;
      } catch (err) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelay));
        } else {
          console.error(
            `[emoteSafe] Failed to play emote "${emoteId}" after ${retries + 1} attempt(s): ${err.message}`
          );
        }
      }
    }
    return false;
  }

  // ─── ALL ORIGINAL METHODS (UNCHANGED) ──────────────────────────────────────

  async react(user_id, reaction_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!reaction_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'reaction_id');

      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof reaction_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'reaction_id', 'string');

      if (user_id === this.bot.info.user.id) throw new HighrisejsError(ErrorCodes.AccessDenied, 'user_id', "another user's");

      const reactions = ['clap', 'heart', 'thumbs', 'wave', 'wink'];
      if (!reactions.includes(reaction_id)) throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'reaction_id', 'clap, heart, thumbs, wave, wink');

      const rid = generateRid();
      const reactionRequest = new ReactionRequest(user_id, reaction_id, rid);
      const payload = { _type: 'ReactionRequest', ...reactionRequest };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  async tip(user_id, amount) {
    try {
      const BARS = {
        1: 'gold_bar_1', 5: 'gold_bar_5', 10: 'gold_bar_10', 50: 'gold_bar_50',
        100: 'gold_bar_100', 500: 'gold_bar_500', 1000: 'gold_bar_1k',
        5000: 'gold_bar_5000', 10000: 'gold_bar_10k',
      };

      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!amount) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'amount');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof amount !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'amount', 'number');
      if (user_id === this.bot.info.user.id) throw new HighrisejsError(ErrorCodes.AccessDenied, 'user_id', "another user's");

      const rid = generateRid();
      const tipRequest = new TipUserRequest(user_id, BARS[amount], rid);
      const payload = { _type: 'TipUserRequest', ...tipRequest };

      const sender = new SendPayloadAndGetResponse(this.bot);
      const response = await sender.sendPayloadAndGetResponse(payload, TipUserRequest.Response);
      return response.result.result;
    } catch (error) {
      throw error;
    }
  }

  async teleport(user_id, x, y, z, facing = 'FrontRight') {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      const validFacing = ['BackLeft', 'BackRight', 'FrontLeft', 'FrontRight'];
      if (!user_id) user_id = this.bot.info.user.id;
      if (x === undefined || x === null || y === undefined || y === null || z === undefined || z === null) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'x, y, z');
      if (!validFacing.includes(facing)) throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'facing', 'BackLeft, BackRight, FrontLeft, FrontRight');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof x !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'x', 'number');
      if (typeof y !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'y', 'number');
      if (typeof z !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'z', 'number');

      const dest = new Position(x, y, z, facing);
      const rid = generateRid();
      const teleportRequest = new TeleportRequest(user_id, dest, rid);
      const request = { _type: 'TeleportRequest', ...teleportRequest };

      if (this.bot.Cache) {
        this.bot.room.cache.updateUserPosition(user_id, { x, y, z, facing });
      }

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(request);
    } catch (error) {
      throw error;
    }
  }

  async transport(user_id, room_id) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!room_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'room_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof room_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'room_id', 'string');

      const rid = generateRid();
      const transportRequest = new MoveUserToRoomRequest(user_id, room_id, rid);
      const request = { _type: 'MoveUserToRoomRequest', ...transportRequest };

      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(request);
    } catch (error) {
      throw error;
    }
  }

  voice = {
    add: async (user_id) => {
      try {
        if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
        if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
        if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');

        const rid = generateRid();
        const addVoiceRequest = new InviteSpeakerRequest(user_id, rid);
        const request = { _type: 'InviteSpeakerRequest', ...addVoiceRequest };

        const sender = new SendPayloadWithoutResponse(this.bot);
        await sender.sendPayloadWithoutResponse(request);
      } catch (error) {
        throw error;
      }
    },

    remove: async (user_id) => {
      try {
        if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
        if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
        if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');

        const rid = generateRid();
        const removeVoiceRequest = new RemoveSpeakerRequest(user_id, rid);
        const request = { _type: 'RemoveSpeakerRequest', ...removeVoiceRequest };

        const sender = new SendPayloadWithoutResponse(this.bot);
        await sender.sendPayloadWithoutResponse(request);
      } catch (error) {
        throw error;
      }
    },
  };

  async moderateRoom(request) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      const payload = { _type: 'ModerateRoomRequest', ...request };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  async kick(user_id) {
    try {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.moderateRoom(new ModerateRoomRequest(user_id, 'kick', null, generateRid()));
    } catch (error) {
      throw error;
    }
  }

  async ban(user_id, seconds) {
    try {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!seconds) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'seconds');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof seconds !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'seconds', 'number');
      await this.moderateRoom(new ModerateRoomRequest(user_id, 'ban', seconds, generateRid()));
    } catch (error) {
      throw error;
    }
  }

  async mute(user_id, seconds) {
    try {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (!seconds) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'seconds');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      if (typeof seconds !== 'number') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'seconds', 'number');
      await this.moderateRoom(new ModerateRoomRequest(user_id, 'mute', seconds, generateRid()));
    } catch (error) {
      throw error;
    }
  }

  async unban(user_id) {
    try {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.moderateRoom(new ModerateRoomRequest(user_id, 'unban', null, generateRid()));
    } catch (error) {
      throw error;
    }
  }

  async unmute(user_id) {
    try {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.moderateRoom(new ModerateRoomRequest(user_id, 'mute', 1, generateRid()));
    } catch (error) {
      throw error;
    }
  }

  async changePlayerPrivileges(user_id, permissions) {
    try {
      if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
      const payload = {
        _type: 'ChangeRoomPrivilegeRequest',
        user_id,
        permissions,
        rid: generateRid(),
      };
      const sender = new SendPayloadWithoutResponse(this.bot);
      await sender.sendPayloadWithoutResponse(payload);
    } catch (error) {
      throw error;
    }
  }

  permissions = {
    get: async (user_id) => {
      try {
        if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
        if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
        if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');

        const rid = generateRid();
        const request = new GetRoomPrivilegeRequest(user_id, rid);
        const payload = { _type: 'GetRoomPrivilegeRequest', ...request };

        const sender = new SendPayloadAndGetResponse(this.bot);
        const response = await sender.sendPayloadAndGetResponse(payload, GetRoomPrivilegeRequest.Response);
        return response.content.content;
      } catch (error) {
        throw error;
      }
    },
  };

  moderator = {
    add: async (user_id) => {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.changePlayerPrivileges(user_id, { moderator: true });
    },
    remove: async (user_id) => {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.changePlayerPrivileges(user_id, { moderator: false });
    },
  };

  designer = {
    add: async (user_id) => {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.changePlayerPrivileges(user_id, { designer: true });
    },
    remove: async (user_id) => {
      if (!user_id) throw new HighriseTypeError(ErrorCodes.MissingParameters, 'user_id');
      if (typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');
      await this.changePlayerPrivileges(user_id, { designer: false });
    },
  };

  outfit = {
    get: async (user_id) => {
      try {
        if (!this.bot.isWebSocketOpen()) throw new HighrisejsError(ErrorCodes.WebSocketNotOpen);
        if (!user_id) user_id = this.bot.info.user.id;
        if (user_id && typeof user_id !== 'string') throw new HighriseTypeError(ErrorCodes.InvalidParameterType, 'user_id', 'string');

        const rid = generateRid();
        const request = new GetUserOutfitRequest(user_id, rid);
        const payload = { _type: 'GetUserOutfitRequest', ...request };

        const sender = new SendPayloadAndGetResponse(this.bot);
        const response = await sender.sendPayloadAndGetResponse(payload, GetUserOutfitRequest.Response);
        return response.outfit.outfit;
      } catch (error) {
        throw error;
      }
    },
  };
}

module.exports = FixedUsers;

const EventEmitter = require('node:events');
const WebSocket = require('ws');
const { HighrisejsError, ErrorCodes } = require('../errors');
const { WebSocketEventParameters, WebSocketEventType } = require('../utils/Events');
const { generateRid, packageAuthor, packageVersion, getUptime } = require('../utils/Util');
const { handleEvent } = require('../handlers/events');

class WebSocketManager extends EventEmitter {
  constructor(client) {
    super();

    this.connected = false;
    this._reconnecting = false;
    this._reconnectDuration = 5;

    this._reconnectTimeout = null;
    this._keepAliveInterval = null;

    this._onOpen = this._onOpen.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onClose = this._onClose.bind(this);
    this._onError = this._onError.bind(this);
    this._onEvent = this._onEvent.bind(this);

    Object.defineProperty(this, 'client', { value: client });
  }

  /**
   * Connects to the Highrise WebSocket gateway.
   * @param {string} token - The token to use for the connection.
   * @param {string} room - The room to connect to.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[i] WebSocket is already connected. Disconnecting first...');
      this.ws.close(); // Ensure the existing connection is closed
    }

    const invalidToken = new HighrisejsError(ErrorCodes.TokenInvalid);
    const invalidRoom = new HighrisejsError(ErrorCodes.RoomInvalid);

    const events = this.client.Events.map(e => WebSocketEventParameters[e]).filter(Boolean).join(',');
    if (!events.length) throw new HighrisejsError(ErrorCodes.ClientMissingEvents);

    if (!this.auth.token) throw invalidToken;
    if (!this.auth.room.id) throw invalidRoom;

    if (this.auth.token.length !== 64) throw invalidToken;
    if (this.auth.room.id.length !== 24) throw invalidRoom;

    try {
      const endpoint = `wss://highrise.game/web/botapi?events=${events}`;
      this.ws = new WebSocket(endpoint, {
        headers: {
          'room-id': this.auth.room.id,
          'api-token': this.auth.token,
        }
      });

      this.ws.setMaxListeners(100);
      this.connected = true;
      this.ws.addEventListener('open', this._onOpen);
      this.ws.addEventListener('message', this._onMessage);
      this.ws.addEventListener('close', this._onClose);
      this.ws.addEventListener('error', this._onError);

    } catch (error) {
      this.connected = false;
      this._reconnecting = false;
      console.error("[i]".red + " Error when creating WebSocket: " + error + ". Please report this to @iHsein in the Highrise Discord server.");
    }
  }

  /**
   * Changes the room the bot is connected to.
   * @param {string} newRoomId - The ID of the new room to connect to.
   * @returns {Promise<void>}
   */
  async changeRoom(newRoomId) {
    if (this.auth.room.id === newRoomId) {
      console.log('[i] Bot is already connected to the same room.');
      return;
    }

    console.log('[i] Changing room...');

    // Properly shut down the current connection
    await this.shutdown();

    // Update the room ID
    this.auth.room.id = newRoomId;

    // Reconnect with the new room ID
    this.connect();
  }

  async reconnect() {
    if (this._reconnecting) {
      return console.log('[i]'.blue + ' Bot is already reconnecting. Skipping reconnect.');
    }

    this._reconnecting = true;
    console.log('[i]'.yellow + ' Attempting to reconnect in' + ` ${this._reconnectDuration}`.yellow + ' seconds...');

    clearTimeout(this._reconnectTimeout);
    this._reconnectTimeout = setTimeout(() => {
      this._reconnecting = false;
      this.info.connection_id = null;
      this.clearListeners();

      this.connect();
      this._reconnectDuration = 5;
    }, this._reconnectDuration * 1000);
  }

  /**
   * Send a keepalive request. This must be sent every 15 seconds or the server will terminate the connection.
   * @returns {Promise<void>}
   * @private
   */
  async _sendKeepAlive() {
    if (!this.connected) return;
    if (this.ws && this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({ _type: 'KeepaliveRequest', rid: generateRid() }));

    clearTimeout(this._keepAliveInterval);
    this._keepAliveInterval = setTimeout(() => {
      this._sendKeepAlive();
    }, 15 * 1000);
  }

  /**
   * Destroys the WebSocket connection.
   * @returns {Promise<void>}
   * @private
   */
  destroy() {
    if (!this.connected) return console.log('[i]'.blue + ' WebSocket is already destroyed.');

    this.connected = false;
    this._reconnecting = false;
    this._keepAliveInterval = null;
    this._reconnectTimeout = null;
    this.ws.close();
    this.clearListeners();
    this.resetInfo();
    this.ws = null;
  }
  
  shutdown() {
    if (!this.connected) return console.log('[i]'.blue + ' WebSocket is already destroyed.');

    console.log('[i] Shutting down WebSocket...');
    this.connected = false;
    this._reconnecting = false;
    clearTimeout(this._keepAliveInterval);
    clearTimeout(this._reconnectTimeout);
    if (this.ws) {
      this.ws.removeEventListener('open', this._onOpen);
      this.ws.removeEventListener('message', this._onMessage);
      this.ws.removeEventListener('close', this._onClose);
      this.ws.removeEventListener('error', this._onError);
      this.ws.close();
    }
    this.ws = null;
  }



  /**
   * Resets the client's info.
   * @returns {Promise<void>}
   * @private
   */
  resetInfo() {
    this.auth.token = null;
    this.auth.room.id = null;
    this.auth.room.name = null;

    this.info.user.id = null;
    this.info.owner.id = null;
    this.info.connection_id = null;
  }

  /**
   * Handle incoming messages from the WebSocket.
   * @param {*} data 
   * @returns 
   */
  _onEvent(data) {
    const eventType = data._type;
    const events = WebSocketEventType[eventType];
    if (!events) return;

    handleEvent.call(this, ...[eventType, data, this]);
  }

  _onMessage(event) {
    if (!this.connected) return;
    const data = JSON.parse(event.data);
    if (!data) return;
    const eventType = data._type;
    if (!eventType) return;

    this._onEvent(data);

    if (eventType === 'SessionMetadata') {
      this.auth.room.name = data.room_info.room_name ?? null;
      this.info.user.id = data.user_id ?? null;
      this.info.owner.id = data.room_info.owner_id ?? null;
      this.info.connection_id = data.connection_id ?? null;
      if (this.Cache) {
        this.room.cache.FetchUserCollection();
      }
    }

    if (this.Cache) {
      if (this.Events.includes(eventType)) {
        switch (eventType) {
          case 'UserJoinedEvent':
            const userData = {
              id: data.user.id,
              username: data.user.username,
              position: { x: data.position.x, y: data.position.y, z: data.position.z, facing: data.position.facing }
            }
            this.room.cache.addUserToCollection(data.user.id, userData);
            break;
          case 'UserLeftEvent':
            this.room.cache.removeUserFromCollection(data.user.id);
            break;
          case 'UserMovedEvent':
            this.room.cache.updateUserPosition(data.user.id, data.position);
            break;
        }
      }
    }

    // console.log("[i]".cyan + ` Received ${data._type} event.`.green + `\nData: ${JSON.stringify(data)}`);
  }

  /**
   * Handle open events.
   * @returns {Promise<void>}
   * @private
   */
  _onOpen() {
    console.log("[i]".cyan + ` Connected using Highrise JavaScript SDK(v${packageVersion()}) by ${packageAuthor()}.`);
    this._sendKeepAlive();
  }

  /**
   * Handles on close events.
   * @param {CloseEvent} event The close event.
   * @returns {Promise<void>}
   * @private
   */
  _onClose(event) {
    console.log("[i]".red + " WebSocket connection closed.");
    this.connected = false;
    this._reconnecting = false;
    this.reconnect();
  }

  /**
   * Handles on error events.
   * @param {ErrorEvent} event The error event.
   * @returns {Promise<void>}
   * @private
   */
  _onError(event) {
    console.error("[i]".red + ` WebSocket error: ${event.message}. Please report this to @iHsein in the Highrise Discord server.`);
    this.connected = false;
    this._reconnecting = false;
    this.reconnect();
  }

  isWebSocketOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  clearListeners() {
    if (this.ws) {
      this.ws.removeEventListener('open', this._onOpen);
      this.ws.removeEventListener('message', this._onMessage);
      this.ws.removeEventListener('close', this._onClose);
      this.ws.removeEventListener('error', this._onError);
    }
  }
}

module.exports = WebSocketManager;

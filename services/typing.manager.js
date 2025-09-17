class TypingManager {
  /**
   * @param {import('@whiskeysockets/baileys').ReturnType} sock - the Baileys socket instance (must have sendPresenceUpdate)
   * @param {object} opts
   * @param {number} opts.heartbeatMs - how often to refresh 'composing' state (default 4000)
   */
  constructor(sock, { heartbeatMs = 4000 } = {}) {
    if (!sock || typeof sock.sendPresenceUpdate !== 'function') {
      throw new Error('TypingManager requires a Baileys sock with sendPresenceUpdate');
    }
    this.sock = sock;
    this.heartbeatMs = heartbeatMs;
    // Map<jid, { interval: NodeJS.Timer, timeout: NodeJS.Timer|null }>
    this._active = new Map();
  }

  /**
   * Start showing typing for jid.
   * If durationMs provided, will auto-stop after that many milliseconds.
   * If durationMs omitted -> runs until stopTyping(jid) is called.
   * Returns true if started or was already running.
   */
  async startTyping(jid, durationMs = 5000) {
    if (!jid) return false;

    // If already active, reset duration timer if provided
    if (this._active.has(jid)) {
      const entry = this._active.get(jid);
      if (entry.timeout) {
        clearTimeout(entry.timeout);
        entry.timeout = null;
      }
      if (typeof durationMs === 'number') {
        entry.timeout = setTimeout(() => this.stopTyping(jid), durationMs);
      }
      return true;
    }

    try {
      // set initial composing
      await this.sock.sendPresenceUpdate('composing', jid).catch(() => {});
    } catch (e) {}

    // heartbeat to keep composing alive
    const interval = setInterval(() => {
      // ignore rejections but keep trying
      this.sock.sendPresenceUpdate('composing', jid).catch(() => {});
    }, this.heartbeatMs);

    let timeout = null;
    if (typeof durationMs === 'number') {
      timeout = setTimeout(() => this.stopTyping(jid), durationMs);
    }

    this._active.set(jid, { interval, timeout });
    return true;
  }

  /**
   * Stop typing for jid immediately.
   */
  async stopTyping(jid) {
    const entry = this._active.get(jid);
    if (!entry) {
      // still ensure we send paused once just in case
      try { await this.sock.sendPresenceUpdate('paused', jid).catch(()=>{}); } catch(e){}
      return false;
    }

    clearInterval(entry.interval);
    if (entry.timeout) clearTimeout(entry.timeout);
    this._active.delete(jid);

    try {
      await this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
    } catch (e) {}

    return true;
  }

  /**
   * Stop typing for all active jids.
   */
  async stopAll() {
    const jids = Array.from(this._active.keys());
    for (const jid of jids) await this.stopTyping(jid);
  }

  /**
   * Returns boolean whether jid is currently showing typing.
   */
  isTyping(jid) {
    return this._active.has(jid);
  }
}

module.exports = TypingManager;
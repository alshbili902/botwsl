'use strict';

/**
 * Isolated per-user in-memory session store keyed strictly by numeric Telegram user ID.
 * Ensures concurrent users never mix state or last-announcement texts.
 */
class UserSessionStore {
  constructor() {
    /** @type {Map<number, { awaitingAnnouncement: boolean, lastAnnouncementText: string | null, updatedAt: number }>} */
    this.sessions = new Map();
  }

  get(userId) {
    const key = Number(userId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        awaitingAnnouncement: false,
        lastAnnouncementText: null,
        updatedAt: Date.now(),
      });
    }
    return this.sessions.get(key);
  }

  setAwaitingAnnouncement(userId, awaiting) {
    const session = this.get(userId);
    session.awaitingAnnouncement = Boolean(awaiting);
    session.updatedAt = Date.now();
    return session;
  }

  setLastAnnouncement(userId, text) {
    const session = this.get(userId);
    session.lastAnnouncementText = text;
    session.awaitingAnnouncement = false;
    session.updatedAt = Date.now();
    return session;
  }
}

module.exports = {
  UserSessionStore,
};

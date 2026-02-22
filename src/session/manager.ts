/**
 * Session Manager
 *
 * 维护外部 Session ID（来自 OpenClaw / 请求头）到 Claude CLI Session ID 的映射。
 *
 * Claude CLI 自身会把 session 数据持久化在 ~/.claude/ 中，
 * 所以我们只需要维护映射关系。proxy 重启后映射丢失，
 * 但可以通过 CLI 的 session 文件重建（如果需要）。
 */

interface SessionEntry {
  cliSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();

  /**
   * 获取或创建 session 映射
   * 返回 { cliSessionId, isNew }
   */
  getOrCreate(externalId: string): { cliSessionId: string; isNew: boolean } {
    const existing = this.sessions.get(externalId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      existing.requestCount++;
      return { cliSessionId: existing.cliSessionId, isNew: false };
    }

    const cliSessionId = crypto.randomUUID();
    this.sessions.set(externalId, {
      cliSessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 1,
    });
    return { cliSessionId, isNew: true };
  }

  /**
   * 从请求中提取 session ID
   * 优先级: X-Session-Id header > body.session_id > null
   */
  extractSessionId(headers: Headers, body?: { session_id?: string }): string | null {
    return (
      headers.get("x-session-id") ||
      body?.session_id ||
      null
    );
  }

  /**
   * 获取所有活跃 session 信息
   */
  listSessions(): Array<{
    externalId: string;
    cliSessionId: string;
    createdAt: number;
    lastUsedAt: number;
    requestCount: number;
  }> {
    const result: Array<{
      externalId: string;
      cliSessionId: string;
      createdAt: number;
      lastUsedAt: number;
      requestCount: number;
    }> = [];
    for (const [externalId, entry] of this.sessions) {
      result.push({ externalId, ...entry });
    }
    return result;
  }

  /**
   * 删除指定 session
   */
  delete(externalId: string): boolean {
    return this.sessions.delete(externalId);
  }

  /**
   * 当前 session 数量
   */
  get size(): number {
    return this.sessions.size;
  }
}

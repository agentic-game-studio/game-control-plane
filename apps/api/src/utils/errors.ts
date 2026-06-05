/**
 * Typed error classes for the api.
 *
 * 11-M17: prefer `throw new ProjectNotFoundError(id)` over the
 * string-sentinel `throw new Error("__PROJECT_NOT_FOUND__")` we used
 * to use inside `updateData` callbacks. The sentinel was awkward
 * (caught by `e.message === "__..."` and skipped past the type
 * system — a typo would silently 500), and it didn't carry the
 * project id for logging.
 */

export class ProjectNotFoundError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
    this.projectId = projectId;
  }
}

export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export class TicketNotFoundError extends Error {
  readonly ticketId: string;
  constructor(ticketId: string) {
    super(`Ticket not found: ${ticketId}`);
    this.name = "TicketNotFoundError";
    this.ticketId = ticketId;
  }
}

/** Type-narrowing helper for `catch` blocks. */
export function isErrorCode(err: unknown, ctor: new (...args: never[]) => Error): boolean {
  return err instanceof ctor;
}

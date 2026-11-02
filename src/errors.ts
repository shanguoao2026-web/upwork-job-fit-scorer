/** Bad input, profile, or arguments. Exit code 2. */
export class UserError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Optional model call failed or is not configured. Exit code 3. */
export class LlmError extends Error {
  readonly exitCode = 3;

  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

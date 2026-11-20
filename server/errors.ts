/** An Error that carries the HTTP status the routes answer with. */
export type HttpError = Error & { status?: number };

export function httpError(status: number, message: string): HttpError {
  return Object.assign(new Error(message), { status });
}

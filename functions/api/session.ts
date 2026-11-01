import { makeSessionHandler, type SessionEnvironment } from '../../backend/auth/session';

export function onRequest(context: { request: Request; env: SessionEnvironment }) {
  return makeSessionHandler(context.env)(context.request);
}

import { ModuleRequestError } from '../core/module-rpc';
import type { MessageKey } from '../i18n';

const keys: Record<string, MessageKey> = {
  EMAIL_EXISTS: 'userErrorEmailExists',
  SELF_ACTION: 'userErrorSelf',
  SELF_LOCKOUT: 'userErrorSelfLockout',
  INVALID_INPUT: 'userErrorInvalidEmail',
  ACCESS_DENIED: 'userErrorDenied',
  WEAK_PASSWORD: 'passwordWeak',
  REAUTH_REQUIRED: 'passwordReauth',
};
/** Safe, localized message key for a user-administration failure. */
export function userErrorKey(error: unknown): MessageKey {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return keys[code] ?? 'userErrorFailed';
}
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Same rule as the profile display name and the workstel-users function. */
export const isDisplayName = (name: string) =>
  name.length >= 1 && name.length <= 80 && !/\p{Cc}/u.test(name);

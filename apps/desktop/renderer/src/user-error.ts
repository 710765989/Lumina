import {userErrorMessage as normalizeError} from '@lumina/contracts';
import {translateMessage,sourceMessage} from './i18n';
export function userErrorMessage(error:unknown){
  const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error??'');
  const source=sourceMessage(message);
  return translateMessage(normalizeError(source===message?error:source));
}

import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gen = customAlphabet(alphabet, 16);

export function newId(prefix = '') {
  return prefix ? `${prefix}_${gen()}` : gen();
}

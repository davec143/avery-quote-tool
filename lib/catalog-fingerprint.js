import { createHash } from 'node:crypto';
export function catalogFingerprint(item) {
  return createHash('sha256').update(JSON.stringify([item.title,item.variant,item.specs,item.pack_qty])).digest('hex');
}

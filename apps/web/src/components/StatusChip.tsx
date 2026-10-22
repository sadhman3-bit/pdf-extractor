import { S } from '../strings';
import { Chip, type Tone } from './ui';

export type AnyStatus =
  | 'ok'
  | 'review'
  | 'unknown'
  | 'ambiguous'
  | 'error'
  | 'duplicate'
  | 'skipped'
  | 'pending'
  | 'running';

const TONE: Record<AnyStatus, Tone> = {
  ok: 'success',
  duplicate: 'neutral',
  review: 'warn',
  unknown: 'warn',
  ambiguous: 'warn',
  error: 'danger',
  skipped: 'neutral',
  pending: 'neutral',
  running: 'accent',
};

export function StatusChip({ status }: { status: AnyStatus }) {
  return <Chip tone={TONE[status]}>{S.status[status]}</Chip>;
}

import { Badge, badgeVariants } from './ui/badge';
import type { Deadline } from '@/lib/types';

/* A verified date links to the page it was read off, so any reader can
   re-check it. An estimate says so rather than implying more than we know. */
/* `plain` renders a span instead of a link, for use inside another link. */
export function Provenance({ deadline, plain = false }: { deadline: Deadline | null | undefined; plain?: boolean }) {
  if (!deadline) return null;
  if (!deadline.confirmed) {
    return (
      <Badge variant="est" title="Extrapolated or second-hand, not checked against the source page">
        est.
      </Badge>
    );
  }
  const when = deadline.verified_on ? ` on ${deadline.verified_on}` : '';
  return deadline.source && !plain ? (
    <a
      className={badgeVariants({ variant: 'ok' })}
      href={deadline.source}
      target="_blank"
      rel="noopener"
      title={`Checked against this page${when}`}
      onClick={(e) => e.stopPropagation()}
    >
      ✓ verified
    </a>
  ) : (
    <Badge variant="ok">✓ verified</Badge>
  );
}

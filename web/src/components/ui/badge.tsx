import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* Tags are neutral labels (publisher, topic); ranks carry a colour slot and
   always print their name, so colour is never the only signal. */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.72rem] font-semibold leading-5 whitespace-nowrap',
  {
    variants: {
      variant: {
        tag: 'border-border bg-surface-2 text-fg-2',
        publisher: 'border-border bg-surface-1 text-fg font-bold',
        track: 'border-dashed border-border-strong bg-transparent text-fg-2',
        ccs: 'border-accent/30 bg-accent-soft text-accent',
        top: 'border-rank-top/40 bg-rank-top/12 text-rank-top',
        mid: 'border-rank-mid/40 bg-rank-mid/12 text-rank-mid',
        base: 'border-rank-base/40 bg-rank-base/12 text-rank-base',
        off: 'border-rank-off/40 bg-rank-off/12 text-rank-off',
        est: 'border-warning/50 bg-warning/12 text-fg-2 rounded-md px-1.5 text-[0.68rem]',
        ok: 'border-good/40 bg-good/10 text-good rounded-md px-1.5 text-[0.68rem] no-underline hover:bg-good/20',
      },
    },
    defaultVariants: { variant: 'tag' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

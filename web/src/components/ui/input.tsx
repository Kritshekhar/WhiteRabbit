import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-border bg-surface-1 px-3 text-sm text-fg placeholder:text-muted',
        'focus-visible:outline-2 focus-visible:outline-accent shadow-sm',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

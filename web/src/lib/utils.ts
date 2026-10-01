import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* Every internal link goes through here so it carries the /WhiteRabbit/ base. */
const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export function href(path = ''): string {
  return BASE + path.replace(/^\/+/, '');
}

export const venueHref = (id: string) => href(`conferences/${encodeURIComponent(id)}/`);
export const grantHref = (id: string) => href(`grants/${encodeURIComponent(id)}/`);

export const money = (n: number) => `$${n.toLocaleString('en-US')}`;

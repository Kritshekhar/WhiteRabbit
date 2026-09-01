/* Shared interaction: theme, flip behaviour, and the two filter controls both
   pages use. Kept here because a bug fixed in one page was silently still
   present in the other while these were duplicated. */

export const $ = (id) => document.getElementById(id);

export function initTheme() {
  const saved = localStorage.getItem('cd-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#theme-toggle')) return;
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('cd-theme', root.dataset.theme);
  });
}

/* Tap-to-flip is for devices with no hover. On a mouse, hover already reveals
   the back, so a click would latch `is-flipped` on top and leave the card
   stuck reversed. (The CSS gates :hover the same way; a touch browser keeps an
   element in :hover after a tap, which pinned the card face-down.) */
export function initFlip(grid) {
  const hoverCapable = window.matchMedia('(hover: hover)');
  grid.addEventListener('click', (e) => {
    if (hoverCapable.matches || e.target.closest('a')) return;
    const card = e.target.closest('.flip');
    if (card) card.classList.toggle('is-flipped');
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.flip');
    if (!card) return;
    e.preventDefault();
    card.classList.toggle('is-flipped');
  });
}

/* Single-select chip row. `attr` is the data attribute holding the value. */
export function initChips(container, attr, onPick) {
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    container.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    onPick(chip.dataset[attr]);
  });
}

/* Multi-select popover over a <details>. Returns a Set the caller reads. */
export function initMultiSelect({ menu, list, clear, summary, label, counts, onChange }) {
  const chosen = new Set();
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  list.innerHTML = sorted.map(([value, n]) => `
    <label class="dropdown-item">
      <input type="checkbox" value="${value}"><span>${value}</span><span class="dropdown-count">${n}</span>
    </label>`).join('');

  const sync = () => {
    const picked = [...chosen];
    summary.textContent = picked.length
      ? `${label}: ${picked.length <= 2 ? picked.join(', ') : `${picked.length} selected`}`
      : `${label}: all`;
    menu.classList.toggle('is-active', picked.length > 0);
  };

  list.addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    box.checked ? chosen.add(box.value) : chosen.delete(box.value);
    sync();
    onChange(chosen);
  });
  clear.addEventListener('click', () => {
    chosen.clear();
    list.querySelectorAll('input').forEach((b) => { b.checked = false; });
    sync();
    onChange(chosen);
  });
  // a <details> popover stays open on an outside click unless told otherwise
  document.addEventListener('click', (e) => {
    if (menu.open && !e.target.closest(`#${menu.id}`)) menu.open = false;
  });
  sync();
  return chosen;
}

/* Clicking anywhere on a row opens its detail page, except on the links inside
   it (calendar, official site, the verified badge), which do their own thing. */
export function initRowNav(container) {
  const go = (el, newTab) => {
    const href = el.dataset.href;
    if (!href) return;
    newTab ? window.open(href, '_blank', 'noopener') : (location.href = href);
  };
  container.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const rowEl = e.target.closest('.row');
    if (rowEl) go(rowEl, e.metaKey || e.ctrlKey);
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const rowEl = e.target.closest('.row');
    if (rowEl && !e.target.closest('a')) { e.preventDefault(); go(rowEl); }
  });
}

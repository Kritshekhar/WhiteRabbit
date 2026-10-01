export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card min-w-0 p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="mt-0.5 mb-3 max-w-3xl text-xs text-muted">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

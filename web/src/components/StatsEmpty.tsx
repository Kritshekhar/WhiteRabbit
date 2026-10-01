/* Shown until the proceedings crawl has filled the tables. */
export function StatsEmpty({ what }: { what: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 border-dashed p-8 text-center">
      <span aria-hidden className="text-3xl">📚</span>
      <p className="font-semibold">Proceedings data coming soon</p>
      <p className="max-w-md text-sm text-muted">
        Papers per year, keywords and topics for {what} will appear here once the proceedings crawl from DBLP and OpenAlex
        has run and its numbers have been checked.
      </p>
    </div>
  );
}

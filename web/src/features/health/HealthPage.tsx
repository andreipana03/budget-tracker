import { useHealth } from './useHealth'

export function HealthPage() {
  const { data, isPending, isError } = useHealth()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <section className="w-full max-w-sm rounded-lg bg-surface p-5">
        <h1 className="text-headline">Budget Tracker</h1>
        <p className="text-subhead text-label-2">System status</p>
        <dl className="mt-4 space-y-2 text-body">
          {isPending && <p className="text-label-2">Checking…</p>}
          {isError && <StatusRow label="API" value="unreachable" healthy={false} />}
          {data && (
            <>
              <StatusRow label="API" value={data.status} healthy={data.status === 'ok'} />
              <StatusRow label="Database" value={data.database} healthy={data.database === 'up'} />
            </>
          )}
        </dl>
      </section>
    </main>
  )
}

function StatusRow({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd className={healthy ? 'text-positive' : 'text-negative'}>{value}</dd>
    </div>
  )
}

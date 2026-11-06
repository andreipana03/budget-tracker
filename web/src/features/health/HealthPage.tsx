import { Screen } from '@/app/Screen'
import { List, Row } from '@/components/ui/List'
import { SkeletonRows } from '@/components/ui/States'

import { useHealth } from './useHealth'

/** /status — is the API up, and can it reach its database? */
export function HealthPage() {
  const { data, isPending, isError } = useHealth()

  return (
    <Screen title="Status" hideToolbarActions>
      <h2 className="sr-only">System status</h2>
      {isPending ? (
        <SkeletonRows count={2} label="Checking" />
      ) : (
        <List>
          <Row title="API" trailing={<StatusValue value={isError ? 'unreachable' : (data?.status ?? '—')} healthy={!isError && data?.status === 'ok'} />} />
          {data && <Row title="Database" trailing={<StatusValue value={data.database} healthy={data.database === 'up'} />} />}
        </List>
      )}
    </Screen>
  )
}

function StatusValue({ value, healthy }: { value: string; healthy: boolean }) {
  return <span className={healthy ? 'text-positive' : 'text-negative'}>{value}</span>
}

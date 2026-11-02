import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { useHealth } from './useHealth'

export function HealthPage() {
  const { data, isPending, isError } = useHealth()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Budget Tracker</CardTitle>
          <CardDescription>System status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {isPending && <p className="text-muted-foreground">Checking…</p>}
          {isError && <StatusRow label="API" value="unreachable" healthy={false} />}
          {data && (
            <>
              <StatusRow label="API" value={data.status} healthy={data.status === 'ok'} />
              <StatusRow label="Database" value={data.database} healthy={data.database === 'up'} />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function StatusRow({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <Badge variant={healthy ? 'default' : 'destructive'}>{value}</Badge>
    </div>
  )
}

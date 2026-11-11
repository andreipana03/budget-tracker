import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MiniPace, PaceAnimationScope, PaceBar } from '@/components/ui/PaceBar'

const bar = (key?: string) => (
  <PaceBar
    animationKey={key}
    segments={[{ color: 'mint', amountMinor: 24640 }]}
    spentMinor={24640}
    budgetMinor={200000}
    currency="RON"
    marker={0.6}
  />
)

describe('pace bar grows in once per screen (design § 3 Motion)', () => {
  afterEach(cleanup)

  it('animates the first mount with a key, never again', () => {
    const first = render(bar('test-screen'))
    expect(first.container.querySelector('.ui-grow-x')).not.toBeNull()
    first.unmount()
    const again = render(bar('test-screen'))
    expect(again.container.querySelector('.ui-grow-x')).toBeNull()
  })

  it('keeps the old behaviour without a key', () => {
    render(bar())
    cleanup()
    const { container } = render(bar())
    expect(container.querySelector('.ui-grow-x')).not.toBeNull()
  })

  it('shares a key through PaceAnimationScope (budget rows)', () => {
    const mini = () => (
      <PaceAnimationScope id="scoped-screen">
        <MiniPace spentMinor={100} limitMinor={200} color="mint" elapsed={0.5} />
      </PaceAnimationScope>
    )
    const first = render(mini())
    expect(first.container.querySelector('.ui-grow-x')).not.toBeNull()
    first.unmount()
    expect(render(mini()).container.querySelector('.ui-grow-x')).toBeNull()
  })
})

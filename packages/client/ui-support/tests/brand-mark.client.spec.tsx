// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { WiseBrandMark } from '../src/client/WiseBrandMark.tsx'

describe('WiseBrandMark', () => {
  it('renders the orange W mark at the requested size', () => {
    const view = render(<WiseBrandMark size={34} />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('height')).toBe('34')
    expect(svg?.textContent).toBe('W')
    view.unmount()
  })

  it('forwards the host class', () => {
    const view = render(<WiseBrandMark size={24} className="host-mark" />)
    expect(view.container.querySelector('svg')?.getAttribute('class')).toBe('host-mark')
    view.unmount()
  })
})

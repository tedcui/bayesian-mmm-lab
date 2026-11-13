import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from '../app/App'

describe('M1 app shell', () => {
  it('labels the page as a placeholder without model results', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Synthetic data · setup placeholder')
    expect(html).toContain('No model results are available yet')
  })
})

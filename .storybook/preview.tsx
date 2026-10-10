import type { Preview } from '@storybook/nextjs-vite'
import '@/app/globals.css'
import './preview.css'

document.documentElement.lang = 'en'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    nextjs: { appDirectory: true },
    a11y: { test: 'error' },
    viewport: {
      options: {
        mobile: { name: 'Mobile (390px)', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        narrow: { name: 'Narrow mobile (320px)', styles: { width: '320px', height: '740px' }, type: 'mobile' },
        tablet: { name: 'Tablet (768px)', styles: { width: '768px', height: '1024px' }, type: 'tablet' },
      },
    },
  },
  decorators: [(Story) => <main className="w-full max-w-lg font-sans"><Story /></main>],
}

export default preview

import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: ['../stories/ui/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs-vite',
    // The Next adapter loads config/env from this directory, not the app root.
    options: { nextConfigPath: fileURLToPath(new URL('./next.config.ts', import.meta.url)) },
  },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    // Do not expose the application's .env.local through Vite either.
    config.envDir = fileURLToPath(new URL('.', import.meta.url))
    config.resolve = {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        '@': fileURLToPath(new URL('..', import.meta.url)),
      },
    }
    return config
  },
}

export default config

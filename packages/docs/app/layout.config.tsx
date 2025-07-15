import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import Image from 'next/image'

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  githubUrl: 'https://github.com/naviprotocol/naviprotocol-monorepo',
  nav: {
    title: (
      <>
        <Image src="/assets/logo.png" alt="Logo" width={26} height={26} />
        NAVI Protocol SDKS
      </>
    )
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: []
}

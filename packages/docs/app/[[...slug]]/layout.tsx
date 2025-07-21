import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '@/app/layout.config'
import { source } from '@/lib/source'
import Image from 'next/image'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      {...baseOptions}
      tree={source.pageTree}
      sidebar={{
        tabs: [
          {
            title: 'Lending',
            description: 'NAVI Lending SDK',
            url: '/lending',
            icon: <Image src="/assets/logo.png" alt="Lending" width={24} height={24} />
          },
          {
            title: 'Astros Aggregator',
            description: 'Swap coins on Sui',
            url: '/swap',
            icon: <Image src="/assets/astros.png" alt="Lending" width={24} height={24} />
          },
          {
            title: 'Astros Bridge',
            description: 'Swap coins cross chain',
            url: '/bridge',
            icon: <Image src="/assets/astros.png" alt="Lending" width={24} height={24} />
          },
          {
            title: 'Wallet Client',
            description: 'Wallet client SDK',
            url: '/wallet-client',
            icon: <Image src="/assets/logo.png" alt="Lending" width={24} height={24} />
          },
          {
            title: 'NAVI SDK Migration',
            description: 'migration from navi-sdk package',
            url: '/navi-sdk-migration/lending',
            icon: <Image src="/assets/logo.png" alt="Lending" width={24} height={24} />
          }
        ]
      }}
    >
      {children}
    </DocsLayout>
  )
}

import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ['typescript', 'twoslash'],
  redirects: () => {
		return [
			{
				source: '/',
				destination: '/lending',
				statusCode: 302,
			},
		];
	},
}

export default withMDX(config)

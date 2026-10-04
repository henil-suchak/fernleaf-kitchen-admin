import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (process.env.NODE_ENV === 'production') {
  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL must be configured for a production build.');
  }

  const parsedApiUrl = new URL(apiUrl);
  if (parsedApiUrl.protocol !== 'https:' && parsedApiUrl.protocol !== 'http:') {
    throw new Error('NEXT_PUBLIC_API_URL must use http or https.');
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;

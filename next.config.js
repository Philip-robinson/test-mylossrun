/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer, webpack }) => {
    config.resolve.modules = [
      require('path').resolve(__dirname),
      ...(config.resolve.modules || ['node_modules']),
    ];

    config.resolve.alias = {
      ...config.resolve.alias,
      "@mui/material": require('path').resolve(__dirname, 'node_modules/@mui/material'),
      "@mui/icons-material": require('path').resolve(__dirname, 'node_modules/@mui/icons-material'),
      "@emotion/react": require('path').resolve(__dirname, 'node_modules/@emotion/react'),
      "@emotion/styled": require('path').resolve(__dirname, 'node_modules/@emotion/styled'),
      "config": require('path').resolve(__dirname, 'app/lib/config.js'),
      "utils": require('path').resolve(__dirname, 'app/lib/utils.js'),
      "fileUtils": require('path').resolve(__dirname, 'app/lib/fileUtils.js'),
      "services": require('path').resolve(__dirname, 'app/services'),
      "components": require('path').resolve(__dirname, 'app/components'),
      "common": require('path').resolve(__dirname, 'app/common'),
      "components/common": require('path').resolve(__dirname, 'app/components/common'),
    };

    // Configure for Konva.js to work in browser without canvas module
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
      fs: false,
    };

    // Replace canvas with empty module for all builds
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^canvas$/,
        require.resolve('./app/lib/empty-module.js')
      )
    );

    return config;
  },
};

module.exports = nextConfig;

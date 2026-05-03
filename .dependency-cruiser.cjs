module.exports = {
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    exclude: '^node_modules|^\\.git',
    includeOnly: '^(eslint\\.config\\.mjs|scripts/.*\\.(js|mjs|cjs)|.*\\/swfobject\\.js|.*\\/audio-player\\.js|images/icons/icomoon/svgxuse\\.js)$'
  },
  forbidden: []
};
